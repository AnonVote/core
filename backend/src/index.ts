import app from "./app";
import { config } from "./config";
import { startScheduler } from "./utils/scheduler";

app.listen(config.port, () => {
  console.log(`AnonVote backend running on port ${config.port}`);
  startScheduler();
});
