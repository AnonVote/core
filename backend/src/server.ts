import app from "./app";
import { config } from "./config";
import { startScheduler } from "./utils/scheduler";
import { startStellarRetryWorker } from "./workers/stellarRetryWorker";

export function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`AnonVote backend running on port ${config.port}`);
    startScheduler();
    startStellarRetryWorker();
  });
  return server;
}

if (require.main === module) {
  startServer();
}
