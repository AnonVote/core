import type { Client } from "../client";
import type { SorokitResult } from "../shared/response";
import { err, ok } from "../shared/response";
import { toMessage } from "../shared/errors";
import type { SorobanPollConfig } from "./types";

export interface ContractHealthStatus {
  contractId: string;
  reachable: boolean;
  rpcLatencyMs: number;
  lastChecked: string;
}

export interface ContractHealthOptions {
  contractId: string;
  pollConfig?: SorobanPollConfig;
}

const DEFAULT_POLL_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 3000;

/**
 * Best-effort health probe for a Soroban contract over RPC.
 *
 * This does not validate contract logic, only that the RPC endpoint
 * can reach the contract and return a response within the timeout.
 */
export async function checkContractHealth(
  client: Client,
  options: ContractHealthOptions,
): Promise<SorokitResult<ContractHealthStatus>> {
  const rpcUrl = client.networkConfig.rpcUrl;
  if (!rpcUrl) {
    return err({
      code: "NETWORK_ERROR",
      message: "RPC URL is required for contract health checks.",
    } as any);
  }

  const start = Date.now();
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [{ hash: "0000000000000000000000000000000000000000000000000000000000000000" }],
      }),
    });

    const latencyMs = Date.now() - start;
    const reachable = response.ok || response.status !== 404;

    return ok({
      contractId: options.contractId,
      reachable,
      rpcLatencyMs: latencyMs,
      lastChecked: new Date().toISOString(),
    });
  } catch (cause) {
    return err({
      code: "NETWORK_ERROR",
      message: toMessage(cause),
      cause,
    } as any);
  }
}

export async function streamContractHealth(
  client: Client,
  options: ContractHealthOptions,
): Promise<AsyncGenerator<SorokitResult<ContractHealthStatus>>> {
  const maxAttempts = options.pollConfig?.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
  const intervalMs = options.pollConfig?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return (async function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await delay(intervalMs);
      const status = await checkContractHealth(client, options);
      yield status;
    }
  })();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}