import { startServer } from "./server";
import { ensureAllOrganizationKeys } from "./services/organizationKeyService";

async function bootstrap() {
  // Ensure all organizations have encryption keys
  console.log("[Startup] Ensuring organization encryption keys...");
  await ensureAllOrganizationKeys();

  // server.ts owns the listen call (and the Stellar retry worker) — bind once.
  startServer();
}

bootstrap().catch((err) => {
  console.error("[Startup] Failed to start server:", err);
  process.exit(1);
});
