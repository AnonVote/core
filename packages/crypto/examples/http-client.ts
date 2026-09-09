/**
 * http-client.ts
 *
 * Example: Full HTTP API integration with AnonVoteClient
 *
 * Demonstrates the complete backend integration workflow:
 *   1. Create a ballot via the API
 *   2. Upload eligible voters
 *   3. Issue one-time tokens
 *   4. Submit encrypted votes
 *   5. Retrieve and verify results
 *
 * Run with: npx tsx examples/http-client.ts
 *
 * Required environment variables:
 *   ANONVOTE_API_URL - Backend API base URL
 *   ANONVOTE_AUTH_TOKEN - Organization auth token
 *   BALLOT_ENCRYPTION_KEY - 64-char hex encryption key
 */

import { AnonVoteClient } from "../src/client/AnonVoteClient";
import {
  InvalidTokenError,
  BallotClosedError,
  BallotNotFoundError,
  AuthError,
} from "../src/client/errors";

async function main() {
  // Check required environment variables
  const apiUrl = process.env.ANONVOTE_API_URL;
  const authToken = process.env.ANONVOTE_AUTH_TOKEN;
  const encryptionKey = process.env.BALLOT_ENCRYPTION_KEY;

  if (!apiUrl || !authToken || !encryptionKey) {
    console.error("Missing required environment variables:");
    console.error("  ANONVOTE_API_URL");
    console.error("  ANONVOTE_AUTH_TOKEN");
    console.error("  BALLOT_ENCRYPTION_KEY");
    process.exit(1);
  }

  // Initialize the HTTP client
  const client = new AnonVoteClient({
    apiUrl,
    ballotEncryptionKey: encryptionKey,
    authToken,
    timeoutMs: 30_000,
    retryConfig: {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
    },
  });

  console.log("=".repeat(60));
  console.log("AnonVote HTTP Client Integration Example");
  console.log("=".repeat(60));

  try {
    // 1. Create a ballot
    console.log("\n[1/6] Creating ballot...");
    const ballot = await client.createBallot(
      "Board Election 2026",
      "Vote for the next board members",
      ["Alice Johnson", "Bob Smith", "Charlie Davis"],
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );

    console.log(`✓ Ballot created: ${ballot.id}`);
    console.log(`  Topic: ${ballot.topic}`);
    console.log(`  Deadline: ${ballot.deadline}`);
    console.log(`  Options: ${ballot.options.map((o) => o.text).join(", ")}`);

    // 2. Upload eligible voters
    console.log("\n[2/6] Uploading voters...");
    const uploadResult = await client.uploadVoters(ballot.id, [
      "alice@example.com",
      "bob@example.com",
      "charlie@example.com",
      "diana@example.com",
      "eve@example.com",
    ]);

    console.log(`✓ Voters uploaded`);
    console.log(`  Added: ${uploadResult.added}`);
    console.log(`  Skipped: ${uploadResult.skipped}`);
    console.log(`  Eligibility List: ${uploadResult.eligibilityListId}`);

    // 3. Issue one-time voter tokens
    console.log("\n[3/6] Issuing voter tokens...");
    const tokenBatch = await client.issueBallotTokens(ballot.id);

    console.log(`✓ Tokens issued: ${tokenBatch.issued}`);
    console.log(`  Sample token: ${tokenBatch.tokens[0].substring(0, 20)}...`);

    // 4. Submit votes (simulate multiple voters)
    console.log("\n[4/6] Submitting votes...");
    const votes = [
      { token: tokenBatch.tokens[0], option: ballot.options[0].text },
      { token: tokenBatch.tokens[1], option: ballot.options[1].text },
      { token: tokenBatch.tokens[2], option: ballot.options[0].text },
    ];

    for (let i = 0; i < votes.length; i++) {
      const vote = votes[i];
      const result = await client.submitVote(
        ballot.id,
        vote.token,
        vote.option,
      );
      console.log(`  ✓ Vote ${i + 1} submitted: ${result.voteId}`);
    }

    // 5. Get ballot results
    console.log("\n[5/6] Retrieving results...");
    try {
      const results = await client.getBallotResults(ballot.id);
      console.log(`✓ Results retrieved`);
      console.log(`  Total votes: ${results.totalVotes}`);
      console.log(`  Published: ${results.publishedAt}`);
      console.log("\n  Vote breakdown:");
      for (const option of results.options) {
        console.log(
          `    ${option.text}: ${option.votes} votes (${option.percentage.toFixed(1)}%)`,
        );
      }
      if (results.stellarTxId) {
        console.log(`\n  Stellar TX: ${results.stellarTxId}`);
      }
    } catch (err) {
      if (err instanceof BallotClosedError) {
        console.log("  ⚠ Ballot still open - results not yet available");
      } else {
        throw err;
      }
    }

    // 6. Verify result integrity
    console.log("\n[6/6] Verifying results...");
    try {
      const verification = await client.verifyResults(ballot.id);
      console.log(`✓ Verification complete`);
      console.log(`  Is consistent: ${verification.isConsistent}`);
      console.log(`  Total votes: ${verification.totalVotes}`);
      console.log(`  Checked at: ${verification.checkedAt}`);
      if (verification.stellarTxId) {
        console.log(`  Stellar TX: ${verification.stellarTxId}`);
      }
    } catch (err) {
      console.log("  ⚠ Verification not yet available");
    }

    console.log("\n" + "=".repeat(60));
    console.log("Integration test completed successfully");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n" + "=".repeat(60));
    console.error("Error occurred:");
    console.error("=".repeat(60));

    if (err instanceof AuthError) {
      console.error("Authentication failed - check your ANONVOTE_AUTH_TOKEN");
    } else if (err instanceof BallotNotFoundError) {
      console.error("Ballot not found - it may have been deleted");
    } else if (err instanceof InvalidTokenError) {
      console.error("Invalid token - it may have been used already");
    } else if (err instanceof BallotClosedError) {
      console.error("Ballot is closed - voting period has ended");
    } else if (err instanceof Error) {
      console.error(`${err.name}: ${err.message}`);
    } else {
      console.error(err);
    }

    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
