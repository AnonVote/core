/**
 * tests/zkp-integration.test.ts
 *
 * End-to-end integration tests for Zero-Knowledge Proofs and Additive
 * Homomorphic Encryption using AnonVoteClient and crypto primitives.
 */

import { AnonVoteClient } from "../src/client";
import {
  generatePaillierKeyPair,
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from "../src/index";

describe("ZKP & Homomorphic Voting End-to-End Workflow", () => {
  const paillierKeys = generatePaillierKeyPair(128);
  const client = new AnonVoteClient();

  it("completes full election lifecycle: election -> vote -> proof -> merkle -> tally -> audit", () => {
    // 1. Setup Election with 3 options
    const election = client.createElection({
      title: "Decentralized Governance Vote 2026",
      description: "Vote on Protocol Upgrade proposal #42",
      options: ["Approve", "Reject", "Abstain"],
      startTime: Date.now() - 1000,
      endTime: Date.now() + 86_400_000,
    });

    expect(election.options).toHaveLength(3);

    // 2. Three voters cast homomorphic votes:
    // Voter 1: Option 0 (Approve)
    // Voter 2: Option 0 (Approve)
    // Voter 3: Option 2 (Abstain)
    const votes = [
      client.castVoteHomomorphic({
        ballotId: election.id,
        optionIndex: 0,
        totalOptions: 3,
        publicKey: paillierKeys.publicKey,
      }),
      client.castVoteHomomorphic({
        ballotId: election.id,
        optionIndex: 0,
        totalOptions: 3,
        publicKey: paillierKeys.publicKey,
      }),
      client.castVoteHomomorphic({
        ballotId: election.id,
        optionIndex: 2,
        totalOptions: 3,
        publicKey: paillierKeys.publicKey,
      }),
    ];

    // 3. Verify each voter's Zero-Knowledge Proof independently (without decrypting)
    for (const vote of votes) {
      const audit = client.verifyVoteZKP(vote, paillierKeys.publicKey);
      expect(audit.isValid).toBe(true);
      expect(audit.ballotId).toBe(election.id);
    }

    // 4. Build Merkle tree of vote receipt commitments for on-chain anchoring
    const receiptHashes = votes.map((v) => v.receiptHash);
    const merkleTree = buildMerkleTree(receiptHashes);
    expect(merkleTree.root).toHaveLength(64);

    // 5. Voter verifies their receipt is included in Merkle tree
    const voter0Proof = generateMerkleProof(receiptHashes, 0);
    expect(verifyMerkleProof(voter0Proof)).toBe(true);

    // 6. Compute Homomorphic Tally without decrypting any individual ballot
    const tallyProof = client.tallyHomomorphic(
      votes,
      paillierKeys.publicKey,
      paillierKeys.privateKey,
      merkleTree.root,
    );

    // Expected Results: Approve = 2, Reject = 0, Abstain = 1
    expect(tallyProof.tallyResults).toEqual([2, 0, 1]);
    expect(tallyProof.totalBallotsCounted).toBe(3);
    expect(tallyProof.ballotsMerkleRoot).toBe(merkleTree.root);

    // 7. Third-party auditor verifies the tally proof against the public key and Merkle root
    const isTallyVerified = client.verifyTallyProof(tallyProof, paillierKeys.publicKey);
    expect(isTallyVerified).toBe(true);
  });

  it("works with low-level primitives standalone", () => {
    const vote = encryptVoteHomomorphic(1, 2, "ballot-abc", paillierKeys.publicKey);
    const verification = verifyVoteZKP(vote, paillierKeys.publicKey);
    expect(verification.isValid).toBe(true);

    const tally = tallyHomomorphic([vote], paillierKeys.publicKey, paillierKeys.privateKey, "root-123");
    expect(tally.tallyResults).toEqual([0, 1]);

    const isProofValid = verifyHomomorphicTallyProof(tally, paillierKeys.publicKey);
    expect(isProofValid).toBe(true);
  });
});
