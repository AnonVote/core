import dotenv from "dotenv";
dotenv.config();

// Validate required environment variables
function validateConfig(): void {
  const errors: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is required");
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    errors.push("JWT_SECRET must be at least 32 characters");
  }

  if (!process.env.STELLAR_SECRET_KEY) {
    errors.push("STELLAR_SECRET_KEY is required");
  }

  const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY || "";
  if (dataEncryptionKey && dataEncryptionKey.length !== 64) {
    errors.push(
      "DATA_ENCRYPTION_KEY must be 64 characters (32 bytes hex)",
    );
  }

  if (process.env.SOROBAN_SERVER_URL) {
    try {
      new URL(process.env.SOROBAN_SERVER_URL);
    } catch {
      errors.push("SOROBAN_SERVER_URL must be a valid URL");
    }
  }

  const validLogLevels = new Set(["debug", "info", "warn", "error"]);
  const logLevel = process.env.LOG_LEVEL || "info";
  if (!validLogLevels.has(logLevel.toLowerCase())) {
    errors.push("LOG_LEVEL must be one of: debug, info, warn, error");
  }

  if (errors.length > 0) {
    console.error("[Config] Missing or invalid environment variables:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  if (!process.env.SOROBAN_CONTRACT_ID) {
    console.warn(
      "[Config] WARNING: SOROBAN_CONTRACT_ID is not set. " +
        "Blockchain audit trail is INACTIVE — all on-chain audit calls will be skipped. " +
        "See contracts/README.md to deploy the contract and set SOROBAN_CONTRACT_ID.",
    );
  }
}

validateConfig();

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: "8h",
  stellarSecretKey: process.env.STELLAR_SECRET_KEY || "",
  stellarNetwork: process.env.STELLAR_NETWORK || "testnet",
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || "",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "AnonVote <noreply@anonvote.app>",
  sorobanContractId: process.env.SOROBAN_CONTRACT_ID || "",
  sorobanServerUrl: process.env.SOROBAN_SERVER_URL || "",
  logLevel: process.env.LOG_LEVEL || "info",
  logSkipPaths: process.env.LOG_SKIP_PATHS || "/health,/healthz,/api/health",

  // ── Soroban transaction batching ───────────────────────────────────────────
  // Votes are anchored in batches to amortise Stellar fees. A batch is
  // submitted once it holds voteBatchSize votes OR voteBatchTimeoutMs has
  // elapsed since the first queued vote — whichever comes first.
  voteBatchSize: parsePositiveInt(process.env.VOTE_BATCH_SIZE, 100),
  voteBatchTimeoutMs: parsePositiveInt(
    process.env.VOTE_BATCH_TIMEOUT_MS,
    30_000,
  ),

  // ── Soroban retry semantics ────────────────────────────────────────────────
  // Exponential backoff: baseDelay * 2^attempt (1s, 2s, 4s, …) capped at
  // sorobanMaxAttempts total tries. Only retry-safe errors are retried;
  // permanent contract errors fail fast into the dead letter queue.
  sorobanMaxAttempts: parsePositiveInt(process.env.SOROBAN_MAX_ATTEMPTS, 3),
  sorobanRetryBaseDelayMs: parsePositiveInt(
    process.env.SOROBAN_RETRY_BASE_DELAY_MS,
    1000,
  ),
  sorobanCircuitBreakerThreshold: parsePositiveFloat(
    process.env.SOROBAN_CIRCUIT_BREAKER_THRESHOLD,
    0.5,
  ),
  sorobanCircuitBreakerDurationMs: parsePositiveInt(
    process.env.SOROBAN_CIRCUIT_BREAKER_DURATION_MS,
    15_000,
  ),
  sorobanCircuitBreakerSampleSize: parsePositiveInt(
    process.env.SOROBAN_CIRCUIT_BREAKER_SAMPLE_SIZE,
    20,
  ),

  // ── Contract state synchronisation ─────────────────────────────────────────
  // Background job cadence for comparing contract counters against the DB.
  contractStateSyncIntervalMs: parsePositiveInt(
    process.env.CONTRACT_STATE_SYNC_INTERVAL_MS,
    60_000,
  ),
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const parsed = parseFloat(raw || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
