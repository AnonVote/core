# Changelog

All notable changes to the AnonVote Soroban contracts package are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Contract stability note:** Once a version is deployed on-chain, its
> `ContractError` discriminant values, `DataKey` enum variants, and event topic
> symbols are **frozen**. Changing any of these after deployment is a breaking
> change. See [STABILITY.md](STABILITY.md) for the complete stability contract.

---

## [Unreleased]

### Planned
- `get_version()` on-chain view function — returns the semantic version string
  so frontends, indexers, and governance systems can verify the deployed version
  without inspecting `Cargo.toml` (see [ISSUE_GET_VERSION.md](ISSUE_GET_VERSION.md))
- Enhanced audit reporting with per-ballot breakdown
- Additional security checks for Milestone 2 hardening
- Per-ballot encryption key support (Milestone 2)
- Rate limiting on write operations (Milestone 2)
- `@anonvote/crypto` npm SDK publication (Milestone 3)
- Mainnet deployment (Milestone 3)

---

## [0.1.0] — 2026-08-16

Initial testnet deployment. This is the first versioned release of the AnonVote
Soroban smart contract and its accompanying TypeScript service layer.

**Deployed contract (testnet)**

| Field | Value |
|---|---|
| Contract ID | `CDPSKEL3SXLUQWU55EWIZY2BAXJOT4CQOXMQUVCRPM2J74LDTULFINPH` |
| Network | `Test SDF Network ; September 2015` |
| WASM hash | `d366202b16d3d37ce19bbb10bdd6d179fb2b826ceab75cd011cf6c4e5c2e6960` |
| Git tag | `contract-testnet-v1.0.0` |
| Git commit | `aca417a` |
| Deploy timestamp | `2026-08-16T16:45:21Z` |

### Added — Soroban contract (`contracts/anonvote`)

**Core ballot lifecycle**
- `initialize(admin)` — bootstraps the contract; sets admin as sole approver (1-of-1); reverts with `AlreadyInitialized` if called again
- `record_ballot(caller, ballot_id_hash, limits)` — registers a single ballot on-chain with configurable per-ballot token and vote caps (`BallotLimits`)
- `record_ballots_batch(caller, ballots)` — atomic multi-ballot registration; validates all entries before writing any (all-or-nothing)
- `record_token(caller, ballot_id_hash)` — increments the token-issued counter; enforces `max_tokens` cap and ballot expiry
- `record_vote(caller, ballot_id_hash)` — increments the vote-cast counter; enforces `max_votes` cap and ballot expiry
- `expire_ballot(caller, ballot_id_hash)` — admin-only manual ballot expiry
- `is_consistent(ballot_id_hash)` — returns `true` iff `tokens_issued == votes_cast`; non-existent ballots return `false` (guards the phantom `0==0` case)

**Result publication (M-of-N gated)**
- `record_result(caller, ballot_id_hash, result_hash)` — creates a pending `ResultPublication` operation requiring M-of-N approver consensus before the result hash is committed on-chain

**View functions**
- `get_admin()` — returns the current admin address
- `get_approvers()` — returns the full approver list
- `get_approval_threshold()` — returns the current M value
- `get_tokens_issued(ballot_id_hash)` — returns token count or `None` if ballot absent
- `get_votes_cast(ballot_id_hash)` — returns vote count or `None` if ballot absent
- `get_result_hash(ballot_id_hash)` — returns the published result hash if available
- `get_ballot_metadata(ballot_id_hash)` — returns full `BallotMetadata` struct
- `get_ballot_created_at(ballot_id_hash)` — returns immutable creation timestamp
- `get_ballot_state(ballot_id_hash)` — returns `BallotStateSnapshot` (metadata + counters + result)
- `get_audit_report(ballot_id_hash)` — returns `BallotAuditReport` with consistency check
- `ballot_exists(ballot_id_hash)` — existence check without a full metadata read
- `result_exists(ballot_id_hash)` — checks whether a result hash has been published
- `get_initialized_at()` — returns the contract initialization timestamp
- `is_paused()` — returns current pause state
- `get_pending_upgrade()` — returns the scheduled upgrade struct if present
- `get_rotation_history()` — returns all historical admin rotation records
- `get_operation(operation_id)` — returns a `PendingOperation` for off-chain monitoring

**M-of-N governance**
- `configure_approval_threshold(caller, approvers, m, n)` — replaces the approver set and sets the M-of-N threshold; validates no duplicate addresses and `1 ≤ m ≤ n`
- `create_operation(caller, operation)` — creates a pending `CriticalOperation` (admin only); supported operations: `AdminRotation`, `Pause`, `ResultPublication`, `UpgradeScheduling`
- `approve_operation(operation_id, approver_address)` — records one approval; the approver reaching threshold M executes the operation atomically in the same transaction
- `cancel_operation(caller, operation_id)` — admin-only cancellation of a pending operation
- Operations expire after 7 days (`APPROVAL_EXPIRATION_SECONDS = 604800`)

