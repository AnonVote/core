# AnonVote Soroban Contract Deployment & Verification Guide

**Version:** 1.0.0  
**Status:** Active  
**Applies to:** AnonVote/contracts, AnonVote/core

---

## Table of Contents

1. [Overview](#overview)
2. [Deployment Guide](#deployment-guide)
3. [Contract ID Management](#contract-id-management)
4. [Independent Result Verification](#independent-result-verification)
5. [TypeScript Service Configuration](#typescript-service-configuration)
6. [Troubleshooting](#troubleshooting)

---

## Overview

AnonVote uses three Soroban smart contracts deployed on the Stellar blockchain to provide cryptographic proof that election results have not been tampered with. This guide covers:

- **How to deploy** the contracts to testnet and mainnet
- **How to verify** a deployment is correct using Stellar explorer
- **How to query results** directly from the Stellar ledger without trusting AnonVote's servers
- **How to configure** the TypeScript service that wires contracts to core

The independent verification section is designed for voters who want to confirm their election result directly from the Stellar blockchain using only public tools. If you are verifying an election result, you can skip directly to [Independent Result Verification](#independent-result-verification).

---

## Deployment Guide

### Prerequisites

#### 1. Install Rust

Install Rust and add the WebAssembly compilation target:

```bash
# Download and install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Activate Rust in your current shell
source $HOME/.shell_env

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Verify installation
rustc --version
cargo --version
```

#### 2. Install Soroban CLI

Install the Stellar CLI tool with Soroban support:

```bash
# Install using cargo
cargo install --locked stellar-cli --features opt

# Verify installation
stellar --version
```

Output should show version 21.0.0 or later.

#### 3. Set up Stellar Account

You need a Stellar account with XLM balance to pay deployment fees. Choose one:

**Option A: Use existing account**

If you already have a Stellar account with a secret key:

```bash
export STELLAR_SECRET_KEY="your-secret-key-starting-with-S"
```

**Option B: Create new account**

Generate a new keypair:

```bash
stellar keys generate --testnet
```

This outputs:

```
Public Key:  GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Secret Key:  SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Store both keys securely. Fund the account via the Stellar testnet faucet:
https://developers.stellar.org/guides/get-started/create-account

#### 4. Configure for Testnet vs Mainnet

Set environment variables for your target network:

**For Testnet:**

```bash
export STELLAR_NETWORK="testnet"
export STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
```

**For Mainnet:**

```bash
export STELLAR_NETWORK="mainnet"
export STELLAR_RPC_URL="https://rpc.stellar.org"
```

### Step-by-Step Build Process

#### Step 1: Clone and Navigate to Contracts

```bash
git clone https://github.com/AnonVote/contracts.git
cd contracts/contracts/anonvote
```

#### Step 2: Build the Contract

Compile the Soroban contract to WebAssembly:

```bash
cargo build --target wasm32-unknown-unknown --release
```

This compiles the Rust contract code to a `.wasm` file that runs on Soroban.

**Build output:**

```
Compiling anonvote v0.1.0
Finished `release` profile [optimized] target(s) in 2.34s
```

**Output file location:**

```
target/wasm32-unknown-unknown/release/anonvote.wasm
```

#### Step 3: Verify Build Artifacts

Confirm the WASM file was created and is not empty:

```bash
ls -lh target/wasm32-unknown-unknown/release/anonvote.wasm
```

Output example:

```
-rw-r--r-- 1 user staff 150K Jun 17 2026 target/wasm32-unknown-unknown/release/anonvote.wasm
```

**What to verify:**

- File exists at the path above
- File size is ~150 KB (not 0 bytes)
- File modification time is recent

#### Step 4: Calculate Deployment Checksum

Record the SHA-256 checksum of the compiled contract for verification:

```bash
sha256sum target/wasm32-unknown-unknown/release/anonvote.wasm
```

Example output:

```
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1  anonvote.wasm
```

**Save this checksum.** You will use it to verify the deployed contract matches the source.

---

### Deployment to Testnet

#### Command 1: Deploy the Contract

Deploy the compiled WASM to Stellar testnet:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/anonvote.wasm \
  --source $STELLAR_SECRET_KEY \
  --network testnet
```

**Expected output:**

```
Contract deployed successfully

Contract ID: CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3UOHPHVQ4J6VGXM5LTBQQCTZ
```

**⚠️ Save the Contract ID** — you will need it for all subsequent steps.

```bash
export CONTRACT_ID="CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3UOHPHVQ4J6VGXM5LTBQQCTZ"
```

#### Command 2: Initialize the Contract

After deployment, the contract must be initialized with an admin address. The admin is the only account that can record ballot events:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin $(stellar keys show --testnet --name anonvote --public-key)
```

Replace `--name anonvote` with your actual key name, or use your public key directly:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Expected output:**

```
Invoking contract method initialize...
Simulation succeeded
Transaction signature: ...
✓ Contract initialized
```

---

### Deployment to Mainnet

The process is identical to testnet, but use `--network mainnet` in all commands:

#### Command 1: Deploy to Mainnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/anonvote.wasm \
  --source $STELLAR_SECRET_KEY \
  --network mainnet
```

⚠️ **This costs real XLM.** Verify the contract ID before proceeding to initialization.

#### Command 2: Initialize on Mainnet

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network mainnet \
  -- initialize \
  --admin GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

### Verify the Deployed Contract Matches Source

#### Method 1: Using Stellar Explorer

1. Open https://stellar.expert
2. Select your network (Testnet or Mainnet) from the dropdown
3. Search for your Contract ID in the search box
4. Click "View Contract"
5. Scroll to "Code Hash"
6. Compare with your local checksum

**How to compare checksums:**

```bash
# Your local checksum (from earlier)
local_checksum=$(sha256sum target/wasm32-unknown-unknown/release/anonvote.wasm | awk '{print $1}')
echo "Local: $local_checksum"

# You'll also see it on Stellar Explorer as "Code Hash"
# They should match
```

#### Method 2: Using Soroban CLI

Get the on-chain code hash:

```bash
stellar contract info \
  --id $CONTRACT_ID \
  --network testnet
```

Output includes:

```
Code Hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
```

Compare with your local build:

```bash
sha256sum target/wasm32-unknown-unknown/release/anonvote.wasm
```

If they match, the deployed contract is bytecode-identical to your source code.

---

## Contract ID Management

### How Contract IDs are Scoped

**One contract serves all ballots.** The contract is not ballot-specific:

- A single AnonVote Soroban contract deployment on mainnet records events for all ballots
- Each ballot is identified within the contract by its `ballot_id_hash` parameter
- The `ballot_id_hash` is the SHA-256 hash of the ballot UUID, providing privacy (ballot IDs are not written in plaintext)
- Multiple deployments (e.g., one per organization) would each have their own contract ID

**Example:**

```
AnonVote/core backend
├── Ballot A (UUID: 550e8400-e29b-41d4-a716-446655440000)
│   └── ballotIdHash = SHA256("550e8400-e29b-41d4-a716-446655440000")
│       └── Stored in single contract with key: TokensIssued(ballotIdHash)
│
├── Ballot B (UUID: 6ba7b810-9dad-11d1-80b4-00c04fd430c8)
│   └── ballotIdHash = SHA256("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
│       └── Stored in single contract with key: TokensIssued(ballotIdHash)
│
└── Storage on Stellar Soroban
    └── Contract ID: CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3...
        ├── TokensIssued(ballotIdHash_A) = 1000
        ├── TokensIssued(ballotIdHash_B) = 500
        ├── VotesCast(ballotIdHash_A) = 1000
        └── VotesCast(ballotIdHash_B) = 500
```

### Where Contract IDs are Stored in core

The `AnonVote/core` backend reads the contract ID from an environment variable:

**In `backend/.env`:**

```bash
# Soroban contract ID — obtained from deployment step above
SOROBAN_CONTRACT_ID=CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3UOHPHVQ4J6VGXM5LTBQQCTZ

# Soroban RPC endpoint — must match deployed network
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Stellar network for contract calls — testnet or mainnet
SOROBAN_NETWORK=testnet

# Deployer/admin account secret key — required to sign contract calls
SOROBAN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**How core uses it:**

In `sorobanService.ts`:

```typescript
const config: SorobanConfig = {
  stellarSecretKey: process.env.SOROBAN_SECRET_KEY,
  stellarNetwork: process.env.SOROBAN_NETWORK as "testnet" | "mainnet",
  contractId: process.env.SOROBAN_CONTRACT_ID,
};

// Used in core services:
// - ballotEngine.createBallot() → sorobanRecordBallot(config, ballotIdHash)
// - identityManager.issueToken() → sorobanRecordToken(config, ballotIdHash)
// - privacyEngine.submitVote() → sorobanRecordVote(config, ballotIdHash)
// - resultEngine.tallyBallot() → sorobanRecordResult(config, ballotIdHash, resultHash)
```

### What Happens if the Contract is Redeployed

If you redeploy the contract (e.g., due to a bug fix), here is what changes and what persists:

| Item                        | On Redeployment                                                    |
| --------------------------- | ------------------------------------------------------------------ |
| **Contract ID**             | Changes — new deployment = new ID                                  |
| **Existing ballot records** | **Lost** — each contract deployment is a separate storage instance |
| **Transaction history**     | Persists on Stellar — all manageData operations are immutable      |
| **core configuration**      | Must update `SOROBAN_CONTRACT_ID` in `.env` to new ID              |

⚠️ **Redeployment creates a new contract instance with empty storage.** This means:

- Previous ballot records are no longer queryable via the contract
- Transaction history remains on Stellar via `manageData` operations
- core must be updated to use the new contract ID
- Voters can still verify results using manageData queries (see [Independent Result Verification](#independent-result-verification))

**Recommended practice:**

- Deploy to testnet first
- Run end-to-end tests (ballot creation, voting, tally)
- Only deploy to mainnet after successful testnet verification
- Once on mainnet, avoid redeployment unless absolutely necessary

---

## Independent Result Verification

### Overview: Verifying Without Trusting AnonVote

This section is designed for voters who want to verify their election result directly from the Stellar blockchain without relying on AnonVote's servers.

**What you'll verify:**

- The final tally published on-chain
- The transaction hash shown on the public results page matches the Stellar ledger
- The vote count is consistent (tokens issued == votes cast)

**What you need:**

- The ballot ID (provided by AnonVote)
- Optional: A Stellar wallet or public account to perform queries
- Access to Horizon API or Stellar Laboratory (public, free tools)

### Step 1: Get the Ballot Information

AnonVote's public results page displays:

- **Ballot ID** (example: `550e8400-e29b-41d4-a716-446655440000`)
- **Result transaction ID** (example: `abc123def456ghi789jkl012mno345...`)
- **Tally** (example: `Option A: 512 votes, Option B: 488 votes`)

Save these values — you'll need them for verification.

### Step 2: Query the Horizon API

Horizon is Stellar's public API for reading blockchain data. Use it to fetch the result event.

#### Using curl (command line):

```bash
curl "https://horizon-testnet.stellar.org/transactions/abc123def456ghi789jkl012mno345/operations" \
  -H "Accept: application/json" | jq .
```

Replace:

- `abc123def456...` with the result transaction ID
- `horizon-testnet` with `horizon-public.stellar.org` if mainnet

#### Expected response:

```json
{
  "_links": {},
  "_embedded": {
    "records": [
      {
        "type": "manage_data",
        "name": "ANONVOTE_RESULT_PUBLISHED",
        "value": "base64-encoded-result-hash"
      }
    ]
  }
}
```

### Step 3: Decode and Verify the Result Hash

The `value` field contains the result hash in base64. Decode it:

```bash
# Base64 value from Horizon API response
encoded="c2VhbGVkLWVsZWN0aW9uLXRhbGx5Lg=="

# Decode to hex
decoded=$(echo "$encoded" | base64 -d | xxd -p)
echo "Result hash from chain: $decoded"
```

On AnonVote's results page, you'll see a result hash displayed. Compare:

```
Results page result hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
Stellar chain hash:       a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1

Match: ✓
```

If they match, the tally on the results page is authentic and has not been altered since publication.

### Step 4: Verify Ballot Consistency (Optional)

To verify the vote count is correct, query the Soroban contract directly to confirm tokens issued == votes cast:

```bash
# Query contract for a ballot
stellar contract invoke \
  --id CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3UOHPHVQ4J6VGXM5LTBQQCTZ \
  --network testnet \
  -- is_consistent \
  --ballot-id-hash $(echo -n "550e8400-e29b-41d4-a716-446655440000" | sha256sum | cut -d' ' -f1)
```

Output:

```
true  ← All tokens that were issued resulted in votes
```

---

### Real Testnet Example: Verifying a Result

**Scenario:** You participated in an AnonVote ballot on testnet. The results page shows:

```
Ballot ID: 550e8400-e29b-41d4-a716-446655440000
Result Transaction: 96c94e0b937c21d6a5c4b7f2e1d3a9c8b7f6e5d4c3b2a1f0e9d8c7b6a5f4e3
Tally: Option A: 512 votes, Option B: 488 votes
```

#### Step 1: Query Horizon API

```bash
curl "https://horizon-testnet.stellar.org/transactions/96c94e0b937c21d6a5c4b7f2e1d3a9c8b7f6e5d4c3b2a1f0e9d8c7b6a5f4e3/operations" \
  -H "Accept: application/json" | jq '.
  _embedded.records[] | select(.type == "manage_data")'
```

Output:

```json
{
  "type": "manage_data",
  "name": "ANONVOTE_RESULT_PUBLISHED",
  "value": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1=="
}
```

#### Step 2: Decode and Verify

```bash
encoded="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1=="
decoded=$(echo "$encoded" | base64 -d | xxd -p)
echo "Decoded hash: $decoded"
```

Output:

```
Decoded hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
```

#### Step 3: Compare with Results Page

The results page displays:

```
Result Hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
```

✓ **They match.** The published tally (Option A: 512, Option B: 488) is authentic and anchored on the Stellar blockchain.

---

### Using Stellar Laboratory (No Technical Skills Required)

Alternatively, use Stellar Laboratory for a visual interface:

1. Open https://stellar.expert
2. Select **Testnet** from the dropdown
3. Search for the **transaction ID** (example: `96c94e0b937c21d6a5c4b7f2e1d3a9c...`)
4. Click **View Transaction**
5. Look for operation type **Manage Data** with name **ANONVOTE_RESULT_PUBLISHED**
6. The value shows the result hash

No command line or technical tools required.

---

## TypeScript Service Configuration

### How the Service Initializes the Soroban Contract Client

The `sorobanService.ts` module in `AnonVote/contracts` provides a TypeScript wrapper for invoking the Soroban contract. Here's how it works:

#### 1. Client Setup

```typescript
// sorobanService.ts - client initialization
import * as StellarSdk from "stellar-sdk";

const SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const SOROBAN_RPC_MAINNET = "https://rpc.stellar.org";

function getRpcUrl(network: string): string {
  return network === "mainnet" ? SOROBAN_RPC_MAINNET : SOROBAN_RPC_TESTNET;
}

function getNetworkPassphrase(network: string): string {
  return network === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

function getRpcServer(network: string): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(getRpcUrl(network), {
    allowHttp: false,
  });
}
```

#### 2. Configuration Type

```typescript
export interface SorobanConfig {
  stellarSecretKey: string; // Secret key for signing transactions
  stellarNetwork: "testnet" | "mainnet"; // Target network
  contractId: string; // Contract ID from deployment
}
```

#### 3. Transaction Flow

When core calls `sorobanRecordBallot()`:

```typescript
1. Load account (from Stellar ledger)
2. Build contract invocation transaction
3. Simulate transaction (calculates resource requirements)
4. Assemble transaction (adds resource fees)
5. Sign transaction (using stellarSecretKey)
6. Submit to Stellar network
7. Poll for confirmation (up to 10 attempts)
```

---

### Environment Variable Reference

The `AnonVote/core` backend reads configuration from environment variables. Set all of the following in `backend/.env`:

| Variable              | Format                        | Required | Description                                         |
| --------------------- | ----------------------------- | -------- | --------------------------------------------------- |
| `SOROBAN_NETWORK`     | `testnet` or `mainnet`        | ✓ Yes    | Target Stellar network                              |
| `SOROBAN_CONTRACT_ID` | Contract ID (starts with `C`) | ✓ Yes    | Deployed contract ID from deployment step           |
| `SOROBAN_RPC_URL`     | Full HTTPS URL                | ✓ Yes    | Soroban RPC endpoint                                |
| `SOROBAN_SECRET_KEY`  | Secret key (starts with `S`)  | ✓ Yes    | Admin account secret key for signing contract calls |

#### Example Configuration

**Testnet:**

```bash
SOROBAN_NETWORK=testnet
SOROBAN_CONTRACT_ID=CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3UOHPHVQ4J6VGXM5LTBQQCTZ
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Mainnet:**

```bash
SOROBAN_NETWORK=mainnet
SOROBAN_CONTRACT_ID=CBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SOROBAN_RPC_URL=https://rpc.stellar.org
SOROBAN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

#### Environment Variable Handling in core

In `core/backend/config.ts` (or equivalent):

```typescript
const sorobanConfig: SorobanConfig = {
  stellarSecretKey: process.env.SOROBAN_SECRET_KEY || "",
  stellarNetwork: (process.env.SOROBAN_NETWORK || "testnet") as
    | "testnet"
    | "mainnet",
  contractId: process.env.SOROBAN_CONTRACT_ID || "",
};

// Validate required variables at startup
if (!sorobanConfig.contractId) {
  console.warn(
    "[Soroban] SOROBAN_CONTRACT_ID not set — contract calls disabled",
  );
}

if (!sorobanConfig.stellarSecretKey) {
  console.warn(
    "[Soroban] SOROBAN_SECRET_KEY not set — contract calls disabled",
  );
}
```

---

### Testnet vs Mainnet Configuration Differences

| Component               | Testnet                               | Mainnet                                          |
| ----------------------- | ------------------------------------- | ------------------------------------------------ |
| **Network name**        | `testnet`                             | `mainnet`                                        |
| **RPC endpoint**        | `https://soroban-testnet.stellar.org` | `https://rpc.stellar.org`                        |
| **Network passphrase**  | `Test SDF Network ; September 2015`   | `Public Global Stellar Network ; September 2015` |
| **Contract ID**         | Starts with `T`                       | Starts with `C`                                  |
| **Account funding**     | Free from faucet                      | Requires real XLM                                |
| **Block time**          | ~5 seconds                            | ~5 seconds                                       |
| **Cost per deployment** | Free (testnet XLM)                    | ~1-10 XLM per deployment                         |
| **When to use**         | Development, testing, demos           | Production, real elections                       |

**Configuration checklist:**

- [ ] Use correct network name (`testnet` or `mainnet`)
- [ ] Use correct RPC URL for that network
- [ ] Use contract ID deployed on that network (not a testnet ID on mainnet)
- [ ] Use account with funds on that network
- [ ] Verify `.env` matches your intended network before starting core

---

### How the Service Handles Stellar Network Failures

The service implements retry logic and timeout handling to tolerate transient network issues:

#### Retry Logic

```typescript
const txHash = sendResult.hash;
let getResult = await server.getTransaction(txHash);
let attempts = 0;

// Poll up to 10 times, waiting 1.5 seconds between attempts
while (
  getResult.status ===
    StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
  attempts < 10
) {
  await new Promise((r) => setTimeout(r, 1500));
  getResult = await server.getTransaction(txHash);
  attempts++;
}

// Total wait time: up to 15 seconds
```

**Behavior:**

- Submits transaction once
- Polls Stellar RPC for result up to 10 times
- Waits 1.5 seconds between polls
- Maximum total wait: 15 seconds

#### Error Handling

When a contract call fails, the service returns:

```typescript
export interface SorobanInvokeResult {
  txHash: string; // Transaction hash, or "" if failed
  success: boolean; // true if contract call succeeded
  returnValue?: unknown; // Return value from contract (if applicable)
}
```

**Failure modes and what core receives:**

| Failure                       | txHash   | success | Returned to core                           |
| ----------------------------- | -------- | ------- | ------------------------------------------ |
| **No secret key configured**  | `""`     | `false` | Warning logged, no retry                   |
| **No contract ID configured** | `""`     | `false` | Warning logged, no retry                   |
| **Simulation fails**          | `""`     | `false` | Error logged, ballot not recorded on-chain |
| **Send fails (invalid tx)**   | `""`     | `false` | Error logged, transaction not submitted    |
| **Timeout (>15 seconds)**     | `txHash` | `false` | Tx may have succeeded; check manually      |
| **Success**                   | `txHash` | `true`  | Transaction hash returned for audit trail  |

#### What core Should Do on Failure

```typescript
// In core's ballotEngine.ts
async function recordBallotOnChain(ballotId: string, ballotIdHash: string) {
  const result = await sorobanRecordBallot(sorobanConfig, ballotIdHash);

  if (!result.success) {
    // Option A: Retry with exponential backoff
    console.error(`[Ballot] Soroban record failed for ${ballotId}`);
    // Implement retry logic with jitter

    // Option B: Continue without on-chain record (graceful degradation)
    // The ballot proceeds, but won't have on-chain audit trail
    // Note: This reduces verifiability — consider making it an error

    // Option C: Fail the ballot creation (strict mode)
    throw new Error(`Failed to record ballot on-chain: ${ballotId}`);
  }

  // Log transaction hash for verification
  console.log(`[Ballot] Recorded on-chain: tx ${result.txHash}`);
}
```

#### Network Resilience Best Practices

1. **Testnet failures are expected** — testnet RPC can be unstable; handle gracefully
2. **Mainnet failures are rare but possible** — implement retry with exponential backoff
3. **Never silently fail** — always log the transaction hash or error reason
4. **Provide manual override** — allow operators to manually record or verify on-chain state
5. **Display verification status** — on the results page, show whether the result is on-chain verified

---

## Troubleshooting

### Deployment Issues

#### "stellar command not found"

Install or rebuild the Soroban CLI:

```bash
cargo install --locked stellar-cli --features opt
```

#### "Error: Could not verify signature"

Ensure your secret key is correct and accessible:

```bash
# Test secret key validity
stellar keys show --secret-key $STELLAR_SECRET_KEY
```

Should output your public key without errors.

#### "Error: Account not found on ledger"

The account has no XLM balance. Fund it:

**Testnet:**

```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys show --public-key $STELLAR_SECRET_KEY)"
```

**Mainnet:**
Transfer XLM to your account from an exchange or wallet.

#### "Error: Timeout"

Network is congested. Try again, or switch to mainnet if on testnet.

### Runtime Issues

#### Contract call times out

Increase the timeout or retry:

```typescript
// In sorobanService.ts, increase timeout
.setTimeout(60) // Was 30, now 60 seconds

// Or add retry loop in core service
```

#### "No contract ID provided, skipping contract call"

Set `SOROBAN_CONTRACT_ID` in `.env`:

```bash
SOROBAN_CONTRACT_ID=CA7QYNF63GQ2TLRJJQ4P6OQQC7TSCIB3...
```

#### "Simulation failed"

Check that:

- Contract ID exists on the target network
- Admin address is correctly initialized
- Input parameters are valid

### Verification Issues

#### "Transaction not found on chain"

Wait longer — Stellar may not have indexed it yet. Retry after 30 seconds.

#### "Result hash mismatch"

The tally on the results page does not match the on-chain hash. This indicates:

- Results page data is corrupted or stale
- On-chain data is corrupted or incorrect
- **This is a critical error.** Contact AnonVote support immediately.

#### "Horizon API returns 404"

Transaction doesn't exist on the network. Verify:

- Transaction ID is correct
- You're querying the correct network (testnet vs mainnet)
- Transaction has been mined (wait a few seconds)

---

## Conclusion

With this guide, you can:

✓ Deploy AnonVote Soroban contracts to testnet and mainnet  
✓ Verify deployments are correct and match source code  
✓ Configure the TypeScript service in core  
✓ Query and verify election results directly from Stellar without trusting AnonVote's servers  
✓ Handle network failures gracefully

For issues or questions, refer to:

- [AnonVote/docs](https://github.com/AnonVote/docs) — specification
- [AnonVote/contracts](https://github.com/AnonVote/contracts) — contract source code
- [Stellar documentation](https://developers.stellar.org/) — Soroban and Horizon reference
- [Stellar community Discord](https://stellar.org/community) — technical support
