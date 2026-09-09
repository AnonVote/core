# API Surface

The REST API exposed by `AnonVote/core`. Base URL: `/api`.  
Auth: JWT via HTTP-only cookie set on login.

---

## Organizations

| Method | Endpoint                  | Auth    | Description                |
| ------ | ------------------------- | ------- | -------------------------- |
| POST   | `/organizations`          | —       | Register organization      |
| POST   | `/organizations/login`    | —       | Login, sets session cookie |
| POST   | `/organizations/logout`   | Session | Clear session              |
| GET    | `/organizations/me`       | Session | Current org profile        |
| PATCH  | `/organizations/me`       | Session | Update name or email       |
| PATCH  | `/organizations/password` | Session | Change password            |

---

## Ballots

| Method | Endpoint       | Auth    | Description         |
| ------ | -------------- | ------- | ------------------- |
| GET    | `/ballots`     | Session | List org's ballots  |
| POST   | `/ballots`     | Session | Create ballot       |
| GET    | `/ballots/:id` | —       | Get ballot (public) |
| PATCH  | `/ballots/:id` | Session | Edit ballot         |
| DELETE | `/ballots/:id` | Session | Delete ballot       |

**Create ballot body:**

```json
{
  "topic": "string",
  "options": ["string"],
  "deadline": "ISO8601",
  "eligibilityListId": "uuid",
  "allowWeightedVoting": false,
  "allowRankedChoice": false,
  "maxRankings": null
}
```

---

## Eligibility

| Method | Endpoint       | Auth    | Description                           |
| ------ | -------------- | ------- | ------------------------------------- |
| POST   | `/eligibility` | Session | Upload voter list (CSV or plain text) |

Identifiers are SHA-256 hashed server-side. Originals never stored.

---

## Tokens

| Method | Endpoint                  | Auth    | Description                     |
| ------ | ------------------------- | ------- | ------------------------------- |
| POST   | `/tokens`                 | —       | Request voter token             |
| POST   | `/tokens/reissue`         | —       | Reissue lost token              |
| POST   | `/tokens/reset/:ballotId` | Session | Reset tokenIssued flags (admin) |

**Request body:** `{ "ballotId": "uuid", "voterIdentifier": "string" }`  
**Response:** `{ "data": { "token": "64-char-hex", "weight": 1 } }`

---

## Votes

| Method | Endpoint | Auth | Description           |
| ------ | -------- | ---- | --------------------- |
| POST   | `/votes` | —    | Submit anonymous vote |

**Body:** `{ "ballotId": "uuid", "voterToken": "64-char-hex", "optionId": "uuid", "weight": 1, "rank": null }`

---

## Results

| Method | Endpoint                   | Auth    | Description            |
| ------ | -------------------------- | ------- | ---------------------- |
| GET    | `/results/:ballotId`       | —       | Get published result   |
| POST   | `/results/:ballotId/tally` | Session | Close and tally ballot |

---

## Audit

| Method | Endpoint           | Auth | Description                   |
| ------ | ------------------ | ---- | ----------------------------- |
| GET    | `/audit/:ballotId` | —    | Event counts + Stellar tx IDs |

---

## Delegations

| Method | Endpoint       | Auth | Description                    |
| ------ | -------------- | ---- | ------------------------------ |
| POST   | `/delegations` | —    | Delegate vote to another token |

---

## Verification

| Method | Endpoint                 | Auth | Description                           |
| ------ | ------------------------ | ---- | ------------------------------------- |
| POST   | `/verification/generate` | —    | Generate verification hash for a vote |
| POST   | `/verification/verify`   | —    | Verify a vote by hash                 |

---

## Admin

| Method | Endpoint               | Auth    | Description              |
| ------ | ---------------------- | ------- | ------------------------ |
| GET    | `/admin/rate-limit`    | Session | Get rate limit config    |
| PATCH  | `/admin/rate-limit`    | Session | Update rate limit preset |
| GET    | `/admin/tokens-issued` | Session | Total tokens issued      |

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
