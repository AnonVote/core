import app from "./app";
import { config } from "./config";
import { startScheduler } from "./utils/scheduler";
import { startStellarRetryWorker, stopStellarRetryWorker } from "./workers/stellarRetryWorker";
import {
  startContractStateSync,
  stopContractStateSync,
} from "./services/contractStateManager";
import { getVoteSubmissionBatcher } from "./services/voteSubmissionBatcher";

export function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`AnonVote backend running on port ${config.port}`);
    startScheduler();
    startStellarRetryWorker();
    // Issue #77: background contract→DB state reconciliation (every minute)
    // and a final batch flush on shutdown so queued votes are never lost.
    startContractStateSync();

    const shutdown = async () => {
      stopStellarRetryWorker();
      stopContractStateSync();
      await getVoteSubmissionBatcher()
        .stop()
        .catch((err) =>
          console.error("[Shutdown] Final batch flush failed:", err),
        );
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
  });
  return server;
}

if (require.main === module) {
  startServer();
}
