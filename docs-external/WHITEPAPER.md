# AnonVote Protocol Whitepaper

**Version:** 1.0.0  
**Status:** Draft

---

## Abstract

AnonVote is a privacy-preserving voting protocol for organizations on the Stellar blockchain. It provides cryptographic voter anonymity and tamper-proof result integrity without relying on trust in the platform operator. Voter identity is structurally separated from ballot choice — not by policy, but at the schema and cryptographic layer.

---

## 1. The Problem

Digital voting systems face a core tension: preventing fraud (one person, one vote) requires knowing who voted, but protecting voters requires not recording who voted for what. Most tools resolve this by trusting the operator — a policy guarantee that breaks the moment the operator is compromised, coerced, or dishonest.

AnonVote resolves this structurally. Even with full database access, it is computationally infeasible to link a vote back to a voter.

---

## 2. Cryptographic Design

### 2.1 Voter identifier hashing

```
identifierHash = SHA-256(trim(lowercase(voterIdentifier)))
```

The raw identifier (email, employee ID, etc.) is never written to the database. Only the hash is stored, used solely to check eligibility and prevent duplicate token issuance.

### 2.2 Token generation and hashing

```
rawToken  = CSPRNG(32 bytes) → 64-char hex   ← given to voter, never stored
tokenHash = SHA-256(rawToken)                 ← stored in DB
```

256 bits of entropy. Brute-force enumeration is computationally infeasible.

### 2.3 Vote encryption

```
key              = BALLOT_ENCRYPTION_KEY (32 bytes from env, never in DB)
iv               = CSPRNG(12 bytes), unique per vote
(ct, authTag)    = AES-256-GCM(key, iv, optionId)
encryptedPayload = base64(iv) + ":" + base64(authTag) + ":" + base64(ct)
```

AES-256-GCM provides authenticated encryption — tampering with a stored payload is detected and rejected at tally time.

### 2.4 Result anchoring

```
resultHash = SHA-256(JSON.stringify(tally))
```

Written immutably to the Soroban contract and as a Stellar `manageData` operation. Anyone can verify the hash independently.

---

## 3. Structural Unlinkability

The three tables that matter:

```
EligibilityEntry       VoterToken           Vote
────────────────       ──────────           ────
identifierHash         tokenHash            encryptedPayload
tokenIssued            ballotId             ballotId
weight                 used                 weight
                       usedAt               rank (optional)
```

No foreign key, no shared column, no log entry links these tables. The only relationship is that all records belong to the same ballot — temporal, not relational.

An attacker with full DB access has: an identifier hash, a token hash, and an encrypted payload. Recovering the plaintext requires reversing SHA-256 or breaking AES-256-GCM. Both are computationally infeasible.

---

## 4. Blockchain Anchoring

### 4.1 Stellar manageData (active)

Every `TOKEN_ISSUED`, `VOTE_CAST`, and `RESULT_PUBLISHED` event is written to Stellar as a `manageData` operation. The transaction hash is stored in the DB and shown on the public result page. Anyone can verify via Stellar Explorer.

### 4.2 Soroban contract (AnonVote/contracts)

Provides on-chain queryable state:

- Token and vote counts per ballot
- Immutable result hash storage
- Public `is_consistent()` check (`tokens_issued == votes_cast`)

No voter data, token values, or vote content is ever written to the contract.

---

## 5. Advanced Voting Modes

**Weighted voting** — Each eligibility entry carries a `weight`. The tally sums `vote.weight` rather than counting rows. Consistency check: `SUM(weights) == COUNT(used tokens)`.

**Vote delegation** — A token holder can delegate to another. The delegator's token is marked used with a `delegatedTo` pointer; the delegate's token carries `delegatedFrom`. The privacy engine resolves the chain at submission time.

**Ranked-choice** — Votes carry an optional `rank` field. Ballots configure `allowRankedChoice` and `maxRankings`.

---

## 6. References

- [TOKEN_FLOW.md](TOKEN_FLOW.md) — step-by-step identity → token → vote flow
- [SECURITY.md](SECURITY.md) — threat model and what AnonVote does and doesn't protect against
- [API.md](API.md) — full REST API surface
- [AnonVote/js](https://github.com/AnonVote/js) — `@anonvote/crypto` implementation
- [AnonVote/contracts](https://github.com/AnonVote/contracts) — Soroban contract implementation
- NIST SP 800-38D (AES-GCM), FIPS PUB 180-4 (SHA-256)
