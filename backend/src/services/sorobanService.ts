import * as StellarSdk from "stellar-sdk";
import { config } from "../config";

const STELLAR_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const STELLAR_HORIZON_MAINNET = "https://horizon.stellar.org";

function getServer(): StellarSdk.Horizon.Server {
  const url =
    config.stellarNetwork === "mainnet"
      ? STELLAR_HORIZON_MAINNET
      : STELLAR_HORIZON_TESTNET;
  return new StellarSdk.Horizon.Server(url);
}

function getNetworkPassphrase(): string {
  return config.stellarNetwork === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

/**
 * Deploy a Soroban smart contract.
 * Returns the contract ID, or empty string if deployment fails.
 */
export async function deployContract(
  wasm: Buffer,
  admin: string,
): Promise<string> {
  if (!config.stellarSecretKey) {
    console.warn(
      "[Soroban] No secret key configured, skipping contract deployment",
    );
    return "";
  }

  try {
    const keypair = StellarSdk.Keypair.fromSecret(config.stellarSecretKey);
    const server = getServer();
    const account = await server.loadAccount(keypair.publicKey());

    // Create a Soroban contract
    const contract = await StellarSdk.SorobanServer.createContract({
      source: keypair,
      wasm,
      admin,
    });

    return contract.contractId;
  } catch (err) {
    console.error("[Soroban] Contract deployment failed:", err);
    return "";
  }
}

/**
 * Call a Soroban smart contract method.
 * Returns the transaction hash, or empty string if call fails.
 */
export async function callContract(
  contractId: string,
  method: string,
  args: StellarSdk.SorobanRpc.Arguments[],
): Promise<string> {
  if (!config.stellarSecretKey) {
    console.warn("[Soroban] No secret key configured, skipping contract call");
    return "";
  }

  try {
    const keypair = StellarSdk.Keypair.fromSecret(config.stellarSecretKey);
    const server = getServer();
    const account = await server.loadAccount(keypair.publicKey());

    // Create Soroban transaction
    const transaction = new StellarSdk.Soroban.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Soroban.Operation.invokeContract({
          contract: contractId,
          method,
          args,
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(keypair);
    const result = await server.submitTransaction(transaction);
    return result.hash;
  } catch (err) {
    console.error("[Soroban] Contract call failed:", err);
    return "";
  }
}

/**
 * Get contract data from Soroban.
 */
export async function getContractData(
  contractId: string,
  key: string,
): Promise<string | null> {
  try {
    const server = getServer();
    const result = await server.getContractData(contractId, key);
    return result.value;
  } catch (err) {
    console.error("[Soroban] Get contract data failed:", err);
    return null;
  }
}
