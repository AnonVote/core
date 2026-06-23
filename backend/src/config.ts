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

  if (!process.env.BALLOT_ENCRYPTION_KEY) {
    errors.push("BALLOT_ENCRYPTION_KEY is required");
  } else if (process.env.BALLOT_ENCRYPTION_KEY.length !== 64) {
    errors.push("BALLOT_ENCRYPTION_KEY must be 64 characters (32 bytes hex)");
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
  ballotEncryptionKey: process.env.BALLOT_ENCRYPTION_KEY || "",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "AnonVote <noreply@anonvote.app>",
  sorobanContractId: process.env.SOROBAN_CONTRACT_ID || "",
};
