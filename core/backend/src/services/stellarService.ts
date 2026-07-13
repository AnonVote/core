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

export interface StellarWriteResult {
  txHash: string;
  ledgerTimestamp: Date | null; // Stellar network consensus time
}

/**
 * Write an immutable record to the Stellar blockchain.
 * Uses manageData operation. Retries up to 3 times on failure.
 * Returns txHash + ledger consensus timestamp, or empty string on failure.
 */
export async function writeRecord(data: object): Promise<StellarWriteResult> {
  if (!config.stellarSecretKey) {
    console.warn(
      "[Stellar] No secret key configured, skipping blockchain write",
    );
    return { txHash: "", ledgerTimestamp: null };
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
      const txHash = result.hash;

      // Fetch ledger close time from Horizon — this is the Stellar consensus timestamp
      let ledgerTimestamp: Date | null = null;
      try {
        const txDetails = await server
          .transactions()
          .transaction(txHash)
          .call();
        if (txDetails.created_at) {
          ledgerTimestamp = new Date(txDetails.created_at);
        }
      } catch (fetchErr) {
        console.warn("[Stellar] Could not fetch ledger timestamp:", fetchErr);
      }

      console.log(
        `[Stellar] Write success — tx: ${txHash}, ledger time: ${ledgerTimestamp?.toISOString() ?? "unknown"}`,
      );

      return { txHash, ledgerTimestamp };
    } catch (err) {
      lastError = err;
      console.warn(
        `[Stellar] Write attempt ${attempt}/${MAX_RETRIES} failed:`,
        err,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  console.error("[Stellar] All retry attempts failed:", lastError);
  return { txHash: "", ledgerTimestamp: null };
}
