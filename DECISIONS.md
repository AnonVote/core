# Architecture Decisions

## ADR-001 — `encryptVote` output format: hex

**Date:** 2026-07-28  
**Status:** Accepted

### Context

`encryptVote` must return an `EncryptedPayload` object with three fields: `ciphertext`, `iv`, and `authTag`. When the original implementation was written, the README documented these as base64-encoded strings. The AnonVote/core backend, however, was written to consume hex-encoded strings for all three fields. This created a silent wire-format mismatch that would cause every tally operation to fail the first time a real ballot was run.

### Decision

All three fields of `EncryptedPayload` (`ciphertext`, `iv`, `authTag`) are **lowercase hex strings**. Base64 is not used anywhere in the cryptographic output surface of this package.

### Rationale

1. **Consistency with the rest of the package.** `hashIdentifier` and `hashToken` both return lowercase hex strings. Using hex for `encryptVote` output means every value that leaves this package is in the same encoding. A consumer reading stored values can tell immediately what encoding they are in.

2. **AnonVote/core expects hex.** Changing this package to emit hex requires editing one file (`src/crypto.ts`) and its tests. Changing core to accept base64 would require updating multiple layers of the tally engine, the Stellar audit trail writer, and the storage schema. The smaller change surface is the correct choice.

3. **Hex is self-describing.** A developer inspecting a stored row in the database can see a 24-character hex string and know it is a 12-byte IV. A base64 string requires knowing the encoding to interpret its length.

4. **No information density benefit from base64 at this scale.** Vote payloads are small (a UUID option ID). The 33% storage overhead difference between hex and base64 is immaterial at any realistic ballot size.

### Consequences

- The README's description of `encryptVote` returning `iv:authTag:ciphertext` as a single base64 string is superseded. The function now returns a structured `EncryptedPayload` object with three hex fields.
- `decryptVote` accepts an `EncryptedPayload` object (not a colon-delimited string) and a hex key.
- Any consumer that was relying on the old base64 colon-delimited format must migrate to the `EncryptedPayload` object interface.
- All existing tests have been rewritten to reflect this format.
## ADR-001: AnonVoteClient SDK — Subpath Export (Option B)

**Status:** Accepted  
**Date:** 2026-07-28

### Context

`@anonvote/crypto` exports five low-level cryptographic primitives. A higher-level
`AnonVoteClient` SDK needed to be added. Two placement options were considered:

**Option A** — Add `src/client.ts` to the existing package and export `AnonVoteClient`
alongside the primitives from `src/index.ts`. One package, one entry point.

**Option B** — Create `src/client/` with its own entry point and expose it as the
subpath export `@anonvote/crypto/client`. Primitives and client are imported separately.

### Decision

**Option B — subpath export** was chosen.

Rationale:

- **Tree-shaking.** Consumers who only need the raw primitives (`encryptVote`,
  `hashToken`, etc.) do not pay the cost of importing the client code. The subpath
  makes the import graph explicit.
- **Separation of concerns.** The SDK layer has different stability guarantees and
  a different change cadence than the primitives. A separate entry point makes that
  boundary clear.
- **Node.js 12+ subpath exports** are already a standard pattern and the package is
  already in a TypeScript + CommonJS configuration that supports them with no extra
  tooling.
- **Explicit API surface.** Developers importing `@anonvote/crypto/client` signal
  intent — they want the SDK, not just the primitives.

### Consequences

`package.json` gains an `exports` field:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/client/index.js"
  }
}
```

`tsconfig.json` `include` must cover `src/client/`.

New files created:
- `src/client/types.ts` — domain-level SDK types
- `src/client/index.ts` — `AnonVoteClient` class

The existing `src/client.ts` (lower-level, retry-focused) is preserved and continues
to be exported from the root entry point. The new `src/client/index.ts` is the
developer-facing SDK.

## ADR-002: Zero-Knowledge Proof (ZKP) and Additive Homomorphic Infrastructure

**Status:** Accepted  
**Date:** 2026-08-23  

### Context
AnonVote previously relied on AES-256-GCM symmetric encryption for vote privacy. While secure in transit, AES-256-GCM required the backend tally engine to decrypt individual ballots to sum votes, introducing tally manipulation risks and preventing cryptographic verification of results on Stellar.

### Decision
Implement a layered cryptographic infrastructure based on:
1. **Paillier Additive Homomorphic Encryption** for ballot encryption and serverless tally summation ($D(\prod c_i) = \sum m_i$).
2. **CDS94 / Chaum-Pedersen Non-Interactive Zero-Knowledge Proofs (NIZK)** for 1-of-$k$ vote vector validity and sum-to-1 ballot proofs.
3. **$K$-of-$N$ Shamir Secret Sharing & Threshold Decryption** across election trustees so no single party can decrypt results.
4. **Merkle Tree Commitments** for individual voter inclusion proofs anchored to Stellar.

See detailed architecture document in [`docs/adr/0002-zkp-and-homomorphic-vote-verification.md`](docs/adr/0002-zkp-and-homomorphic-vote-verification.md).

