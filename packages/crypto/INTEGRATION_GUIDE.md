# Integration Guide

A step-by-step walkthrough of the complete AnonVote ballot lifecycle using `@anonvote/crypto`.

---

## Prerequisites

### Node.js Version

`@anonvote/crypto` requires **Node.js 20+**. The SDK uses `globalThis.crypto` (available in Node 19+) and targets ES2020.

### Installation

```bash
npm install @anonvote/crypto
```

### Environment Variables

| Variable | Format | Required |
| --- | --- | --- |
| `BALLOT_ENCRYPTION_KEY` | 64-character hex string (32 bytes) | Yes, for `encryptVote` / `decryptVote` |

Generate a key:

```bash
openssl rand -hex 32
```

Never commit or log this value.

---

## Ballot Lifecycle

### 1. Hashing Voter Identifiers

Before storing voter eligibility data, hash identifiers with `hashIdentifier`. This function normalizes input (trim, lowercase, NFC, strip punctuation) before hashing, so equivalent identifiers produce the same hash.

```typescript
import { hashIdentifier } from "@anonvote/crypto";

// These all produce the same hash
const hash1 = hashIdentifier("alice@example.com");
const hash2 = hashIdentifier("  Alice@Example.COM  ");
const hash3 = hashIdentifier("Alice@example.com");

// Store only the hash — never the original identifier
await db.eligibility.create({
  identifierHash: hash1,
  ballotId: "elec-123",
  weight: 1,
});
```

### 2. Generating Voter Tokens

Each voter receives a one-time token. Generate it with `generateToken`, then hash it for storage with `hashToken`. The raw token is given to the voter and discarded.

```typescript
import { generateToken, hashToken } from "@anonvote/crypto";

// Generate a one-time token
const rawToken = generateToken(); // 64-char hex string

// Hash for server-side storage
const tokenHash = hashToken(rawToken);

// Store only the hash
await db.voterToken.create({
  tokenHash,
  ballotId: "elec-123",
  used: false,
});

// Distribute rawToken to the voter, then discard it
sendToVoter(rawToken);
```

**Key distinction:** `hashToken` is case-sensitive and does not normalize input. `hashIdentifier` normalizes before hashing. Never mix the two for the same data.

### 3. Creating an Election

Use `AnonVoteClient` from the subpath export to create elections client-side. No network calls are made.

```typescript
import { AnonVoteClient } from "@anonvote/crypto/client";
import { randomBytes } from "crypto";

// Generate a fresh key per ballot
const ballotKey = randomBytes(32).toString("hex");

const client = new AnonVoteClient({ ballotKey });

const election = client.createElection({
  title: "Board Election 2026",
  description: "Elect two new board members.",
  options: ["Alice", "Bob", "Abstain"],
  startTime: new Date(),
  endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});

console.log(election.id);      // unique election ID
console.log(election.options); // array with UUIDs for each option
```

Each option receives a generated UUID. Voters reference options by UUID, not by label text — option labels never reach the encryption layer.

### 4. Encrypting Votes

When a voter casts a vote, the selected option UUID is encrypted with AES-256-GCM:

```typescript
const ballot = client.castVote(election, election.options[0].id);

// ballot contains:
//   electionId      — the election this vote belongs to
//   optionId        — the selected option UUID (local only)
//   encryptedPayload — { ciphertext, iv, authTag } (all hex strings)
```

**Security properties:**
- `optionId` is present locally for voter confirmation but never sent to the server
- Each encryption uses a random IV, so the same option produces different ciphertext
- The GCM auth tag detects tampering at decryption time

### 5. Verifying Votes

Verify a ballot locally before submitting to the server:

```typescript
const result = client.verifyVote(ballot);
console.log(result.confirmed); // true if the payload decrypts correctly
```

If the ballot has been corrupted or the key is wrong, `verifyVote` throws a `CryptoError` rather than silently returning false.

### 6. Serializing for Server Submission

Serialize the ballot for transmission. Only the election ID and encrypted payload are included — `optionId` is deliberately omitted:

```typescript
const json = client.serialize(ballot);

// Send to server
await fetch("/api/votes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: json,
});
```

The output is a deterministic JSON string (keys sorted alphabetically), suitable for hashing or blockchain anchoring.

### 7. Deserializing Stored Ballots

Reconstruct a ballot from a stored or received JSON string:

```typescript
const restored = client.deserialize(json);

// restored.optionId === "" — not included in serialized form by design
// restored.electionId matches the original
// restored.encryptedPayload is intact for decryption
```

### 8. Decrypting Results (Tally Engine)

Only the tally engine should decrypt votes, using the low-level `decryptVote` function:

```typescript
import { decryptVote } from "@anonvote/crypto";

// For each encrypted vote in the database
const optionId = decryptVote(vote.encryptedPayload, ballotKey);
// Tally the optionId
```

---

## Using the Root-Level AnonVoteClient

The root export (`@anonvote/crypto`) provides a different `AnonVoteClient` with a network-aware interface. Use this when you need automatic retry, timeout handling, and HTTP integration:

