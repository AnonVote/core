# AnonVote Soroban Smart Contract Interface Specification

**Repository:** `AnonVote/contracts`  
**Runtime:** Soroban on Stellar  
**Language:** Rust / `soroban-sdk`  
**Status:** Interface specification for `create_ballot`, `record_vote`, and `finalise_result`

This document is the formal public interface specification for the AnonVote Soroban contract. A contributor should be able to implement the contract and the core TypeScript service stub from this specification alone.

The contract stores only public verification data. It does not store voter identity, plaintext vote choices, private keys, decryption keys, or raw ballot titles.

---

## 1. Soroban type conventions

### `BytesN<32>`

`BytesN<32>` values are exactly 32 bytes. Calls must reject malformed client inputs before contract submission. The contract interface uses `BytesN<32>` for:

- `ballot_id`: canonical 32-byte ballot identifier.
- `title_hash`: 32-byte hash of the ballot title or title metadata.

Client services may display these values as lowercase hexadecimal strings, but contract calls and event data use raw Soroban bytes, not hex strings.

### `Bytes`

`Bytes` is variable-length Soroban byte data. It is used for encrypted vote payloads and tally labels. Payload contents are opaque to the contract.

### `u64` deadline

`deadline` is a Unix timestamp in seconds, compared against `env.ledger().timestamp()`. A ballot is open while `env.ledger().timestamp() <= deadline` and closed once `env.ledger().timestamp() > deadline`.

### `Map<Bytes, u32>` tally

`tally` maps opaque result option identifiers to vote counts. Each key is a `Bytes` value so clients can use encrypted option labels, hashed option labels, or canonical byte identifiers. Each value is a non-negative `u32` count.

---

## 2. Contract types

### Contract name

```rust
pub struct AnonVoteContract;
```

### Data keys

The implementation must use typed Soroban storage keys equivalent to:

```rust
#[contracttype]
pub enum DataKey {
    Admin,
    Ballot(BytesN<32>),
    Vote(BytesN<32>, u32),
    VoteCount(BytesN<32>),
    Result(BytesN<32>),
}
```

### Ballot status

```rust
#[contracttype]
pub enum BallotStatus {
    Open,
    Finalised,
}
```

### Ballot record

```rust
#[contracttype]
pub struct BallotRecord {
    pub ballot_id: BytesN<32>,
    pub title_hash: BytesN<32>,
    pub deadline: u64,
    pub status: BallotStatus,
    pub vote_count: u32,
    pub created_at: u64,
}
```

### Vote record

```rust
#[contracttype]
pub struct VoteRecord {
    pub ballot_id: BytesN<32>,
    pub index: u32,
    pub encrypted_payload: Bytes,
    pub recorded_at: u64,
}
```

### Result record

```rust
#[contracttype]
pub struct ResultRecord {
    pub ballot_id: BytesN<32>,
    pub tally: Map<Bytes, u32>,
    pub finalised_at: u64,
}
```

### Error types

Implementations must expose stable numeric error codes. The enum names below are the public semantic API and must not be changed without a migration plan.

```rust
#[contracterror]
#[repr(u32)]
pub enum ContractError {
    BallotAlreadyExists = 1,
    BallotNotFound = 2,
    BallotClosed = 3,
    BallotStillOpen = 4,
    AlreadyFinalised = 5,
    Unauthorized = 6,
    AlreadyInitialized = 7,
    InvalidDeadline = 8,
    InvalidPayload = 9,
}
```

Mapping to issue labels:

| Issue label | Contract enum variant |
| --- | --- |
| `BALLOT_ALREADY_EXISTS` | `ContractError::BallotAlreadyExists` |
| `BALLOT_NOT_FOUND` | `ContractError::BallotNotFound` |
| `BALLOT_CLOSED` | `ContractError::BallotClosed` |
| `BALLOT_STILL_OPEN` | `ContractError::BallotStillOpen` |
| `ALREADY_FINALISED` | `ContractError::AlreadyFinalised` |

---

## 3. Access control

### Permissionless functions

The following functions are permissionless. They must not require a specific invoker address:

- `create_ballot`
- `record_vote`
- public view/read functions, if implemented

AnonVote relies on privacy and anti-abuse rules in core services. The contract must remain compatible with core's TypeScript service stub by accepting calls without an admin signer for ballot creation and vote recording.

### Admin-restricted functions

`finalise_result` must require the configured admin address. The admin is the trusted result publisher used by the core tallying service.

An implementation should include initialization and admin update methods even though they are not part of the three required ballot functions:

```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError>;
pub fn update_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), ContractError>;
pub fn get_admin(env: Env) -> Option<Address>;
```

Rules:

