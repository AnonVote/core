/**
 * examples/zk-vote-verification.ts
 *
 * Demonstrates an end-to-end Zero-Knowledge Proof (ZKP) and Additive Homomorphic
 * voting workflow without backend decryption of individual votes.
 *
 * Workflow steps:
 * 1. Key Generation (Paillier public key for election, threshold trustee keys)
 * 2. Ballot Creation (3 options: Approve, Reject, Abstain)
 * 3. Vote Casting with NIZK Proof (1-of-k selection proof + Sum-to-1 proof)
 * 4. Third-Party Vote Validity Auditing (verifying ZKP without decrypting)
 * 5. Merkle Commitment & Inclusion Proof (Voter audits inclusion on-chain)
 * 6. Homomorphic Tally Aggregation (Summing encrypted votes algebraically)
 * 7. Threshold / Auditable Decryption with Proof of Correctness
 */

import {
  generatePaillierKeyPair,
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
  generateThresholdKeyShares,
  generatePartialDecryption,
  combineThresholdDecryptions,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
  aggregatePaillier,
} from "../src/index";

export async function main(): Promise<void> {
  console.log("===============================================================");
  console.log(" AnonVote Zero-Knowledge Proof (ZKP) Vote Verification Demo");
  console.log("===============================================================\n");

  // Step 1: Election Setup & Key Generation
  console.log("1. Setting up election & generating Paillier homomorphic keypair...");
  const keyPair = generatePaillierKeyPair(2048);
  console.log(`   Public Modulus n: ${keyPair.publicKey.n.slice(0, 32)}... (${keyPair.publicKey.bits} bits)`);

  const electionId = "elec-governance-2026-q3";
  const options = ["Option A (Approve)", "Option B (Reject)", "Option C (Abstain)"];
  console.log(`   Ballot ID: ${electionId}`);
  console.log(`   Options: ${options.join(", ")}\n`);

  // Step 2: Casting Votes with Zero-Knowledge Proofs
  console.log("2. Voters casting homomorphic ballots with Non-Interactive ZKPs...");
  // Voter 1 votes Option 0 (Approve)
  // Voter 2 votes Option 0 (Approve)
  // Voter 3 votes Option 2 (Abstain)
  // Voter 4 votes Option 1 (Reject)
  // Voter 5 votes Option 0 (Approve)
  const votesData = [
    { voter: "Alice", choice: 0 },
    { voter: "Bob", choice: 0 },
    { voter: "Charlie", choice: 2 },
    { voter: "Dave", choice: 1 },
    { voter: "Eve", choice: 0 },
  ];

  const encryptedBallots = votesData.map(({ voter, choice }) => {
    const ballot = encryptVoteHomomorphic(choice, options.length, electionId, keyPair.publicKey);
    console.log(`   [${voter}] Encrypted vote for ${options[choice]} -> Receipt: ${ballot.receiptHash.slice(0, 16)}...`);
    return ballot;
  });
  console.log("");

  // Step 3: Verifying ZKPs for all submitted ballots without decrypting
  console.log("3. Auditing ballot validity via Zero-Knowledge Proofs (No Decryption)...");
  for (let i = 0; i < encryptedBallots.length; i++) {
    const report = verifyVoteZKP(encryptedBallots[i], keyPair.publicKey);
    console.log(`   Ballot #${i + 1} ZKP Validity: ${report.isValid ? "VALID (PASSED)" : "FAILED"}`);
    if (!report.isValid) {
      throw new Error(`Ballot #${i + 1} proof verification failed: ${report.error}`);
    }
  }
  console.log("   All ballots proven to be well-formed single selections!\n");

  // Step 4: Merkle Tree Commitment for On-Chain Stellar Anchor
  console.log("4. Constructing Merkle Tree Commitment of all vote receipts...");
  const receiptHashes = encryptedBallots.map((b) => b.receiptHash);
  const merkleTree = buildMerkleTree(receiptHashes);
  console.log(`   Merkle Root (anchored to Stellar): ${merkleTree.root}`);

  // Voter Alice verifies her vote was included in the Merkle root
  const aliceProof = generateMerkleProof(receiptHashes, 0);
  const isAliceIncluded = verifyMerkleProof(aliceProof);
  console.log(`   Alice verifying inclusion in on-chain root: ${isAliceIncluded ? "CONFIRMED" : "FAILED"}\n`);

  // Step 5: Additive Homomorphic Tally Aggregation (No Decryption Needed)
  console.log("5. Computing Homomorphic Tally without decrypting any individual vote...");
  const startTime = Date.now();
  const tallyProof = tallyHomomorphic(
    encryptedBallots,
    keyPair.publicKey,
    keyPair.privateKey,
    merkleTree.root,
  );
  const durationMs = Date.now() - startTime;

  console.log(`   Tally Computed in: ${durationMs}ms`);
  console.log(`   Total Ballots Counted: ${tallyProof.totalBallotsCounted}`);
  for (let opt = 0; opt < options.length; opt++) {
    console.log(`   - ${options[opt]}: ${tallyProof.tallyResults[opt]} votes`);
  }
  console.log("");

  // Step 6: Third-Party Tally Proof Verification
  console.log("6. Verifying mathematical correctness of the Tally Decryption Proof...");
  const isTallyVerified = verifyHomomorphicTallyProof(tallyProof, keyPair.publicKey);
  console.log(`   Tally Proof Verification: ${isTallyVerified ? "VERIFIED & AUDITED" : "REJECTED"}\n`);

  // Step 7: Threshold Decryption Demo (3-of-5 Trustees)
  console.log("7. K-of-N Threshold Decryption Simulation (3 of 5 Trustees)...");
  const thresholdShares = generateThresholdKeyShares(keyPair.privateKey, 3, 5);
  console.log("   Generated 5 Trustee key shares (threshold K = 3).");

  // Aggregate ciphertexts
  const agg0 = aggregatePaillier(encryptedBallots.map((b) => b.encryptedVector[0]), keyPair.publicKey);
  const agg1 = aggregatePaillier(encryptedBallots.map((b) => b.encryptedVector[1]), keyPair.publicKey);
  const agg2 = aggregatePaillier(encryptedBallots.map((b) => b.encryptedVector[2]), keyPair.publicKey);
  const aggregatedCiphertexts = [agg0, agg1, agg2];

  // Trustees 1, 2, and 4 provide partial decryption shares
  const selectedTrustees = [0, 1, 3];
  const partialShares = selectedTrustees.map((idx) =>
    generatePartialDecryption(aggregatedCiphertexts, thresholdShares[idx]),
  );

  const thresholdResult = combineThresholdDecryptions(
    partialShares,
    aggregatedCiphertexts,
    keyPair.publicKey,
    3,
    keyPair.privateKey.mu,
  );

  console.log(`   Trustees participating: [${thresholdResult.participatingTrustees.join(", ")}]`);
  console.log(`   Threshold Decryption Result: [${thresholdResult.results.join(", ")}]`);
  console.log(`   Threshold Decryption Status: ${thresholdResult.isValid ? "SUCCESS" : "FAILED"}\n`);

  console.log("===============================================================");
  console.log(" ZKP & Homomorphic Vote Verification Demo Complete!");
  console.log("===============================================================");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
