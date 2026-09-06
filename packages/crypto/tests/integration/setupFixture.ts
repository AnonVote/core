/**
 * tests/integration/setupFixture.ts
 *
 * Shared fixture for the integration suite: the `fetch` mock (installed and
 * restored in exactly one place so it cannot leak between suites), ballot and
 * voter factories, and a lazily-built 128-bit Paillier keypair shared by every
 * ZKP scenario.
 *
 * The keypair is the entire runtime budget of this suite — generating a second
 * one is the fastest way to blow the 5-second ceiling. Always go through
 * {@link sharedPaillierKeys}.
 */

import { generatePaillierKeyPair } from "../../src/zkp/paillier";
import type { PaillierKeyPair } from "../../src/zkp/types";
import { MockStellarNetwork } from "./mockStellarNetwork";
import { MockBackend } from "./mockBackend";

/** Base URL every integration client is pointed at. */
export const TEST_API_URL = "https://api.integration.test";

/** Auth token the mock backend accepts on write endpoints. */
export const TEST_AUTH_TOKEN = "integration-test-bearer-token";

/**
 * A deterministic 64-char hex AES key. Fixed rather than random so a failing
 * assertion reproduces byte-for-byte.
 */
export const TEST_BALLOT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** A second, different key — for the wrong-key decryption scenario. */
export const WRONG_BALLOT_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

// ── Paillier keypair (lazy, module-scoped) ──────────────────────────────────

let cachedPaillierKeys: PaillierKeyPair | undefined;

/**
 * The shared 128-bit Paillier keypair. Built on first use and reused for the
 * rest of the file's lifetime. 128 bits matches the rest of the test suite;
 * production default is 2048 and must never be used here.
 */
export function sharedPaillierKeys(): PaillierKeyPair {
  if (!cachedPaillierKeys) {
    cachedPaillierKeys = generatePaillierKeyPair(128);
  }
  return cachedPaillierKeys;
}

// ── fetch mock ──────────────────────────────────────────────────────────────

/** One recorded outbound request. */
export interface FetchCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  /** Parsed JSON request body, or undefined for bodyless requests. */
  body?: Record<string, unknown>;
}

/** Handle returned by {@link installFetchMock} for driving the network seam. */
export interface FetchMockHandle {
  /** Every request the SDK made, in order. */
  readonly calls: FetchCall[];
  /** Requests recorded so far. */
  callCount(): number;
  /** Requests recorded for a given path suffix. */
  callsTo(pathSuffix: string): FetchCall[];
  /** Artificial latency applied before each response. Honours AbortSignal. */
  setLatency(ms: number): void;
  /** Rejects the next `count` calls at the network level (before any status). */
  failNetwork(count: number, error?: Error): void;
  /** Responds with `status` for the next `count` calls, bypassing the backend. */
  forceStatus(count: number, status: number, body?: unknown): void;
  /** Clears recorded calls and any pending injected behaviour. */
  reset(): void;
}

const originalFetch: typeof globalThis.fetch | undefined = globalThis.fetch;
let installed = false;

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Rejects with an AbortError as soon as `signal` fires, whatever `promise` is
 * still doing. The loser's rejection is swallowed so a stalled or failing
 * server-side promise cannot surface as an unhandled rejection after the
 * caller has already given up on it.
 */
function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      promise.catch(() => {});
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      promise.catch(() => {});
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function headersToRecord(init: RequestInit): Record<string, string> {
  const raw = init.headers;
  if (!raw) return {};
  if (raw instanceof Headers) {
    const out: Record<string, string> = {};
    raw.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw);
  }
  return { ...(raw as Record<string, string>) };
}

/**
 * Replaces `globalThis.fetch` with a mock that routes to `backend`.
 *
 * Real `Response` objects are constructed (undici, Node 20+), so `res.ok`,
 * `res.status` and `res.json()` behave exactly as they do in production —
 * `throwForStatus` is exercised for real rather than against a stub shape.
 *
 * Always pair with {@link restoreFetch} in an `afterEach`.
 */
