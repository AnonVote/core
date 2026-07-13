import type { Client } from "../client";
import type { SorokitResult } from "../shared/response";
import type { SorobanPollConfig } from "./types";

export interface RetryInvokeOptions {
  maxAttempts?: number;
  backoffMs?: number;
  poll?: SorobanPollConfig;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 500;

export async function retryContractInvoke(
  client: Client,
  contractId: string,
  method: string,
  args: unknown[],
  sign: (xdr: string) => Promise<SorokitResult<string>>,
  options: RetryInvokeOptions = {},
): Promise<SorokitResult<string>> {
  const { maxAttempts = DEFAULT_MAX_ATTEMPTS, backoffMs = DEFAULT_BACKOFF_MS, poll } = options;

  let lastError: SorokitResult<string> | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await delay(backoffMs * attempt);
    }

    const invokeResult = await client.soroban.invoke(
      {
        contractId,
        method,
        args,
        networkPassphrase: client.networkConfig.networkPassphrase,
        sourceAccount: "", // Caller should pass into an expanded API in follow-up work
        timeoutMs: poll?.intervalMs,
      },
      sign,
    );

    if (invokeResult.status === "ok") {
      return invokeResult;
    }

    lastError = invokeResult;
  }

  return lastError ?? {
    status: "error",
    data: null,
    error: {
      code: "CONTRACT_INVOKE_FAILED",
      message: "Contract invocation failed after retries.",
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}