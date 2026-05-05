/**
 * Soroban Smart Contract Service
 *
 * STATUS: Stub — ready to wire to a deployed contract.
 *
 * The manageData-based stellarService.ts is the active blockchain layer.
 * This service is prepared for when a Soroban contract is deployed on testnet/mainnet.
 *
 * TO ACTIVATE:
 * 1. Write a Soroban contract in Rust (see /contracts/ when created)
 * 2. Deploy with: stellar contract deploy --wasm target/wasm32-unknown-unknown/release/anonvote.wasm --network testnet
 * 3. Set SOROBAN_CONTRACT_ID in .env
 * 4. Call invokeContract() from privacyEngine or resultEngine as needed
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
