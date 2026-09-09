# Cryptographic Primitive Specifications

**Package:** [`@anonvote/crypto`](https://github.com/AnonVote/js)  
**Source:** [`src/crypto.ts`](https://github.com/AnonVote/js/blob/main/src/crypto.ts)  
**Version:** 1.0.0  
**Status:** Active

---

## Overview

AnonVote's privacy model rests on five cryptographic primitives exported from `@anonvote/crypto`. Together they enforce two structural guarantees: voter identity cannot be linked to a ballot choice, and vote payloads cannot be read or altered without the per-ballot encryption key.

The five primitives are:

| Primitive | Role |
| --- | --- |
| `hashIdentifier` | Hash voter identifiers before storage so raw identities are never persisted |
| `generateToken` | Generate a 256-bit cryptographically random one-time voter credential |
| `hashToken` | Hash the raw token for server-side storage and lookup |
| `encryptVote` | Encrypt a ballot choice with AES-256-GCM before storage |
| `decryptVote` | Decrypt and authenticate a stored vote payload during tallying |

This document specifies each primitive in full: algorithm, input and output format, security property, and failure modes. It also specifies key management, which is not part of `@anonvote/crypto` itself but is required to use `encryptVote` and `decryptVote` correctly. See [`specs/crypto-integration-guide.md`](crypto-integration-guide.md) for the required call sequences and composition rules.

---

## 1. `hashIdentifier(id: string): string`

**Reference:** [`src/crypto.ts — hashIdentifier`](https://github.com/AnonVote/js/blob/main/src/crypto.ts)

### Algorithm and parameters

| Property | Value |
| --- | --- |
| Algorithm | SHA-256 |
| Standard | FIPS PUB 180-4 |
| Input preprocessing | `trim()` then `toLowerCase()` — applied in this order before hashing |
| Output | 64-character lowercase hex string |
| Deterministic | Yes — identical normalized inputs always produce identical outputs |
| Reversible | No |

### Input format and constraints

A UTF-8 string representing a voter identifier — typically an email address or an employee ID. The string may contain leading or trailing whitespace and may be mixed case. The function normalizes these before hashing.

Normalization is applied as: `SHA-256(id.trim().toLowerCase())`.

The trim step must precede the lowercase step. Reversing the order produces an identical result in practice, but the canonical sequence is trim-first to ensure deterministic behavior if an implementation applies the steps separately.

### Output format and guarantees

A 64-character lowercase hex string representing the 32-byte (256-bit) SHA-256 digest. The output is safe to store, compare, and log — it does not contain or reveal the original identifier.

### Security property

**Preimage resistance.** Given the stored hash, it is computationally infeasible to recover the original voter identifier. An attacker with read access to the `EligibilityEntry` table learns only that a hash is present for a ballot — not the identity of the voter it represents.

SHA-256 provides 128 bits of preimage resistance under current cryptanalysis. No practical attack against SHA-256 preimage resistance exists.

### Failure modes

| Failure | Consequence |
| --- | --- |
| Normalization differs between upload and lookup | An eligible voter's identifier produces a different hash at token request time, making them appear ineligible — they cannot receive a token |
| Normalization applied at lookup but not at upload (or vice versa) | Duplicate token issuance may become possible if two representations of the same identifier produce different hashes |
| Using a reversible encoding instead of SHA-256 | A database attacker can recover raw voter identities |
| Using this function for non-voter-identifier inputs (e.g. ballot UUIDs) | The trim-and-lowercase normalization is designed for human-readable identifiers; applying it to UUIDs or byte strings can create cross-component hash mismatches if another component hashes the same value without normalization |

---

## 2. `generateToken(): string`

**Reference:** [`src/crypto.ts — generateToken`](https://github.com/AnonVote/js/blob/main/src/crypto.ts)

### Algorithm and parameters

| Property | Value |
| --- | --- |
| Source | `crypto.randomBytes(32)` |
| Standard | NIST SP 800-90A (CSPRNG) |
| Entropy | 256 bits |
| Output | 64-character lowercase hex string |
| Deterministic | No — each call produces a fresh, independent random value |
| Reversible | N/A — not a hash function |

### Input format and constraints

None. The function takes no arguments. Entropy is drawn entirely from the operating system's CSPRNG.

### Output format and guarantees

A 64-character lowercase hex string encoding 32 random bytes. Each call produces a statistically independent value. The collision probability across any realistic number of tokens ever generated is negligible — at one trillion tokens, the birthday-bound collision probability is approximately 2⁻¹⁰⁷.

The raw token is a bearer credential: possession is sufficient to exercise the vote right it represents. It is transmitted to the voter once and must not be retained server-side in any form after `hashToken` has been called on it.

### Security property

**Unpredictability.** An attacker who does not hold the raw token cannot guess or enumerate it. At 256 bits of entropy, exhaustive search is computationally infeasible. Even with prior knowledge of all previously issued tokens, each new token is independent.

### Failure modes

| Failure | Consequence |
| --- | --- |
| Using `Math.random()` or any non-CSPRNG source | Entropy collapses to at most 53 bits (JavaScript's float precision); tokens become guessable by an attacker who can observe timing or seed state |
| Using a deterministic seed (timestamp, counter, process ID) | Tokens become predictable to any attacker who knows or can estimate the seed |
| Generating tokens shorter than 32 bytes | Entropy budget shrinks; online guessing becomes feasible even against rate-limited endpoints |
| Storing the raw token after delivery | A database or log attacker gains a valid credential and can cast a vote on behalf of the voter |

---

## 3. `hashToken(token: string): string`

**Reference:** [`src/crypto.ts — hashToken`](https://github.com/AnonVote/js/blob/main/src/crypto.ts)

### Algorithm and parameters

| Property | Value |
| --- | --- |
| Algorithm | SHA-256 |
| Standard | FIPS PUB 180-4 |
| Input preprocessing | None — the raw token is hashed byte-for-byte with no normalization |
| Output | 64-character lowercase hex string |
| Deterministic | Yes |
| Reversible | No |

### Input format and constraints

The raw 64-character hex string produced by `generateToken`. No normalization is applied before hashing. This is intentional and load-bearing: tokens are machine-generated exact-byte values, not human-readable identifiers. Any normalization (trim, lowercase, encoding conversion) applied to the token before hashing will cause lookup failures at redemption time if the voter's submitted token does not undergo the same transformation.

### Output format and guarantees

A 64-character lowercase hex string representing the SHA-256 digest of the raw token. This value is stored in `VoterToken.tokenHash`. It is used at vote submission time by hashing the submitted raw token and looking up the result.

### Design rationale: why this is a separate step from generation

The two-step design — generate then hash separately — separates the credential from the lookup key:

- `rawToken` is the bearer credential. Possession is sufficient to cast a vote; the server does not verify the holder's identity against the credential at submission time. It is transmitted to the voter once and has no server-side representation after `tokenHash` is stored.
- `tokenHash` is the server-side lookup key. It is the sole token-related value persisted. It carries no credential value — preimage resistance of SHA-256 prevents derivation of `rawToken` from `tokenHash`.

A database compromise exposes `tokenHash` values. Without `rawToken`, an attacker cannot derive a valid credential from the hash — SHA-256 preimage resistance makes reversal infeasible. This means a database breach does not automatically yield the ability to vote.

If the raw token and its hash were stored together, or if the raw token were retained in any form, this protection collapses.

### Security property

**Preimage resistance.** A database attacker who reads `VoterToken.tokenHash` cannot recover the corresponding `rawToken` and therefore cannot cast a vote on the voter's behalf.

### Failure modes

| Failure | Consequence |
| --- | --- |
| Applying any normalization before hashing | Token redemption fails for voters whose submitted token, when normalized, produces a different hash than the stored value — the voter cannot vote |
| Storing `rawToken` alongside `tokenHash` | Database read access yields valid credentials; the separation guarantee is eliminated |
| Using a different hash algorithm than was used to produce the stored hash | All token lookups fail |

---

## 4. `encryptVote(optionId: string, ballotKey: string): string`

**Reference:** [`src/crypto.ts — encryptVote`](https://github.com/AnonVote/js/blob/main/src/crypto.ts)

### Algorithm and parameters

| Property | Value |
| --- | --- |
| Algorithm | AES-256-GCM |
| Standard | NIST SP 800-38D |
| Key length | 256 bits (32 bytes), provided as a 64-character lowercase hex string |
| IV | 12 bytes, generated fresh from CSPRNG inside the function on every call |
| Auth tag | 16 bytes (GCM default) |
| Output format | `base64(iv):base64(authTag):base64(ciphertext)` |
| Deterministic | No — a fresh IV is generated on every call |

### Input format and constraints

- `optionId` — a UTF-8 string identifying the ballot option the voter selected. Typically a UUID.
- `ballotKey` — a 64-character lowercase hex string representing the 32-byte per-ballot AES key. The function throws if `ballotKey` is not exactly 64 hex characters.

The function throws immediately if `ballotKey` is malformed. It does not silently fall back to a different key or key length.

### Output format and guarantees

A string in the format `base64(iv):base64(authTag):base64(ciphertext)`, where:

- `iv` — 12 bytes (16 characters base64), unique per call
- `authTag` — 16 bytes (24 characters base64), covering the ciphertext and associated data
- `ciphertext` — variable length, covering the UTF-8 encoding of `optionId`

The three components are colon-delimited. No other delimiter is used. `decryptVote` expects this exact format.

The IV is generated inside `encryptVote` on every call. Callers cannot provide or control it. This prevents the most common GCM misuse — IV reuse under the same key.

### Design rationale: why AES-256-GCM and not AES-256-CBC

AES-256-CBC provides confidentiality but not integrity. A database attacker who can write to the `Vote` table can modify stored ciphertexts, and a CBC-only implementation cannot detect the modification. The tally engine would decrypt the altered payload and count a manipulated vote.

AES-256-GCM is an authenticated encryption scheme. The 16-byte GCM authentication tag covers the ciphertext. Any modification to the stored payload — ciphertext bytes, IV bytes, or auth tag bytes — causes `decryptVote` to fail authentication before decryption is attempted. The tally engine cannot be made to produce a result from a tampered payload.

This means the integrity of vote payloads is enforced cryptographically, not by database access controls alone.

### Security property

**IND-CPA confidentiality and ciphertext integrity.** The encrypted payload reveals nothing about the vote option to a party who does not hold `ballotKey`. Any modification to the stored payload is detected at decryption time. The combination of per-call IV generation and GCM authentication means neither the vote choice nor the ballot key can be recovered or inferred from a sequence of ciphertexts.

### Failure modes

| Failure | Consequence |
| --- | --- |
| IV reused across two calls under the same key | GCM's security proof breaks; relationships between plaintexts may become recoverable; authentication guarantees are weakened. The function prevents this by generating the IV internally. |
| Using a global application key instead of a per-ballot key | A single key compromise decrypts every ballot ever encrypted under it; one leaked secret exposes the full vote history |
| Storing `ballotKey` in the vote database alongside encrypted payloads | A database attacker can decrypt all votes for any ballot whose key is present |
| Calling `encryptVote` before validating the voter token and ballot state | Invalid or replayed token attempts can generate encrypted artifacts before the credential is known to be valid |

---

## 5. `decryptVote(payload: string, ballotKey: string): string`

**Reference:** [`src/crypto.ts — decryptVote`](https://github.com/AnonVote/js/blob/main/src/crypto.ts)

### Algorithm and parameters

| Property | Value |
| --- | --- |
| Algorithm | AES-256-GCM |
| Standard | NIST SP 800-38D |
| Key length | 256 bits (32 bytes), provided as a 64-character lowercase hex string |
| Input format | `base64(iv):base64(authTag):base64(ciphertext)` |
| Auth tag verification | Performed before decryption; throws on failure |
| Output | The original `optionId` string passed to `encryptVote` |

### Input format and constraints

- `payload` — a string in the format `base64(iv):base64(authTag):base64(ciphertext)` produced by `encryptVote`. The function throws if the format is malformed.
- `ballotKey` — the same 64-character lowercase hex string used when `encryptVote` was called for this ballot. A different key will produce an authentication failure.

### Output format and guarantees

The plaintext `optionId` string recovered from the payload. If decryption succeeds, the returned value is identical to the `optionId` that was passed to `encryptVote` — GCM authentication guarantees this. If decryption fails for any reason, the function throws.

### Auth tag verification

GCM authentication tag verification is performed before any plaintext is produced. If verification fails, the function throws before returning any bytes. This means:

- A caller cannot receive partial plaintext from a tampered payload.
- A caller cannot distinguish a tampered payload from a wrong-key failure at the byte level — both throw. The distinction matters operationally (wrong key → configuration error; tampered payload → integrity event) but the function's behavior is the same in both cases.

### What a failed verification means in the vote system context

An authentication failure during tally is not a routine error. It signals one of:

1. The stored payload was modified after encryption — the `Vote` table was altered
2. The ballot key being used does not match the key used at encryption time — a configuration or key management error
3. The payload is structurally malformed — a storage or serialization error

All three conditions are ballot-integrity events. In no case should the tally engine treat an authentication failure as a vote to skip. A skipped failed vote produces a published result that accounts for fewer votes than were cast, with no signal to operators or voters that the count is incomplete.

### Design rationale: why the function throws instead of returning null or a sentinel

A return value of `null` or a sentinel string on failure would allow callers to silently continue. The function throws to make it structurally impossible to publish a tally that ignores authentication failures without an explicit, visible decision to do so. Callers must handle the exception; they cannot accidentally ignore it.

### Security property

**Ciphertext integrity and authenticity.** A vote payload that decrypts successfully is guaranteed to be unmodified since it was encrypted. Any third party who does not hold `ballotKey` cannot produce a payload that passes authentication.

### Failure modes

| Failure | Consequence |
| --- | --- |
| Catching the thrown exception and continuing the tally | The published result is computed on fewer votes than were cast; the discrepancy is invisible to voters and auditors |
| Using a wrong ballot key | Authentication fails on every vote for that ballot; tally cannot proceed until the correct key is provided |
| Payload format corruption (truncated, re-encoded, delimiter changed) | Authentication fails; same consequence as above |

---

## 6. Dependency diagram

The five primitives compose into the vote lifecycle as follows. Each arrow shows what data is produced and where it flows.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ELIGIBILITY UPLOAD (admin)                                          │
│                                                                     │
│  voterIdentifier ──► hashIdentifier() ──► identifierHash            │
│                                               │                     │
│                                               ▼                     │
│                                      EligibilityEntry (stored)      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ TOKEN ISSUANCE (voter requests credential)                          │
│                                                                     │
│  voterIdentifier ──► hashIdentifier() ──► lookup EligibilityEntry   │
│                                                                     │
│  generateToken() ──► rawToken ──────────────────────────────────►   │
│        │                                                 (to voter) │
│        └──► hashToken() ──► tokenHash                               │
│                                  │                                  │
│                                  ▼                                  │
│                          VoterToken (stored)                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ VOTE SUBMISSION (voter submits credential + choice)                 │
│                                                                     │
│  rawToken ──► hashToken() ──► tokenHash ──► lookup VoterToken       │
│                                                                     │
│  optionId ─────────────────────────────────────────────┐           │
│  ballotKey (from secret store) ────────────────────────┤           │
│                                                         ▼           │
│                                              encryptVote()          │
│                                                   │                 │
│                                                   ▼                 │
│                                          encryptedPayload           │
│                                                   │                 │
│                                                   ▼                 │
│                                            Vote (stored)            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ RESULT TALLY (ballot closes)                                        │
│                                                                     │
│  encryptedPayload ──────────────────────────────────────┐          │
│  ballotKey (from secret store) ─────────────────────────┤          │
│                                                          ▼          │
│                                               decryptVote()         │
│                                                    │                │
│                                    throws on auth failure ──► HALT  │
│                                                    │                │
│                                                    ▼                │
│                                         optionId (recovered)        │
│                                                    │                │
│                                                    ▼                │
│                                        tally[optionId] += weight    │
│                                                    │                │
│                                                    ▼                │
│                                    SHA-256(tallyJson) ──► Stellar   │
└─────────────────────────────────────────────────────────────────────┘
```

**No primitive appears in more than one phase except `hashToken`**, which is called at both token issuance (to produce the stored hash) and vote submission (to look up the stored hash from the submitted raw token).

**`ballotKey` is external to `@anonvote/crypto`** — it is loaded from secure configuration at both vote submission and tally time. The package does not manage or store keys.

---

## 7. Key management

Key management is not part of `@anonvote/crypto` but is required to use `encryptVote` and `decryptVote` correctly. This section is the authoritative specification. Implementations in `AnonVote/core` must conform to it.

### Key generation

Each ballot requires exactly one AES-256 encryption key, generated at ballot creation time:

```
ballotKey = crypto.randomBytes(32).toString('hex')
```

This produces a 64-character lowercase hex string — the same shape that `encryptVote` and `decryptVote` expect. The same CSPRNG source used for `generateToken` applies here (NIST SP 800-90A).

### Key scope

One key per ballot. A single application-level key shared across all ballots is not protocol-compliant. The reason: if a shared key is compromised, every ballot ever encrypted under it can be decrypted. Per-ballot keys limit the blast radius of any single compromise to one ballot.

### Storage requirements

| Location | Permitted |
| --- | --- |
| Secret manager (AWS Secrets Manager, GCP Secret Manager, etc.) | Yes |
| KMS-backed encrypted parameter store | Yes |
| Deployment-time secret (e.g. Kubernetes Secret, Fly.io secret) | Yes |
| Vote database, alongside encrypted payloads | **No** |
| Application logs | **No** |
| Audit events | **No** |
| Client API responses | **No** |
| On-chain records | **No** |

The key name or secret reference (e.g. `ANONVOTE_BALLOT_KEY_<ballotId>`) may be stored with the ballot record in the database. The key material must not be.

### Access

Only two code paths may read a ballot key:

1. The vote submission path — to call `encryptVote`
2. The tally path — to call `decryptVote`

No other path — admin UI, audit log service, eligibility upload, token issuance — requires or should have access to ballot key material.

### Compromise impact

A compromised ballot key exposes all encrypted vote payloads for that ballot only. Per-ballot key isolation means a leaked key must not expose any other ballot's votes. If a global application key is used, this guarantee does not hold.

### Key rotation

Rotation is possible in two cases:

**Before any votes are cast:** generate a new 32-byte key and replace the old unused key in secret storage. No payload migration required.

**After votes are cast, before results are published:** for each `Vote` record for the ballot, call `decryptVote(payload, oldKey)` to recover `optionId`, then `encryptVote(optionId, newKey)` to produce a new payload. Verify that the count of successfully re-encrypted votes equals the count of `Vote` records. Update all payloads and the key reference atomically. Halt if any decryption fails before updating any records.

Rotation is not possible:

- If the old key is lost. AES-GCM payloads cannot be recovered without the key used to encrypt them.
- If any payload fails authentication under the old key. Investigate before changing key material.
- After results are published without a full re-publication and audit trail update.

---

## 8. What this crypto layer does not protect against

AnonVote's cryptographic design makes strong guarantees within a defined threat model. The following are outside that model. Deployments that require protection against any of these must address them at a layer above the cryptographic primitives.

**Traffic analysis.** A network-level attacker who can observe timing between a token request and a vote submission may attempt correlation. The API adds no artificial delays between these operations. A determined observer with packet-level visibility can gather timing metadata even without reading payload content.

**Coercion.** If a voter is forced to vote a particular way, or compelled to hand over their `rawToken` before using it, the protocol cannot prevent the outcome. The cryptographic model protects identity from the system; it does not protect voters from external social or physical pressure.

**Compromised token delivery channel.** `rawToken` is returned to the voter once over the API response channel. If that channel is intercepted — for example, if a voter's email account is compromised and the token was delivered by email — the attacker holds a valid credential and can cast a vote. The token is only as secure as the channel used to deliver it.

**Ballot encryption key compromise.** If `ballotKey` for a ballot is leaked, all encrypted vote payloads for that ballot can be decrypted by the attacker. Per-ballot key scoping (see Section 7) limits the blast radius to one ballot, but it does not eliminate the risk from key compromise itself. High-security deployments should treat key material with the same access controls as production database credentials.

**Admin eligibility fraud.** The organization admin controls the eligibility list. A malicious admin can add ineligible voters or remove eligible ones before token issuance. Stellar anchoring makes post-submission result tampering detectable — the on-chain result hash cannot be changed. It does not constrain what the admin writes to the eligibility list before the ballot opens.
