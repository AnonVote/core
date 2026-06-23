/**
 * Soroban Smart Contract Service
 *
 * STATUS: Contract written (contracts/anonvote/src/lib.rs) — needs deployment.
 *
 * The manageData-based stellarService.ts is the active blockchain layer.
 * This service is ready to wire once the Soroban contract is deployed.
 *
 * TO ACTIVATE:
 * 1. Install Rust + Stellar CLI (see contracts/README.md)
 * 2. Build: cd contracts/anonvote && cargo build --target wasm32-unknown-unknown --release
 * 3. Deploy: stellar contract deploy --wasm target/wasm32-unknown-unknown/release/anonvote.wasm --network testnet
 * 4. Initialize: stellar contract invoke --id <ID> -- initialize --admin <PUBLIC_KEY>
 * 5. Set SOROBAN_CONTRACT_ID=<ID> in backend/.env
 * 6. Call the helpers below from ballotEngine, identityManager, privacyEngine, resultEngine
 *
 * CORRECT SDK USAGE (stellar-sdk v12):
 * - RPC server:     new StellarSdk.SorobanRpc.Server(rpcUrl)
 * - Simulate tx:    server.simulateTransaction(tx)
 * - Assemble tx:    StellarSdk.SorobanRpc.assembleTransaction(tx, simulation)
 * - Submit tx:      server.sendTransaction(tx)
 * - Convert values: StellarSdk.nativeToScVal(value, { type }) / scValToNative(scVal)
 * - Invoke op:      StellarSdk.Operation.invokeHostFunction({ func, auth })
 */

import * as StellarSdk from "stellar-sdk";
import { config } from "../config";

const SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const SOROBAN_RPC_MAINNET = "https://rpc.stellar.org";

function getRpcUrl(): string {
  return config.stellarNetwork === "mainnet"
    ? SOROBAN_RPC_MAINNET
    : SOROBAN_RPC_TESTNET;
}

function getNetworkPassphrase(): string {
  return config.stellarNetwork === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

function getRpcServer(): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(getRpcUrl(), {
    allowHttp: false,
  });
}

export interface SorobanInvokeResult {
  txHash: string;
  success: boolean;
  returnValue?: unknown;
}

/**
 * Invoke a method on a deployed Soroban smart contract.
 *
 * @param contractId - The deployed contract ID (C... address)
 * @param method     - The contract function name to call
 * @param args       - Arguments as native JS values (converted via nativeToScVal)
 *
 * @returns txHash and return value, or empty string if not configured / fails
 *
 * NOTE: This is a stub. Set SOROBAN_CONTRACT_ID in .env to activate.
 */
export async function invokeContract(
  contractId: string,
  method: string,
  args: { value: unknown; type: string }[],
): Promise<SorobanInvokeResult> {
  if (!config.stellarSecretKey) {
    console.warn("[Soroban] No secret key configured, skipping contract call");
    return { txHash: "", success: false };
  }

  if (!contractId) {
    console.warn("[Soroban] No contract ID provided, skipping contract call");
    return { txHash: "", success: false };
  }

  try {
    const keypair = StellarSdk.Keypair.fromSecret(config.stellarSecretKey);
    const server = getRpcServer();

    // Load account from Soroban RPC
    const account = await server.getAccount(keypair.publicKey());

    // Convert JS args to Soroban ScVal types
    const scArgs = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    // Build the invokeHostFunction operation
    const contract = new StellarSdk.Contract(contractId);
    const operation = contract.call(method, ...scArgs);

    // Build transaction
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate to get footprint and resource fees
    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      console.error("[Soroban] Simulation failed:", simulation.error);
      return { txHash: "", success: false };
    }

    // Assemble the transaction with simulation results (adds soroban data + fees)
    const preparedTx = StellarSdk.SorobanRpc.assembleTransaction(
      tx,
      simulation,
    ).build();

    // Sign and submit
    preparedTx.sign(keypair);
    const sendResult = await server.sendTransaction(preparedTx);

    if (sendResult.status === "ERROR") {
      console.error("[Soroban] Send failed:", sendResult.errorResult);
      return { txHash: "", success: false };
    }

    // Poll for transaction completion
    const txHash = sendResult.hash;
    let getResult = await server.getTransaction(txHash);
    let attempts = 0;

    while (
      getResult.status ===
        StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 10
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      getResult = await server.getTransaction(txHash);
      attempts++;
    }

    if (
      getResult.status ===
      StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS
    ) {
      const returnValue = getResult.returnValue
        ? StellarSdk.scValToNative(getResult.returnValue)
        : undefined;

      console.log(`[Soroban] ${method} succeeded — tx: ${txHash}`);
      return { txHash, success: true, returnValue };
    }

    console.error("[Soroban] Transaction failed:", getResult);
    return { txHash, success: false };
  } catch (err) {
    console.error("[Soroban] invokeContract error:", err);
    return { txHash: "", success: false };
  }
}

