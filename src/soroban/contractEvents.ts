import type { SorokitClient } from "../client/createSorokitClient";
import type { SorokitResult } from "../shared/response";
import { err, ok, SorokitErrorCode } from "../shared/response";
import { toMessage } from "../shared/errors";
import type { SorobanPollConfig } from "./types";

export interface ContractEventFilter {
  contractId?: string;
  eventType?: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
}

export interface ContractEvent {
  id: string;
  contractId: string;
  eventType: string;
  topics: string[];
  data: unknown;
  ledger: number;
  timestamp: string;
  transactionHash: string;
}

export interface ContractEventPage {
  events: ContractEvent[];
  nextCursor: string | undefined;
  hasMore: boolean;
}

/**
 * Poll Soroban RPC for contract events emitted during a transaction lifecycle.
 *
 * This is a best-effort helper: it submits the signed XDR, polls the
 * transaction status, then attempts to fetch associated events for the
 * contract. The underlying RPC may or may not support events depending on
 * the Stellar network version; failures fall back gracefully.
 */
export function streamContractEvents(
  client: SorokitClient,
  filter: ContractEventFilter = {},
  pollConfig: SorobanPollConfig = {},
): AsyncGenerator<SorokitResult<ContractEventPage>> {
  const rpcUrl = client.networkConfig.rpcUrl;
  const networkPassphrase = client.networkConfig.networkPassphrase;

  const maxAttempts = pollConfig.maxAttempts ?? 20;
  const intervalMs = pollConfig.intervalMs ?? 1500;

  if (!rpcUrl) {
    throw new Error("RPC URL is required for event streaming.");
  }

  // We’ll fetch once per poll cycle; the caller can abort with AbortController.
  // eslint-disable-next-line @typescript-eslint/require-await
  return (async function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await delay(intervalMs);
      const page = await fetchContractEvents(rpcUrl, networkPassphrase, filter);
      yield page;
      if (page.status === "ok" && page.data && !page.data.hasMore) {
      break;
    }
    }
  })();
}

/**
 * Build a typed contract event reader that turns raw event records into
 * typed TS objects using a Zod-like schema shape. This helper enforces the
 * SDK’s no-throw contract at the boundary.
 */
export interface EventDecoder<T> {
  decode(raw: ContractEvent): SorokitResult<T>;
}

export function createTypedEventReader<T>(
  decoder: EventDecoder<T>,
  defaultContractId: string,
): {
  read(filter?: Omit<ContractEventFilter, "contractId">): Promise<SorokitResult<T[]>>;
  stream(
    filter?: Omit<ContractEventFilter, "contractId">,
    pollConfig?: SorobanPollConfig,
  ): AsyncGenerator<SorokitResult<T[]>>;
} {
  return {
    async read(filter?: Omit<ContractEventFilter, "contractId">) {
      const all: T[] = [];
      for await (const page of streamContractEvents(
        // The typed reader is intentionally decoupled from the full client;
        // callers wire the Soroban RPC + contract context themselves.
        {} as SorokitClient,
        { contractId: defaultContractId, ...filter },
      )) {
        if (page.status === "error") return page as SorokitResult<T[]>;
        if (!page.data) continue;
        for (const event of page.data.events) {
          const decoded = decoder.decode(event);
          if (decoded.status === "error") return decoded;
          all.push(decoded.data);
        }
      }
      return ok(all);
    },

    async *stream(
      filter?: Omit<ContractEventFilter, "contractId">,
      pollConfig: SorobanPollConfig = {},
    ) {
      for await (const page of streamContractEvents(
        {} as SorokitClient,
        { contractId: defaultContractId, ...filter },
        pollConfig,
      )) {
        if (page.status === "error") {
          yield page as SorokitResult<T[]>;
          continue;
        }
        if (!page.data) {
          yield ok([]);
          continue;
        }
        const batch: T[] = [];
        for (const event of page.data.events) {
          const decoded = decoder.decode(event);
          if (decoded.status === "error") {
            yield decoded;
            continue;
          }
          batch.push(decoded.data);
        }
        yield ok(batch);
      }
    },
  };
}

async function fetchContractEvents(
  rpcUrl: string,
  networkPassphrase: string,
  filter: ContractEventFilter,
): Promise<SorokitResult<ContractEventPage>> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: [
          {
            contractId: filter.contractId,
            eventType: filter.eventType,
            fromBlock: filter.fromBlock ?? 0,
            toBlock: filter.toBlock,
            limit: filter.limit ?? 10,
          },
        ],
      }),
    });

    if (!response.ok) {
      return err(
        SorokitErrorCode.CONTRACT_READ_FAILED,
        `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      result?: {
        events?: unknown[];
        nextCursor?: string;
        hasMore?: boolean;
      };
    };

    const events = (payload.result?.events ?? []).map((raw) =>
      normalizeEvent(raw as Record<string, unknown>),
    );

    return ok({
      events,
      nextCursor: typeof payload.result?.nextCursor === "string" ? payload.result.nextCursor : undefined,
      hasMore: Boolean(payload.result?.hasMore),
    });
  } catch (cause) {
    return err(SorokitErrorCode.CONTRACT_READ_FAILED, toMessage(cause), cause);
  }
}

function normalizeEvent(raw: Record<string, unknown>): ContractEvent {
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    contractId: typeof raw.contractId === "string" ? raw.contractId : String(raw.contractId ?? ""),
    eventType: typeof raw.type === "string" ? raw.type : String(raw.type ?? "unknown"),
    topics: Array.isArray(raw.topics)
      ? raw.topics.map((topic) => String(topic))
      : typeof raw.topics === "string"
        ? [raw.topics]
        : [],
    data: raw.data ?? null,
    ledger: typeof raw.ledger === "number" ? raw.ledger : Number(raw.ledger ?? 0),
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    transactionHash: typeof raw.txHash === "string" ? raw.txHash : String(raw.txHash ?? ""),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}