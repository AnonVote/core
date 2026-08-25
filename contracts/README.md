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

### Idempotency & Duplicate Rejection (Issue #77)
- **Per-vote idempotency key**: `record_vote` now takes a `vote_id_hash` supplied
  by the caller (an HMAC-SHA256 of `ballotId:tokenHash`), stored under a
  `VoteRecorded(vote_id_hash)` data key.
- **Returned `Error::DuplicateVote` (code `5`)** whenever the same `vote_id_hash`
  is submitted again — the on-chain counter never advances on a replay, so
  resubmitting a batch can never double-count a vote.
- **Atomic batching**: `batch_record_votes` pre-validates every entry (duplicate
  + per-ballot overflow) **before** applying any, so a revert leaves storage
  untouched. Callers can safely split a reverted batch into individual
  idempotent `record_vote` submits.

## Contract Methods

- `record_ballot(env: Env, ballot_id_hash: String)`: Records ballot registration on-chain.
- `record_token(env: Env, ballot_id_hash: String)`: Records token issuance counter increment.
- `record_vote(env: Env, ballot_id_hash: String, vote_id_hash: String) -> Result<(), Error>`:
  Records a vote cast. Idempotent — duplicate `vote_id_hash` returns
  `Error::DuplicateVote` (`#5`); enforces `MAX_VOTES_PER_BALLOT`.
- `batch_record_votes(env: Env, votes: Vec<(String, String)>) -> Result<(), Error>`:
  Records `(ballot_id_hash, vote_id_hash)` pairs in ONE atomic call — the
  primitive that lets 100 backend votes share one transaction fee.
- `record_result(env: Env, ballot_id_hash: String, result_hash: String)`: Publishes final ballot tally hash.
- `get_tokens_issued(env: Env, ballot_id_hash: String) -> u64`: Returns total token count issued.
- `get_votes_cast(env: Env, ballot_id_hash: String) -> u64`: Returns total votes recorded.
- `is_consistent(env: Env, ballot_id_hash: String) -> bool`: Verifies that `tokens_issued >= votes_cast`.
- `has_vote(env: Env, vote_id_hash: String) -> bool`: Returns whether a vote id has already been recorded (used by the backend to disambiguate failed batches).

## Error Codes

| Code | Error | Meaning |
|---|---|---|
| 1 | `CounterOverflow` | ballot vote counter at `MAX_VOTES_PER_BALLOT` |
| 2 | `BallotNotFound` | operation on an unknown/uninitialized ballot |
| 3 | `Unauthorized` | caller is not the current admin |
| 4 | `InvalidKey` | invalid public key (or same as current admin) |
| 5 | `DuplicateVote` | `vote_id_hash` already recorded (idempotency guard) |

## Building & Testing

```bash
# Build WASM binary
cargo build --target wasm32-unknown-unknown --release

# Run Rust unit tests
cargo test
```

> **Known dev-dependency pin (issue #77):** `soroban-env-host 22.x` resolves
> `ed25519-dalek 3.0.0`, but its testutils code requires the 2.x API, which
> breaks `cargo test` with:
> `trait bound ChaCha20Rng: ed25519_dalek::rand_core::CryptoRng is not satisfied`.
> If you hit this, downgrade the transitive dep precisely:
>
> ```bash
> cargo update -p ed25519-dalek@3.0.0 --precise 2.1.1
> ```
>
> (`Cargo.lock` is gitignored for this crate, so the pin must be re-applied per
> checkout.)

See [`docs/SOROBAN_INTEGRATION.md`](../docs/SOROBAN_INTEGRATION.md) for the full
backend integration guide (deploy, batching, retries, observability, recovery).