```typescript
import { AnonVoteClient } from "@anonvote/crypto";

const client = new AnonVoteClient({
  encryptionKey: process.env.BALLOT_ENCRYPTION_KEY!,
  retryConfig: { maxRetries: 3 },
});

// Create an election (generates IDs, returns Election object)
const election = client.createElection({
  title: "Budget Vote",
  description: "Q3 budget approval",
  options: ["Approve", "Reject"],
  startTime: Date.now(),
  endTime: Date.now() + 7 * 86_400_000,
});

// Cast a vote (encrypts the option)
const receipt = client.castVote({
  ballotId: election.id,
  voteOption: election.options[0].text,
});

// Verify the encrypted payload
const isValid = client.verifyVote(receipt.encryptedPayload);
```

---

## Common Pitfalls and Solutions

### 1. Incorrect Key Format

**Problem:** `encryptVote` throws `ValidationError: encryption key must be a 64-character hex string (32 bytes)`.

**Solution:** Ensure the key is exactly 64 hex characters (32 bytes). Generate with:

```bash
openssl rand -hex 32
```

```typescript
import { randomBytes } from "crypto";
const key = randomBytes(32).toString("hex"); // always 64 hex chars
```

### 2. Reusing Keys Across Ballots

**Problem:** Using the same encryption key for multiple ballots compromises vote secrecy.

**Solution:** Generate a fresh key per ballot. Never persist the key alongside encrypted votes.

### 3. Wrong Key for Decryption

**Problem:** `decryptVote` throws `CryptoError: Failed to decrypt vote: payload has been tampered with or the key is incorrect`.

**Solution:** Verify you're using the same key that was used for encryption. Check for copy-paste errors or encoding mismatches.

### 4. Sending `optionId` to the Server

**Problem:** Including `optionId` in API requests breaks the privacy model.

**Solution:** Always use `client.serialize(ballot)` before submitting. The serialized form intentionally omits `optionId`.

### 5. Mixing `hashIdentifier` and `hashToken`

**Problem:** Eligibility lookups fail because `hashIdentifier` normalizes input but `hashToken` does not.

**Solution:** Use `hashIdentifier` for voter identifiers (emails, IDs). Use `hashToken` for raw voter tokens. Never interchange them.

### 6. Election Not Active

**Problem:** `castVote` throws `ELECTION_NOT_ACTIVE`.

**Solution:** Ensure the current time is between `startTime` and `endTime`. For testing, set `startTime` in the past and `endTime` in the future.

### 7. Encryption Key Missing

**Problem:** `castVote` throws `encryptionKey is required either in params or client config`.

**Solution:** Either pass the key in the client constructor or in each `castVote` call:

```typescript
// Option A: client-level
const client = new AnonVoteClient({ encryptionKey: key });

// Option B: per-call
client.castVote({ ballotId, voteOption, encryptionKey: key });
```

### 8. Tampered Payload Detection

**Problem:** `decryptVote` throws `CryptoError` even though the ciphertext looks correct.

**Solution:** GCM mode detects any modification to the ciphertext, IV, or auth tag. If you see this error, the payload was modified in transit or the wrong key is being used.

---

## FAQ

### Q: How do I rotate encryption keys?

A: Generate a new key per ballot using `randomBytes(32).toString("hex")`. Each ballot should use its own key. Old keys must be retained to decrypt historical votes. Key rotation is per-ballot, not global — a single ballot's votes are always encrypted with the same key.

### Q: Are voter tokens secure?

A: Tokens are 32 bytes (256 bits) of cryptographically secure randomness generated via the Web Crypto API or Node's `crypto.randomBytes`. The raw token is never stored — only its SHA-256 hash is persisted. The hash is one-way; the original token cannot be recovered from the database. Tokens are single-use and invalidated after voting.

### Q: How does encryption performance scale?

A: AES-256-GCM encryption is fast. Based on benchmarks, the SDK can encrypt approximately 10,000+ votes per second on modern hardware. The operation is synchronous and CPU-bound. For bulk operations (e.g., tallying thousands of votes), consider processing in batches to avoid blocking the event loop.

### Q: Can I use this in the browser?

A: The `generateToken` function works in browsers via the Web Crypto API. However, `hashIdentifier`, `hashToken`, `encryptVote`, and `decryptVote` require Node.js's `crypto` module (or a runtime with Node.js compatibility like Cloudflare Workers with `nodejs_compat`). The `AnonVoteClient` SDK is designed for server-side or Node.js-compatible environments.

### Q: What happens if I lose the encryption key?

A: Votes encrypted with that key cannot be decrypted. There is no recovery mechanism — this is by design to ensure vote secrecy. Store keys securely with the same care as database credentials.

### Q: How do I verify results independently?

A: Use `verifyVoteHash` from the crypto primitives to verify individual votes, or use the root-level `AnonVoteClient.verifyVote` to check that an encrypted payload is valid. For full result verification, use the `AnonVoteClient` SDK's verification methods which check consistency against audit records and the Stellar blockchain anchor.

### Q: What's the difference between the two AnonVoteClient exports?

A: The root export (`@anonvote/crypto`) provides a network-aware client with HTTP retry, timeout handling, and server communication. The subpath export (`@anonvote/crypto/client`) provides a pure client-side SDK for election creation, vote casting, and local verification without any network calls.

---

## Further Reading

- [README.md](./README.md) — Package overview and API reference
- [examples/](./examples/) — Working TypeScript examples
- [TypeDoc API Documentation](https://anonvote.github.io/js/) — Generated API reference
- [DECISIONS.md](./DECISIONS.md) — Architecture decision records
- [PERFORMANCE.md](./PERFORMANCE.md) — Performance baselines
