/**
 * Minimal test consumer — validates that @anonvote/crypto/client resolves
 * correctly and that the public API is usable from a consuming TypeScript project.
 *
 * Run with: npx ts-node --project tsconfig.json index.ts
 * (from the test-consumer/ directory)
 */
import { randomBytes } from "crypto";
import { AnonVoteClient } from "@anonvote/crypto/client";
import type { ClientConfig, Election, Ballot, VerificationResult } from "@anonvote/crypto/client";

// 1 — Constructor validates ballotKey at instantiation time
const ballotKey: string = randomBytes(32).toString("hex");

const config: ClientConfig = { ballotKey };
const client = new AnonVoteClient(config);

// 2 — createElection returns a typed Election
const election: Election = client.createElection({
  title: "Consumer test election",
  description: "Verifying subpath export resolves correctly.",
  options: ["Yes", "No"],
  startTime: new Date(Date.now() - 1000),
  endTime: new Date(Date.now() + 86_400_000),
});

console.log("election.id:", election.id);
console.log("options:", election.options.map((o) => `${o.label} (${o.id})`));

// 3 — castVote returns a typed Ballot
const ballot: Ballot = client.castVote(election, election.options[0].id);
console.log("ballot.electionId:", ballot.electionId);
console.log("has encryptedPayload:", !!ballot.encryptedPayload.ciphertext);

// 4 — verifyVote returns a typed VerificationResult
const result: VerificationResult = client.verifyVote(ballot);
console.log("verified:", result.confirmed); // true

// 5 — serialize omits optionId
const json = client.serialize(ballot);
const parsed = JSON.parse(json) as Record<string, unknown>;
if ("optionId" in parsed) {
  throw new Error("FAIL: optionId must not appear in serialized output");
}
console.log("serialized (no optionId):", json);

// 6 — deserialize round-trip
const restored = client.deserialize(json);
console.log("restored.electionId:", restored.electionId);
console.log("restored.optionId:", JSON.stringify(restored.optionId)); // ""

console.log("\nAll test-consumer checks passed.");
