# Soroban Contract Integration Guide (issue #77)

This document explains how the backend talks to the deployed AnonVote Soroban
contract: what was built, how to deploy/configure it, how batching + retries
work, how to observe it, and how to recover from failures.

---

## 1. Architecture overview

```
POST /api/votes ─▶ privacyEngine.submitVote()
                      │  (DB write — vote row, idempotency key, PENDING)
                      ▼
              VoteSubmissionBatcher.enqueue()
                      │  queues up to VOTE_BATCH_SIZE votes (or 30s)
                      ▼
              batch_record_votes(Vec<(ballotIdHash, voteIdHash)>)
                      │  ONE atomic Soroban transaction
                      ▼
              mark votes ANCHORED (soroban_tx_id set)
```

Supporting pieces:

| Component | File | Responsibility |
|---|---|---|
| RPC primitives | `backend/src/services/sorobanService.ts` | `invokeContract`, `readContract`, per-method helpers, **throws typed `SorobanError`s** |
| Error types | `backend/src/services/sorobanErrors.ts` | `NETWORK_ERROR`/`RPC_ERROR`/`SIMULATION_FAILED` (retryable) vs `CONTRACT_ERROR`/`CONFIG_ERROR` (permanent) |
| Resilience | `backend/src/services/sorobanResilient.ts` | exponential backoff (1s→2s→4s), circuit breaker, call logging |
| Batching | `backend/src/services/voteSubmissionBatcher.ts` | threshold/timeout flush, dedupe, duplicate-fallback split, dead-letter queue |
| State sync | `backend/src/services/contractStateManager.ts` | every-minute chain↔DB reconciliation + divergence alerts |
| Replay worker | `backend/src/workers/stellarRetryWorker.ts` | drains legacy `stellar_retry_queue` rows into the batcher |
| Observability | `backend/src/services/sorobanMetrics.ts`, `routes/admin.ts` | metrics + breaker + DLQ admin endpoints |
| Contract | `contracts/anonvote/src/lib.rs` | `record_ballot`, `record_token`, `record_vote` (idempotent), `batch_record_votes`, `record_result`, `has_vote`, `get_tokens_issued`, `get_votes_cast`, `is_consistent` |

---

## 2. Prerequisities

- Rust with `wasm32-unknown-unknown` target and the `stellar` CLI (Soroban 22).
- A Stellar **testnet** funding account. Fund it via
  <https://laboratory.stellar.org/#account-creator> (Friendbot on the right).

---

## 3. Build & deploy the contract

```bash
cd contracts/anonvote

# 1. Build the WASM
cargo build --target wasm32-unknown-unknown --release

# 2. Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/anonvote.wasm \
  --source <SECRET_KEY> \
  --network testnet

# 3. Initialize with your admin G... public key (must be a valid Stellar key)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <SECRET_KEY> \
  --network testnet \
  -- initialize --admin_key <G...PUBLIC_KEY>
```

Verify the deployment:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_admin_key
```

---

## 4. Backend configuration

Set these in `backend/.env` (see `.env.example`):

```bash
SOROBAN_CONTRACT_ID=<C... address from step 3>
SOROBAN_SERVER_URL=            # optional; defaults to soroban-testnet.stellar.org
STELLAR_SECRET_KEY=<S... key that pays for transactions>
DATA_ENCRYPTION_KEY=<64 hex chars>   # REQUIRED for keyed idempotency hashes

# ── batching (tunable at runtime without code changes) ──────────────────────
VOTE_BATCH_SIZE=100            # votes per atomic Soroban transaction
VOTE_BATCH_TIMEOUT_MS=30000    # flush after this long regardless of size

# ── retry semantics ──────────────────────────────────────────────────────────
SOROBAN_MAX_ATTEMPTS=3         # 1 initial + 2 retries
SOROBAN_RETRY_BASE_DELAY_MS=1000
SOROBAN_CIRCUIT_BREAKER_THRESHOLD=0.5
SOROBAN_CIRCUIT_BREAKER_DURATION_MS=15000
SOROBAN_CIRCUIT_BREAKER_SAMPLE_SIZE=20

