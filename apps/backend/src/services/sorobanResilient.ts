/**
 * Resilience layer for Soroban contract calls (issue #77 — Phase 2).
 *
 * Provides:
 *  - Exponential-backoff retries (1s → 2s → 4s by default) that only fire for
 *    retry-safe error kinds (NETWORK_ERROR, RPC_ERROR; SIMULATION_FAILED is
 *    retried once since resource/fee spikes are often transient). Permanent
 *    CONTRACT_ERRORs fail fast.
 *  - A dedicated circuit breaker: when >50% of recent contract calls fail the
 *    circuit OPENS, batch submission pauses, and an alert is logged. After the
 *    open duration it HALF-OPENs, letting one probe call through; success
 *    closes it again.
 *  - Structured logging + metric recording for every attempt.
 *
 * This module deliberately does NOT import sorobanService — callers hand it
 * the operation as a closure, which keeps unit tests hermetic and avoids
 * circular imports.
 */

import { config } from "../config";
import { logger } from "../utils/logger";
import {
  CircuitBreaker,
  CircuitState,
} from "../middleware/circuitBreaker";
import { SorobanError, classifySorobanError } from "./sorobanErrors";
import {
  recordSorobanCall,
  recordSorobanRetry,
} from "./sorobanMetrics";

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Circuit breaker guarding all Soroban submissions. */
export const sorobanCircuitBreaker = new CircuitBreaker({
  threshold: config.sorobanCircuitBreakerThreshold,
  duration: config.sorobanCircuitBreakerDurationMs,
  sampleSize: config.sorobanCircuitBreakerSampleSize,
});

// The generic breaker logs via its own logger; expose state transitions of the
// Soroban instance as alerts so ops can distinguish them from HTTP breakers.
const originalTransition = (
  sorobanCircuitBreaker as unknown as {
    transitionTo: (s: CircuitState) => void;
  }
).transitionTo.bind(sorobanCircuitBreaker);
(sorobanCircuitBreaker as unknown as { transitionTo: (s: CircuitState) => void }).transitionTo =
  (newState: CircuitState) => {
    if (newState === CircuitState.OPEN) {
      // ALERT: contract submission paused
      logger.error("soroban_circuit_breaker_open_alert", {
        alert: "SOROBAN_SUBMISSION_PAUSED",
        threshold: config.sorobanCircuitBreakerThreshold,
        message:
          "Soroban circuit breaker OPENED — vote/batch submission paused until recovery probe succeeds.",
      });
    }
    originalTransition(newState);
  };

export interface ResilienceOptions {
  /** Logical operation name for logs/metrics, e.g. "record_vote". */
  op: string;
  /** Total attempts including the first (default from config, usually 3). */
  maxAttempts?: number;
  /** Base delay in ms; delay_i = base * 2^(i-1). Default from config. */
  baseDelayMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Skip the circuit breaker check (used by recovery probes themselves). */
  skipCircuitBreaker?: boolean;
}

export class SorobanCircuitOpenError extends Error {
  constructor() {
    super("Soroban circuit breaker is OPEN — submission paused");
    this.name = "SorobanCircuitOpenError";
  }
}

/**
 * Execute `fn` with circuit-breaker gating and exponential-backoff retries.
 * Throws the last SorobanError after exhausting attempts.
 */
export async function withSorobanResilience<T>(
  fn: () => Promise<T>,
  opts: ResilienceOptions,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? config.sorobanMaxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? config.sorobanRetryBaseDelayMs;
  const sleep = opts.sleep ?? defaultSleep;

  if (!opts.skipCircuitBreaker && !sorobanCircuitBreaker.allowRequest()) {
    recordSorobanCall(opts.op, "skipped");
    throw new SorobanCircuitOpenError();
  }

  let lastError: SorobanError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      sorobanCircuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      lastError = classifySorobanError(err);
      // SIMULATION_FAILED gets exactly one retry — fee/resource spikes are
      // often transient but persistent simulation failures are not.
      const retryable =
        lastError.retryable ||
        (lastError.kind === "SIMULATION_FAILED" && attempt === 1);

      sorobanCircuitBreaker.recordFailure();

      logger.warn("soroban_call_failed", {
        op: opts.op,
        attempt,
        maxAttempts,
        kind: lastError.kind,
        retryable,
        error: lastError.message,
      });

      if (!retryable || attempt === maxAttempts) break;

      recordSorobanRetry(opts.op);
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }

  recordSorobanCall(opts.op, "error");
  throw lastError!;
}

/** Current breaker state for observability endpoints. */
export function getSorobanCircuitBreakerStatus() {
  return {
    ...sorobanCircuitBreaker.getMetrics(),
  };
}

/** Test helper — force the breaker back to CLOSED with empty history. */
export function resetSorobanCircuitBreaker(): void {
  sorobanCircuitBreaker.reset();
}