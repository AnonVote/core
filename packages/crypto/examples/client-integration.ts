/**
 * client-integration.ts
 *
 * Demonstrates using the AnonVoteClient SDK to:
 *   1. Configure the client with a ballot encryption key
 *   2. Create an election
 *   3. Cast a vote and receive a ballot
 *   4. Verify the vote locally
 *   5. Serialize for server submission
 *   6. Deserialize a stored ballot
 *
 * This example does NOT make real HTTP requests.
 * The serialization step shows what would be sent to the backend API.
 *
 * Run with: npx tsx examples/client-integration.ts
 */

import { randomBytes } from "crypto";
import { AnonVoteClient } from "../src/client/index";

const BALLOT_KEY = randomBytes(32).toString("hex");

export interface IntegrationResult {
  electionId: string;
  voteVerified: boolean;
  serializedPayload: string;
  deserializedOptionId: string;
}

export function main(): IntegrationResult {
  // ── 1. Configure the client ───────────────────────────────────────────
  const client = new AnonVoteClient({
    ballotKey: BALLOT_KEY,
  });

  console.log("Client configured with ballot encryption key.");

  // ── 2. Create an election ─────────────────────────────────────────────
  const election = client.createElection({
    title: "Q3 Budget Vote",
    description: "Approve or reject the Q3 budget proposal.",
    options: ["Approve", "Reject", "Abstain"],
    startTime: new Date(),
    endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  console.log(`Election: ${election.title} (${election.id})`);
  console.log(`Options: ${election.options.map((o) => `${o.label} [${o.index}]`).join(", ")}`);
  console.log(`Status: ${election.status}`);

  // ── 3. Cast a vote ───────────────────────────────────────────────────
  // Select the "Approve" option (index 0)
  const selectedOption = election.options[0];
  console.log(`\nCasting vote for: ${selectedOption.label}`);

  const ballot = client.castVote(election, selectedOption.id);
  console.log(`Ballot election ID: ${ballot.electionId}`);
  console.log(`Encrypted payload has ${Object.keys(ballot.encryptedPayload).length} fields`);

  // ── 4. Verify the vote locally ────────────────────────────────────────
  const verification = client.verifyVote(ballot);
  console.log(`\nVerification: ${verification.confirmed ? "CONFIRMED" : "FAILED"}`);
  console.log(`Checked at: ${verification.checkedAt.toISOString()}`);

  // ── 5. Serialize for server submission ─────────────────────────────────
  const serialized = client.serialize(ballot);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  console.log(`\nSerialized payload keys: ${Object.keys(parsed).join(", ")}`);
  console.log(`optionId excluded from server payload: ${!("optionId" in parsed) ? "YES" : "NO"}`);

  // ── 6. Deserialize a stored ballot ────────────────────────────────────
  const restored = client.deserialize(serialized);
  console.log(`\nDeserialized election ID: ${restored.electionId}`);
  console.log(`Deserialized option ID present: ${restored.optionId !== "" ? "YES" : "NO (empty by design)"}`);

  // ── 7. Show what would be sent to the backend API ─────────────────────
  console.log("\n--- API Submission Payload ---");
  console.log("POST /api/votes");
  console.log(`Body: ${serialized.slice(0, 120)}...`);

  return {
    electionId: election.id,
    voteVerified: verification.confirmed,
    serializedPayload: serialized,
    deserializedOptionId: restored.optionId,
  };
}

if (require.main === module) {
  main();
}