# ── state reconciliation ─────────────────────────────────────────────────────
CONTRACT_STATE_SYNC_INTERVAL_MS=60000
```

Then apply the schema migration and run:

```bash
cd backend
npx prisma migrate deploy   # applies 20260824000000_add_soroban_integration
npx prisma generate
npm run dev
```

---

## 5. How batching works

- Every confirmed vote is inserted with `anchor_status = PENDING` and a
  deterministic **`vote_id_hash`** =
  `HMAC-SHA256(DATA_ENCRYPTION_KEY, "<ballotId>:<effectiveTokenHash>")`.
  The HMAC key lives outside the database so a DB-only leak cannot link votes
  back to voter tokens (anonymity preservation).
- The `VoteSubmissionBatcher` holds votes in memory and submits them all in a
  single `batch_record_votes` transaction when either:
  - the queue reaches `VOTE_BATCH_SIZE` (default 100) **or**
  - `VOTE_BATCH_TIMEOUT_MS` (default 30s) has elapsed since the first queued
    vote.
- Both values are env-tunable — **no code change required** to change them.

### Atomicity & duplicate fallback

`batch_record_votes` pre-validates **every** entry before applying any. If any
vote id is already on-chain it reverts the whole batch with
`Error::DuplicateVote`. The batcher then splits the batch and re-submits each
vote individually via the idempotent `record_vote`, consulting `has_vote` first
so already-anchored votes are marked done, not re-submitted.

---

## 6. Retry semantics

- Only **retry-safe** errors are retried: `NETWORK_ERROR`, `RPC_ERROR`, and
  one retry for `SIMULATION_FAILED`.
- **Permanent** errors (`CONTRACT_ERROR`, `CONFIG_ERROR`) fail fast into the
  dead-letter queue — no wasted retries.
- Backoff is exponential: `baseDelay * 2^attempt` (default 1s, 2s, 4s) up to
  `SOROBAN_MAX_ATTEMPTS` (default 3).
- A **circuit breaker** guards all contract submission. When more than 50% of
  recent calls fail it opens, batch submission is **paused** (votes stay queued,
  nothing is lost), and an `SOROBAN_SUBMISSION_PAUSED` alert is logged. After
  `SOROBAN_CIRCUIT_BREAKER_DURATION_MS` a probe call is allowed; success closes
  the circuit, another failure re-opens it.

### Idempotency

`record_vote` / `batch_record_votes` are idempotent: the contract stores every
`vote_id_hash` and rejects duplicates with `Error::DuplicateVote` (code 5).
Resubmitting the same batch can never double-count. The DB enforces the same
invariant via the unique index on `Vote.vote_id_hash`.

---

## 7. State reconciliation

`startContractStateSync()` (started in `server.ts`) runs every
`CONTRACT_STATE_SYNC_INTERVAL_MS` and, for every non-DRAFT ballot, compares the
contract counters (`get_tokens_issued`, `get_votes_cast`, `is_consistent`)
against raw DB row counts. A mismatch produces:

```json
{"level":"error","alert":"CONTRACT_STATE_DIVERGENCE","ballotId":"...",
 "chain":{"tokensIssued":2,"votesCast":5,"isConsistent":false},
 "db":{"tokensIssued":2,"votesCast":1}}
```

**Contract counters count on-chain calls, not weighted sums** — comparisons are
always against raw row counts.

---

## 8. Observability

Admin endpoints (JWT auth required):

```
GET  /api/admin/soroban/metrics         metrics + breaker state + batcher stats + recent divergences
POST /api/admin/soroban/state-sync      trigger a reconciliation run on demand
GET  /api/admin/soroban/dead-letters    votes whose anchoring failed permanently
POST /api/admin/soroban/dead-letters/:id/replay   requeue a dead letter
```

Metrics produced (`sorobanMetrics.ts`):

- `soroban_calls_total{method,outcome}` — every contract invocation
- `soroban_retry_attempts_total{method}`
- `soroban_batches_total{outcome}` — ok / failed / paused / duplicate_fallback
- `soroban_batch_size{sum,count,max,avg}`
- `soroban_dead_lettered_total`
- `soroban_divergences_detected_total`

Every contract call is logged with method + params + result through the
structured logger.

### Alerts to wire into your monitoring

| Alert | Trigger |
|---|---|
| `SOROBAN_SUBMISSION_PAUSED` | circuit breaker OPEN |
| `CONTRACT_STATE_DIVERGENCE` | chain counters ≠ DB counters |
| `VOTE_DEAD_LETTERED` | a vote exhausted all retries and went to the DLQ |

---

## 9. Dead letter queue & manual recovery

When a vote's anchoring exhausts all retries it is parked in
`soroban_dead_letters` and its `anchor_status` is set to `FAILED`. Votes are
never silently lost — the tally will show a `isConsistent: false` warning for
affected ballots.

To recover:

```
POST /api/admin/soroban/dead-letters/:id/replay
```

The vote is re-queued into the batcher (idempotent if the contract actually had
recorded it), and the DLQ row is resolved.

---

## 10. Deployment checklist

1. [ ] `cargo build --target wasm32-unknown-unknown --release` in `contracts/anonvote`
2. [ ] Deploy + `initialize` the contract on testnet (section 3)
3. [ ] `SOROBAN_CONTRACT_ID`, `STELLAR_SECRET_KEY`, `DATA_ENCRYPTION_KEY` set in `backend/.env`
4. [ ] `npx prisma migrate deploy` + `npx prisma generate`
5. [ ] Run the hermetic suite: `npx jest src/tests/sorobanIntegration.test.ts`
6. [ ] Run the DB-backed suite: `npm test` (needs Postgres)
7. [ ] `cargo test` in `contracts/anonvote`
   - If you hit `trait bound ChaCha20Rng: ed25519_dalek::rand_core::CryptoRng
     is not satisfied`, run:
     `cargo update -p ed25519-dalek@3.0.0 --precise 2.1.1`
     (the contract's Cargo.lock is gitignored, so re-apply this per checkout).
8. [ ] Warm-up: create a ballot, issue a token, cast a vote, verify
      `GET /api/admin/soroban/metrics` shows `configured: true` and the batch
      anchored the vote.
9. [ ] Confirm DB state matches contract state:
      `POST /api/admin/soroban/state-sync` → `diverged: 0`.

---

## 11. Transaction fee economics

Without batching, each vote costs one Stellar/Soroban transaction fee. With the
default `VOTE_BATCH_SIZE = 100` each batch costs **one** fee for up to 100
votes → ~100× cheaper, at the cost of up to `VOTE_BATCH_TIMEOUT_MS` extra delay
before a vote appears on-chain.