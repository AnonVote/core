/**
 * http-error-handling.ts
 *
 * Demonstrates proper error handling with the AnonVoteClient HTTP SDK:
 *   1. Catching AuthError for authentication failures
 *   2. Catching BallotNotFoundError for missing resources
 *   3. Catching InvalidTokenError for token issues
 *   4. Catching BallotClosedError for closed ballots
 *   5. Catching TimeoutError for request timeouts
 *   6. Handling network errors with retry logic
 *   7. Using the error hierarchy to catch all SDK errors
 *
 * Run with: npx tsx examples/http-error-handling.ts
 */

import { AnonVoteClient } from "../src/client/AnonVoteClient";
import {
  InvalidTokenError,
  BallotClosedError,
  BallotNotFoundError,
  AuthError,
  TimeoutError,
} from "../src/client/errors";
import { AnonVoteError, ValidationError } from "../src/errors";
import { HttpError } from "../src/retry";

async function demonstrateErrorHandling() {
  const client = new AnonVoteClient({
    apiUrl: "https://api.example.com",
    ballotEncryptionKey: "a".repeat(64),
    authToken: "invalid-token",
    timeoutMs: 5000,
  });

  console.log("=".repeat(60));
  console.log("HTTP Error Handling Examples");
  console.log("=".repeat(60));

  // 1. AuthError - Invalid authentication
  console.log("\n[1] Handling AuthError:");
  try {
    await client.createBallot(
      "Test Ballot",
      "Description",
      ["A", "B"],
      new Date().toISOString(),
    );
  } catch (err) {
    if (err instanceof AuthError) {
      console.log(`  ✓ Caught AuthError: ${err.message}`);
      console.log(`    → Action: Check your auth token and retry`);
    }
  }

  // 2. BallotNotFoundError - Resource doesn't exist
  console.log("\n[2] Handling BallotNotFoundError:");
  try {
    await client.getBallotResults("nonexistent-ballot-id");
  } catch (err) {
    if (err instanceof BallotNotFoundError) {
      console.log(`  ✓ Caught BallotNotFoundError: ${err.message}`);
      console.log(`    → Action: Verify ballot ID or check if deleted`);
    }
  }

  // 3. InvalidTokenError - Token already used or invalid
  console.log("\n[3] Handling InvalidTokenError:");
  try {
    await client.submitVote("ballot-123", "used-token", "Option A");
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      console.log(`  ✓ Caught InvalidTokenError: ${err.message}`);
      console.log(`    → Action: Token already used, cannot vote again`);
    }
  }

  // 4. BallotClosedError - Voting period ended
  console.log("\n[4] Handling BallotClosedError:");
  try {
    await client.submitVote("closed-ballot", "valid-token", "Option A");
  } catch (err) {
    if (err instanceof BallotClosedError) {
      console.log(`  ✓ Caught BallotClosedError: ${err.message}`);
      console.log(`    → Action: Ballot is closed, votes no longer accepted`);
    }
  }

  // 5. ValidationError - Client-side validation
  console.log("\n[5] Handling ValidationError:");
  try {
    await client.createBallot("", "Description", ["A", "B"], "2026-12-31");
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log(`  ✓ Caught ValidationError: ${err.message}`);
      console.log(`    → Action: Fix input and retry`);
    }
  }

  // 6. TimeoutError - Request took too long
  console.log("\n[6] Handling TimeoutError:");
  const slowClient = new AnonVoteClient({
    apiUrl: "https://api.example.com",
    ballotEncryptionKey: "a".repeat(64),
    timeoutMs: 100, // Very short timeout for demo
  });
  try {
    await slowClient.getBallotResults("ballot-123");
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.log(`  ✓ Caught TimeoutError: ${err.message}`);
      console.log(`    → Action: Increase timeout or check network`);
    }
  }

  // 7. HttpError - Generic HTTP error
  console.log("\n[7] Handling HttpError:");
  try {
    await client.uploadVoters("ballot-123", ["voter@example.com"]);
  } catch (err) {
    if (err instanceof HttpError) {
      console.log(`  ✓ Caught HttpError [${err.statusCode}]: ${err.message}`);
      console.log(`    → Action: Check API status or contact support`);
    }
  }

  // 8. Catch all SDK errors with base class
  console.log("\n[8] Using AnonVoteError base class:");
  try {
    await client.submitVote("", "", "");
  } catch (err) {
    if (err instanceof AnonVoteError) {
      console.log(`  ✓ Caught via base class: ${err.constructor.name}`);
      console.log(`    Message: ${err.message}`);
      console.log(`    → This catches all SDK-specific errors`);
    }
  }

  // 9. Type-safe error handling pattern
  console.log("\n[9] Type-safe error handling pattern:");
  async function safeVoteSubmission(
    ballotId: string,
    token: string,
    option: string,
  ) {
    try {
      const result = await client.submitVote(ballotId, token, option);
      return { success: true, data: result };
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        return { success: false, error: "TOKEN_USED" };
      } else if (err instanceof BallotClosedError) {
        return { success: false, error: "BALLOT_CLOSED" };
      } else if (err instanceof BallotNotFoundError) {
        return { success: false, error: "BALLOT_NOT_FOUND" };
      } else if (err instanceof ValidationError) {
        return { success: false, error: "INVALID_INPUT" };
      } else {
        return { success: false, error: "UNKNOWN" };
      }
    }
  }

  const result = await safeVoteSubmission("ballot-123", "token", "Option A");
  console.log(`  ✓ Safe submission result:`, result);

  // 10. Retry behavior with transient errors
  console.log("\n[10] Automatic retry on transient errors:");
  console.log("  ℹ The client automatically retries on:");
  console.log("    - Network errors (ECONNREFUSED, ETIMEDOUT)");
  console.log("    - HTTP 500, 502, 503, 504 (server errors)");
  console.log("    - HTTP 408, 429 (timeout, rate limit)");
  console.log("  ℹ It does NOT retry on:");
  console.log("    - HTTP 4xx (client errors, except 408/429)");
  console.log("    - ValidationError (bad input)");
  console.log("    - AuthError (authentication failure)");

  console.log("\n" + "=".repeat(60));
  console.log("Error handling demonstration complete");
  console.log("=".repeat(60));
}

// Export for testing
export { demonstrateErrorHandling };

if (require.main === module) {
  demonstrateErrorHandling().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
}
