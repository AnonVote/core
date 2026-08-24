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

## Building & Testing

```bash
# Build WASM binary
cargo build --target wasm32-unknown-unknown --release

# Run Rust unit tests
cargo test
```
