# REST API Specification

**Base URL:** `https://your-deployment/api`  
**Auth:** JWT via HTTP-only cookie (`session` header set on login)

---

## Organizations

| Method  | Endpoint                  | Auth    | Description                      |
| ------- | ------------------------- | ------- | -------------------------------- |
| `POST`  | `/organizations`          | —       | Register a new organization      |
| `POST`  | `/organizations/login`    | —       | Admin login; sets session cookie |
| `POST`  | `/organizations/logout`   | Session | Clears session cookie            |
| `GET`   | `/organizations/me`       | Session | Get current org profile          |
| `PATCH` | `/organizations/me`       | Session | Update org name or email         |
| `PATCH` | `/organizations/password` | Session | Change password                  |

---

## Ballots

| Method   | Endpoint       | Auth    | Description                                               |
| -------- | -------------- | ------- | --------------------------------------------------------- |
| `GET`    | `/ballots`     | Session | List all ballots for the authenticated org                |
| `POST`   | `/ballots`     | Session | Create a new ballot                                       |
| `GET`    | `/ballots/:id` | —       | Get a ballot by ID (public)                               |
| `PATCH`  | `/ballots/:id` | Session | Edit ballot topic, deadline, options, or eligibility list |
| `DELETE` | `/ballots/:id` | Session | Delete a ballot and all associated data                   |

### Create ballot request body

```json
{
  "topic": "Should we adopt remote-first?",
  "options": ["Yes", "No", "Abstain"],
  "deadline": "2026-07-01T00:00:00.000Z",
  "eligibilityListId": "uuid",
  "allowWeightedVoting": false,
  "allowRankedChoice": false,
  "maxRankings": null
}
```

---

## Eligibility

| Method | Endpoint       | Auth    | Description                                     |
| ------ | -------------- | ------- | ----------------------------------------------- |
| `POST` | `/eligibility` | Session | Upload voter list (multipart CSV or plain text) |

Identifiers are SHA-256 hashed server-side. Raw identifiers are never stored.

---

## Tokens

| Method | Endpoint                  | Auth    | Description                                         |
| ------ | ------------------------- | ------- | --------------------------------------------------- |
| `POST` | `/tokens`                 | —       | Request a one-time voter token                      |
| `POST` | `/tokens/reissue`         | —       | Reissue a lost token (blocked if vote already cast) |
| `POST` | `/tokens/reset/:ballotId` | Session | Reset all tokenIssued flags for a ballot (admin)    |

### Token request body

```json
{
  "ballotId": "uuid",
  "voterIdentifier": "alice@example.com"
}
```

### Token response

```json
{
  "data": {
    "token": "64-char-hex-string",
    "weight": 1
  }
}
```

---

## Votes

| Method | Endpoint | Auth | Description              |
| ------ | -------- | ---- | ------------------------ |
| `POST` | `/votes` | —    | Submit an anonymous vote |

### Vote request body

```json
{
  "ballotId": "uuid",
  "voterToken": "64-char-hex-string",
  "optionId": "uuid",
  "weight": 1,
  "rank": null
}
```

---

## Results

| Method | Endpoint                   | Auth    | Description                       |
| ------ | -------------------------- | ------- | --------------------------------- |
| `GET`  | `/results/:ballotId`       | —       | Get published result (public)     |
| `POST` | `/results/:ballotId/tally` | Session | Manually close and tally a ballot |

---

## Audit

| Method | Endpoint           | Auth | Description                                        |
| ------ | ------------------ | ---- | -------------------------------------------------- |
| `GET`  | `/audit/:ballotId` | —    | Get audit event counts and Stellar transaction IDs |

---

## Delegations

| Method | Endpoint       | Auth | Description                                   |
| ------ | -------------- | ---- | --------------------------------------------- |
| `POST` | `/delegations` | —    | Delegate voting power to another token holder |

---

## Verification

| Method | Endpoint                 | Auth | Description                             |
| ------ | ------------------------ | ---- | --------------------------------------- |
| `POST` | `/verification/generate` | —    | Generate a verification hash for a vote |
| `POST` | `/verification/verify`   | —    | Verify a vote using its hash            |

---

## Admin

| Method  | Endpoint               | Auth    | Description                            |
| ------- | ---------------------- | ------- | -------------------------------------- |
| `GET`   | `/admin/rate-limit`    | Session | Get current rate limit settings        |
| `PATCH` | `/admin/rate-limit`    | Session | Update rate limit preset               |
| `GET`   | `/admin/tokens-issued` | Session | Total tokens issued across all ballots |

---

## Errors

AnonVote protocol errors are standardized in [`specs/errors.md`](specs/errors.md). API implementations SHOULD return the protocol `code` in every error response and clients SHOULD branch on that code rather than on human-readable text.

```json
{
  "code": "AVE-REQ-002",
  "message": "Human-readable description"
}
```

Common HTTP mappings include:

| Status | Protocol code examples | When |
| ------ | ---------------------- | ---- |
| 400 | `AVE-REQ-001`, `AVE-REQ-002`, `AVE-BALLOT-002`, `AVE-TOKEN-003`, `AVE-VOTE-001` | Malformed payloads or invalid request data |
| 401 | `AVE-AUTH-001` | Missing, expired, or invalid authentication |
| 403 | `AVE-AUTH-002`, `AVE-BALLOT-003`, `AVE-BALLOT-004` | Authenticated but not permitted, or action not allowed in current ballot state |
| 404 | `AVE-BALLOT-001`, `AVE-ELIG-001`, `AVE-TOKEN-002`, `AVE-TALLY-003` | Referenced resource or result not found |
| 409 | `AVE-TOKEN-001`, `AVE-VOTE-002`, `AVE-TALLY-002`, `AVE-CONTRACT-002` | Duplicate or conflicting protocol state |
| 429 | `AVE-REQ-004` | Rate limit exceeded |
| 500/503 | `AVE-VOTE-003`, `AVE-CRYPTO-002`, `AVE-CONTRACT-003`, `AVE-AUDIT-001` | Required persistence, cryptographic, contract, or audit operation failed |