- `initialize` may be called exactly once.
- `initialize` stores `DataKey::Admin -> Address` in instance storage.
- A second `initialize` call returns `ContractError::AlreadyInitialized`.
- `update_admin` requires `current_admin.require_auth()`.
- `update_admin` succeeds only when `current_admin` equals the stored admin.
- `update_admin` replaces `DataKey::Admin` with `new_admin`.
- Unauthorized admin changes return `ContractError::Unauthorized`.

If the contract is deployed through a constructor pattern instead of `initialize`, the same rules apply: one immutable initial admin must be set at deployment, and only the current admin may update it.

---

## 4. Contract functions

## 4.1 `create_ballot`

### Rust signature

```rust
pub fn create_ballot(
    env: Env,
    ballot_id: BytesN<32>,
    title_hash: BytesN<32>,
    deadline: u64,
) -> Result<(), ContractError>;
```

### Parameters

| Parameter | Type | Description | Constraints |
| --- | --- | --- | --- |
| `env` | `Env` | Soroban execution environment. | Provided by Soroban runtime. |
| `ballot_id` | `BytesN<32>` | Canonical 32-byte ballot identifier. | Exactly 32 bytes. Must not already exist. |
| `title_hash` | `BytesN<32>` | Hash of ballot title or metadata. | Exactly 32 bytes. Raw title must not be stored. |
| `deadline` | `u64` | Unix timestamp in seconds when voting closes. | Must be greater than current ledger timestamp. |

### Return type

`Result<(), ContractError>`.

- `Ok(())` means the ballot record was written and the public creation event was emitted.
- `Err(...)` means no ballot record or vote counter was written.

### Preconditions

The call succeeds only if:

1. `DataKey::Ballot(ballot_id)` does not already exist.
2. `deadline > env.ledger().timestamp()`.
3. `ballot_id` and `title_hash` are valid `BytesN<32>` values, enforced by the Soroban ABI.

### Postconditions on success

1. A `BallotRecord` is written to persistent storage under `DataKey::Ballot(ballot_id)`.
2. `DataKey::VoteCount(ballot_id)` is written with value `0u32`.
3. Ballot status is `BallotStatus::Open`.
4. `created_at` equals `env.ledger().timestamp()`.
5. A `ballot_created` event is emitted exactly once.

### Errors

| Error | Trigger |
| --- | --- |
| `ContractError::BallotAlreadyExists` / `BALLOT_ALREADY_EXISTS` | `DataKey::Ballot(ballot_id)` already exists. |
| `ContractError::InvalidDeadline` | `deadline <= env.ledger().timestamp()`. |

---

## 4.2 `record_vote`

### Rust signature

```rust
pub fn record_vote(
    env: Env,
    ballot_id: BytesN<32>,
    encrypted_payload: Bytes,
) -> Result<u32, ContractError>;
```

### Parameters

| Parameter | Type | Description | Constraints |
| --- | --- | --- | --- |
| `env` | `Env` | Soroban execution environment. | Provided by Soroban runtime. |
| `ballot_id` | `BytesN<32>` | Ballot to vote in. | Exactly 32 bytes. Must exist. |
| `encrypted_payload` | `Bytes` | Opaque encrypted vote payload produced by core privacy logic. | Must be non-empty. Contract does not decrypt or validate vote choice semantics. |

### Return type

`Result<u32, ContractError>`.

- `Ok(index)` returns the vote index assigned to the recorded vote.
- The first vote for a ballot returns index `0`.
- Each subsequent vote increments by one.

### Preconditions

The call succeeds only if:

1. `DataKey::Ballot(ballot_id)` exists.
2. The ballot status is `BallotStatus::Open`.
3. `env.ledger().timestamp() <= ballot.deadline`.
4. `encrypted_payload` is non-empty.
5. Incrementing the vote count does not overflow `u32`.

### Postconditions on success

1. A `VoteRecord` is written to persistent storage under `DataKey::Vote(ballot_id, index)`.
2. `DataKey::VoteCount(ballot_id)` is incremented by one.
3. The stored `BallotRecord.vote_count` is updated to match the new vote count.
4. The ballot remains `BallotStatus::Open`.
5. A `vote_recorded` event is emitted exactly once.

### Errors

| Error | Trigger |
| --- | --- |
| `ContractError::BallotNotFound` / `BALLOT_NOT_FOUND` | `DataKey::Ballot(ballot_id)` does not exist. |
| `ContractError::BallotClosed` / `BALLOT_CLOSED` | Ballot status is not `Open` or ledger timestamp is greater than deadline. |
| `ContractError::InvalidPayload` | `encrypted_payload` is empty. |

---

## 4.3 `finalise_result`

### Rust signature

