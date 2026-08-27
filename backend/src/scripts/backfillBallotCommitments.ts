/**
 * Backfill ballot commitments for ballots created before Issue #86.
 *
 * Idempotent: a ballot whose stored commitment already matches its content is
 * left alone. Safe to re-run.
 *
 * Usage:
 *   npm run backfill:commitments            # compute + persist only
 *   npm run backfill:commitments -- --anchor  # also anchor ACTIVE ballots on-chain
 *   npm run backfill:commitments -- --dry-run
 *
 * Note: `description` is a new field, so there are no pre-existing plaintext
 * descriptions to migrate. Legacy ballots have `descriptionCiphertext = null`,
 * which canonicalizes to "" — their commitments are still computable.
 */
import { prisma } from "../prisma/client";
import { computeBallotCommitment } from "../utils/commitment";
import { hashIdentifier } from "../utils/crypto";
import { sorobanRecordBallotCommitment } from "../services/sorobanService";
import { logger } from "../utils/logger";

interface Summary {
  scanned: number;
  computed: number;
  unchanged: number;
  anchored: number;
  anchorSkipped: number;
  failed: number;
}

export async function backfillBallotCommitments(opts: {
  anchor?: boolean;
  dryRun?: boolean;
} = {}): Promise<Summary> {
  const summary: Summary = {
    scanned: 0,
    computed: 0,
    unchanged: 0,
    anchored: 0,
    anchorSkipped: 0,
    failed: 0,
  };

  const ballots = await prisma.ballot.findMany({
    where: { deletedAt: null },
    include: { options: true },
    orderBy: { createdAt: "asc" },
  });

  for (const ballot of ballots) {
    summary.scanned++;
    try {
      const commitmentHash = computeBallotCommitment({
        topic: ballot.topic,
        descriptionCiphertext: ballot.descriptionCiphertext,
        options: ballot.options,
        deadline: ballot.deadline,
      });

      if (ballot.commitmentHash === commitmentHash) {
        summary.unchanged++;
      } else if (opts.dryRun) {
        summary.computed++;
      } else {
        await prisma.ballot.update({
          where: { id: ballot.id },
          data: { commitmentHash },
        });
        summary.computed++;
      }

      // Only ACTIVE ballots are anchored: DRAFT content is still mutable, and
      // CLOSED/FINALISED ballots were never anchored under the old code path.
      if (opts.anchor && ballot.status === "ACTIVE" && !ballot.commitmentTxId) {
        if (opts.dryRun) {
          summary.anchorSkipped++;
        } else {
          const txHash = await sorobanRecordBallotCommitment(
            hashIdentifier(ballot.id),
            commitmentHash,
          );
          if (txHash) {
            await prisma.ballot.update({
              where: { id: ballot.id },
              data: {
                commitmentTxId: txHash,
                commitmentAnchoredAt: new Date(),
              },
            });
            summary.anchored++;
          } else {
            // No contract configured — the DB copy remains the fallback.
            summary.anchorSkipped++;
          }
        }
      }
    } catch (err) {
      summary.failed++;
      logger.error("backfill_commitment_failed", {
        ballotId: ballot.id,
        error: err,
      });
    }
  }

  return summary;
}

if (require.main === module) {
  const anchor = process.argv.includes("--anchor");
  const dryRun = process.argv.includes("--dry-run");

  backfillBallotCommitments({ anchor, dryRun })
    .then((summary) => {
      logger.info("backfill_commitments_complete", { ...summary, anchor, dryRun });
      console.log(
        `[Backfill] scanned=${summary.scanned} computed=${summary.computed} ` +
          `unchanged=${summary.unchanged} anchored=${summary.anchored} ` +
          `anchorSkipped=${summary.anchorSkipped} failed=${summary.failed}` +
          (dryRun ? " (dry run — nothing written)" : ""),
      );
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("[Backfill] Fatal error:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
