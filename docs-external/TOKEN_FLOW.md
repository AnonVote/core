# Token Flow

> **Deprecated.** The authoritative specification is [`specs/token-flow.md`](specs/token-flow.md). This file is kept for quick reference only and may lag behind the normative spec.

How a voter identity becomes a token, and a token becomes a vote.

---

## Full flow diagram

```
Admin                      Backend                        Voter
  │                           │                             │
  │── Upload eligibility ────►│                             │
  │   list (CSV)              │  hashIdentifier(id) × N    │
  │                           │  store { identifierHash,   │
  │                           │    weight, tokenIssued:false}│
  │                           │                             │
  │                           │◄── POST /api/tokens ────────│
  │                           │    { ballotId, identifier } │
  │                           │                             │
  │                           │  hashIdentifier(identifier) │
  │                           │  lookup EligibilityEntry    │
  │                           │  generateToken() → rawToken │
  │                           │  hashToken(rawToken)        │
  │                           │  store { tokenHash, ballotId}│
  │                           │  set tokenIssued = true     │
  │                           │── { token: rawToken } ─────►│
  │                           │                             │
  │                           │◄── POST /api/votes ─────────│
  │                           │    { ballotId, voterToken,  │
  │                           │      optionId, weight }     │
  │                           │                             │
  │                           │  hashToken(voterToken)      │
  │                           │  lookup VoterToken          │
  │                           │  validate not used          │
  │                           │  encryptVote(optionId, key) │
  │                           │  store Vote (encrypted)     │
  │                           │  mark token used            │
  │                           │  write VOTE_CAST → Stellar  │
  │                           │── { voteId, stellarTxId } ─►│
  │                           │                             │
  │── POST /tally ───────────►│                             │
  │                           │  decryptVote(payload) × N   │
  │                           │  tally[optionId] += weight  │
  │                           │  store Result               │
  │                           │  write RESULT_PUBLISHED     │
  │                           │    → Stellar                │
```

---

## Step by step

### 1. Eligibility upload

- Admin uploads CSV of voter identifiers
- Backend calls `hashIdentifier(id)` on each — trims and lowercases before SHA-256
- Stores `{ eligibilityListId, identifierHash, weight, tokenIssued: false }`
- Raw identifiers are never written to the database

### 2. Token request

- Voter POSTs their identifier to `/api/tokens`
- Backend hashes input and looks up `EligibilityEntry`
- If eligible and `tokenIssued = false`:
  - `rawToken = generateToken()` — 32-byte CSPRNG, 256-bit entropy
  - `tokenHash = hashToken(rawToken)` — SHA-256, no normalization
  - Stores `{ tokenHash, ballotId, used: false }` in `VoterToken`
  - Sets `EligibilityEntry.tokenIssued = true`
  - Returns `rawToken` to voter — **never stored anywhere**

### 3. Vote submission

- Voter POSTs `rawToken + optionId` to `/api/votes`
- Backend: `hashToken(rawToken)` → lookup `VoterToken`
- Validates: token exists, belongs to ballot, not used
- `encryptVote(optionId, BALLOT_ENCRYPTION_KEY)` → `encryptedPayload`
- Stores `Vote { ballotId, optionId, encryptedPayload, weight, rank? }`
- Marks `VoterToken.used = true`, records `usedAt`
- Writes `VOTE_CAST` audit event to Stellar (fire-and-forget, non-blocking)

### 4. Result tally

- Admin triggers tally or scheduler auto-closes at deadline
- Backend decrypts each vote: `decryptVote(payload, key)` → `optionId`
- Aggregates: `tally[optionId] += vote.weight`
- Consistency check: `SUM(vote.weight) == COUNT(used VoterTokens)`
- Stores `Result { tallyJson, totalVotes, isConsistent }`
- Writes `RESULT_PUBLISHED` to Stellar with result hash

---

## Edge cases

### Token reissue

Voter lost their token before voting:

1. POST `/api/tokens/reissue` with identifier
2. Backend verifies `tokenIssued = true` and no matching used token
3. Deletes the old unused `VoterToken`, creates a fresh one
4. Returns new `rawToken`

Blocked if vote was already cast — the token used count matches issued count.

### Delegation

1. Delegator POSTs to `/api/delegations` with their token hash and delegate's token hash
2. Backend sets `delegatorToken.delegatedTo = delegateToken.id`, marks delegator used
3. At vote submission, privacy engine follows the chain and validates against the delegate token

### Duplicate detection

- Second token request for same identifier: `tokenIssued = true` → audit event `DUPLICATE_TOKEN_ATTEMPT`, error returned
- Second vote attempt with used token: `VoterToken.used = true` → audit event `DUPLICATE_VOTE_ATTEMPT`, error returned
- Neither audit event stores the identifier or token value
