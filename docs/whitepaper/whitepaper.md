# AnonVote Protocol Whitepaper

**Version:** 1.0.0-draft  
**Status:** Draft  
**Authors:** AnonVote Contributors

---

## Abstract

AnonVote is a privacy-preserving voting protocol for organizations, built on the Stellar blockchain. It provides cryptographic guarantees of voter anonymity and result integrity without relying on policy or trust assumptions. This document describes the full protocol: the threat model, cryptographic design, data flows, smart contract audit model, and the structural unlinkability properties that make voter anonymity computationally enforceable rather than merely promised.

---

## 1. Introduction

Digital voting systems face a fundamental tension: to prevent fraud (one person, one vote), you need to know who voted; but to protect voters, you must not record who voted for what. Most systems resolve this by trusting the platform operator — a policy guarantee, not a cryptographic one.

AnonVote resolves this tension structurally. Identity and ballot choice are separated at the schema level; no database join between them exists by design. Every vote is recorded on the Stellar blockchain so results are independently verifiable by anyone, without trusting AnonVote's infrastructure.

---

## 2. Threat Model

### 2.1 Adversaries considered

| Adversary          | Capability                          | Goal                                           |
| ------------------ | ----------------------------------- | ---------------------------------------------- |
| Database attacker  | Full read access to the database    | Link a vote to a voter identity                |
| Network attacker   | Can observe API traffic             | Correlate token requests with vote submissions |
| Insider            | Access to application code and logs | Identify who voted for what                    |
| Result manipulator | Can modify database records         | Alter vote counts after submission             |

### 2.2 Properties guaranteed

- **Voter anonymity** — Even with full database access, it is computationally infeasible to link a vote to a voter identity.
- **One person, one vote** — Enforced by the cryptographic token system, not by policy.
- **Result integrity** — Vote payloads are encrypted; results are anchored to the Stellar blockchain.
- **Public auditability** — Anyone can verify event counts and result hashes on-chain without trusting AnonVote servers.

### 2.3 Out of scope

- Coercion attacks (voter forced to vote a certain way)
- Side-channel attacks on the token delivery mechanism (e.g., email interception)
- Collusion between the election administrator and a blockchain validator

---

## 3. Cryptographic Design

### 3.1 Voter identifier hashing

Voter identifiers (email addresses, employee IDs, etc.) are hashed with SHA-256 before storage:

```
identifierHash = SHA-256(trim(lowercase(voterIdentifier)))
```

The original identifier is never written to the database. The hash is used only to check eligibility and prevent duplicate token issuance.

### 3.2 Token generation

One-time voter tokens are generated using a cryptographically secure pseudo-random number generator (CSPRNG):

```
rawToken = CSPRNG(32 bytes) → hex string (64 chars)
tokenHash = SHA-256(rawToken)
```

The `rawToken` is returned to the voter and immediately discarded from server memory. Only `tokenHash` is persisted. The raw token has 256 bits of entropy — brute-force enumeration is computationally infeasible.

### 3.3 Vote encryption

Vote option IDs are encrypted with AES-256-GCM before storage:

```
key    = BALLOT_ENCRYPTION_KEY (32 bytes, from env)
iv     = CSPRNG(12 bytes)   ← random per vote, never reused
(ciphertext, authTag) = AES-256-GCM(key, iv, optionId)
encryptedPayload = base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
```

GCM authentication tags ensure any tampering with the stored payload is detected and rejected at tally time. The encryption key is held only by the backend — not stored in the database.

### 3.4 Result tally

At tally time, the backend decrypts each vote payload to recover the option ID, aggregates counts, and records the result:

```
optionId = AES-256-GCM-Decrypt(key, encryptedPayload)
tally[optionId] += vote.weight
```

The tally JSON is then hashed and anchored on-chain:

```
resultHash = SHA-256(JSON.stringify(tally))
```

---

## 4. Structural Unlinkability

The key privacy property is that **no database join can connect a voter's identity to their vote**. This is enforced at the schema level:

