# Protocol Error Code Specification

This document is the canonical, implementation-independent error catalog for AnonVote. Backend services, SDKs, CLIs, and smart contracts MUST use these codes when representing protocol failures so that the same failure condition is reported consistently across implementations.

---

## Goals

- Define stable, language-agnostic error identifiers for common protocol failures.
- Describe when each error MUST be returned or raised.
- Keep transport details separate from protocol semantics: the same code can be represented as an HTTP response, SDK exception, contract error, CLI exit detail, or structured log event.
- Avoid leaking voter identifiers, raw tokens, encrypted vote payloads, ballot keys, or other sensitive values in error responses.

---

## Error object

Implementations SHOULD expose protocol errors as structured objects with at least these fields:

| Field | Required | Description |
| ----- | -------- | ----------- |
| `code` | Yes | Stable protocol code from this specification. |
| `message` | Yes | Human-readable summary safe to show to clients. |
| `details` | No | Non-sensitive machine-readable context, such as a field name or validation rule. MUST NOT contain raw voter identifiers, raw tokens, ballot encryption keys, decrypted votes, or encrypted payload bytes. |

Example JSON representation:

```json
{
  "code": "AVE-VOTE-002",
  "message": "The supplied voter token has already been used.",
  "details": {
    "field": "voterToken"
  }
}
```

The JSON shape above is recommended for HTTP APIs and SDKs, but the protocol code is the normative value. Implementations in languages or runtimes that do not use JSON MUST still preserve the exact `code` string.

---

## Code format

Protocol error codes use this format:

```text
AVE-<DOMAIN>-<NUMBER>
```

- `AVE` identifies AnonVote protocol errors.
- `<DOMAIN>` groups related failures.
- `<NUMBER>` is a three-digit, zero-padded identifier that is unique within the domain.

Codes are immutable once published. A code MUST NOT be reused for a different failure condition.

---

## Error catalog

### Request and payload errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-REQ-001` | `MALFORMED_PAYLOAD` | The request or message body cannot be parsed or is not shaped as required by the protocol. | Return when JSON, CSV, multipart data, contract arguments, or SDK inputs are syntactically malformed, missing required top-level structure, or use an unsupported content representation. |
| `AVE-REQ-002` | `INVALID_FIELD` | One or more fields fail validation. | Return when a required field is absent, empty when non-empty is required, has the wrong type, has an invalid format such as a non-UUID ballot ID, or violates a numeric/string bound. |
| `AVE-REQ-003` | `UNSUPPORTED_OPERATION` | The requested operation is not supported by this protocol version or deployment. | Return when a client requests a feature, endpoint, contract function, ballot mode, or option that the implementation does not support. |
| `AVE-REQ-004` | `RATE_LIMITED` | The caller exceeded a configured request limit. | Return when a backend, SDK adapter, gateway, or contract-facing service rejects an operation because the caller is temporarily rate limited. |

### Authentication and authorization errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-AUTH-001` | `UNAUTHENTICATED` | Authentication is missing, expired, malformed, or otherwise invalid. | Return when an authenticated operation is requested without a valid admin session, API credential, wallet signature, or other required authentication proof. |
| `AVE-AUTH-002` | `UNAUTHORIZED_ACTION` | The authenticated caller is not permitted to perform the requested action. | Return when the caller is authenticated but is not the organization admin, contract admin, ballot owner, or otherwise lacks the required permission. |
| `AVE-AUTH-003` | `INVALID_SIGNATURE` | A required cryptographic signature is invalid. | Return when a wallet, contract, webhook, audit, or delegation signature is required but fails verification. |

### Ballot errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-BALLOT-001` | `BALLOT_NOT_FOUND` | The referenced ballot does not exist or is not visible to the caller. | Return when a ballot ID or ballot hash cannot be resolved in the relevant off-chain store or on-chain state. |
| `AVE-BALLOT-002` | `INVALID_BALLOT` | The ballot definition is invalid. | Return when ballot creation or update input has invalid options, duplicate option IDs, incompatible settings, an invalid deadline, an invalid eligibility reference, or otherwise violates ballot schema rules. |
| `AVE-BALLOT-003` | `BALLOT_EXPIRED` | The ballot deadline has passed. | Return when token issuance, vote submission, delegation, ballot editing, or another time-bound action is attempted after the ballot deadline or after the ballot has closed. |
| `AVE-BALLOT-004` | `BALLOT_NOT_OPEN` | The ballot is not accepting the requested operation yet. | Return when voting, token issuance, delegation, or tallying is attempted before the ballot opens or before the required prior state exists. |
| `AVE-BALLOT-005` | `BALLOT_ALREADY_EXISTS` | A ballot is already registered for the supplied identifier or hash. | Return when creating or recording a ballot would duplicate an existing ballot record or on-chain ballot entry. |
| `AVE-BALLOT-006` | `BALLOT_ALREADY_TALLIED` | Results have already been finalized or published for the ballot. | Return when an implementation is asked to tally, mutate, delete, or re-record final results for a ballot whose tally is immutable. |

