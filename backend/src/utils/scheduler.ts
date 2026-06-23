import {
  getOpenExpiredBallots,
  closeBallot,
  processPendingAnchors,
} from "../services/ballotEngine";
import { tallyBallot } from "../services/resultEngine";
import { prisma } from "../prisma/client";

async function getNextDeadline(): Promise<Date | null> {
  const ballot = await prisma.ballot.findFirst({
    where: {
      status: "OPEN",
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
  // Background worker for Stellar anchoring
  setInterval(async () => {
    try {
      await processPendingAnchors();
    } catch (err) {
      console.error("[Scheduler] Anchor worker error:", err);
    }
  }, 60_000); // Check every minute

  async function processExpiredBallots(): Promise<void> {
    try {
      const expiredBallots = await getOpenExpiredBallots();
      if (expiredBallots.length === 0) return;

      console.log(
        `[Scheduler] Closing ${expiredBallots.length} expired ballot(s)`,
      );

      for (const ballot of expiredBallots) {
        try {
          await closeBallot(ballot.id);
          console.log(`[Scheduler] Closed ballot ${ballot.id}, tallying...`);
          await tallyBallot(ballot.id);
          console.log(`[Scheduler] Tally complete for ballot ${ballot.id}`);
        } catch (err) {
          console.error(
            `[Scheduler] Error processing ballot ${ballot.id}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error("[Scheduler] Poll error:", err);
    }

    // Schedule next check
    const nextDeadline = await getNextDeadline();
    if (nextDeadline) {
      const timeUntil = nextDeadline.getTime() - Date.now();
      const safeDelay = Math.max(1000, timeUntil);
      console.log(
        `[Scheduler] Next ballot expires in ${Math.round(timeUntil / 1000)}s, scheduling check`,
      );
      setTimeout(processExpiredBallots, safeDelay);
    } else {
      console.log("[Scheduler] No upcoming ballots, polling every 30 seconds");
      setTimeout(processExpiredBallots, 30_000);
    }
  }

  console.log("[Scheduler] Started — waiting for ballots to schedule checks");
  processExpiredBallots();
}