**Admin rotation**
- `rotate_admin(caller, new_admin)` — creates a pending `AdminRotation` operation for M-of-N approval; reverts with `SameAdmin` if new equals current
- Rotation history is persisted on-chain via `RotationRecord` entries readable by `get_rotation_history()`

**Upgradability (time-locked)**
- `schedule_upgrade(caller, new_wasm_hash)` — creates a pending `UpgradeScheduling` operation; time lock is 48 hours (`UPGRADE_TIME_LOCK_SECONDS = 172800`)
- `execute_upgrade()` — executes the scheduled WASM swap after the time lock expires
- `cancel_upgrade(caller)` — admin-only cancellation of a scheduled upgrade

**Emergency pause**
- `pause_contract(caller)` — creates a pending `Pause` operation for M-of-N approval
- `resume_contract(caller)` — admin-only immediate resume; bypasses M-of-N
- All state-mutating functions check `ContractPaused` and revert if the contract is paused

**Input validation**
- `validate_hex_hash()` (in `validation.rs`) — enforces that `ballot_id_hash` and `result_hash` are exactly 64 lowercase hex characters (valid SHA-256 digests)
- Invalid hashes return `InvalidBallotIdHash` (code 23) or `InvalidResultHash` (code 24)

**Event emissions** (for external indexers)

Dual event strategy: lightweight short-symbol events for backward-compatible consumers + strongly-typed `BallotEvent` enum for new integrations.

| Topic | Payload | Description |
|---|---|---|
| `("audit", "blt_crtd")` | `(hash, timestamp, admin)` | Ballot created |
| `("ballot",)` | `BallotEvent::BallotCreated` | Typed ballot created |
| `("audit", "tok_issd")` | `(hash, new_count)` | Token issued |
| `("ballot",)` | `BallotEvent::TokenRecorded` | Typed token recorded |
| `("audit", "vote_cast")` | `(hash, new_count)` | Vote cast |
| `("ballot",)` | `BallotEvent::VoteRecorded` | Typed vote recorded |
| `("audit", "exp_adm")` | `hash` | Ballot expired by admin |
| `("audit", "upg_cncl")` | `(caller, timestamp)` | Upgrade cancelled |
| `("audit", "upg_excd")` | `new_wasm_hash` | Upgrade executed |
| `("audit", "resumed")` | `(caller, timestamp)` | Contract resumed |
| `("govern", "cfg_appr")` | `(caller, m, n)` | Approval config changed |
| `("govern", "op_create")` | `(id, caller, created_at, expires_at)` | Operation created |
| `("govern", "approved")` | `(id, approver, count, timestamp)` | Operation approved |
| `("govern", "op_exec")` | `(id, count, timestamp)` | Operation executed |
| `("govern", "op_cancel")` | `(id, caller, timestamp)` | Operation cancelled |

**ContractError enum** — 25 fixed discriminant values (see [STABILITY.md](STABILITY.md))

**Merkle proof support**
- `MerkleProof` struct stored on-chain for result verification
- `verify_result_proof` internal helper for Merkle path validation

**Gas optimizations** (see [contracts/OPTIMIZATION.md](contracts/OPTIMIZATION.md))
- Reduced redundant clones in `require_ballot_metadata` and `require_ballot_not_expired`
- Moved clone of `vote_hash` in `verify_result_proof` to a move
- Combined metadata + expiry check into `require_ballot_metadata_and_not_expired` (single code path for `record_token` and `record_vote`)
- ~1.2% estimated gas reduction on a realistic ballot workflow

**Build toolchain pin**
- Contract must be built with **rustc 1.81.0** (`rustup run 1.81.0 cargo build --target wasm32-unknown-unknown --release --locked`). Since rustc 1.82 the `wasm32-unknown-unknown` target enables `reference-types` and `multivalue` WASM proposals by default, which the Soroban host bundled with `soroban-sdk` 21 rejects at upload time. `Cargo.lock` pins transitive deps to pre-`edition2024` versions compatible with 1.81.

---

### Added — TypeScript service layer (`service/`)

**`SorobanService` factory API**
- `createSorobanService(config)` — returns an object with all contract methods pre-bound to a config
- `createDefaultTestnetConfig({ contractId, sourceKeypair })` — testnet config helper (RPC: `https://soroban-testnet.stellar.org`)
- `createDefaultMainnetConfig({ contractId, sourceKeypair })` — mainnet config helper (RPC: `https://soroban-mainnet.stellar.org`)

**Contract method wrappers**
- `sorobanRecordBallot(config, ballotIdHash)` — calls `record_ballot`
- `sorobanRecordToken(config, ballotIdHash)` — calls `record_token`
- `sorobanRecordVote(config, ballotIdHash)` / `recordVote()` — calls `record_vote`
- `sorobanPublishResult(config, ...)` / `tally()` — calls `record_result`
- `sorobanIsConsistent(config, ballotIdHash)` — calls `is_consistent`
- `getAuditReport(config, ballotIdHash)` — calls `get_audit_report`
- `getBallotConsistencyReport(config, ...)` — calls `is_consistent` and optionally compares against a database vote count