### Eligibility and token errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-ELIG-001` | `ELIGIBILITY_NOT_FOUND` | The voter or eligibility entry is not eligible for the ballot. | Return when the normalized and hashed identifier is absent from the ballot eligibility list or the eligibility list itself cannot be found. |
| `AVE-ELIG-002` | `DUPLICATE_ELIGIBILITY_ENTRY` | The same eligibility identifier appears more than once for a ballot. | Return when uploading or updating an eligibility list would create duplicate normalized identifier hashes for one ballot. |
| `AVE-TOKEN-001` | `TOKEN_ALREADY_ISSUED` | A voter token was already issued for the eligibility entry. | Return when a token request is made for an eligible identifier whose `tokenIssued` flag is already true and token reissue rules do not allow a replacement. |
| `AVE-TOKEN-002` | `TOKEN_NOT_FOUND` | The supplied voter token cannot be found for the ballot. | Return when the submitted raw token, after hashing exactly as specified, does not match an unused or issued token for the requested ballot. |
| `AVE-TOKEN-003` | `INVALID_TOKEN` | The supplied voter token is malformed or not valid for the operation. | Return when a token is missing, not a 64-character lowercase hex value, belongs to a different ballot, has an invalid state transition, or otherwise fails token validation before lookup can succeed. |
| `AVE-TOKEN-004` | `TOKEN_REISSUE_BLOCKED` | The token cannot be reissued. | Return when a reissue request is made after a vote was cast, after delegation consumed the token, after ballot closure, or when reissue policy forbids replacement. |

### Vote errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-VOTE-001` | `INVALID_VOTE` | The vote is not valid for the ballot. | Return when the selected option is not part of the ballot, the weight is invalid, ranked-choice fields violate ballot settings, delegation resolution fails, or the vote does not satisfy ballot-specific rules. |
| `AVE-VOTE-002` | `DUPLICATE_VOTE` | The voter token has already been used to cast or delegate a vote. | Return when a vote submission uses a token whose used state is already true, including replay attempts. |
| `AVE-VOTE-003` | `VOTE_RECORD_FAILED` | The vote could not be durably recorded. | Return when an otherwise valid vote cannot be atomically persisted, encrypted, or anchored according to the deployment's required durability rules. |
| `AVE-VOTE-004` | `DELEGATION_INVALID` | The requested delegation is invalid. | Return when delegation creates a cycle, targets an invalid token, crosses ballot boundaries, uses an already consumed token, or violates delegation policy. |

### Cryptography and tally errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-CRYPTO-001` | `MALFORMED_ENCRYPTED_PAYLOAD` | An encrypted vote payload does not match the required payload format. | Return or raise when encrypted payload parsing fails before authentication can be checked. |
| `AVE-CRYPTO-002` | `PAYLOAD_AUTHENTICATION_FAILED` | Encrypted vote authentication failed. | Return or raise when AES-GCM authentication fails during decryption because the payload was modified, the wrong ballot key was used, or stored bytes are corrupted. Tally publication MUST halt. |
| `AVE-CRYPTO-003` | `BALLOT_KEY_INVALID` | The ballot encryption key is missing or malformed. | Return or raise when the ballot key is absent, not a 64-character lowercase hex string, wrong length, or otherwise not usable as the required AES-256 key. |
| `AVE-TALLY-001` | `TALLY_NOT_READY` | The ballot cannot be tallied yet. | Return when tallying is requested before the ballot deadline, while required votes or audit events are pending, or before the deployment's tally preconditions are met. |
| `AVE-TALLY-002` | `TALLY_CONSISTENCY_FAILED` | Tally counts do not match required protocol invariants. | Return when issued token counts, used token counts, vote rows, weighted totals, or on-chain counts fail consistency checks. |
| `AVE-TALLY-003` | `RESULT_NOT_FOUND` | Published results are not available. | Return when a client requests results for a ballot that has not been tallied or published. |

### Smart contract and audit errors

