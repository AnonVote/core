/**
 * tests/zkp-proofs.test.ts
 *
 * Tests for Zero-Knowledge Proofs:
 * - Binary 1-of-2 validity proofs
 * - 1-of-k Ballot validity proofs (single selection constraint)
 * - Tally decryption proofs
 * - Rejection of forged and tampered proofs
 */

import { generatePaillierKeyPair, encryptPaillier } from "../src/zkp/paillier";
import {
  generateBinaryValidityProof,
  verifyBinaryValidityProof,
  createHomomorphicVote,
  verifyHomomorphicVote,
  tallyHomomorphicVotes,
  verifyTallyDecryptionProof,
} from "../src/zkp/proofs";

describe("Zero-Knowledge Proofs Subsystem", () => {
  const keyPair = generatePaillierKeyPair(128);

  describe("Binary 1-of-2 Validity Proof (CDS94)", () => {
    it("generates and verifies valid proof for bit 0", () => {
      const { ciphertext, r } = encryptPaillier(0, keyPair.publicKey);
      const proof = generateBinaryValidityProof(0, ciphertext, r, keyPair.publicKey);
      const isValid = verifyBinaryValidityProof(proof, ciphertext, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it("generates and verifies valid proof for bit 1", () => {
      const { ciphertext, r } = encryptPaillier(1, keyPair.publicKey);
      const proof = generateBinaryValidityProof(1, ciphertext, r, keyPair.publicKey);
      const isValid = verifyBinaryValidityProof(proof, ciphertext, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it("fails verification if proof components are tampered", () => {
      const { ciphertext, r } = encryptPaillier(1, keyPair.publicKey);
      const proof = generateBinaryValidityProof(1, ciphertext, r, keyPair.publicKey);
      const tamperedProof = {
        ...proof,
        z0: (BigInt("0x" + proof.z0) + 1n).toString(16),
      };
      const isValid = verifyBinaryValidityProof(tamperedProof, ciphertext, keyPair.publicKey);
      expect(isValid).toBe(false);
    });

    it("fails verification if ciphertext encrypts invalid value (e.g. 2)", () => {
      const { ciphertext, r } = encryptPaillier(2, keyPair.publicKey);
      // Attempting to generate proof claiming it's 0 or 1 will fail verification
      const fakeProof = generateBinaryValidityProof(0, ciphertext, r, keyPair.publicKey);
      const isValid = verifyBinaryValidityProof(fakeProof, ciphertext, keyPair.publicKey);
      expect(isValid).toBe(false);
    });
  });

  describe("Full Ballot Validity Proof (1-of-k vector + Sum-to-1)", () => {
    it("creates and verifies valid ballot for chosen option", () => {
      const vote = createHomomorphicVote(1, 3, "ballot-123", keyPair.publicKey);
      const report = verifyHomomorphicVote(vote, keyPair.publicKey);

      expect(report.isValid).toBe(true);
      expect(report.ballotId).toBe("ballot-123");
      expect(report.optionCount).toBe(3);
      expect(vote.receiptHash).toHaveLength(64);
    });

    it("verifies ballots across various option indices", () => {
      for (let selected = 0; selected < 4; selected++) {
        const vote = createHomomorphicVote(selected, 4, `ballot-${selected}`, keyPair.publicKey);
        const report = verifyHomomorphicVote(vote, keyPair.publicKey);
        expect(report.isValid).toBe(true);
      }
    });

    it("rejects tampered encrypted ciphertext inside ballot", () => {
      const vote = createHomomorphicVote(0, 3, "ballot-123", keyPair.publicKey);
      const tamperedVote = {
        ...vote,
        encryptedVector: [
          { c: (BigInt("0x" + vote.encryptedVector[0].c) + 1n).toString(16) },
          vote.encryptedVector[1],
          vote.encryptedVector[2],
        ],
      };

      const report = verifyHomomorphicVote(tamperedVote, keyPair.publicKey);
      expect(report.isValid).toBe(false);
    });

    it("rejects tampered sum proof", () => {
      const vote = createHomomorphicVote(2, 4, "ballot-456", keyPair.publicKey);
      const tamperedVote = {
        ...vote,
        validityProof: {
          ...vote.validityProof,
          sumProof: {
            ...vote.validityProof.sumProof,
            response: (BigInt("0x" + vote.validityProof.sumProof.response) + 1n).toString(16),
          },
        },
      };

      const report = verifyHomomorphicVote(tamperedVote, keyPair.publicKey);
      expect(report.isValid).toBe(false);
    });

    it("throws error for out-of-bounds selectedIndex", () => {
      expect(() => createHomomorphicVote(5, 3, "ballot-err", keyPair.publicKey)).toThrow();
      expect(() => createHomomorphicVote(-1, 3, "ballot-err", keyPair.publicKey)).toThrow();
    });
  });

  describe("Tally Decryption Proof", () => {
    it("tallies multiple homomorphic votes and verifies tally proof", () => {
      // 5 voters vote across 3 options:
      // Voter 1: Option 0
      // Voter 2: Option 1
      // Voter 3: Option 0
      // Voter 4: Option 2
      // Voter 5: Option 0
      // Expected totals: Option 0 = 3, Option 1 = 1, Option 2 = 1
      const votes = [
        createHomomorphicVote(0, 3, "b-1", keyPair.publicKey),
        createHomomorphicVote(1, 3, "b-2", keyPair.publicKey),
        createHomomorphicVote(0, 3, "b-3", keyPair.publicKey),
        createHomomorphicVote(2, 3, "b-4", keyPair.publicKey),
        createHomomorphicVote(0, 3, "b-5", keyPair.publicKey),
      ];

      const tallyProof = tallyHomomorphicVotes(
        votes,
        keyPair.publicKey,
        keyPair.privateKey,
        "mock-merkle-root-abc",
      );

      expect(tallyProof.tallyResults).toEqual([3, 1, 1]);
      expect(tallyProof.totalBallotsCounted).toBe(5);
      expect(tallyProof.ballotsMerkleRoot).toBe("mock-merkle-root-abc");

      const isTallyValid = verifyTallyDecryptionProof(tallyProof, keyPair.publicKey);
      expect(isTallyValid).toBe(true);
    });

    it("rejects tampered tally results in proof", () => {
      const votes = [
        createHomomorphicVote(0, 2, "b-1", keyPair.publicKey),
        createHomomorphicVote(1, 2, "b-2", keyPair.publicKey),
      ];

      const tallyProof = tallyHomomorphicVotes(votes, keyPair.publicKey, keyPair.privateKey);
      const tamperedTally = {
        ...tallyProof,
        tallyResults: [100, 1], // forged total
      };

      const isTallyValid = verifyTallyDecryptionProof(tamperedTally, keyPair.publicKey);
      expect(isTallyValid).toBe(false);
    });
  });
});
