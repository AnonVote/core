# AnonVote Soroban Service — API Reference

This document describes every public function exported from `service/index.ts`.
All functions are **COMPLETE** (no stubs). The implementation status column uses:

- **Complete** — fully implemented, tested, and ready to use
- **Read-only** — view call only; no transaction submitted, never throws

---

## Table of Contents

1. [Error types](#error-types)
2. [Enums](#enums)
3. [Config & validation](#config--validation)
4. [Core RPC primitives](#core-rpc-primitives)
5. [Ballot write operations](#ballot-write-operations)
6. [Ballot read operations](#ballot-read-operations)
7. [Consistency verification](#consistency-verification)
8. [Admin operations](#admin-operations)
9. [Upgrade operations](#upgrade-operations)
10. [Backend flow helpers](#backend-flow-helpers)
11. [Event helpers](#event-helpers)
12. [Circuit-breaker control](#circuit-breaker-control)
13. [Config factories](#config-factories)
14. [Service factory](#service-factory)
15. [Function index](#function-index)

---

## Error types

### `SorobanServiceError`

Typed error thrown by all write helpers. Inspect `retryable` to decide retry vs alert.

| Property | Type | Description |
|---|---|---|
| `code` | `SorobanServiceErrorCode` | Service-level failure category |
| `retryable` | `boolean` | `true` when retrying with backoff is safe |
| `contractErrorCode` | `SorobanErrorCode \| undefined` | On-chain error — internal logging only |

```ts
try {
  await sorobanRecordBallot(config, ballotIdHash);
} catch (err) {
  if (err instanceof SorobanServiceError) {
    if (err.retryable) {
      // enqueue for retry with exponential backoff
    } else if (err.code === SorobanServiceErrorCode.CONTRACT_ERROR) {
      // logic error — alert, do not retry
    }
  }
}
```

### `SorobanServiceErrorCode` enum

| Value | Retryable | Meaning |
|---|---|---|
| `NETWORK_ERROR` | ✅ | Transient network glitch, DNS, TCP reset |
| `SIMULATION_FAILED` | ✅ | RPC timeout or overloaded node |
| `TRANSACTION_FAILED` | ❌ | Tx submission/confirmation failed — investigate |
| `CONTRACT_ERROR` | ❌ | Contract logic rejected the call — do not retry |

### `SorobanErrorCode` enum

On-chain contract error codes mirroring `ContractError` in `lib.rs`. For internal
logging only — never surface these in API responses.

| Code | Value | Meaning |
|---|---|---|
| `AdminUnauthorized` | 1 | Caller is not the contract admin |
| `AlreadyInitialized` | 2 | Contract already initialized |
| `NotInitialized` | 3 | Contract not initialized |
| `BallotNotFound` | 4 | Ballot does not exist on-chain |
| `BallotAlreadyExists` | 5 | Ballot already recorded by a different admin |
| `ResultAlreadyPublished` | 6 | A different result hash is already published |
| `CounterOverflow` | 7 | Counter reached u32::MAX |
| `InvalidBallotHash` | 8 | Ballot hash must not be empty |
| `UpgradeAlreadyScheduled` | 9 | An upgrade is already scheduled |
| `NoUpgradeScheduled` | 10 | No upgrade currently scheduled |
| `TimeLockNotExpired` | 11 | Time lock has not yet expired |
| `BallotExpired` | 12 | Ballot has expired |
| `ContractPaused` | 13 | Contract is currently paused |
| `LimitExceeded` | 14 | Ballot token or vote limit exceeded |
| `InvalidApprovalConfig` | 15 | Invalid M-of-N approval configuration |
| `DuplicateApprover` | 16 | Duplicate address in approver list |
| `ApproverUnauthorized` | 17 | Caller is not a configured approver |
| `OperationNotFound` | 18 | Operation not found |
| `OperationAlreadyApproved` | 19 | Approver already approved this operation |
| `OperationNotPending` | 20 | Operation is not in pending status |
| `OperationExpired` | 21 | Operation approval window expired |
| `SameAdmin` | 22 | New admin must differ from current admin |
| `SimulationFailed` | 100 | RPC-level simulation failure |
| `TransactionFailed` | 101 | RPC-level transaction failure |
| `NetworkError` | 102 | Network or RPC unreachable |
| `NotConfigured` | 103 | Contract ID or secret key not configured |

---

## Enums

### `BallotState`

Lifecycle state of a ballot on-chain.

| Value | Meaning |
|---|---|
| `Active` | Ballot is open for voting |
| `Expired` | Voting window closed without result publication |
| `ResultPublished` | Tally has been published on-chain |
| `Archived` | Ballot has been archived (terminal state) |

---

## Config & validation

### `validateContractId(contractId: string)`

**Status:** Complete | Read-only utility

Checks that `contractId` is a non-empty string. Returns `{ valid: true }` or
`{ valid: false, error: ConfigError }`.

```ts
const check = validateContractId(config.contractId);
if (!check.valid) console.error(check.error.message);
```

### `validateSorobanConfig(config: SorobanConfig)`

**Status:** Complete | Read-only utility

Validates that `config` has both a non-empty `contractId` and a `sourceKeypair`.
Returns `{ valid: true }` or `{ valid: false, error: ConfigError }`. Called
internally by every write helper before submitting any transaction.

```ts
const check = validateSorobanConfig(config);
if (!check.valid) throw new Error(check.error.message);
```

### `toSorobanDomainError(err: unknown)`

**Status:** Complete | Read-only utility

Converts any caught error into a `SorobanDomainError` with a `code` and
`message` field. Safe to log — never exposes raw contract internals.

---

## Core RPC primitives

### `invokeContract(config, method, args)`

**Status:** Complete

Submit a state-changing Soroban transaction (simulate → sign → send → confirm).
Implements the configured `RetryPolicy` and `CircuitBreakerPolicy`.

| Parameter | Type | Description |
|---|---|---|
| `config` | `SorobanConfig` | RPC endpoint, keypair, retry policy |
| `method` | `string` | Contract entrypoint name |
| `args` | `{ value: unknown; type: string }[]` | Encoded arguments |

Returns `SorobanInvokeResult`. Does not throw — callers inspect `.success`.

```ts
const result = await invokeContract(config, "record_ballot", [
  { value: adminPublicKey, type: "address" },
  { value: ballotIdHash,   type: "string"  },
]);
if (!result.success) { /* handle */ }
```

### `readContract(config, method, args)`

**Status:** Complete | Read-only

Submit a read-only `simulateTransaction` call — no ledger state change, no fee.
Returns `SorobanInvokeResult` with `returnValue` decoded via `scValToNative`.

```ts
const { value } = await readContract(config, "get_version", []);
console.log(value); // "1.0.0"
```

---

## Ballot write operations

All write operations require a valid `SorobanConfig` with `sourceKeypair`.
They throw `SorobanServiceError` on failure.

### `sorobanRecordBallot(config, ballotIdHash, limits?)`

**Status:** Complete

Record a ballot creation on-chain. Idempotent: if the same ballot was already
recorded by this admin, the contract returns success without a state change.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config` | `SorobanConfig` | — | Service config |
| `ballotIdHash` | `string` | — | SHA-256 hex hash of the ballot ID |
| `limits` | `BallotLimits \| undefined` | `{ maxTokens: 10000, maxVotes: 10000 }` | On-chain limits |

Returns `SorobanInvokeResult`. Throws `SorobanServiceError` on failure.

```ts
await sorobanRecordBallot(config, ballotIdHash, { maxTokens: 500, maxVotes: 500 });
```

### `sorobanRecordBallotsBatch(config, ballots)`

**Status:** Complete

Record multiple ballots atomically. All-or-nothing: the contract validates every
ballot before writing any, so a single invalid entry fails the whole batch.

| Parameter | Type | Description |
|---|---|---|
| `config` | `SorobanConfig` | Service config |
| `ballots` | `Array<{ ballotIdHash: string; limits?: BallotLimits }>` | Ballots to record |

Returns `SorobanInvokeResult` where `returnValue` is the array of recorded hashes.

```ts
await sorobanRecordBallotsBatch(config, [
  { ballotIdHash: "hash-a", limits: { maxTokens: 100, maxVotes: 100 } },
  { ballotIdHash: "hash-b" },
]);
```

### `sorobanRecordToken(config, ballotIdHash)`

**Status:** Complete

Record a token issuance on-chain (increments `tokens_issued` counter).

```ts
await sorobanRecordToken(config, ballotIdHash);
```

### `sorobanRecordVote(config, ballotIdHash)`

**Status:** Complete

Record a single vote cast on-chain (increments `votes_cast` counter). The
contract atomically checks `BallotState`; rejects with `BallotExpired` if the
ballot is no longer active.

```ts
await sorobanRecordVote(config, ballotIdHash);
```

### `sorobanRecordResult(config, ballotIdHash, resultHash)`

**Status:** Complete

Publish a tally result hash on-chain. Handles `ResultAlreadyPublished`
idempotency: if the **same** hash is already published, the call is treated as
success. If a **different** hash is already published, throws
`SorobanServiceError` with `code: CONTRACT_ERROR`.

```ts
const resultHash = hashTallyResult(localResult);
await sorobanRecordResult(config, ballotIdHash, resultHash);
```

### `sorobanExpireBallot(config, ballotIdHash)`

**Status:** Complete

Atomically transition a ballot from `Active` → `Expired` on-chain. All
subsequent `record_vote` / `record_token` calls for this ballot will be
rejected with `BallotExpired`. Calling this on an already-expired ballot
returns `BallotExpired`.

```ts
await sorobanExpireBallot(config, ballotIdHash);
```

### `sorobanTransitionBallotState(config, ballotIdHash, newState)`

**Status:** Complete

Manually transition a ballot's lifecycle state (admin only). Allowed transitions:
`Active → ResultPublished → Archived`. Any other or backward transition
returns `InvalidStateTransition`.

```ts
await sorobanTransitionBallotState(config, ballotIdHash, BallotState.Archived);
```

---

## Ballot read operations

Read operations do not submit transactions. They return `null` on config
validation failure or RPC error rather than throwing.

### `sorobanGetBallotState(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns the full `BallotStateSnapshot` or `null`.

```ts
const snapshot = await sorobanGetBallotState(config, ballotIdHash);
if (snapshot?.state === BallotState.Expired) { /* ... */ }
```

### `sorobanGetBallotMetadata(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns `{ created_at: number; admin: string; is_active: boolean }` or `null`.

```ts
const meta = await sorobanGetBallotMetadata(config, ballotIdHash);
console.log(meta?.admin); // "G..."
```

### `sorobanGetBallotStats(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns `{ tokens_issued: number; votes_cast: number; result_hash: string | null }` or `null`.

```ts
const stats = await sorobanGetBallotStats(config, ballotIdHash);
console.log(stats?.votes_cast);
```

### `sorobanGetBallotCreatedAt(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns the Unix timestamp (seconds) when the ballot was first recorded on-chain,
or `null` if the ballot does not exist. Immutable after creation.

```ts
const ts = await sorobanGetBallotCreatedAt(config, ballotIdHash);
```

### `sorobanGetBallotExpiration(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns the ballot's expiration state as a `boolean` (whether it is expired),
or `null` on failure.

```ts
const expired = await sorobanGetBallotExpiration(config, ballotIdHash);
```

### `sorobanGetAuditCounts(config, ballotIdHash)`

**Status:** Complete | Read-only

Reads `tokens_issued`, `votes_cast`, and `is_consistent` in a single parallel
`Promise.all`. Normalizes Soroban `undefined` (ScVal::Void = None) to `null`.

Returns `{ tokensIssued: number | null; votesCast: number | null; isConsistent: boolean }` or `null`.

```ts
const counts = await sorobanGetAuditCounts(config, ballotIdHash);
console.log(counts?.isConsistent); // true | false
```

### `sorobanGetAuditReport(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns the full `BallotAuditReport` or `null`.

```ts
const report = await sorobanGetAuditReport(config, ballotIdHash);
```

### `sorobanGetAllBallots(config)`

**Status:** Complete | Read-only

Returns all ballot ID hashes recorded on-chain as `string[]`. Returns `[]` on
config failure or empty contract state.

```ts
const hashes = await sorobanGetAllBallots(config);
```

### `sorobanResultExists(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns `true` if a result hash has been published, `false` if not yet
published, `null` on failure.

```ts
const finalized = await sorobanResultExists(config, ballotIdHash);
```

### `sorobanBallotIsActive(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns `true` if the ballot exists and its state is `Active`, `false`
otherwise, `null` on failure.

```ts
if (await sorobanBallotIsActive(config, ballotIdHash)) { /* accept votes */ }
```

### `sorobanIsBallotExpired(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns `true` if `BallotState === Expired`, `false` otherwise, `null` on
failure or unknown ballot. The contract state is the single source of truth —
prefer this over the backend's own database status field.

```ts
if (await sorobanIsBallotExpired(config, ballotIdHash)) { /* reject submission */ }
```

### `sorobanIsBallotFinalized(config, ballotIdHash)`

**Status:** Complete | Read-only

Returns `true` if a result has been published (`is_ballot_finalized`), `false`
otherwise, `null` on failure.

```ts
const done = await sorobanIsBallotFinalized(config, ballotIdHash);
```

### `sorobanVerifyResultProof(config, ballotIdHash, voteMerkleProof, resultHash)`

**Status:** Complete | Read-only

Verify a Merkle proof of a vote against the published result hash.

| Parameter | Type | Description |
|---|---|---|
| `ballotIdHash` | `string` | Target ballot |
| `voteMerkleProof` | `MerkleProof` | `{ index, path, vote_hash }` |
| `resultHash` | `string` | Published result hash to verify against |

Returns `boolean | null`.

```ts
const valid = await sorobanVerifyResultProof(config, ballotIdHash, proof, resultHash);
```

### `sorobanGetVersion(config)`

**Status:** Complete | Read-only

Returns the semantic version string embedded in the deployed contract (e.g.
`"1.0.0"`), or `null` if the config is invalid or the query fails.

```ts
const version = await sorobanGetVersion(config);
console.log(version); // "1.0.0"
```

---

## Consistency verification

### `verifyBallotConsistency(config, ballotIdHash, databaseVoteCount?)`

**Status:** Complete | Read-only

Read-only post-finalization consistency check. Reads `tokens_issued`,
`votes_cast`, and `is_consistent` in parallel. Optionally compares
`databaseVoteCount` against the on-chain count and logs the result.

**Never throws** — failures set `consistent: false` and populate `error`.
Callers must not fail tally finalization on a `false` result.

| Parameter | Type | Description |
|---|---|---|
| `config` | `SorobanConfig` | Service config |
| `ballotIdHash` | `string` | Ballot to verify |
| `databaseVoteCount` | `number \| undefined` | Backend tally count for cross-check |

Returns `BallotConsistencyReport`:

```ts
interface BallotConsistencyReport {
  ballotIdHash: string;
  consistent: boolean;           // true if tokens_issued === votes_cast on-chain
  tokensIssuedOnChain: number | null;
  votesCastOnChain: number | null;
  votesCastInDatabase: number | null;
  databaseMatchesChain: boolean | null; // null if databaseVoteCount was not provided
  checkedAt: number;             // Unix timestamp of this check
  error?: string;                // set when the RPC or config check fails
}
```

```ts
const report = await verifyBallotConsistency(config, ballotIdHash, dbVoteCount);
if (!report.consistent) {
  logger.warn({ report }, "On-chain consistency check failed");
}
```

---

## Admin operations

### `sorobanRotateAdmin(config, newAdminPublicKey)`

**Status:** Complete

Create a pending M-of-N admin rotation operation. Must be called by the current
admin. Rejects with `SameAdmin` if `newAdminPublicKey === current admin`.
Returns `returnValue` containing the operation ID.

```ts
const result = await sorobanRotateAdmin(config, newAdminPublicKey);
console.log(result.returnValue); // operation ID
```

### `sorobanGetRotationHistory(config)`

**Status:** Complete | Read-only

Returns the on-chain admin rotation history in chronological order (oldest
first), or `null` on config/RPC failure.

```ts
// Returns Array<{ oldAdmin, newAdmin, rotatedAt }>
const history = await sorobanGetRotationHistory(config);
```

---

## Upgrade operations

### `sorobanScheduleUpgrade(config, newWasmHash)`

**Status:** Complete

Schedule a contract upgrade (admin only). Rejects with `UpgradeAlreadyScheduled`
if an upgrade is already pending. `newWasmHash` is a hex-encoded WASM hash.

```ts
await sorobanScheduleUpgrade(config, wasmHashHex);
```

### `sorobanCancelUpgrade(config)`

**Status:** Complete

Cancel the currently scheduled upgrade (admin only). Rejects with
`NoUpgradeScheduled` if no upgrade is pending.

```ts
await sorobanCancelUpgrade(config);
```

### `sorobanExecuteUpgrade(config)`

**Status:** Complete

Execute the scheduled upgrade (callable by anyone once the time lock expires).
Rejects with `TimeLockNotExpired` if called too early.

```ts
await sorobanExecuteUpgrade(config);
```

### `sorobanGetPendingUpgrade(config)`

**Status:** Complete | Read-only

Returns `{ newWasmHash, scheduledAt, executableAt }` or `null` if no upgrade
is scheduled or the config/RPC fails.

```ts
const pending = await sorobanGetPendingUpgrade(config);
if (pending) console.log(`Upgrade executable at ledger ${pending.executableAt}`);
```

---

## Backend flow helpers

Higher-level functions that wire on-chain calls to the backend database layer.
These are the recommended entry points for ballot-engine and result-engine code.

### `hashTallyResult(localResult)`

**Status:** Complete | Pure (no I/O)

Compute a deterministic SHA-256 hash of a tally result payload. Object keys
are sorted recursively before serialization so the hash is stable regardless
of property insertion order.

```ts
const resultHash = hashTallyResult({ yesVotes: 42, noVotes: 8, abstain: 0 });
// resultHash is a 64-char lowercase hex string
```

### `recordVote(config, ballotIdHash, encryptedVote, options?)`

**Status:** Complete

Record a vote on-chain with optional RPC retry resilience. Returns
`RecordVoteResult` with the Stellar `txHash` that must be persisted as
`soroban_tx_id` alongside the encrypted vote row.

```ts
const result = await recordVote(config, ballotIdHash, encryptedVote);
await db.votes.create({ ...result, soroban_tx_id: result.sorobanTxId });
```

### `tally(config, ballotIdHash, localResult, options?)`

**Status:** Complete

Publish a local tally result on-chain and read back the contract's
`is_consistent` flag. Returns `TallyResult` with `isConsistent`.

```ts
const result = await tally(config, ballotIdHash, localResult);
if (!result.isConsistent) logger.error("On-chain inconsistency detected");
```

### `submitVoteOnChainFirst(config, repository, input, options?)`

**Status:** Complete

End-to-end vote submission: record on-chain first, then persist the database
row with `soroban_tx_id`. The contract atomically rejects expired ballots —
an expired ballot never reaches `repository.createVote`.

```ts
const record = await submitVoteOnChainFirst(config, voteRepository, {
  ballotIdHash,
  encryptedVote,
});
```

### `publishTallyOnChain(config, repository, input, options?)`

**Status:** Complete

End-to-end tally publication: publish the result on-chain, then persist both
the Soroban tx hash and the contract's consistency verdict in the tally store.

```ts
const persisted = await publishTallyOnChain(config, tallyRepository, {
  ballotIdHash,
  localResult,
  resultHash,
});
```

---

## Event helpers

### `parseSorobanEvent(event)`

**Status:** Complete | Read-only

Parse a raw Soroban event object into a typed `SorobanEventData` with a
normalized `type`, `topics`, `value`, `ledger`, `txHash`, and `timestamp`.

```ts
const parsed = parseSorobanEvent(rawEvent);
console.log(parsed.type); // "ballot_created" | "vote_recorded" | ...
```

### `sorobanFilterEvents(config, filter?)`

**Status:** Complete | Read-only

Query the contract's event log and return matching `SorobanEventData[]`.
Applies optional `SorobanEventFilter` (`eventType`, `ballotIdHash`,
`startTime`, `endTime`). Returns `[]` on config/RPC failure.

```ts
const events = await sorobanFilterEvents(config, {
  eventType: "vote_recorded",
  ballotIdHash,
  startTime: Date.now() / 1000 - 3600,
});
```

---

## Circuit-breaker control

### `resetSorobanCircuitBreakers()`

**Status:** Complete

Reset all in-process circuit-breaker state (all RPC endpoints). Useful in
tests or after a known outage is resolved. Does not persist across process
restarts.

```ts
resetSorobanCircuitBreakers();
```

---

## Config factories

### `createDefaultTestnetConfig(params)`

**Status:** Complete

Create a `SorobanConfig` pre-configured for Stellar Testnet
(`https://soroban-testnet.stellar.org`, `TESTNET` passphrase).

```ts
const config = createDefaultTestnetConfig({
  contractId: process.env.SOROBAN_CONTRACT_ID!,
  sourceKeypair: Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!),
});
```

### `createDefaultMainnetConfig(params)`

**Status:** Complete

Create a `SorobanConfig` pre-configured for Stellar Mainnet
(`https://soroban-mainnet.stellar.org`, `PUBLIC` passphrase).

```ts
const config = createDefaultMainnetConfig({
  contractId: process.env.SOROBAN_CONTRACT_ID!,
  sourceKeypair: Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!),
});
```

---

## Service factory

### `createSorobanService(config)`

**Status:** Complete

Create a service instance with all public functions pre-bound to `config`, so
callers never need to pass `config` on individual invocations.

```ts
import { createSorobanService, createDefaultTestnetConfig } from "@anonvote/contracts/service";
import { Keypair } from "stellar-sdk";

const config = createDefaultTestnetConfig({
  contractId: process.env.SOROBAN_CONTRACT_ID!,
  sourceKeypair: Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!),
});
const service = createSorobanService(config);

// All methods available without passing config:
await service.sorobanRecordBallot(ballotIdHash);
await service.sorobanRecordVote(ballotIdHash);
const stats = await service.sorobanGetBallotStats(ballotIdHash);
const version = await service.sorobanGetVersion();
const report = await service.verifyBallotConsistency(ballotIdHash, dbVoteCount);
```

The factory exposes every function listed in this document:

`invokeContract` · `readContract` · `sorobanRecordBallot` · `sorobanRecordBallotsBatch` ·
`sorobanRecordToken` · `sorobanRecordVote` · `recordVote` · `sorobanRecordResult` ·
`sorobanExpireBallot` · `sorobanIsBallotExpired` · `tally` · `submitVoteOnChainFirst` ·
`publishTallyOnChain` · `sorobanFilterEvents` · `sorobanRotateAdmin` ·
`sorobanGetRotationHistory` · `sorobanTransitionBallotState` · `sorobanGetAuditCounts` ·
`sorobanResultExists` · `sorobanGetBallotState` · `sorobanGetBallotCreatedAt` ·
`sorobanGetAuditReport` · `sorobanVerifyResultProof` · `sorobanGetBallotMetadata` ·
`sorobanGetBallotStats` · `sorobanGetAllBallots` · `sorobanBallotIsActive` ·
`sorobanIsBallotFinalized` · `sorobanGetBallotExpiration` · `sorobanScheduleUpgrade` ·
`sorobanCancelUpgrade` · `sorobanExecuteUpgrade` · `sorobanGetPendingUpgrade` ·
`sorobanGetVersion` · `verifyBallotConsistency` · `hashTallyResult`

---

## Function index

| Function | Category | Status | Throws |
|---|---|---|---|
| `invokeContract` | Core RPC | Complete | No (returns result) |
| `readContract` | Core RPC | Complete | No (returns result) |
| `sorobanRecordBallot` | Ballot write | Complete | Yes — `SorobanServiceError` |
| `sorobanRecordBallotsBatch` | Ballot write | Complete | Yes — `SorobanServiceError` |
| `sorobanRecordToken` | Ballot write | Complete | Yes — `SorobanServiceError` |
| `sorobanRecordVote` | Ballot write | Complete | Yes — `SorobanServiceError` |
| `sorobanRecordResult` | Ballot write | Complete | Yes — `SorobanServiceError` |
| `sorobanExpireBallot` | Ballot write | Complete | Yes — `SorobanServiceError` |
| `sorobanTransitionBallotState` | Ballot write | Complete | No (returns result) |
| `sorobanGetBallotState` | Ballot read | Complete | No (returns null) |
| `sorobanGetBallotMetadata` | Ballot read | Complete | No (returns null) |
| `sorobanGetBallotStats` | Ballot read | Complete | No (returns null) |
| `sorobanGetBallotCreatedAt` | Ballot read | Complete | No (returns null) |
| `sorobanGetBallotExpiration` | Ballot read | Complete | No (returns null) |
| `sorobanGetAuditCounts` | Ballot read | Complete | No (returns null) |
| `sorobanGetAuditReport` | Ballot read | Complete | No (returns null) |
| `sorobanGetAllBallots` | Ballot read | Complete | No (returns []) |
| `sorobanResultExists` | Ballot read | Complete | No (returns null) |
| `sorobanBallotIsActive` | Ballot read | Complete | No (returns null) |
| `sorobanIsBallotExpired` | Ballot read | Complete | No (returns null) |
| `sorobanIsBallotFinalized` | Ballot read | Complete | No (returns null) |
| `sorobanVerifyResultProof` | Ballot read | Complete | No (returns null) |
| `sorobanGetVersion` | Ballot read | Complete | No (returns null) |
| `verifyBallotConsistency` | Consistency | Complete | No (never throws) |
| `sorobanRotateAdmin` | Admin | Complete | No (returns result) |
| `sorobanGetRotationHistory` | Admin | Complete | No (returns null) |
| `sorobanScheduleUpgrade` | Upgrade | Complete | No (returns result) |
| `sorobanCancelUpgrade` | Upgrade | Complete | No (returns result) |
| `sorobanExecuteUpgrade` | Upgrade | Complete | No (returns result) |
| `sorobanGetPendingUpgrade` | Upgrade | Complete | No (returns null) |
| `hashTallyResult` | Backend flow | Complete | No (pure function) |
| `recordVote` | Backend flow | Complete | Yes — `SorobanServiceError` |
| `tally` | Backend flow | Complete | Yes — `SorobanServiceError` |
| `submitVoteOnChainFirst` | Backend flow | Complete | Yes — `SorobanServiceError` |
| `publishTallyOnChain` | Backend flow | Complete | Yes — `SorobanServiceError` |
| `parseSorobanEvent` | Events | Complete | No (returns parsed event) |
| `sorobanFilterEvents` | Events | Complete | No (returns []) |
| `resetSorobanCircuitBreakers` | Circuit breaker | Complete | No |
| `createDefaultTestnetConfig` | Config | Complete | No (pure factory) |
| `createDefaultMainnetConfig` | Config | Complete | No (pure factory) |
| `createSorobanService` | Factory | Complete | No (pure factory) |
| `validateContractId` | Validation | Complete | No (returns result) |
| `validateSorobanConfig` | Validation | Complete | No (returns result) |
| `toSorobanDomainError` | Error | Complete | No (pure converter) |

**Total exported functions: 43**
**Stubs: 0**
**Missing implementations: 0**
