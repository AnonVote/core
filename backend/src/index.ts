import app from "./app";
import { config } from "./config";
import { startScheduler } from "./utils/scheduler";
import { ensureAllOrganizationKeys } from "./services/organizationKeyService";

async function bootstrap() {
  // Ensure all organizations have encryption keys
  console.log("[Startup] Ensuring organization encryption keys...");
  await ensureAllOrganizationKeys();
  
  app.listen(config.port, () => {
    console.log(`AnonVote backend running on port ${config.port}`);
    startScheduler();
  });
}

bootstrap().catch((err) => {
  console.error("[Startup] Failed to start server:", err);
  process.exit(1);
});
