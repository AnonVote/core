/**
 * Vote Submission Batcher (issue #77 — Phase 2).
 *
 * Collects confirmed database votes and anchors them to the Soroban contract
 * in BATCHES: one atomic `batch_record_votes` transaction per up-to-N votes,
 * cutting per-vote Stellar fees by ~N×.
 *
 * Flush triggers (whichever comes first):
 *   - queue reaches `maxBatchSize` votes   (VOTE_BATCH_SIZE, default 100)
 *   - `flushIntervalMs` elapsed since first pending vote
 *                                        (VOTE_BATCH_TIMEOUT_MS, default 30s)
 *
 * Failure semantics:
 *   - The default transport wraps the RPC call in exponential-backoff retries
 *     (1s/2s/4s) and the Soroban circuit breaker. While the breaker is OPEN,
 *     flushes are PAUSED — votes stay queued, nothing is lost.
 *   - A whole-batch revert caused by a duplicate vote id falls back to
 *     individual idempotent submits: duplicates count as success ("backend
 *     recognizes this and continues"), genuine failures are retried too.
 *   - Votes whose submission exhausts all retries go to the DEAD LETTER QUEUE
 *     (`soroban_dead_letters`, vote.anchorStatus = FAILED) for manual replay
 *     via POST /api/admin/soroban/dead-letters/:id/replay.
 *
 * Idempotency: every vote carries a deterministic `voteIdHash`; the batcher
 * de-duplicates in-flight/recent entries, and the contract itself rejects
 * duplicate ids — resubmitting the same batch can never double-count.
 */

import { prisma } from "../prisma/client";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  isSorobanConfigured,
  sorobanHasVote,
  sorobanRecordVotesBatch,
  sorobanRecordVote,
} from "./sorobanService";
import {
  withSorobanResilience,
  SorobanCircuitOpenError,
} from "./sorobanResilient";
import { isDuplicateVoteError, classifySorobanError } from "./sorobanErrors";
import {
  recordBatch,
  recordDeadLetter,
  recordSorobanCall,
} from "./sorobanMetrics";

export interface QueuedVote {
  /** Vote.id in the database. */
  voteId: string;
  ballotId: string;
  ballotIdHash: string;
  voteIdHash: string;
}

export type BatchSubmissionResult =
  | { status: "ok"; txHash: string }
  | { status: "duplicate" }
  | { status: "paused" }
  | { status: "unconfigured" }
  | { status: "failed"; reason?: string };

export type BatchTransport = (
  entries: QueuedVote[],
) => Promise<BatchSubmissionResult>;

