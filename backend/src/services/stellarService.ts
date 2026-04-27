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
 * Write an immutable record to the Stellar blockchain.
 * Uses manageData operation. Retries up to 3 times on failure.
 * Returns the transaction hash, or empty string if all retries fail (non-blocking).
 */
export async function writeRecord(data: object): Promise<string> {
  if (!config.stellarSecretKey) {
    console.warn(
      "[Stellar] No secret key configured, skipping blockchain write",
    );
    return "";
  }

  const MAX_RETRIES = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const keypair = StellarSdk.Keypair.fromSecret(config.stellarSecretKey);
      const server = getServer();
      const account = await server.loadAccount(keypair.publicKey());

      // Stellar manageData value max is 64 bytes
      const dataStr = JSON.stringify(data).substring(0, 64);
      const key = `av-${Date.now()}`.substring(0, 64);

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
      })
        .addOperation(
          StellarSdk.Operation.manageData({
            name: key,
            value: dataStr,
          }),
        )
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await server.submitTransaction(transaction);
      return result.hash;
    } catch (err) {
      lastError = err;
      console.warn(
        `[Stellar] Write attempt ${attempt}/${MAX_RETRIES} failed:`,
        err,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // backoff
      }
    }
  }

  console.error("[Stellar] All retry attempts failed:", lastError);
  return "";
}
