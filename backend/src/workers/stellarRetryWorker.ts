import { prisma } from "../prisma/client";
import { sorobanRecordVote } from "../services/sorobanService";
import { hashIdentifier } from "../utils/crypto";

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export async function processStellarRetryQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const pendingItems = await prisma.stellarRetryQueue.findMany({
      where: {
        retryCount: { lt: 5 },
      },
      include: {
        vote: true,
      },
      take: 20,
    });

    for (const item of pendingItems) {
      if (!item.vote) {
        await prisma.stellarRetryQueue.delete({ where: { id: item.id } }).catch(() => {});
        continue;
      }

      const ballotIdHash = hashIdentifier(item.vote.ballotId);

      try {
        const txHash = await sorobanRecordVote(ballotIdHash);

        if (txHash) {
          // Success anchoring
          await prisma.$transaction([
            prisma.vote.update({
              where: { id: item.voteId },
              data: {
                stellarTxId: txHash,
                anchorStatus: "ANCHORED",
              },
            }),
            prisma.stellarRetryQueue.delete({
              where: { id: item.id },
            }),
          ]);
          console.log(`[StellarRetryWorker] Anchored vote ${item.voteId} with tx ${txHash}`);
        } else {
          // Soroban call returned empty/failed
          const newRetryCount = item.retryCount + 1;
          if (newRetryCount >= 5) {
            await prisma.$transaction([
              prisma.vote.update({
                where: { id: item.voteId },
                data: { anchorStatus: "FAILED" },
              }),
              prisma.stellarRetryQueue.update({
                where: { id: item.id },
                data: { retryCount: newRetryCount },
              }),
            ]);
            console.warn(
              `[StellarRetryWorker] Vote ${item.voteId} reached max retries (5). Marked FAILED permanently for manual review.`
            );
          } else {
            await prisma.stellarRetryQueue.update({
              where: { id: item.id },
              data: { retryCount: newRetryCount },
            });
          }
        }
      } catch (err) {
        console.error(`[StellarRetryWorker] Error retrying vote ${item.voteId}:`, err);
        const newRetryCount = item.retryCount + 1;
        if (newRetryCount >= 5) {
          await prisma.$transaction([
            prisma.vote.update({
              where: { id: item.voteId },
              data: { anchorStatus: "FAILED" },
            }),
            prisma.stellarRetryQueue.update({
              where: { id: item.id },
              data: { retryCount: newRetryCount },
            }),
          ]).catch(() => {});
        } else {
          await prisma.stellarRetryQueue.update({
            where: { id: item.id },
            data: { retryCount: newRetryCount },
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("[StellarRetryWorker] Error in queue processing loop:", err);
  } finally {
    isProcessing = false;
  }
}

export function startStellarRetryWorker(intervalMs = 60000): void {
  if (timer) return;
  console.log(`[StellarRetryWorker] Starting background worker (interval: ${intervalMs}ms)`);
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
