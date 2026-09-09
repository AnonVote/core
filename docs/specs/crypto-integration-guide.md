# @anonvote/crypto Integration Guide

**Package:** [`@anonvote/crypto`](https://github.com/AnonVote/js)  
**Audience:** Backend, contract-adapter, and service contributors integrating AnonVote cryptographic primitives.

This guide specifies how the five exported primitives compose in production code. The package README documents what each primitive does; this document defines the order of operations, persistence boundaries, key scope, and failure handling required to preserve AnonVote's privacy model.

---

## Integration Rules

- Call primitives in the sequences below. Do not reorder them to fit local storage or API convenience.
- Persist only derived values that this guide explicitly marks as safe to store.
- Treat raw identifiers, raw tokens, and ballot encryption keys as secrets.
- Use one AES-256 key per ballot. A shared application key is not protocol-compliant.
- Treat `decryptVote` authentication failures as critical tally failures, not as skipped votes.

---

## Identity-to-Hash Sequence

`hashIdentifier` is used only for voter eligibility matching. It trims and lowercases the provided identifier before hashing, then returns a 64-character SHA-256 hex string.

### Sequence

1. Receive the voter identifier from a trusted ingestion path, such as an eligibility CSV upload or token request form.
2. Apply any application-level canonicalization that is part of the eligibility policy before both upload and lookup. For example, if the organization treats employee IDs as case-sensitive, do not rely on email-style lowercasing.
3. Call `hashIdentifier(identifier)` exactly once at the persistence boundary.
4. Store only the returned `identifierHash`.
5. After hashing, do not store, log, return, enqueue, or attach the raw identifier to audit events.
6. During token request, hash the submitted identifier the same way and look up the stored `identifierHash`.

### Example

```typescript
import { hashIdentifier } from "@anonvote/crypto";

type EligibilityEntry = {
  eligibilityListId: string;
  identifierHash: string;
  tokenIssued: boolean;
};

function buildEligibilityEntry(
  eligibilityListId: string,
  submittedIdentifier: string,
): EligibilityEntry {
  const identifierHash = hashIdentifier(submittedIdentifier);

  return {
    eligibilityListId,
    identifierHash,
    tokenIssued: false,
  };
}

function findEligibilityHash(submittedIdentifier: string): string {
  return hashIdentifier(submittedIdentifier);
}
```

The value returned by `hashIdentifier` may be stored and compared. The input must be discarded after this point.

---

## Token Lifecycle Sequence

`generateToken` creates the raw one-time credential. `hashToken` creates the server-side lookup value. The raw token and token hash have different purposes and must never be swapped.

### Sequence

1. Verify that the submitted identifier hash exists in the ballot eligibility list and has not already received a token.
2. Call `generateToken()` to create `rawToken`.
3. Call `hashToken(rawToken)` to create `tokenHash`.
4. Store `tokenHash` with `ballotId`, `used: false`, and issuance metadata.
5. Mark the eligibility entry as `tokenIssued: true` in the same transaction.
6. Deliver `rawToken` to the voter exactly once.
7. Discard `rawToken` server-side. Do not log it, store it, place it in analytics, or write it to an audit event.
8. When the voter redeems the token, receive the raw token from the request.
9. Call `hashToken(rawTokenFromRequest)` and compare the result to stored `tokenHash`.
10. Validate that the token exists, belongs to the ballot, is not used, and is not otherwise revoked.
11. Only after token validation succeeds, continue to option validation and vote encryption.
12. Mark the token used in the same transaction that stores the vote.

### Example

```typescript
import { generateToken, hashToken } from "@anonvote/crypto";

type StoredToken = {
  ballotId: string;
  tokenHash: string;
  used: boolean;
};

function issueToken(ballotId: string): { rawToken: string; stored: StoredToken } {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  return {
    rawToken,
    stored: {
      ballotId,
      tokenHash,
      used: false,
    },
  };
}

function validateRedeemedToken(
  ballotId: string,
  rawTokenFromRequest: string,
  lookupByTokenHash: (tokenHash: string) => StoredToken | undefined,
): StoredToken {
  const tokenHash = hashToken(rawTokenFromRequest);
  const stored = lookupByTokenHash(tokenHash);

  if (!stored || stored.ballotId !== ballotId || stored.used) {
    throw new Error("Invalid token for this ballot");
  }

  return stored;
}
```

The raw token is a bearer secret. Anyone holding it can attempt to vote until it is used or revoked.

---

## Vote Encryption Sequence

`encryptVote` encrypts the selected ballot option with AES-256-GCM and returns an encrypted payload string in `base64(iv):base64(authTag):base64(ciphertext)` format. The IV is generated inside `encryptVote` and is part of the returned payload.

### Sequence

1. Receive `ballotId`, raw token, and `optionId`.
2. Hash and validate the raw token as described in the token lifecycle.
3. Load the ballot and verify that it is open.
4. Verify that `optionId` belongs to the ballot.
5. Resolve the ballot's per-ballot encryption key from secure configuration or secret storage.
6. Call `encryptVote(optionId, ballotKey)`.
7. Store the returned encrypted payload on the vote record.
8. Do not store the raw token or voter identifier on the vote record.
9. Prefer not to store plaintext `optionId` on the vote record. If a relational schema temporarily requires an option reference, treat it as a known privacy weakening and remove it before production privacy review.
10. Mark the token used in the same transaction.
11. During tally, load the same ballot key and call `decryptVote(encryptedPayload, ballotKey)` for each vote.
12. If any decrypt call throws, halt the tally, mark the ballot result unpublished or failed, alert an operator, and investigate key mismatch or tampering. Do not silently skip the vote.

### Example

```typescript
import { encryptVote, decryptVote } from "@anonvote/crypto";

type VoteRecord = {
  ballotId: string;
  encryptedPayload: string;
  weight: number;
};

function storeVote(
  ballotId: string,
  optionId: string,
  ballotKey: string,
  weight = 1,
): VoteRecord {
  const encryptedPayload = encryptVote(optionId, ballotKey);

  return {
    ballotId,
    encryptedPayload,
    weight,
  };
}

function tallyVotes(votes: VoteRecord[], ballotKey: string): Record<string, number> {
  const tally: Record<string, number> = {};

  for (const vote of votes) {
    let optionId: string;

    try {
      optionId = decryptVote(vote.encryptedPayload, ballotKey);
    } catch (error) {
      throw new Error(
        `Cannot publish tally: encrypted vote failed authentication (${String(error)})`,
      );
    }

    tally[optionId] = (tally[optionId] ?? 0) + vote.weight;
  }

  return tally;
}
```

An AES-GCM authentication failure means the ciphertext, IV, auth tag, or key is wrong. In a tally, that is a ballot-integrity event.

---

## Key Management Specification

### Key Scope

Each ballot must have its own AES-256 encryption key. Never use one global application key for every ballot.

Required key shape:

```typescript
import crypto from "crypto";

const ballotKey = crypto.randomBytes(32).toString("hex");
```

The generated value is 32 bytes encoded as 64 lowercase hex characters, which is the format `encryptVote` and `decryptVote` require.

### Storage

Store ballot keys in environment-scoped secure storage, such as a cloud secret manager, KMS-backed encrypted parameter store, deployment secret, or operator-managed secret vault. The protocol requirement is:

- The database may store encrypted votes.
- The database must not store the ballot key beside those encrypted votes.
- The key name or secret reference may be stored with the ballot, but the key material must live outside the vote database.
- Access to ballot keys must be limited to the vote submission path and tally path.
- Logs, audit events, client responses, analytics, and on-chain records must never contain key material.

A compliant naming pattern is one secret per ballot, for example:

```text
ANONVOTE_BALLOT_KEY_<ballotId>
```

The exact secret name can vary by deployment platform, but it must resolve to a unique key for that ballot.

### Compromise Impact

If a ballot key is compromised, all encrypted votes for that ballot can be decrypted by the attacker. Per-ballot scoping limits the blast radius: compromise of one ballot key must not decrypt any other ballot's votes.

A global application key breaks this boundary. One leaked key would expose every historical and future ballot encrypted with that key.

### Rotation

Rotation is possible only while all affected encrypted payloads can be read, decrypted with the old key, re-encrypted with the new per-ballot key, and atomically updated before results are published.

Rotation is possible:

- Before any votes are cast: generate a new per-ballot key and replace the old unused key.
- After votes are cast but before publication: run a controlled migration that decrypts each payload with the old key, re-encrypts with the new key, verifies counts, and updates the ballot key reference atomically.

Rotation is not possible:

- If the old key is lost. AES-GCM payloads cannot be recovered without it.
- If any payload fails authentication under the old key. Halt and investigate before changing key material.
- After a result is published, unless the protocol explicitly republishes the result and audit trail with a rotation event.

---

## Common Misuse Patterns

These patterns are drawn from current ecosystem integration risks, including observed code in `AnonVote/core` and `AnonVote/contracts` documentation. They are not theoretical edge cases.

### 1. Using a global encryption key for every ballot

Observed pattern: `core` exposes one `BALLOT_ENCRYPTION_KEY` in process configuration and uses it for vote encryption and tallying.

Why it breaks privacy: one compromised application secret decrypts every ballot encrypted under it. It also makes independent deployments or ballot migrations incompatible when contributors assume different key scopes.

Required pattern: generate and store one 32-byte hex key per ballot, then resolve that specific key for `encryptVote` and `decryptVote`.

### 2. Storing plaintext vote choices next to encrypted payloads

Observed pattern: the current `core` vote schema stores both `optionId` and `encryptedPayload` on each vote record.

Why it breaks privacy: encrypting the option ID no longer protects ballot selections if the same row also contains the plaintext option ID. The database becomes enough to read votes without the ballot key.

Required pattern: store the encrypted payload as the vote choice. Keep only non-identifying metadata required for tally integrity, such as `ballotId`, `weight`, `rank`, and timestamps. If a temporary schema keeps `optionId`, treat the system as not yet meeting production privacy requirements.

### 3. Storing or logging raw identifiers after hashing

Observed pattern: token issuance debug logs in `core` print the raw voter identifier around the `hashIdentifier` call.

Why it breaks privacy: identifier hashes are intended to replace raw identifiers at the persistence boundary. Logs are persistence too; they can be retained, searched, exported, and correlated with token issuance times.

Required pattern: after `hashIdentifier`, retain only `identifierHash`. Logs may include ballot IDs, event IDs, counts, and hash prefixes only when operationally necessary, but never raw identifiers.

### 4. Storing the raw token after delivery

Observed risk: token issuance returns the raw token to the voter and stores a hash. Any integration that stores the raw token for support, reissue, email resend, or analytics undoes that boundary.

Why it breaks privacy: the raw token is the credential used to cast a vote. If retained server-side, database or log access can become vote access, and token issuance can be linked to later redemption.

Required pattern: store only `hashToken(rawToken)`. To validate redemption, hash the submitted raw token and compare hashes.

### 5. Calling `hashIdentifier` without normalization awareness

Observed pattern: eligibility upload sanitizes control characters before hashing, while token lookup passes user input directly to `hashIdentifier`. Contracts documentation also suggests using `hashIdentifier(ballotId)`, even though that helper lowercases and trims voter identifiers.

Why it breaks privacy or interoperability: `hashIdentifier` performs opinionated normalization for voter identifiers. Passing pre-normalized data from inconsistent sources can make eligible voters impossible to match. Reusing it for non-voter identifiers, such as ballot IDs, can create cross-language mismatches if another component hashes bytes exactly.

Required pattern: define canonical input rules per identifier type. Use `hashIdentifier` only for voter eligibility identifiers that should be trimmed and lowercased. For ballot IDs or protocol IDs, specify a separate exact-byte hash rule.

### 6. Catching and swallowing `decryptVote` authentication errors

Observed pattern: current `core` result tally logs decrypt failures and continues publishing a tally.

Why it breaks privacy and integrity: AES-GCM authentication failure signals tampering, malformed payload, or wrong key. Skipping the failed vote can publish an incorrect result while hiding the root cause.

Required pattern: abort tally publication on any decrypt failure, mark the tally attempt failed, and alert an operator. The ballot should not publish a result until every encrypted vote decrypts successfully with the ballot key.

### 7. Reusing an IV across multiple `encryptVote` calls

Observed risk: contributors sometimes try to make encrypted payloads deterministic for tests or contract fixtures by controlling IVs in wrappers around AES-GCM.

Why it breaks privacy: AES-GCM requires a unique IV for each encryption under the same key. IV reuse can reveal relationships between plaintexts and can compromise authentication guarantees.

Required pattern: call `encryptVote(optionId, ballotKey)` directly and let the package generate a fresh IV internally. Tests should assert round-trip behavior and payload format, not deterministic ciphertext.

### 8. Encrypting before validating the token and option

Observed risk: vote submission code paths can accidentally encrypt as soon as an `optionId` is present, then validate token state afterward.

Why it breaks privacy and integrity: invalid or replayed token attempts can create encrypted vote artifacts, logs, or timing signals before the credential is known to be valid.

Required pattern: validate token existence, ballot membership, unused state, ballot status, and option membership first. Only then call `encryptVote`.

---

## Minimal End-to-End Example

```typescript
import crypto from "crypto";
import {
  hashIdentifier,
  generateToken,
  hashToken,
  encryptVote,
  decryptVote,
} from "@anonvote/crypto";

const ballotId = "ballot-2026-06";
const optionId = "option-yes";
const voterIdentifier = "Alice@Example.com ";
const ballotKey = crypto.randomBytes(32).toString("hex");

const identifierHash = hashIdentifier(voterIdentifier);

const rawToken = generateToken();
const tokenHash = hashToken(rawToken);
const storedTokens = new Map([[tokenHash, { ballotId, used: false }]]);

const redeemedHash = hashToken(rawToken);
const storedToken = storedTokens.get(redeemedHash);

if (!storedToken || storedToken.ballotId !== ballotId || storedToken.used) {
  throw new Error("Invalid token");
}

const encryptedPayload = encryptVote(optionId, ballotKey);
storedToken.used = true;

const decryptedOptionId = decryptVote(encryptedPayload, ballotKey);

console.log({
  identifierHash,
  tokenHash,
  encryptedPayload,
  decryptedOptionId,
});
```

This example stores only the identifier hash, token hash, and encrypted vote payload. The raw identifier and raw token are used only at the edge of the flow and then discarded.
