# AnonVote Soroban Smart Contract

[![CI](https://github.com/damiedee96/contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/damiedee96/contracts/actions/workflows/ci.yml)

Records immutable audit events on the Stellar blockchain with on-chain queryable state.

## What it does

| Function                                     | Description                  |
| -------------------------------------------- | ---------------------------- |
| `record_ballot(ballot_id_hash)`              | Register a ballot on-chain   |
| `record_token(ballot_id_hash)`               | Increment token issued count |
| `record_vote(ballot_id_hash)`                | Increment vote cast count    |
| `record_result(ballot_id_hash, result_hash)` | Publish result hash          |
| `get_tokens_issued(ballot_id_hash)`          | Read token count             |
| `get_votes_cast(ballot_id_hash)`             | Read vote count              |
| `get_result_hash(ballot_id_hash)`            | Read result hash             |
| `is_consistent(ballot_id_hash)`              | Check tokens == votes        |

All inputs use SHA-256 hashes of ballot UUIDs — no raw IDs stored on-chain.

---

## Deployed contract (testnet)

**Status:** ✅ Deployed & initialized on Stellar **testnet**.

| Field | Value |
| --- | --- |
| Contract ID | `CDPSKEL3SXLUQWU55EWIZY2BAXJOT4CQOXMQUVCRPM2J74LDTULFINPH` |
| Network | testnet (`Test SDF Network ; September 2015`) |
| WASM hash | `d366202b16d3d37ce19bbb10bdd6d179fb2b826ceab75cd011cf6c4e5c2e6960` |
| Admin | `GA6D2UIEACZO25AG2BUGPLQAZW3JJJZSGYH4LVUW5JMWQQ3SFQDK4UVL` |
| Deploy tx | `2da3aab9addbc922d3430530716d15071848472e875b5c1595709388945b3b23` |
| Git tag | `contract-testnet-v1.0.0` |

Full metadata (upload/deploy/initialize tx hashes, timestamp, git commit,
RPC URL) is recorded in [`deployments.json`](deployments.json); the ID is also
in [`CONTRACT_ID`](CONTRACT_ID).

### Verify on Stellar Explorer

- Contract: <https://stellar.expert/explorer/testnet/contract/CDPSKEL3SXLUQWU55EWIZY2BAXJOT4CQOXMQUVCRPM2J74LDTULFINPH>
- Deploy transaction: <https://stellar.expert/explorer/testnet/tx/2da3aab9addbc922d3430530716d15071848472e875b5c1595709388945b3b23>

### Verify with a live view call

Read-only calls require no signing key beyond a funded source account:

```bash
stellar contract invoke \
  --id CDPSKEL3SXLUQWU55EWIZY2BAXJOT4CQOXMQUVCRPM2J74LDTULFINPH \
  --source-account <YOUR_ACCOUNT> --network testnet \
  -- get_admin
# => "GA6D2UIEACZO25AG2BUGPLQAZW3JJJZSGYH4LVUW5JMWQQ3SFQDK4UVL"

# is_paused => false, get_approval_threshold => 1
```

---

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install the 1.81.0 toolchain used to build the deployable WASM (see "Build" below)
rustup toolchain install 1.81.0
rustup target add wasm32-unknown-unknown --toolchain 1.81.0

# The default/stable toolchain is still used for tests
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli --features opt
```

---

## Build

> **Important — build with rustc 1.81.0.** Since rustc 1.82 the
> `wasm32-unknown-unknown` target enables the WASM `reference-types` and
> `multivalue` proposals by default. The Soroban host bundled with
> `soroban-sdk` 21 rejects those at upload time
> (`HostError: Error(WasmVm, InvalidAction) "reference-types not enabled"`).
> Building with 1.81.0 — the last release before that default changed —
> produces an MVP-clean, uploadable artifact. The committed `Cargo.lock` pins
> a few transitive deps to pre-`edition2024` versions so cargo 1.81 can parse
> the graph; build with `--locked` and do not `cargo update` them without
> re-verifying. See `contracts/anonvote/.cargo/config.toml` for the full
> rationale.

```bash
cd contracts/anonvote
rustup run 1.81.0 cargo build --target wasm32-unknown-unknown --release --locked
```

Output: `target/wasm32-unknown-unknown/release/anonvote.wasm`

Verify the artifact is free of the rejected proposals (optional, requires
Binaryen `wasm-opt`) — this must exit 0:

```bash
wasm-opt target/wasm32-unknown-unknown/release/anonvote.wasm \
  --mvp-features --enable-mutable-globals --enable-sign-ext --enable-bulk-memory \
  -o /dev/null
```

---

## Test

```bash
cd contracts/anonvote
cargo test
```

---

## Deploy

### Prerequisites

- [Rust](https://rustup.rs/) with the `wasm32-unknown-unknown` target
- [Stellar CLI](https://github.com/stellar/stellar-cli)
- `jq` installed
- A Stellar account funded with testnet/mainnet XLM

### Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|---|
| `STELLAR_SECRET_KEY` | Yes | Admin secret key for signing the deploy transaction |
| `SOROBAN_RPC_URL_TESTNET` | No | Testnet RPC endpoint — defaults to `https://soroban-testnet.stellar.org` |
| `SOROBAN_RPC_URL_MAINNET` | No | Mainnet RPC endpoint — defaults to `https://soroban-mainnet.stellar.org` |

### Deploy to testnet

```bash
source .env
./deploy.sh testnet
```

### Deploy to mainnet

```bash
source .env
./deploy.sh mainnet
```

### What the script does

1. Builds the WASM binary
2. Deploys to the specified Stellar network
3. Initializes the contract with the derived admin address
4. Records contract ID, WASM hash, git commit, and timestamp in `deployments.json`
5. Creates a git tag (`contract-testnet-v1.0.0` or `contract-mainnet-v1.0.0`)
6. Prints a summary with the contract ID and verification links

### Verifying deployment

Check the contract on Stellar Explorer:
- Testnet: `https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>`
- Mainnet: `https://stellar.expert/explorer/mainnet/contract/<CONTRACT_ID>`

### Contract ID

After a successful deployment the contract ID is recorded in two places:

- **`contracts/CONTRACT_ID`** — human-readable file, one line per network, committed to git
- **`contracts/deployments.json`** — full deployment metadata (contract ID, WASM hash, git commit, timestamp)

Both files are updated automatically by `deploy.sh`. Commit them so the deployed ID is always traceable in version history.

Set the contract ID in the backend before starting the server:

```bash
# contracts/.env  (used by the TypeScript service layer)
SOROBAN_CONTRACT_ID=<CONTRACT_ID>

# backend/.env  (used by the backend application)
SOROBAN_CONTRACT_ID=<CONTRACT_ID>
```

The backend reads `SOROBAN_CONTRACT_ID` from the environment on startup and validates the format before accepting requests. If the variable is missing or malformed the server will refuse to start.

### Pushing to remote

After deployment, push the tag and commit:

```bash
git push origin contract-testnet-v1.0.0
git push origin feat/contract-deployment-script
```

---

## Wire into the backend

Once deployed, update `backend/src/services/sorobanService.ts` calls in:

- `backend/src/services/ballotEngine.ts` — call `invokeContract(id, "record_ballot", [...])`
- `backend/src/services/identityManager.ts` — call `invokeContract(id, "record_token", [...])`
- `backend/src/services/privacyEngine.ts` — call `invokeContract(id, "record_vote", [...])`
- `backend/src/services/resultEngine.ts` — call `invokeContract(id, "record_result", [...])`

The `ballot_id_hash` argument should be `hashIdentifier(ballotId)` — the same SHA-256 function already used in the backend.

## Usage

### Factory API (recommended)

The preferred way to use the service is via the `createSorobanService` factory, which creates an object with all methods pre-bound to a config:

```ts
import { Keypair } from "stellar-sdk";
import { createSorobanService, createDefaultTestnetConfig } from "@anonvote/contracts/service";

const sourceKeypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!);
const config = createDefaultTestnetConfig({
  contractId: process.env.SOROBAN_CONTRACT_ID!,
  sourceKeypair,
});
const service = createSorobanService(config);

await service.sorobanRecordBallot("hash123");
```

### Config helpers

```ts
// Testnet — defaults to https://soroban-testnet.stellar.org
const testnetConfig = createDefaultTestnetConfig({ contractId, sourceKeypair });

// Mainnet — defaults to https://soroban-mainnet.stellar.org
const mainnetConfig = createDefaultMainnetConfig({ contractId, sourceKeypair });

// Override any field for custom RPC gateways or local dev nodes:
const customConfig = { ...testnetConfig, rpcUrl: "http://localhost:8000" };
```

### Module-level API (low-level)

The module-level functions are still exported for callers who need to pass config dynamically:

```ts
import { SorobanServiceError, sorobanRecordBallot } from "@anonvote/contracts/service";

try {
  await sorobanRecordBallot(config, ballotIdHash);
} catch (err) {
  if (err instanceof SorobanServiceError) {
    if (err.retryable) {
      // Enqueue for retry with backoff
    }
  }
  throw err;
}
```

### Error handling

All service helpers throw `SorobanServiceError` on failure. Import it from `service/index.ts` and wrap every call:

```ts
import { SorobanServiceError } from "@anonvote/contracts/service";

try {
  await service.sorobanRecordBallot(ballotIdHash);
} catch (err) {
  if (err instanceof SorobanServiceError) {
    if (err.retryable) {
      // Enqueue for retry with backoff — NETWORK_ERROR and SIMULATION_FAILED
      // are transient; retrying is safe and expected.
    } else {
      // CONTRACT_ERROR or TRANSACTION_FAILED — do not retry.
      // CONTRACT_ERROR indicates a logic error (e.g. ballot already exists).
    }
  }
  throw err;
}
```

Error code retryability:

| `SorobanServiceErrorCode` | `retryable` | When thrown                                   |
| -------------------------- | ----------- | --------------------------------------------- |
| `NETWORK_ERROR`            | `true`      | RPC endpoint unreachable, DNS failure, TCP reset |
| `SIMULATION_FAILED`        | `true`      | RPC timeout, overloaded node, no error code   |
| `TRANSACTION_FAILED`       | `false`     | `sendTransaction` returned ERROR, or tx never confirmed after max retries |
| `CONTRACT_ERROR`           | `false`     | On-chain logic error (BallotNotFound, BallotAlreadyExists, etc.) |

Full error details (raw RPC responses, contract diagnostics) are logged internally only and are never exposed in the thrown error message, so it is safe to surface `err.message` in structured logs. Do not include raw contract error details in API responses to clients.

---

## Milestones

AnonVote development is organized into three milestones. Each issue is tagged with which milestone it belongs to.

### Milestone 1 — Foundation

Everything works end-to-end on testnet. A real admin can create a ballot, upload voters, issue tokens, collect votes, tally, and verify the result on Stellar. No manual database steps.

**Status:** In progress
**Focus:** Core voting flow, Soroban integration, vote encryption, public verification

### Milestone 2 — Hardening

The system is production-safe. Per-ballot encryption keys, rate limiting, error handling, retry queues, no raw identifiers anywhere, Soroban fully wired not stubbed.

**Status:** Planned
**Focus:** Security hardening, production readiness, reliability, scalability

### Milestone 3 — Ecosystem

@anonvote/crypto published on npm, docs repo complete, contracts deployed on mainnet, third party developers can build on top of AnonVote using the JS SDK.

**Status:** Planned
**Focus:** SDK release, third-party integrations, documentation

---

## Contributing

Issues are labeled with their corresponding milestone so you can see what stage of development they belong to.