```rust
pub fn finalise_result(
    env: Env,
    admin: Address,
    ballot_id: BytesN<32>,
    tally: Map<Bytes, u32>,
) -> Result<(), ContractError>;
```

The issue text lists parameters as `ballot_id` and `tally`; this specification includes `admin: Address` explicitly so Soroban can enforce authorization with `admin.require_auth()` while preserving the same ballot/tally payload used by the TypeScript service.

### Parameters

One-time initialization. Sets the admin address. Fails with `AVE-CONTRACT-002` if already initialized.

### Return type

Register a ballot on-chain. Initializes `TokensIssued` and `VotesCast` to 0. Fails with `AVE-CONTRACT-002` if the ballot is already recorded.

- `Ok(())` means the final tally was written and the ballot can no longer accept votes.
- `Err(...)` means no result record was written and the ballot status was not changed.

Increment `TokensIssued` for a ballot. Fails with `AVE-BALLOT-001` if the ballot is not found.

The call succeeds only if:

Increment `VotesCast` for a ballot. Fails with `AVE-BALLOT-001` if the ballot is not found.

### Postconditions on success

Record the SHA-256 of the tally JSON. Immutable once set — fails with `AVE-CONTRACT-002` if the result is already recorded.

---

## 5. Storage layout

All ballot and vote data must be written to Soroban **persistent storage** so it remains queryable for public verification. Admin configuration may be stored in instance storage because it is contract-level configuration.

| Key | Value type | Storage kind | Written by | Read by | Notes |
| --- | --- | --- | --- | --- | --- |
| `DataKey::Admin` | `Address` | Instance | `initialize`, `update_admin` | `finalise_result`, `get_admin`, `update_admin` | Contract-wide admin. |
| `DataKey::Ballot(ballot_id)` | `BallotRecord` | Persistent | `create_ballot`, `record_vote`, `finalise_result` | all three functions and ballot views | Primary ballot record. |
| `DataKey::VoteCount(ballot_id)` | `u32` | Persistent | `create_ballot`, `record_vote` | `record_vote`, vote count views | Redundant counter for efficient indexing. Must equal `BallotRecord.vote_count`. |
| `DataKey::Vote(ballot_id, index)` | `VoteRecord` | Persistent | `record_vote` | vote/event verification views or indexers | One record per accepted encrypted vote. |
| `DataKey::Result(ballot_id)` | `ResultRecord` | Persistent | `finalise_result` | result views and public verifiers | Immutable after first write. |

### Key format requirements

- `ballot_id` in storage keys is raw `BytesN<32>`, not a hex string.
- `Vote` keys use `(ballot_id, index)` where `index` is the assigned zero-based vote index.
- Result keys use the same raw `ballot_id` bytes as the ballot record.

### Permanent vs temporary entries

- The contract must not rely on temporary storage for ballot records, votes, counts, or results.
- All public verification state must be persistent.
- Implementations should apply suitable TTL extension policy to persistent ballot, vote, and result keys when mutating them so ledger expiration does not silently remove public verification data.

---

## 6. Event schema

Events are a public API. Once deployed, event topics and data shapes must not change without a migration plan.

All `ballot_id` values in event data are raw Soroban bytes (`BytesN<32>`), not hex strings. Indexers may convert them to lowercase hex for display or database keys, but the ledger event itself must use bytes.

### 6.1 `ballot_created`

Emitted by `create_ballot` after storage writes succeed.

```rust
env.events().publish(
    (symbol_short!("ballot_created"), ballot_id.clone()),
    (ballot_id, title_hash, deadline, created_at),
);
```

| Field | Type | Description |
| --- | --- | --- |
| Topic 0 | `Symbol` | Exact value: `ballot_created`. |
| Topic 1 | `BytesN<32>` | Raw ballot id bytes. |
| Data 0 | `BytesN<32>` | Raw ballot id bytes. |
| Data 1 | `BytesN<32>` | Raw title hash bytes. |
| Data 2 | `u64` | Deadline Unix timestamp in seconds. |
| Data 3 | `u64` | Creation ledger timestamp in seconds. |

### 6.2 `vote_recorded`

Emitted by `record_vote` after vote storage and counter updates succeed.

```rust
env.events().publish(
    (symbol_short!("vote_recorded"), ballot_id.clone()),
    (ballot_id, index, encrypted_payload_hash, recorded_at),
);
```

The contract should not emit the full encrypted payload because event logs are optimized for public indexing. It should emit `encrypted_payload_hash: BytesN<32>` where the hash is the contract's canonical hash of `encrypted_payload`. If the implementation cannot hash in-contract, it may emit the raw `encrypted_payload: Bytes`, but the chosen format must be documented before deployment and must not change afterward. The recommended public API is the hash form above.

