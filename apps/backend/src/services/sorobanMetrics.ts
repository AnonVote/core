/**
 * In-memory observability registry for the Soroban integration layer
 * (issue #77 — Phase 3: metrics).
 *
 * Counters follow a Prometheus-ish shape and are exposed through
 * GET /api/admin/soroban/metrics. Everything is process-local: this is an
 * alerting/debugging aid, not a source of truth.
 */

export interface SorobanMetricsSnapshot {
  /** soroban_calls_total keyed by "<method>|<outcome>" (outcome: ok|error|skipped). */
  callsTotal: Record<string, number>;
  /** soroban_retry_attempts_total keyed by method. */
  retryAttemptsTotal: Record<string, number>;
  /** soroban_batches_total keyed by outcome (ok|failed|paused|duplicate_fallback). */
  batchesTotal: Record<string, number>;
  /** Batch-size aggregates: sum/count/max over submitted batches. */
  batchSize: { sum: number; count: number; max: number };
  /** Votes moved to the dead letter queue after exhausting retries. */
  deadLetteredTotal: number;
  /** Contract-vs-database divergences detected by the state sync job. */
  divergencesDetectedTotal: number;
}

const state = {
  callsTotal: {} as Record<string, number>,
  retryAttemptsTotal: {} as Record<string, number>,
  batchesTotal: {} as Record<string, number>,
  batchSize: { sum: 0, count: 0, max: 0 },
  deadLetteredTotal: 0,
  divergencesDetectedTotal: 0,
};

function bump(bucket: Record<string, number>, key: string, n = 1): void {
  bucket[key] = (bucket[key] ?? 0) + n;
}

export function recordSorobanCall(method: string, outcome: "ok" | "error" | "skipped"): void {
  bump(state.callsTotal, `${method}|${outcome}`);
}

export function recordSorobanRetry(method: string): void {
  bump(state.retryAttemptsTotal, method);
}

export function recordBatch(
  outcome: "ok" | "failed" | "paused" | "duplicate_fallback",
  size?: number,
): void {
  bump(state.batchesTotal, outcome);
  if (typeof size === "number" && size > 0 && outcome === "ok") {
    state.batchSize.sum += size;
    state.batchSize.count += 1;
    state.batchSize.max = Math.max(state.batchSize.max, size);
  }
}

export function recordDeadLetter(): void {
  state.deadLetteredTotal += 1;
}

export function recordDivergence(): void {
  state.divergencesDetectedTotal += 1;
}

export function getSorobanMetrics(): SorobanMetricsSnapshot {
  const avg =
    state.batchSize.count > 0
      ? Math.round(state.batchSize.sum / state.batchSize.count)
      : 0;
  return {
    callsTotal: { ...state.callsTotal },
    retryAttemptsTotal: { ...state.retryAttemptsTotal },
    batchesTotal: { ...state.batchesTotal },
    batchSize: {
      sum: state.batchSize.sum,
      count: state.batchSize.count,
      max: state.batchSize.max,
      ...(state.batchSize.count > 0 ? { avg } : {}),
    } as SorobanMetricsSnapshot["batchSize"],
    deadLetteredTotal: state.deadLetteredTotal,
    divergencesDetectedTotal: state.divergencesDetectedTotal,
  };
}

/** Test helper — wipes all counters. */
export function resetSorobanMetrics(): void {
  state.callsTotal = {};
  state.retryAttemptsTotal = {};
  state.batchesTotal = {};
  state.batchSize = { sum: 0, count: 0, max: 0 };
  state.deadLetteredTotal = 0;
  state.divergencesDetectedTotal = 0;
}