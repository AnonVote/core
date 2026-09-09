# @anonvote/crypto

**The cryptographic primitives and token utilities powering AnonVote.**

This package is the canonical source of all crypto and token logic used across the AnonVote ecosystem. It is framework-agnostic and has zero runtime dependencies. Runtime support varies by function — see [Runtime support](#runtime-support) below.

[![npm](https://img.shields.io/npm/v/@anonvote/crypto)](https://www.npmjs.com/package/@anonvote/crypto)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

---

## Role in the ecosystem

| Repo                                                        | Depends on this package                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| [AnonVote/core](https://github.com/AnonVote/core)           | Yes — backend imports `@anonvote/crypto` |
| [AnonVote/contracts](https://github.com/AnonVote/contracts) | No — Soroban contracts use native Rust   |
| [AnonVote/docs](https://github.com/AnonVote/docs)           | References this package in spec docs     |

---

## What's in this package

### Zero-Knowledge Proof (ZKP) & Homomorphic Primitives (`src/zkp/`)

| Export | Description | Runtime |
| --- | --- | --- |
| `generatePaillierKeyPair(bits?)` | Generates a Paillier key pair for additive homomorphic encryption ($D(\prod c_i) = \sum m_i$). | Cross-runtime |
| `encryptVoteHomomorphic(optIndex, totalOpts, ballotId, pk)` | Encrypts a vote vector and generates a Non-Interactive Zero-Knowledge (NIZK) 1-of-$k$ validity proof. | Cross-runtime |
| `verifyVoteZKP(vote, pk)` | Verifies a voter's zero-knowledge validity proof without decrypting the ballot. | Cross-runtime |
| `tallyHomomorphic(votes, pk, sk, merkleRoot?)` | Computes the aggregated election results algebraically without decrypting any individual vote. | Cross-runtime |
| `verifyHomomorphicTallyProof(proof, pk)` | Cryptographically audits and verifies the tally decryption proof. | Cross-runtime |
| `generateThresholdKeyShares(sk, K, N)` | Splits Paillier private key across $N$ trustees requiring $K$ shares for tally decryption. | Cross-runtime |
| `combineThresholdDecryptions(shares, aggC, pk, K, mu)` | Combines $K$ trustee decryption shares to recover the final aggregate tally. | Cross-runtime |
| `buildMerkleTree(leafHashes)` | Builds a cryptographic Merkle commitment tree for ballot auditability. | Cross-runtime |
| `generateMerkleProof(leaves, idx)` / `verifyMerkleProof(proof)` | Generates and verifies on-chain vote inclusion proofs for voters. | Cross-runtime |

### Standard Cryptographic Utilities (`src/crypto.ts`)

| Export                       | Description                                                                                                        | Edge runtime support |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `hashIdentifier(id)`         | SHA-256 hash of a voter identifier. Trims and lowercases before hashing. Never store originals — only hashes.      | No — Node.js `crypto` only |
| `generateToken(encoding?)`   | Generates a 32-byte (256-bit) CSPRNG token as a hex (default, 64 chars) or base64url string (43 chars).             | Yes |
| `bytesToBase64Url(bytes)`    | Converts bytes to an RFC 4648 URL-safe base64 string without padding.                                              | Yes |
| `hashToken(token)`           | SHA-256 hash of a raw token. Only the hash is ever persisted — the raw value is given to the voter and discarded.  | No — Node.js `crypto` only |
| `encryptVote(optionId, key)` | AES-256-GCM encryption of a vote option ID. Returns an `EncryptedPayload` object with `iv`, `authTag`, and `ciphertext` — all lowercase hex strings (see `DECISIONS.md`). Requires a 32-byte hex key. | No — Node.js `crypto` only |
| `decryptVote(payload, key)`  | Decrypts a vote payload produced by `encryptVote`. Used only by the result tally engine.                           | No — Node.js `crypto` only |


### Types (`src/types.ts`)

`src/types.ts` is the **canonical type source for the entire AnonVote ecosystem**. All shared TypeScript types — votes, tokens, ballots, audit events, and tally results — are defined here and exported from this package. `AnonVote/core` and any future consumer **should import from `@anonvote/crypto`** rather than maintaining local copies. Defining types locally in `core/shared/` causes silent drift: a field rename in one place does not break the other at compile time and only fails at runtime.

Key types exported:

| Type | Description |
| ---- | ----------- |
| `EncryptedPayload` | AES-256-GCM output: `{ ciphertext, iv, authTag }` — all hex strings |
| `Token` | Token pair: `{ value, hash }` — raw value for voter, hash for storage |
| `Vote` | Ballot vote event: `{ ballotId, optionId, timestamp }` |
| `ElectionResult` | Tally output: `Record<optionId, voteCount>` |
| `BallotEvent` | Stellar audit trail event with `event_type`, `ballot_id`, `stellar_tx_id`, `created_at` |
| `AnonVoteCryptoError` | Typed error class with `code` field (`INVALID_KEY`, `DECRYPTION_FAILED`, `INVALID_PAYLOAD`) |
| `Ballot`, `Option`, `BallotStatus` | Core ballot domain types |
| `VoterToken`, `EligibilityEntry`, `EligibilityList` | Token and eligibility record types |
| `VoteRecord`, `Result`, `AuditEvent`, `AuditCounts` | Persistence and result types |

---

## Installation

```bash
npm install @anonvote/crypto
```

---

## Usage: Cryptographic primitives

```typescript
import {
  hashIdentifier,
  generateToken,
  hashToken,
  encryptVote,
  decryptVote,
  type EncryptedPayload,
} from "@anonvote/crypto";

// Hash a voter identifier before storing — never store the original
const identifierHash = hashIdentifier("alice@example.com");

// Issue a one-time anonymous token ('hex' by default, or compact 'base64url')
const rawToken = generateToken();              // 64-char hex string (default)
const compactToken = generateToken("base64url"); // 43-char URL-safe base64 string
const storedHash = hashToken(rawToken);        // store only this; discard rawToken

// Encrypt a vote option — returns { ciphertext, iv, authTag } all in hex
const BALLOT_KEY = process.env.BALLOT_ENCRYPTION_KEY!; // 64-char hex
const payload: EncryptedPayload = encryptVote("option-uuid-here", BALLOT_KEY);

// Decrypt during result tally (tally engine only)
const optionId = decryptVote(payload, BALLOT_KEY);
```

### Usage: Zero-Knowledge Proofs & Homomorphic Tallying

```typescript
import {
  generatePaillierKeyPair,
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from "@anonvote/crypto";

// 1. Generate election keypair (Paillier additive homomorphic)
const keyPair = generatePaillierKeyPair(2048);

// 2. Voter casts vote for Option 0 (out of 3 options) with NIZK Proof
const vote = encryptVoteHomomorphic(0, 3, "ballot-123", keyPair.publicKey);

// 3. Auditor verifies ballot validity WITHOUT decrypting
const report = verifyVoteZKP(vote, keyPair.publicKey);
console.log(report.isValid); // true

// 4. Anchor vote commitments on-chain via Merkle Tree
const merkleTree = buildMerkleTree([vote.receiptHash]);
const voterProof = generateMerkleProof([vote.receiptHash], 0);
console.log(verifyMerkleProof(voterProof)); // true (voter verifies inclusion)

// 5. Homomorphic Tallying: Compute sum without individual vote decryption
const tallyProof = tallyHomomorphic([vote], keyPair.publicKey, keyPair.privateKey, merkleTree.root);
console.log(tallyProof.tallyResults); // [1, 0, 0]

// 6. Third party audits the tally proof
console.log(verifyHomomorphicTallyProof(tallyProof, keyPair.publicKey)); // true
```


---

## Usage: AnonVoteClient SDK

The AnonVoteClient SDK is the recommended way to integrate AnonVote into your application. It lives at the `@anonvote/crypto/client` subpath so consumers of only the raw primitives don't pay the import cost.

```bash
npm install @anonvote/crypto
```

```typescript
import { randomBytes } from "crypto";
import { AnonVoteClient } from "@anonvote/crypto/client";

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

// 5. Deserialize a stored ballot
const restored = client.deserialize(json);
```

### Key guarantees

- The constructor throws immediately if `ballotKey` is not a valid 64-character hex string — misconfigured clients fail at construction, not at the first crypto operation.
- `castVote` never logs the `optionId`. The option the voter chose stays local.
- `serialize` omits `optionId` — only the encrypted payload reaches the server.
- `verifyVote` propagates decryption errors rather than silently returning `false`. A corrupted payload is a different failure mode from an option mismatch.

---

## Environment variables

| Variable               | Format              | Description                                                     |
| ---------------------- | ------------------- | --------------------------------------------------------------- |
| `BALLOT_ENCRYPTION_KEY` | 64-character hex string (32 bytes) | AES-256-GCM key used to encrypt and decrypt vote payloads. **Required** for `encryptVote`, `decryptVote`, and `AnonVoteClient` vote operations. |

Generate a key with:

```bash
openssl rand -hex 32
```

Never log or commit this value. Store it as a secret in your deployment environment.

---

## API Reference

Full generated API documentation, including every exported function, class, and
type with parameter and return descriptions, is available at
**[anonvote.github.io/js](https://anonvote.github.io/js/)**.

### Cryptographic functions

| Export | Description |
| ------ | ----------- |
| `hashIdentifier(id)` | Returns the SHA-256 hash of a voter identifier. Trims and lowercases before hashing. |
| `generateToken(encoding?)` | Generates a 32-byte (256-bit) CSPRNG token as a hex (64 chars) or base64url string (43 chars). |
| `bytesToBase64Url(bytes)` | Converts bytes to an RFC 4648 URL-safe base64 string without padding. |
| `hashToken(token)` | Returns the SHA-256 hash of a raw token. Only the hash is ever persisted. |
| `encryptVote(option, key)` | AES-256-GCM encryption of a vote option. Returns an `EncryptedPayload`. Requires a 64-char hex key. |
| `decryptVote(payload, key)` | Decrypts a payload produced by `encryptVote`. Used only by the result tally engine. |

### AnonVoteClient

| Export | Description |
| ------ | ----------- |
| `AnonVoteClient` | The primary SDK class. Wraps crypto primitives and provides a high-level API for elections and votes. |
| `AnonVoteClient.createElection(params)` | Validates inputs and returns a new `Election` object with generated IDs. |
| `AnonVoteClient.castVote(params)` | Encrypts a vote option and returns a `VoteReceipt`. |
| `AnonVoteClient.verifyVote(payload, key?)` | Attempts to decrypt a payload; returns `true` if valid. |
| `AnonVoteClient.serialize(election)` | Converts an `Election` to a JSON-safe `SerializedElection`. |
| `AnonVoteClient.deserialize(payload)` | Reconstructs an `Election` from a `SerializedElection` payload. |

### Error classes

| Export | Description |
| ------ | ----------- |
| `AnonVoteError` | Base class for all SDK errors. Catch with `instanceof AnonVoteError`. |
| `ValidationError` | Thrown when an input fails validation (missing field, wrong format, logical constraint). Extends `AnonVoteError`. |
| `CryptoError` | Thrown when a cryptographic operation fails at runtime (e.g. tampered ciphertext, wrong key). Extends `AnonVoteError`. |

### Types

| Export | Description |
| ------ | ----------- |
| `BallotStatus` | `"OPEN" \| "CLOSED"` — the status of a ballot. |
| `Option` | A ballot option with `id`, `ballotId`, and `text`. |
| `Ballot` | A full ballot record including options, eligibility, and status. |
| `EligibilityList` | A list of eligible voters, identified by its `id`. |
| `EligibilityEntry` | A single entry in an eligibility list; stores `identifierHash`, not the raw identifier. |
| `Token` | A raw token value paired with its SHA-256 hash. |
| `VoterToken` | A persisted one-time voter token record (stores only `tokenHash`). |
| `Vote` | A raw vote before encryption: `ballotId`, `option`, `timestamp`. |
| `EncryptedPayload` | AES-256-GCM ciphertext with `ciphertext`, `iv`, and `authTag` as hex strings. |
| `Organization` | An organization record with `id`, `name`, `email`, and `createdAt`. |
| `Result` | A published tally result including `tallyJson` and optional `stellarTxId`. |
| `AuditEventType` | Union of audit event type strings (e.g. `"VOTE_CAST"`, `"TOKEN_ISSUED"`). |
| `AuditEvent` | A single audit event record with `eventType` and optional `stellarTxId`. |
| `AuditCounts` | Aggregate audit counts and event list for a ballot. |
| `ApiResponse<T>` | Generic wrapper `{ data: T }` for API responses. |
| `TokenResponse` | Response shape for token issuance: `token` and `weight`. |
| `LoginResponse` | Response shape for login: `organizationId` and `name`. |
| `ClientConfig` | Configuration for `AnonVoteClient`: optional `encryptionKey`. |
| `ElectionOption` | An option within an `Election`: `id` and `text`. |
| `CreateElectionParams` | Input parameters for `AnonVoteClient.createElection`. |
| `CastVoteParams` | Input parameters for `AnonVoteClient.castVote`. |
| `Election` | A fully formed election object returned by `AnonVoteClient.createElection`. |
| `VoteReceipt` | A receipt returned by `AnonVoteClient.castVote`, containing the encrypted payload. |

---

## Privacy guarantees

These primitives enforce AnonVote's structural unlinkability model:

- `hashIdentifier` and `hashToken` are **one-way** — original values are unrecoverable from the database
- `generateToken` uses the Web Crypto API's `getRandomValues` when available, falling back to Node.js `crypto.randomBytes` — cryptographically secure and unpredictable in either case
- `encryptVote` uses **AES-256-GCM** — authenticated encryption; tampered ciphertexts are rejected at decryption
- No identifier is ever stored alongside a token — the hash functions operate independently on different data

---

## Security notes

- `BALLOT_ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). Generate one with `openssl rand -hex 32`.
- Never log raw voter identifiers or raw tokens.
- `decryptVote` should only be called by the result tally engine.

---

## Role in the ecosystem

| Repo | Depends on this package |
| ---- | ----------------------- |
| [AnonVote/core](https://github.com/AnonVote/core) | Yes — backend imports `@anonvote/crypto` |
| [AnonVote/contracts](https://github.com/AnonVote/contracts) | No — Soroban contracts use native Rust |
| [AnonVote/docs](https://github.com/AnonVote/docs) | References this package in spec docs |

---

## Examples and Integration Guide

Working TypeScript examples demonstrating the complete ballot lifecycle are available in the [`examples/`](./examples/) directory:

| File | Description |
| --- | --- |
| [`basic-ballot.ts`](./examples/basic-ballot.ts) | Ballot creation, key generation, vote encryption, and verification |
| [`token-workflow.ts`](./examples/token-workflow.ts) | Token generation, hashing, and validation |
| [`error-handling.ts`](./examples/error-handling.ts) | Handling `ValidationError` and `CryptoError` gracefully |
| [`client-integration.ts`](./examples/client-integration.ts) | Using `AnonVoteClient` to create elections and cast votes |

For a complete walkthrough of the SDK including common pitfalls and FAQ, see the [**Integration Guide**](./INTEGRATION_GUIDE.md).

Run the examples:

```bash
npx tsx examples/basic-ballot.ts
npx tsx examples/token-workflow.ts
```

---

## Development

```bash
git clone https://github.com/anon/core.git
cd js
npm install
npm test
npm run build
```

### Scripts

| Command                | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `npm run build`        | Compile TypeScript to `dist/`                  |
| `npm test`             | Run unit tests with Jest                       |
| `npm run test:examples`| Run example integration tests                 |
| `npm run lint`         | ESLint check on `src/` and `tests/`            |
| `npm run lint:fix`     | Auto-fix fixable lint issues                   |

### Pre-commit checklist

Before committing, run lint and tests manually:

```bash
npm run lint   # must exit 0 — no errors allowed
npm test       # must pass
```

The `no-console` rule is enforced as an error. If lint flags a `console.*` in `src/`, remove it — do not add an eslint-disable comment.

---

## Repository structure

```
js/
├── src/
│   ├── crypto.ts     # Core cryptographic functions
│   ├── types.ts      # Canonical shared types for the AnonVote ecosystem
│   ├── client.ts     # AnonVoteClient SDK
│   └── index.ts      # Public API re-exports
├── tests/
│   └── crypto.test.ts
├── DECISIONS.md      # Architecture decisions (wire format, encoding choices)
│   ├── client/
│   │   ├── index.ts  # AnonVoteClient SDK (@anonvote/crypto/client)
│   │   └── types.ts  # Domain-level SDK types
│   ├── crypto.ts     # Core cryptographic primitives
│   ├── client.ts     # Low-level retry-aware client (root export)
│   ├── errors.ts     # Error classes
│   ├── retry.ts      # Exponential backoff retry utility
│   ├── types.ts      # Shared TypeScript types
│   └── index.ts      # Public API re-exports
├── tests/
│   ├── crypto.test.ts
│   ├── client.test.ts
│   ├── sdk-client.test.ts  # AnonVoteClient SDK tests (issue #42)
│   └── errors.test.ts
├── DECISIONS.md      # Architecture decision records
├── package.json
└── tsconfig.json
```

> **For contributors to AnonVote/core:** import shared types from `@anonvote/crypto` rather than
> defining local copies in `core/shared/`. `src/types.ts` is the single source of truth — local
> copies drift silently and only fail at runtime.

---

## Milestones

### Milestone 1 — Foundation
Everything works end-to-end on testnet. A real admin can create a ballot, upload voters, issue tokens, collect votes, tally, and verify the result on Stellar.

### Milestone 2 — Hardening
Per-ballot encryption keys, rate limiting, error handling, retry queues, no raw identifiers anywhere, Soroban fully wired.

### Milestone 3 — Ecosystem
`@anonvote/crypto` published on npm, docs repo complete, contracts deployed on mainnet, third-party developers can build on top of AnonVote using the JS SDK.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
