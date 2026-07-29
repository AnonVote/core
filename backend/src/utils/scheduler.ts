import {
  getDraftBallotsToActivate,
  getActiveExpiredBallots,
  closeBallot,
  finaliseBallot,
  processPendingAnchors,
} from "../services/ballotEngine";
import { tallyBallot } from "../services/resultEngine";
import { prisma } from "../prisma/client";

async function getNextActiveDeadline(): Promise<Date | null> {
  const ballot = await prisma.ballot.findFirst({
    where: {
      status: "ACTIVE",
      deadline: {
        gte: new Date(),
      },
    },
    orderBy: {
      deadline: "asc",
    },
    select: {
      deadline: true,
    },
  });
  return ballot?.deadline ?? null;
}

export async function startScheduler(): Promise<void> {
  // Background worker for Stellar anchoring — runs every 60 seconds
  setInterval(async () => {
    try {
      await processPendingAnchors();
    } catch (err) {
      console.error("[Scheduler] Anchor worker error:", err);
    }
  }, 60_000);

  async function processBallotStateTransitions(): Promise<void> {
    try {
      // 1. DRAFT → ACTIVE: start_time passed or null start_time
      const draftsToActivate = await getDraftBallotsToActivate();
      if (draftsToActivate.length > 0) {
        console.log(
          `[Scheduler] Activating ${draftsToActivate.length} draft ballot(s)`,
        );
        for (const ballot of draftsToActivate) {
          try {
            await prisma.ballot.update({
              where: { id: ballot.id },
              data: { status: "ACTIVE" },
            });
            console.log(`[Scheduler] Activated ballot ${ballot.id}`);
          } catch (err) {
            console.error(
              `[Scheduler] Error activating ballot ${ballot.id}:`,
              err,
            );
          }
        }
      }

      // 2. ACTIVE → CLOSED: deadline passed
      const expiredBallots = await getActiveExpiredBallots();
      if (expiredBallots.length > 0) {
        console.log(
          `[Scheduler] Closing ${expiredBallots.length} expired ballot(s)`,
        );
        for (const ballot of expiredBallots) {
          try {
            await closeBallot(ballot.id);
            console.log(`[Scheduler] Closed ballot ${ballot.id}, tallying...`);
            await tallyBallot(ballot.id);
            console.log(`[Scheduler] Tally complete for ballot ${ballot.id}`);

            // Auto-finalise if the flag is set
            if (ballot.autoFinalise) {
              await finaliseBallot(ballot.id);
              console.log(`[Scheduler] Auto-finalised ballot ${ballot.id}`);
            }
          } catch (err) {
            console.error(
              `[Scheduler] Error processing ballot ${ballot.id}:`,
              err,
            );
          }
        }
      }
    } catch (err) {
      console.error("[Scheduler] Poll error:", err);
    }

    // Schedule next check based on next ACTIVE ballot deadline
    const nextDeadline = await getNextActiveDeadline();
    if (nextDeadline) {
      const timeUntil = nextDeadline.getTime() - Date.now();
      const safeDelay = Math.max(1000, timeUntil);
      console.log(
        `[Scheduler] Next active ballot expires in ${Math.round(timeUntil / 1000)}s, scheduling check`,
      );
      setTimeout(processBallotStateTransitions, safeDelay);
    } else {
      console.log("[Scheduler] No upcoming active ballots, polling every 30 seconds");
      setTimeout(processBallotStateTransitions, 30_000);
    }
  }

  console.log("[Scheduler] Started — waiting for ballots to schedule checks");
  processBallotStateTransitions();
}
