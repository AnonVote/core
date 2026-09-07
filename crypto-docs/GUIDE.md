# @anonvote/crypto Guide

This guide walks through the full voting workflow using `@anonvote/crypto`, from
generating voter tokens through encrypting and verifying a vote. For per-function
details (parameters, return types, thrown errors), browse the API reference
generated alongside this page.

## Voting workflow walkthrough

A ballot goes through four stages: eligibility, token issuance, voting, and tally.

### 1. Eligibility

Voter identifiers are never stored in plaintext. Hash each identifier with
`hashIdentifier` before persisting it to an eligibility list.

```typescript
import { hashIdentifier } from "@anonvote/crypto";

const identifierHash = hashIdentifier("alice@example.com");
// store identifierHash — never the raw email
```

### 2. Token generation and validation

Each eligible voter receives a one-time token. Only the token's hash is stored
server-side; the raw value is handed to the voter and then discarded.

```typescript
import { generateToken, hashToken } from "@anonvote/crypto";

const rawToken = generateToken(); // give this to the voter
const storedHash = hashToken(rawToken); // persist only this
```

At vote time, the backend looks up the incoming raw token by re-hashing it with
`hashToken` and comparing against the stored hash. A token that doesn't match, or
has already been consumed, must be rejected before a vote is accepted.

### 3. Vote encryption and decryption

A voter's option is encrypted client-side with AES-256-GCM before it ever
reaches the server. Only the encrypted payload is transmitted.

```typescript
import { encryptVote, decryptVote } from "@anonvote/crypto";

const BALLOT_KEY = process.env.BALLOT_ENCRYPTION_KEY!; // 64-char hex

const encrypted = encryptVote("Alice", BALLOT_KEY);
// encrypted === { ciphertext, iv, authTag }

// Later, during tally:
const option = decryptVote(encrypted, BALLOT_KEY);
```

`verifyVoteHash` lets a third party confirm that a specific option was the one
encrypted, without decrypting or revealing any other payload:

```typescript
import { verifyVoteHash } from "@anonvote/crypto";

const matches = verifyVoteHash("Alice", encrypted, BALLOT_KEY);
```

### 4. Tally

Only the result tally engine should call `decryptVote`. Each encrypted vote is
decrypted, counted per option, and the raw option values are discarded once the
tally is complete.

## Integration with backend

`AnonVoteClient` (available at the `@anonvote/crypto/client` subpath) wraps the
primitives above into a minimal, framework-agnostic API for creating elections
and casting votes. It performs no network calls itself — pair it with your own
backend integration for persistence and submission.

```typescript
import { AnonVoteClient } from "@anonvote/crypto/client";
import { randomBytes } from "crypto";

// Generate a fresh key per ballot — never reuse across ballots
const ballotKey = randomBytes(32).toString("hex");
const client = new AnonVoteClient({ ballotKey });

// 1. Create an election (pure client-side, no network)
const election = client.createElection({
  title: "Board Election 2026",
  description: "Elect two new board members.",
  options: ["Alice", "Bob", "Abstain"],
  startTime: new Date(),
  endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});

// 2. Cast a vote — pass the option UUID, not the label
const ballot = client.castVote(election, election.options[0].id);

// 3. Verify locally before submitting
const result = client.verifyVote(ballot);
console.log(result.confirmed); // true

// 4. Serialize for server submission — optionId is intentionally excluded
const json = client.serialize(ballot);
await fetch("/api/votes", { method: "POST", body: json });
```

The constructor throws immediately if `ballotKey` is not a valid
64-character hex string, `castVote` never logs the chosen `optionId`, and
`serialize` omits `optionId` so only the encrypted payload ever reaches your
backend.

## Common pitfalls and solutions

- **Reusing a ballot encryption key across ballots.** Generate a fresh key per
  ballot with `crypto.randomBytes(32).toString("hex")`. Reusing a key defeats
  the per-ballot isolation the encryption model relies on.
- **Hashing an identifier without normalizing first.** `hashIdentifier` already
  normalizes internally, but if you hash identifiers anywhere else in your own
  code, apply the same normalization or lookups will silently fail to match.
- **Persisting raw tokens.** Only `hashToken`'s output belongs in storage. If a
  raw token is ever logged or persisted, treat it as compromised and reissue.
- **Calling `decryptVote` outside the tally engine.** Decryption should only
  happen where the tally is computed. Anywhere else, prefer `verifyVoteHash` for
  verification without decrypting.
- **Comparing decrypted values with `===` in security-sensitive code.** Use a
  constant-time comparison for anything that compares secret-derived values, to
  avoid leaking information through timing.
