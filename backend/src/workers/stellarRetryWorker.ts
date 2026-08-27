/**
 * Stellar/Soroban Retry Worker (issue #77).
 *
 * Drains the LEGACY `stellar_retry_queue` table (populated by pre-batching
 * deployments) into the VoteSubmissionBatcher, which performs the actual
 * on-chain anchoring with batching, exponential-backoff retries, circuit
 * breaking and dead-lettering. Once a row's votes are handed to the batcher
 * the queue entry is removed — all further retry semantics live in the
 * batcher/resilience layer, not here.
 */
import { createHash } from "crypto";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";
import { getVoteSubmissionBatcher } from "../services/voteSubmissionBatcher";
import { logger } from "../utils/logger";

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export async function processStellarRetryQueue(): Promise<number> {
  if (isProcessing) return 0;
  isProcessing = true;

  let drained = 0;
  try {
    const pendingItems = await prisma.stellarRetryQueue.findMany({
      where: { retryCount: { lt: 5 } },
      include: { vote: true },
      take: 20,
    });

        const batcher = getVoteSubmissionBatcher();

    for (const item of pendingItems) {
      if (!item.vote) {
        await prisma.stellarRetryQueue
          .delete({ where: { id: item.id } })
          .catch((err) =>
            logger.warn("stellar_retry_queue_orphan_delete_failed", {
              queueItemId: item.id,
              error: err,
            }),
          );
        continue;
      }

        // Votes anchored before the batching migration have no stored
      // vote_id_hash. Derive a stable one from the vote id — it is unique and
      // deterministic, so replays stay idempotent under the contract guard.
      const voteIdHash =
        item.vote.voteIdHash ??
        createHash("sha256").update(`legacy-vote:${item.vote.id}`).digest("hex");

      batcher.enqueue({
        voteId: item.vote.id,
        ballotId: item.vote.ballotId,
        ballotIdHash: hashIdentifier(item.vote.ballotId),
        voteIdHash,
      });
      drained += 1;

      await prisma.stellarRetryQueue
        .delete({ where: { id: item.id } })
        .catch((err) =>
          logger.warn("stellar_retry_queue_drain_delete_failed", {
            queueItemId: item.id,
            error: err,
          }),
        );
    }

    if (drained > 0) {
      logger.info("stellar_retry_queue_drained", {
        count: drained,
        message:
          "Legacy retry-queue votes handed to the submission batcher for anchored retry.",
      });
    }
  } catch (err) {
    console.error("[StellarRetryWorker] Error in queue processing loop:", err);
  } finally {
    isProcessing = false;
  }

  return drained;
}

export function startStellarRetryWorker(intervalMs = 60000): void {
  if (timer) return;
  console.log(
    `[StellarRetryWorker] Starting background worker (interval: ${intervalMs}ms)`,
  );
  timer = setInterval(() => {
    processStellarRetryQueue().catch((err) => {
      console.error("[StellarRetryWorker] Unhandled error:", err);
    });
  }, intervalMs);
}

export function stopStellarRetryWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[StellarRetryWorker] Stopped background worker");
  }
}