export function installFetchMock(
  backend: MockBackend,
  apiUrl: string = TEST_API_URL,
): FetchMockHandle {
  const calls: FetchCall[] = [];
  let latencyMs = 0;
  let networkFailuresRemaining = 0;
  let networkError: Error = new Error("ECONNREFUSED: connection refused");
  let forcedRemaining = 0;
  let forcedStatus = 500;
  let forcedBody: unknown = { message: "injected failure" };

  const handle: FetchMockHandle = {
    calls,
    callCount: () => calls.length,
    callsTo: (pathSuffix) => calls.filter((c) => c.path.endsWith(pathSuffix)),
    setLatency: (ms) => {
      latencyMs = ms;
    },
    failNetwork: (count, error) => {
      networkFailuresRemaining = count;
      if (error) networkError = error;
    },
    forceStatus: (count, status, body) => {
      forcedRemaining = count;
      forcedStatus = status;
      forcedBody = body ?? { message: `injected HTTP ${status}` };
    },
    reset: () => {
      calls.length = 0;
      latencyMs = 0;
      networkFailuresRemaining = 0;
      forcedRemaining = 0;
    },
  };

  const mockFetch = async (
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.startsWith(apiUrl) ? url.slice(apiUrl.length) : url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = headersToRecord(init);

    let parsedBody: Record<string, unknown> | undefined;
    if (typeof init.body === "string") {
      parsedBody = JSON.parse(init.body) as Record<string, unknown>;
    }

    calls.push({ method, url, path, headers, body: parsedBody });

    const signal = init.signal ?? null;

    const respond = async (): Promise<Response> => {
      if (latencyMs > 0) {
        await delay(latencyMs, signal);
      }

      if (networkFailuresRemaining > 0) {
        networkFailuresRemaining -= 1;
        throw networkError;
      }

      if (forcedRemaining > 0) {
        forcedRemaining -= 1;
        return jsonResponse(forcedStatus, forcedBody);
      }

      const result = await backend.handle(method, path, parsedBody, headers);
      return jsonResponse(result.status, result.body);
    };

    // Real fetch rejects the moment the signal aborts, however deep the server
    // is into handling the request. Racing here rather than only around the
    // latency delay is what makes a stalled backend observable as a timeout.
    return withAbort(respond(), signal);
  };

  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  installed = true;

  return handle;
}

/** Restores the real `globalThis.fetch`. Safe to call when nothing is installed. */
export function restoreFetch(): void {
  if (!installed) return;
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete (globalThis as { fetch?: unknown }).fetch;
  }
  installed = false;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Fixture assembly ────────────────────────────────────────────────────────

/** Everything a test needs: a fresh ledger, backend, and installed fetch mock. */
export interface IntegrationFixture {
  ledger: MockStellarNetwork;
  backend: MockBackend;
  fetchMock: FetchMockHandle;
  ballotKey: string;
  apiUrl: string;
  authToken: string;
}

/**
 * Builds a fresh fixture and installs the fetch mock.
 * Tear down with {@link teardownFixture} in an `afterEach`.
 */
export function setupFixture(
  options: { ballotKey?: string; requireAuth?: boolean } = {},
): IntegrationFixture {
  const ledger = new MockStellarNetwork();
  const ballotKey = options.ballotKey ?? TEST_BALLOT_KEY;
  const backend = new MockBackend({
    ledger,
    ballotKey,
    authToken: options.requireAuth === false ? undefined : TEST_AUTH_TOKEN,
  });
  const fetchMock = installFetchMock(backend, TEST_API_URL);

  return {
    ledger,
    backend,
    fetchMock,
    ballotKey,
    apiUrl: TEST_API_URL,
    authToken: TEST_AUTH_TOKEN,
  };
}

/** Restores `fetch` and clears ledger state. */
export function teardownFixture(fixture: IntegrationFixture): void {
  restoreFetch();
  fixture.ledger.reset();
  fixture.fetchMock.reset();
}

// ── Factories ───────────────────────────────────────────────────────────────

/** A voter identifier list of the requested size. */
export function makeVoters(count: number, prefix = "voter"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}@example.test`);
}

/** Ballot creation arguments with sensible defaults. */
export function makeBallotArgs(
  overrides: Partial<{
    title: string;
    description: string;
    options: string[];
    deadline: string;
  }> = {},
): {
  title: string;
  description: string;
  options: string[];
  deadline: string;
} {
  return {
    title: overrides.title ?? "Integration Ballot",
    description: overrides.description ?? "A ballot used by the integration suite",
    options: overrides.options ?? ["Approve", "Reject", "Abstain"],
    deadline:
      overrides.deadline ?? new Date(Date.now() + 86_400_000).toISOString(),
  };
}

/**
 * Retry config that keeps backoff observable but effectively free.
 * Fake timers interact badly with the real `await`s in `withRetry`, so the
 * delays are shrunk instead of faked.
 */
export const FAST_RETRY = {
  initialDelayMs: 1,
  maxDelayMs: 2,
  backoffMultiplier: 1,
} as const;
