/**
 * basic-ballot.ts
 *
 * Demonstrates the basic ballot workflow:
 *   1. Hashing a voter identifier for eligibility
 *   2. Creating an election with the SDK
 *   3. Casting a vote (encrypting the selected option)
 *   4. Verifying the encrypted ballot
 *   5. Serializing for server submission
 *
 * Run with: npx tsx examples/basic-ballot.ts
 */

import { randomBytes } from "crypto";
import {
  hashIdentifier,
  encryptVote,
  decryptVote,
  verifyVoteHash,
} from "../src/crypto";
import { AnonVoteClient } from "../src/client";

const BALLOT_KEY = randomBytes(32).toString("hex");

export async function main(): Promise<void> {
  // ── 1. Hash a voter identifier for eligibility ────────────────────────
  const voterEmail = "alice@example.com";
  const identifierHash = hashIdentifier(voterEmail);
  console.log(`Voter identifier hash: ${identifierHash.slice(0, 16)}...`);

  // ── 2. Create an election using the SDK ───────────────────────────────
  const client = new AnonVoteClient({ encryptionKey: BALLOT_KEY });

  const election = client.createElection({
    title: "Board Election 2026",
    description: "Elect two new board members for the upcoming term.",
    options: ["Alice", "Bob", "Abstain"],
    startTime: Date.now(),
    endTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  console.log(`Election created: ${election.id}`);
  console.log(`Options: ${election.options.map((o) => `${o.text} (${o.id.slice(0, 8)}...)`).join(", ")}`);

  // ── 3. Cast a vote ───────────────────────────────────────────────────
  // Select the first option ("Alice")
  const selectedOption = election.options[0];
  console.log(`\nVoting for: ${selectedOption.text}`);

  const receipt = client.castVote({
    ballotId: election.id,
    voteOption: selectedOption.text,
    encryptionKey: BALLOT_KEY,
  });

  console.log(`Receipt ID: ${receipt.id}`);
  console.log(`Encrypted payload ciphertext: ${receipt.encryptedPayload.ciphertext.slice(0, 16)}...`);

  // ── 4. Verify the encrypted vote locally ──────────────────────────────
  const isValid = client.verifyVote(receipt.encryptedPayload, BALLOT_KEY);
  console.log(`\nVote verification: ${isValid ? "PASSED" : "FAILED"}`);

  // ── 5. Demonstrate low-level encrypt/decrypt ──────────────────────────
  const optionId = selectedOption.id;
  const encrypted = encryptVote(optionId, BALLOT_KEY);
  const decrypted = decryptVote(encrypted, BALLOT_KEY);
  console.log(`\nLow-level encrypt/decrypt roundtrip: ${decrypted === optionId ? "OK" : "FAIL"}`);

  // ── 6. Verify via verifyVoteHash ──────────────────────────────────────
  const verified = verifyVoteHash(optionId, encrypted, BALLOT_KEY);
  console.log(`verifyVoteHash: ${verified ? "PASSED" : "FAILED"}`);

  // ── 7. Build a submission payload ─────────────────────────────────────
  const submissionPayload = {
    ballotId: election.id,
    token: "sample-voter-token",
    encryptedPayload: receipt.encryptedPayload,
  };
  const keys = Object.keys(submissionPayload);
  console.log(`\nSubmission payload keys: ${keys.join(", ")}`);
  console.log(`optionId excluded from payload: ${!("optionId" in submissionPayload) ? "YES" : "NO"}`);
}

// Allow running directly or importing for tests
if (require.main === module) {
  main().catch(console.error);
}