**Backend flow helpers**
- `submitVoteOnChainFirst(voteRepository, input)` — validates + calls `record_vote`, waits for Soroban confirmation, then inserts the vote row with `soroban_tx_id`
- `publishTallyOnChain(tallyRepository, input)` — computes/accepts a result hash, calls `record_result`, reads `is_consistent`, persists `soroban_tx_id` and `is_consistent`

**Error handling**
- `SorobanServiceError` — typed throwable with `code`, `retryable`, and `contractErrorCode` fields
- `SorobanServiceErrorCode` — four service-level categories: `NETWORK_ERROR` (retryable), `SIMULATION_FAILED` (retryable), `TRANSACTION_FAILED` (not retryable), `CONTRACT_ERROR` (not retryable)
- `SorobanErrorCode` — mirrors all 25 on-chain `ContractError` discriminants plus three service-level codes (`SimulationFailed`, `TransactionFailed`, `NetworkError`)
- `toSorobanDomainError(err)` — maps `SorobanServiceError` to an HTTP-status-annotated `SorobanDomainError` for API response shaping

**Resilience**
- `withSorobanRpcResilience` — retry wrapper with configurable `RpcRetryPolicy` (default: 3 attempts, 250ms initial delay, 2× backoff) wrapping full contract invocations
- Per-`(rpcUrl, contractId)` circuit breaker (default: opens after 3 retryable failures, resets after 30s); only retryable errors trip the breaker
- `resetSorobanCircuitBreakers()` — test utility to clear all circuit breaker state
- Transaction-confirmation polling with configurable `RetryPolicy` (default: 10 attempts, 1500ms initial, 1.5× backoff)

**Event parsing**
- `parseSorobanEvent(event)` — normalises raw Stellar SDK event objects into typed `SorobanEventData` with known fields (`ballotIdHash`, `count`, `resultHash`, `admin`, `newWasmHash`, etc.)
- `SorobanEventFilter` — filter by `eventType`, `ballotIdHash`, `startTime`, `endTime`
- `ContractMonitor` (`service/soroban/contractMonitor.ts`) — polls for contract events with pagination

**Config validation**
- `validateSorobanConfig(config)` — validates keypair and contract ID format before any RPC call
- `validateContractId(contractId)` — validates Stellar contract address format (C... prefix)

---

### Infrastructure

- `deploy.sh` — automated testnet/mainnet deployment script; builds WASM, deploys, initializes, writes `deployments.json`, creates a git tag, and prints a verification summary
- `deployments.json` — deployment metadata record (contract ID, WASM hash, transaction hashes, timestamp, git commit, RPC URL)
- `CONTRACT_ID` — human-readable contract ID file, one line per network
- CI pipeline (`.github/workflows/ci.yml`) — runs `cargo build`, `cargo test`, `npm run typecheck`, and `npm test` on every push
- `.env.example` — documents all required and optional environment variables

---

## Migration Guide

### There is no prior version to migrate from

`0.1.0` is the first release. No migration from an earlier on-chain deployment is required.

### Upgrading the deployed WASM in a future release

All upgrades go through the time-locked M-of-N governance path:

```bash
# 1. Build the new WASM and compute its hash
rustup run 1.81.0 cargo build --target wasm32-unknown-unknown --release --locked
stellar contract upload --wasm target/wasm32-unknown-unknown/release/anonvote.wasm --network testnet
# Note the returned <NEW_WASM_HASH>

# 2. Propose the upgrade (requires admin auth)
stellar contract invoke --id <CONTRACT_ID> --network testnet -- \
  schedule_upgrade --caller <ADMIN> --new_wasm_hash <NEW_WASM_HASH>
# Note the returned <OPERATION_ID>

# 3. Collect M approvals (one tx per approver)
stellar contract invoke --id <CONTRACT_ID> --network testnet -- \
  approve_operation --operation_id <OPERATION_ID> --approver_address <APPROVER>

# 4. Execute after 48-hour time lock
stellar contract invoke --id <CONTRACT_ID> --network testnet -- execute_upgrade
```

### Breaking change policy

Any of the following is a **breaking change** and will increment the **major** version:

- Removing or renaming a public contract function
- Changing the argument order or types of a public contract function
- Renumbering a `ContractError` discriminant
- Renaming a `DataKey` enum variant
- Changing an event topic symbol
- Changing the `ballot_id_hash` format (currently: 64-char lowercase hex SHA-256)

Non-breaking changes (minor or patch version bumps):

- Adding new public view functions
- Adding new `ContractError` variants (new discriminant values only)
- Adding new event types
- TypeScript service API additions
- Gas optimizations with no behavioural change

---

*Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — Versions: [semver](https://semver.org)*
