# Security Model

What AnonVote protects against, what it doesn't, and why.

---

## Threat model

| Attacker           | Capability                     | AnonVote's response                                                                                                                                                  |
| ------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB attacker        | Full read access to all tables | Cannot link vote to voter — no join path exists. Identifier and token hashes are one-way SHA-256. Vote payloads are AES-256-GCM encrypted with a key not in the DB.  |
| Network attacker   | Observes all API traffic       | Token request and vote submission are separate endpoints with no shared identifier. Rate limiting and HTTPS prevent enumeration and interception.                    |
| Insider            | App code + logs                | Logs never contain raw identifiers or raw tokens. Audit events store only event type and ballot ID.                                                                  |
| Result manipulator | Can write to DB                | Vote payloads are authenticated — GCM auth tag detects tampering. Results are anchored to Stellar; the on-chain hash cannot be changed.                              |
| Token guesser      | Unlimited guesses              | Tokens are 32-byte CSPRNG — 256-bit entropy. Brute-force is computationally infeasible. Rate limiting (3 req/min on vote endpoints) reduces online guessing further. |
| Replay attacker    | Captured valid token           | `VoterToken.used` is set atomically in a DB transaction on first use. Replay attempts are rejected and logged as `DUPLICATE_VOTE_ATTEMPT`.                           |

---

## What AnonVote protects

- **Voter anonymity** — No database query, join, or log can link a specific voter to their vote.
- **One person, one vote** — Enforced by the cryptographic token system. A token can only be used once.
- **Result integrity** — AES-256-GCM encryption + Stellar anchoring. Tally cannot be changed without detection.
- **Public auditability** — Anyone can verify event counts and result hashes on the Stellar ledger without accessing AnonVote's servers.
- **Duplicate prevention** — Both duplicate token requests and duplicate vote attempts are blocked and audited.

---

## What AnonVote does NOT protect against

- **Coercion** — If a voter is forced to vote a certain way or reveal their token, the protocol cannot prevent it. This is a social problem, not a cryptographic one.
- **Compromised token delivery** — If the channel delivering `rawToken` to the voter is intercepted (e.g., email), an attacker can use the token. The token is only as secure as its delivery channel.
- **Compromised admin** — The admin who runs the ballot controls the eligibility list and the encryption key. A malicious admin can manipulate eligibility. The blockchain anchoring makes post-hoc result tampering detectable, but does not constrain pre-submission eligibility fraud.
- **Key compromise** — If `BALLOT_ENCRYPTION_KEY` is leaked, historical vote payloads can be decrypted. The key should be rotated per ballot in high-security deployments.
- **Endpoint availability** — AnonVote does not provide availability guarantees. A DDoS on the API would prevent voting but cannot silently alter results.
- **Metadata analysis** — Timing correlation between token requests and vote submissions is theoretically possible for a network-level attacker observing traffic over time. The API does not add artificial delays.

---

## Cryptographic primitives

| Primitive          | Algorithm                             | Standard        |
| ------------------ | ------------------------------------- | --------------- |
| Identifier hashing | SHA-256                               | FIPS PUB 180-4  |
| Token generation   | CSPRNG (Node.js `crypto.randomBytes`) | NIST SP 800-90A |
| Token hashing      | SHA-256                               | FIPS PUB 180-4  |
| Vote encryption    | AES-256-GCM                           | NIST SP 800-38D |
| Result hashing     | SHA-256                               | FIPS PUB 180-4  |

---

## Audit checklist

For anyone auditing an AnonVote deployment:

- [ ] `EligibilityEntry.identifierHash` — SHA-256 hashes only, no raw identifiers
- [ ] `VoterToken.tokenHash` — SHA-256 hashes only, no raw tokens
- [ ] `Vote.encryptedPayload` — always `iv:authTag:ciphertext` format, never plaintext
- [ ] `BALLOT_ENCRYPTION_KEY` — not present in any DB column or log
- [ ] No FK or join path between `EligibilityEntry` and `Vote`
- [ ] All `VOTE_CAST` audit events have a `stellarTxId`
- [ ] All `RESULT_PUBLISHED` audit events have a `stellarTxId`
- [ ] Stellar tx IDs match on-chain records when verified via Stellar Explorer
