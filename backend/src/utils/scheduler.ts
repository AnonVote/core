import { getOpenExpiredBallots, closeBallot } from "../services/ballotEngine";
import { tallyBallot } from "../services/resultEngine";
import { prisma } from "../prisma/client";
import { purgeExpiredRateLimitEntries } from "../services/voteRateLimiter";

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

  // Purge expired rate-limit entries every 10 minutes to keep the table lean
  setInterval(async () => {
    try {
      const purged = await purgeExpiredRateLimitEntries();
      if (purged > 0) {
        console.log(`[Scheduler] Purged ${purged} expired rate-limit entries`);
      }
    } catch (err) {
      console.error("[Scheduler] Rate-limit purge error:", err);
    }
  }, 10 * 60 * 1000);
}
