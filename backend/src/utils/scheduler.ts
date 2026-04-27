import { getOpenExpiredBallots, closeBallot } from "../services/ballotEngine";
import { tallyBallot } from "../services/resultEngine";

export function startScheduler(): void {
  console.log(
    "[Scheduler] Started — polling every 30 seconds for expired ballots",
  );

  setInterval(async () => {
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
  }, 30_000);
}