/**
 * Read contract data without submitting a transaction (view call / simulation only).
 *
 * @param contractId - The deployed contract ID
 * @param method     - The read-only contract function name
 * @param args       - Arguments as native JS values
 *
 * @returns The return value from the contract, or null on failure
 */
export async function readContract(
  contractId: string,
  method: string,
  args: { value: unknown; type: string }[],
): Promise<unknown | null> {
  if (!contractId) {
    console.warn("[Soroban] No contract ID provided, skipping read");
    return null;
  }

  try {
    const keypair = config.stellarSecretKey
      ? StellarSdk.Keypair.fromSecret(config.stellarSecretKey)
      : StellarSdk.Keypair.random();

    const server = getRpcServer();
    const account = await server.getAccount(keypair.publicKey());

    const scArgs = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    const contract = new StellarSdk.Contract(contractId);
    const operation = contract.call(method, ...scArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate only — no submission
    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      console.error("[Soroban] Read simulation failed:", simulation.error);
      return null;
    }

    if (
      StellarSdk.SorobanRpc.Api.isSimulationSuccess(simulation) &&
      simulation.result?.retval
    ) {
      return StellarSdk.scValToNative(simulation.result.retval);
    }

    return null;
  } catch (err) {
    console.error("[Soroban] readContract error:", err);
    return null;
  }
}

// ── AnonVote contract helpers ─────────────────────────────────────────────────
// These wrap invokeContract/readContract with the specific AnonVote contract
// methods. Set SOROBAN_CONTRACT_ID in .env to activate.

const CONTRACT_ID = config.sorobanContractId;

/**
 * Record a ballot creation on-chain.
 * Call from ballotEngine.createBallot() after the ballot is saved to DB.
 */
export async function sorobanRecordBallot(
  ballotIdHash: string,
): Promise<string> {
  if (!CONTRACT_ID) return "";
  const result = await invokeContract(CONTRACT_ID, "record_ballot", [
    { value: ballotIdHash, type: "string" },
  ]);
  return result.txHash;
}

/**
 * Record a token issuance on-chain.
 * Call from identityManager.issueToken() after the token is issued.
 */
export async function sorobanRecordToken(
  ballotIdHash: string,
): Promise<string> {
  if (!CONTRACT_ID) return "";
  const result = await invokeContract(CONTRACT_ID, "record_token", [
    { value: ballotIdHash, type: "string" },
  ]);
  return result.txHash;
}

/**
 * Record a vote cast on-chain.
 * Call from privacyEngine.submitVote() after the vote is saved to DB.
 */
export async function sorobanRecordVote(ballotIdHash: string): Promise<string> {
  if (!CONTRACT_ID) return "";
  const result = await invokeContract(CONTRACT_ID, "record_vote", [
    { value: ballotIdHash, type: "string" },
  ]);
  return result.txHash;
}

/**
 * Record a result publication on-chain.
 * Call from resultEngine.tallyBallot() after the result is saved to DB.
 * resultHash: SHA-256 of the tally JSON string.
 */
export async function sorobanRecordResult(
  ballotIdHash: string,
  resultHash: string,
): Promise<string> {
  if (!CONTRACT_ID) return "";
  const result = await invokeContract(CONTRACT_ID, "record_result", [
    { value: ballotIdHash, type: "string" },
    { value: resultHash, type: "string" },
  ]);
  return result.txHash;
}

/**
 * Read on-chain audit counts for a ballot (view call — no transaction).
 */
export async function sorobanGetAuditCounts(ballotIdHash: string): Promise<{
  tokensIssued: number;
  votesCast: number;
  isConsistent: boolean;
} | null> {
  if (!CONTRACT_ID) return null;
  const [tokens, votes, consistent] = await Promise.all([
    readContract(CONTRACT_ID, "get_tokens_issued", [
      { value: ballotIdHash, type: "string" },
    ]),
    readContract(CONTRACT_ID, "get_votes_cast", [
      { value: ballotIdHash, type: "string" },
    ]),
    readContract(CONTRACT_ID, "is_consistent", [
      { value: ballotIdHash, type: "string" },
    ]),
  ]);
  return {
    tokensIssued: (tokens as number) ?? 0,
    votesCast: (votes as number) ?? 0,
    isConsistent: (consistent as boolean) ?? false,
  };
}
