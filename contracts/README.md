# AnonVote Soroban Smart Contract

The `anonvote` smart contract provides on-chain anchoring for ballot creation, token issuance, vote submission, and result verification on the Stellar network using Soroban.

## Key Features & Hardening

### Vote Counter Overflow Detection (Issue #70)
- **Maximum Vote Limit**: `MAX_VOTES_PER_BALLOT = 2^63 - 1` (`9_223_372_036_854_775_807_u64`).
- **Defensive Check**: Before incrementing a ballot's vote counter in `record_vote`, the contract checks if the current count has reached `MAX_VOTES_PER_BALLOT`.
- **Error Code**: Returns `Error::CounterOverflow` (code `1`) and rejects the vote if the limit is exceeded.
- **Event Logging**:
  - Emits `(symbol_short!("vote"), symbol_short!("overflw"))` when a vote overflow attempt is rejected.
  - Emits `(symbol_short!("vote"), symbol_short!("limit"))` when the vote counter reaches `MAX_VOTES_PER_BALLOT`.

## Contract Methods

- `record_ballot(env: Env, ballot_id_hash: String)`: Records ballot registration on-chain.
- `record_token(env: Env, ballot_id_hash: String)`: Records token issuance counter increment.
- `record_vote(env: Env, ballot_id_hash: String) -> Result<(), Error>`: Records vote cast, enforcing `MAX_VOTES_PER_BALLOT` limit.
- `record_result(env: Env, ballot_id_hash: String, result_hash: String)`: Publishes final ballot tally hash.
- `get_tokens_issued(env: Env, ballot_id_hash: String) -> u64`: Returns total token count issued.
- `get_votes_cast(env: Env, ballot_id_hash: String) -> u64`: Returns total votes recorded.
- `is_consistent(env: Env, ballot_id_hash: String) -> bool`: Verifies that `tokens_issued >= votes_cast`.
- `record_ballot_commitment(env: Env, ballot_id_hash: String, commitment: String) -> Result<(), Error>`: Anchors a ballot's content commitment at DRAFT → ACTIVE. **Write-once** — a second write returns `Error::CommitmentExists` (code `5`). Unlike `record_result`, which overwrites unconditionally, a commitment that can be replaced proves nothing.
- `get_ballot_commitment(env: Env, ballot_id_hash: String) -> Result<String, Error>`: Returns the anchored commitment, or `Error::BallotNotFound` (code `2`) if the ballot was never committed.
- `initialize(env: Env, admin_key: String) -> Result<(), Error>`: Sets the admin key once, at deployment.
- `get_admin_key(env: Env) -> Result<String, Error>` / `rotate_admin_key(...)`: Admin key read and rotation.

### Error codes

| Code | Variant | Meaning |
| --- | --- | --- |
| 1 | `CounterOverflow` | Vote counter would exceed `MAX_VOTES_PER_BALLOT` |
| 2 | `BallotNotFound` | Operation on an unknown/uninitialised ballot |
| 3 | `Unauthorized` | Caller is not the admin, or contract already initialised |
| 4 | `InvalidKey` | Malformed Stellar key, or identical to the current one |
| 5 | `CommitmentExists` | A commitment is already anchored for this ballot |

These discriminants are a stable on-chain contract; `test_error_code_descriptive` pins them.

## Deployment

```bash
cargo build --target wasm32-unknown-unknown --release

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/anonvote.wasm \
  --source <identity> --network testnet

# Set the admin key once. Whoever holds this key controls rotate_admin_key.
stellar contract invoke --id <CONTRACT_ID> --source <identity> --network testnet \
  -- initialize --admin_key <G...>
```

Then set `SOROBAN_CONTRACT_ID=<CONTRACT_ID>` in `.env`. Until it is set, every
Soroban call silently no-ops and ballot verification falls back to the database
copy, reporting `source: "database"`.

> **Redeploy required for Issue #86.** `record_ballot_commitment` and
> `get_ballot_commitment` are new, so a contract deployed before this change
> cannot serve on-chain verification.

## Building & Testing

```bash
# Build WASM binary
cargo build --target wasm32-unknown-unknown --release

# Run Rust unit tests
cargo test
```