```
EligibilityEntry          VoterToken             Vote
─────────────────         ──────────────         ────────────────
identifierHash            tokenHash              encryptedPayload
tokenIssued = true        ballotId               ballotId
                          used = true            optionId (encrypted)
```

There is no foreign key, no shared column, and no log entry that links these three tables. The only relationship is temporal (all belong to the same ballot), not relational.

Even if an attacker has:

- The identifier hash (from EligibilityEntry)
- The token hash (from VoterToken)
- The encrypted payload (from Vote)

...they cannot determine which vote corresponds to which voter without either:

1. Reversing SHA-256 (computationally infeasible)
2. Breaking AES-256-GCM (computationally infeasible)

---

## 5. Token Flow

See [`specs/token-flow.md`](../specs/token-flow.md) for the full flow diagram.

**Summary:**

1. Admin uploads eligibility list → identifiers hashed and stored
2. Voter submits identifier → eligibility checked by hash, `rawToken` generated and returned, `tokenHash` stored, `tokenIssued` flag set
3. Voter submits `rawToken` + `optionId` → `tokenHash` verified, vote encrypted and stored, token marked used
4. Ballot closes → tally engine decrypts votes, publishes result, anchors to Stellar

---

## 6. Stellar Integration

### 6.1 manageData (active)

Every TOKEN_ISSUED, VOTE_CAST, and RESULT_PUBLISHED event is written to Stellar as a `manageData` operation on a dedicated AnonVote account. The resulting transaction hash is stored in the database and surfaced on the public result page.

This means anyone can independently confirm that a result was published at a specific time by checking the Stellar ledger — no trust in AnonVote required.

### 6.2 Soroban contracts (AnonVote/contracts)

The Soroban contract extends this with **on-chain queryable state**: token counts, vote counts, and result hashes stored in contract persistent storage. This allows:

- Public verification of ballot consistency (`tokens_issued == votes_cast`)
- Independent auditing without querying AnonVote's API
- Immutable result hash storage (cannot be overwritten once set)

See [`specs/smart-contracts.md`](../specs/smart-contracts.md) for the full contract specification.

---

## 7. Advanced Voting Modes

### 7.1 Weighted voting

Each eligibility entry carries a `weight` field (default: 1). The token issuance flow returns this weight to the voter; the vote submission records it. The tally engine sums `vote.weight` instead of counting rows.

Consistency check: `SUM(vote.weight) == COUNT(used tokens)` is evaluated at tally time and surfaced on the result page.

### 7.2 Vote delegation

A token holder can delegate their voting power to another token holder. The delegator's token is marked `used` with a `delegatedTo` pointer; the delegate's token is marked with a `delegatedFrom` pointer. The privacy engine follows the delegation chain at vote-submission time.

### 7.3 Ranked-choice voting

Votes carry an optional `rank` field (1 = first choice, 2 = second, etc.). The ballot model carries `allowRankedChoice` and `maxRankings` configuration. Ranked-choice tally logic is applied in the result engine.

---

## 8. Privacy Audit Checklist

For auditors reviewing an AnonVote deployment:

- [ ] `EligibilityEntry.identifierHash` contains only SHA-256 hashes, never raw identifiers
- [ ] `VoterToken.tokenHash` contains only SHA-256 hashes, never raw tokens
- [ ] `Vote.encryptedPayload` is always in `iv:authTag:ciphertext` format, never plaintext
- [ ] No log lines contain raw voter identifiers or raw token values
- [ ] `BALLOT_ENCRYPTION_KEY` is not stored in the database
- [ ] No foreign key or join path connects `EligibilityEntry` to `Vote`
- [ ] Stellar transaction IDs are present on VOTE_CAST and RESULT_PUBLISHED audit events

---

## 9. References

- Stellar Developer Documentation: https://developers.stellar.org
- Soroban SDK: https://soroban.stellar.org
- AES-GCM specification: NIST SP 800-38D
- SHA-256 specification: FIPS PUB 180-4
- `@anonvote/crypto`: https://github.com/AnonVote/js

---

_This document is a living spec. For discussion and amendments, open an issue or pull request in [AnonVote/docs](https://github.com/AnonVote/docs)._