| Field | Type | Description |
| --- | --- | --- |
| Topic 0 | `Symbol` | Exact value: `vote_recorded`. |
| Topic 1 | `BytesN<32>` | Raw ballot id bytes. |
| Data 0 | `BytesN<32>` | Raw ballot id bytes. |
| Data 1 | `u32` | Zero-based vote index. |
| Data 2 | `BytesN<32>` | Hash of encrypted payload. |
| Data 3 | `u64` | Vote recording ledger timestamp in seconds. |

### 6.3 `result_finalised`

Emitted by `finalise_result` after result storage and status updates succeed.

```rust
env.events().publish(
    (symbol_short!("result_finalised"), ballot_id.clone()),
    (ballot_id, tally_hash, total_votes, finalised_at),
);
```

`tally_hash` is a `BytesN<32>` hash of the canonical serialized `Map<Bytes, u32>` tally. The full tally is stored in `DataKey::Result(ballot_id)`; the event hash lets indexers verify that the stored or served tally matches the emitted ledger event.

| Field | Type | Description |
| --- | --- | --- |
| Topic 0 | `Symbol` | Exact value: `result_finalised`. |
| Topic 1 | `BytesN<32>` | Raw ballot id bytes. |
| Data 0 | `BytesN<32>` | Raw ballot id bytes. |
| Data 1 | `BytesN<32>` | Hash of canonical tally map. |
| Data 2 | `u32` | Total votes represented by the tally. |
| Data 3 | `u64` | Finalisation ledger timestamp in seconds. |

### Querying events from Stellar

Consumers verify public activity by querying Stellar/Soroban events for the deployed contract id and filtering by topic:

1. Use the configured Soroban RPC endpoint.
2. Call `getEvents` with:
   - `contractIds: [ANONVOTE_CONTRACT_ID]`
   - `topics` filter containing the target event symbol and optionally the raw `ballot_id` topic.
3. Decode XDR event values into Soroban types.
4. Convert `BytesN<32>` values to lowercase hex only in client/indexer presentation layers.
5. For `result_finalised`, fetch or read `DataKey::Result(ballot_id)` and verify that the canonical tally hash matches the emitted `tally_hash`.

---

## 7. Recommended read-only views

The issue requires the three write functions above. The following read-only helpers are recommended for service and verifier compatibility:

```rust
pub fn get_ballot(env: Env, ballot_id: BytesN<32>) -> Option<BallotRecord>;
pub fn get_vote_count(env: Env, ballot_id: BytesN<32>) -> u32;
pub fn get_result(env: Env, ballot_id: BytesN<32>) -> Option<ResultRecord>;
pub fn is_finalised(env: Env, ballot_id: BytesN<32>) -> bool;
```

View functions are permissionless and must not mutate state.

---

## Error handling

Smart contract implementations MUST map native contract errors, panics, or result variants to the protocol error codes in [`errors.md`](errors.md). SDK wrappers MUST expose those protocol codes at their public boundary even when the contract runtime represents failures as numeric discriminants.

---

## Integration with core

The core TypeScript service stub must encode parameters as follows:

| Core operation | Contract call | Encoding requirements |
| --- | --- | --- |
| Ballot creation | `create_ballot(ballot_id, title_hash, deadline)` | `ballot_id` and `title_hash` are 32-byte buffers encoded as `BytesN<32>`; `deadline` is a Unix timestamp in seconds. |
| Vote submission | `record_vote(ballot_id, encrypted_payload)` | `ballot_id` is `BytesN<32>`; `encrypted_payload` is raw encrypted bytes. |
| Result publication | `finalise_result(admin, ballot_id, tally)` | `admin` signs; `ballot_id` is `BytesN<32>`; `tally` is a Soroban `Map<Bytes, u32>`. |

The service must not send hex strings to the contract for `ballot_id`, `title_hash`, tally keys, or payload bytes. Hex strings are allowed only at API boundaries or logs before conversion to Soroban byte values.

---

## 9. Compatibility checklist

A compatible implementation must satisfy all of the following:

- `create_ballot`, `record_vote`, and `finalise_result` use the exact parameter semantics defined here.
- Every function documents and returns the specified error variants.
- Ballot ids are raw `BytesN<32>` in contract calls, storage keys, and event data.
- `deadline` is a `u64` Unix timestamp in seconds and is compared to `env.ledger().timestamp()`.
- Vote payloads are stored as opaque `Bytes` and never decrypted on-chain.
- Tally keys are `Bytes`; tally counts are `u32`.
- All ballot, vote, count, and result entries are persistent storage entries.
- Event topics and data shapes match this document exactly before deployment.
- `finalise_result` is admin-restricted; `create_ballot` and `record_vote` are permissionless.
- A finalised ballot cannot accept additional votes and cannot be finalised again.