/** Default transport: one atomic batch tx with retry/backoff/breaker inside. */
export const defaultBatchTransport: BatchTransport = async (entries) => {
  if (!isSorobanConfigured()) {
    return { status: "unconfigured" };
  }
  try {
    const result = await withSorobanResilience(
      () => sorobanRecordVotesBatch(entries),
      { op: "batch_record_votes" },
    );
    if (result.txHash) return { status: "ok", txHash: result.txHash };
    return { status: "failed", reason: "empty tx hash" };
  } catch (err) {
    if (err instanceof SorobanCircuitOpenError) return { status: "paused" };
    if (isDuplicateVoteError(err)) return { status: "duplicate" };
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
};

const RECENT_VOTE_ID_CACHE_LIMIT = 4096;

export interface BatcherOptions {
  maxBatchSize?: number;
  flushIntervalMs?: number;
  transport?: BatchTransport;
  sleep?: (ms: number) => Promise<void>;
}

export class VoteSubmissionBatcher {
  private queue: QueuedVote[] = [];
  private queuedVoteIds = new Set<string>();
  private recentVoteIds = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private inFlightFlush: Promise<void> | null = null;
  readonly options: {
    maxBatchSize: number;
    flushIntervalMs: number;
    transport: BatchTransport;
    sleep: (ms: number) => Promise<void>;
  };
  lastFlushAt: Date | null = null;
  lastError: string | null = null;

  constructor(options: BatcherOptions = {}) {
    this.options = {
      maxBatchSize: options.maxBatchSize ?? config.voteBatchSize,
      flushIntervalMs: options.flushIntervalMs ?? config.voteBatchTimeoutMs,
      transport: options.transport ?? defaultBatchTransport,
      sleep:
        options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  /**
   * Queue a confirmed vote for batched anchoring.
   * Returns false when the vote was already queued or anchored recently
   * (idempotent replays are dropped).
   */
  enqueue(vote: QueuedVote): boolean {
    if (
      this.recentVoteIds.has(vote.voteIdHash) ||
      this.queuedVoteIds.has(vote.voteIdHash)
    ) {
      return false;
    }

    this.queue.push(vote);
    this.queuedVoteIds.add(vote.voteIdHash);

    if (!this.timer && !this.flushing) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.options.flushIntervalMs);
      // Don't keep the process alive for a pending batch in tests/CI.
      this.timer.unref?.();
    }
    if (this.queue.length >= this.options.maxBatchSize) {
      void this.flush();
    }
    return true;
  }

  /** Number of votes waiting to be anchored. */
  get size(): number {
    return this.queue.length;
  }

  stats() {
    return {
      queued: this.queue.length,
      maxBatchSize: this.options.maxBatchSize,
      flushIntervalMs: this.options.flushIntervalMs,
      lastFlushAt: this.lastFlushAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  /**
   * Submit up to maxBatchSize queued votes in one transaction.
   * Safe to call concurrently — internal lock serialises flushes; callers
   * awaiting a flush that is already running get its completion promise.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return this.inFlightFlush ?? Promise.resolve();
    }
    this.flushing = true;
    this.clearTimer();

    this.inFlightFlush = (async () => {
      try {
        while (this.queue.length > 0) {
          const batch = this.queue.splice(0, this.options.maxBatchSize);
          batch.forEach((v) => this.queuedVoteIds.delete(v.voteIdHash));

          const result = await this.options.transport(batch);

          switch (result.status) {
            case "ok":
              await this.markAnchored(batch, result.txHash);
              break;
            case "duplicate":
              await this.handleDuplicateRevert(batch);
              break;
            case "paused":
              this.requeueAtFront(batch);
              recordBatch("paused");
              logger.warn("soroban_batch_flush_paused", {
                alert: "SOROBAN_SUBMISSION_PAUSED",
                size: batch.length,
                message:
                  "Circuit breaker OPEN — batch held in queue; will retry automatically.",
              });
              return; // stop flushing; finally-block reschedules
            case "unconfigured":
              logger.warn("soroban_batch_skipped_unconfigured", {
                size: batch.length,
                message:
                  "SOROBAN_CONTRACT_ID not set — votes remain PENDING in the database.",
              });
              recordSorobanCall("batch_record_votes", "skipped");
              break;
            case "failed":
              this.lastError = result.reason ?? "batch submission failed";
              recordBatch("failed", batch.length);
              await this.deadLetterBatch(batch, this.lastError);
              break;
          }
        }
      } finally {
        this.flushing = false;
        // Anything left (e.g. re-queued after pause) — schedule another attempt.
        if (this.queue.length > 0 && !this.timer) {
          this.timer = setTimeout(
            () => void this.flush(),
            Math.min(this.options.flushIntervalMs, 5000),
          );
          this.timer.unref?.();
        }
      }
    })();

    try {
      await this.inFlightFlush;
    } finally {
      this.inFlightFlush = null;
    }
  }

  /** Shutdown hook: anchor everything still queued, then stop timers. */
  async stop(): Promise<void> {
    this.clearTimer();
    while (this.queue.length > 0) {
      await this.flush();
    }
  }

  /** Test helper — drop all state without submitting. */
  reset(): void {
    this.clearTimer();
    this.queue = [];
    this.queuedVoteIds.clear();
    this.recentVoteIds.clear();
    this.lastFlushAt = null;
    this.lastError = null;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private rememberVoteIds(batch: QueuedVote[]): void {
    for (const v of batch) this.recentVoteIds.add(v.voteIdHash);
    if (this.recentVoteIds.size > RECENT_VOTE_ID_CACHE_LIMIT) {
      this.recentVoteIds = new Set(
        [...this.recentVoteIds].slice(-RECENT_VOTE_ID_CACHE_LIMIT / 2),
      );
    }
  }

  private requeueAtFront(batch: QueuedVote[]): void {
    for (const v of [...batch].reverse()) {
      if (!this.queuedVoteIds.has(v.voteIdHash)) {
        this.queue.unshift(v);
        this.queuedVoteIds.add(v.voteIdHash);
      }
    }
  }

  private async markAnchored(
    batch: QueuedVote[],
    txHash: string,
  ): Promise<void> {
    this.lastFlushAt = new Date();
    this.lastError = null;
    this.rememberVoteIds(batch);
    recordBatch("ok", batch.length);

    for (const vote of batch) {
      await prisma.vote
        .update({
          where: { id: vote.voteId },
          data: {
            sorobanTxId: txHash,
            stellarTxId: txHash,
            anchorStatus: "ANCHORED",
          },
        })
        .catch((err) => {
          // A unique-constraint race on vote_id_hash means another worker
          // anchored it first — success by idempotency, log and move on.
          logger.warn("soroban_anchor_status_update_conflict", {
            voteId: vote.voteId,
            error: err instanceof Error ? err.message : err,
          });
        });
      // Best-effort cleanup of legacy retry-queue rows.
      await prisma.stellarRetryQueue
        .deleteMany({ where: { voteId: vote.voteId } })
        .catch(() => undefined);
    }

    logger.info("soroban_batch_anchored", {
      method: "batch_record_votes",
      batchSize: batch.length,
      txHash,
    });
  }

  /**
   * Whole batch reverted because ≥1 vote id was already recorded on-chain.
   * Re-submit individually (each idempotent): duplicates resolve to success,
   * genuinely-failing entries are retried then dead-lettered.
   */
  private async handleDuplicateRevert(batch: QueuedVote[]): Promise<void> {
    recordBatch("duplicate_fallback");
    logger.warn("soroban_batch_duplicate_revert", {
      size: batch.length,
      message:
        "batch_record_votes reverted with DuplicateVote — falling back to individual idempotent submits",
    });

    const anchored: QueuedVote[] = [];
    const failed: QueuedVote[] = [];

    for (const vote of batch) {
      try {
        // Ask the chain whether this exact vote already landed.
        const exists = await sorobanHasVote(vote.voteIdHash);
        if (exists === true) {
          anchored.push(vote);
          continue;
        }
        const txHash = await withSorobanResilience(
          () => sorobanRecordVote(vote.ballotIdHash, vote.voteIdHash),
          { op: "record_vote", skipCircuitBreaker: true, maxAttempts: 2 },
        );
        if (txHash) {
          anchored.push(vote);
        } else {
          // sorobanRecordVote swallows contract rejections (including
          // DuplicateVote) into "". Ask the chain before giving up — a vote
          // that landed on-chain in the meantime counts as anchored.
          const existsNow = await sorobanHasVote(vote.voteIdHash);
          if (existsNow === true) {
            anchored.push(vote);
          } else {
            failed.push(vote);
          }
        }
      } catch (err) {
        if (isDuplicateVoteError(err)) {
          anchored.push(vote); // contract rejected — already counted on-chain
        } else {
          failed.push(vote);
        }
      }
      await this.options.sleep(50); // gentle pacing on the fallback path
    }

    if (anchored.length > 0) {
      await this.markAnchored(anchored, `split-${Date.now()}`);
    }
    if (failed.length > 0) {
      await this.deadLetterBatch(failed, "individual resubmit failed");
    }
  }

  /** All retries exhausted — park these votes in the dead letter queue. */
  private async deadLetterBatch(
    batch: QueuedVote[],
    reason: string,
  ): Promise<void> {
    this.lastError = reason;
    for (const vote of batch) {
      recordDeadLetter();
      try {
        await prisma.$transaction([
          prisma.vote.update({
            where: { id: vote.voteId },
            data: { anchorStatus: "FAILED" },
          }),
          prisma.sorobanDeadLetter.upsert({
            where: { voteId: vote.voteId },
            create: {
              voteId: vote.voteId,
              ballotId: vote.ballotId,
              reason: reason.slice(0, 500),
              attempts: config.sorobanMaxAttempts,
            },
            update: {
              reason: reason.slice(0, 500),
              resolvedAt: null,
            },
          }),
        ]);
        logger.error("soroban_vote_dead_lettered", {
          alert: "VOTE_DEAD_LETTERED",
          voteId: vote.voteId,
          ballotId: vote.ballotId,
          reason,
          message:
            "Vote anchoring failed permanently — parked in soroban_dead_letters for manual replay.",
        });
      } catch (err) {
        logger.error("soroban_dead_letter_write_failed", {
          voteId: vote.voteId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }
}

// ── Process-wide singleton ────────────────────────────────────────────────────

let singleton: VoteSubmissionBatcher | null = null;

export function getVoteSubmissionBatcher(): VoteSubmissionBatcher {
  if (!singleton) singleton = new VoteSubmissionBatcher();
  return singleton;
}

/** Replace the singleton (tests / custom transports). Resets the old one's timers. */
export function setVoteSubmissionBatcher(batcher: VoteSubmissionBatcher): void {
  singleton?.reset();
  singleton = batcher;
}

/** Test helper — drop the singleton entirely. */
export function resetVoteSubmissionBatcher(): void {
  singleton?.reset();
  singleton = null;
}