| Code | Name | Description | Failure condition |
| ---- | ---- | ----------- | ----------------- |
| `AVE-CONTRACT-001` | `CONTRACT_NOT_INITIALIZED` | The smart contract has not been initialized. | Return or raise when a contract write or read requires initialized admin or storage state that is absent. |
| `AVE-CONTRACT-002` | `CONTRACT_STATE_CONFLICT` | The requested contract state transition conflicts with existing state. | Return or raise when recording a ballot, token, vote, or result would violate immutability, duplicate-record, or missing-record constraints. |
| `AVE-CONTRACT-003` | `CONTRACT_CALL_FAILED` | A contract call failed before the protocol state transition completed. | Return when simulation, authorization, submission, ledger inclusion, or transaction confirmation fails. |
| `AVE-AUDIT-001` | `AUDIT_EVENT_FAILED` | A required audit event could not be recorded. | Return when the deployment requires an audit event but cannot write it durably. |
| `AVE-AUDIT-002` | `AUDIT_MISMATCH` | Audit records do not match expected protocol state. | Return when off-chain audit events, on-chain counters, transaction IDs, or result hashes disagree with the canonical ballot state. |

---

## Required failure mappings

Implementations MUST map the following common scenarios to these protocol codes:

| Scenario | Required code |
| -------- | ------------- |
| Malformed request body, CSV, SDK input, or contract argument | `AVE-REQ-001` |
| Missing or invalid required field | `AVE-REQ-002` |
| Missing, expired, or invalid authentication | `AVE-AUTH-001` |
| Authenticated caller lacks permission | `AVE-AUTH-002` |
| Referenced ballot does not exist | `AVE-BALLOT-001` |
| Ballot creation or update violates ballot schema | `AVE-BALLOT-002` |
| Token issuance, delegation, voting, or editing after close/deadline | `AVE-BALLOT-003` |
| Duplicate ballot registration | `AVE-BALLOT-005` |
| Voter identifier is not eligible | `AVE-ELIG-001` |
| Duplicate identifier in an eligibility list | `AVE-ELIG-002` |
| Duplicate token request for an identifier | `AVE-TOKEN-001` |
| Unknown token for the requested ballot | `AVE-TOKEN-002` |
| Malformed token value | `AVE-TOKEN-003` |
| Token reissue after vote or delegation use | `AVE-TOKEN-004` |
| Invalid ballot option, weight, rank, or ballot-specific vote rule | `AVE-VOTE-001` |
| Duplicate vote or token replay | `AVE-VOTE-002` |
| Invalid delegation request | `AVE-VOTE-004` |
| Malformed encrypted vote payload | `AVE-CRYPTO-001` |
| Decryption authentication failure during tally | `AVE-CRYPTO-002` |
| Missing or malformed ballot encryption key | `AVE-CRYPTO-003` |
| Tally requested before tally preconditions are met | `AVE-TALLY-001` |
| Token, vote, weighted, audit, or on-chain count mismatch | `AVE-TALLY-002` |
| Results requested before publication | `AVE-TALLY-003` |
| Contract duplicate or missing-record state conflict | `AVE-CONTRACT-002` |

---

## Transport guidance

### HTTP APIs

HTTP implementations SHOULD include the protocol `code` in every error response. They MAY also include legacy fields for backward compatibility, but clients SHOULD branch on `code` rather than text or transport status.

Recommended response shape:

```json
{
  "code": "AVE-BALLOT-003",
  "message": "The ballot is closed and no longer accepts votes."
}
```

Suggested HTTP status classes:

| Status | Typical protocol codes |
| ------ | ---------------------- |
| `400` | `AVE-REQ-*`, `AVE-BALLOT-002`, `AVE-TOKEN-003`, `AVE-VOTE-001`, `AVE-VOTE-004`, `AVE-CRYPTO-001`, `AVE-CRYPTO-003` |
| `401` | `AVE-AUTH-001` |
| `403` | `AVE-AUTH-002`, `AVE-BALLOT-003`, `AVE-BALLOT-004`, `AVE-TOKEN-004` |
| `404` | `AVE-BALLOT-001`, `AVE-ELIG-001`, `AVE-TOKEN-002`, `AVE-TALLY-003` |
| `409` | `AVE-BALLOT-005`, `AVE-BALLOT-006`, `AVE-ELIG-002`, `AVE-TOKEN-001`, `AVE-VOTE-002`, `AVE-TALLY-002`, `AVE-CONTRACT-002`, `AVE-AUDIT-002` |
| `422` | Semantically well-formed but protocol-invalid request states, when an implementation distinguishes them from `400`. |
| `429` | `AVE-REQ-004` |
| `500` or `503` | `AVE-VOTE-003`, `AVE-CRYPTO-002`, `AVE-CONTRACT-001`, `AVE-CONTRACT-003`, `AVE-AUDIT-001` |

### SDKs and CLIs

SDKs and CLIs SHOULD expose the protocol `code` as a stable property on errors or result objects. Exception class names, enum names, localized text, and exit codes are implementation details and MUST NOT replace the protocol code.

### Smart contracts

Smart contract implementations SHOULD map native contract errors, panics, or result variants to these protocol codes at their public boundary. When a runtime cannot emit strings directly, the contract documentation and SDK wrapper MUST provide a deterministic mapping from native error values to protocol codes.
