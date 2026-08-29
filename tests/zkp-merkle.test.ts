/**
 * tests/zkp-merkle.test.ts
 *
 * Tests for Merkle tree commitments and inclusion proofs.
 */

import {
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from "../src/zkp/merkle";

describe("Merkle Tree Commitments and Inclusion Proofs", () => {
  const leaves = [
    "3d0a9f2e8b4c7a1d5e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d",
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "f0e1d2c3b4a59887766554433221100ffeeddccbbaa99887766554433221100f",
    "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  ];

  it("builds a Merkle tree and generates deterministic root", () => {
    const tree = buildMerkleTree(leaves);
    expect(tree.root).toHaveLength(64);
    expect(tree.commitment.leafCount).toBe(4);
    expect(tree.commitment.depth).toBeGreaterThan(1);
  });

  it("generates and verifies valid inclusion proofs for all leaves", () => {
    for (let i = 0; i < leaves.length; i++) {
      const proof = generateMerkleProof(leaves, i);
      expect(proof.leaf).toBe(leaves[i]);
      expect(proof.index).toBe(i);
      const isValid = verifyMerkleProof(proof);
      expect(isValid).toBe(true);
    }
  });

  it("handles odd number of leaves gracefully by duplication", () => {
    const oddLeaves = leaves.slice(0, 3);
    const tree = buildMerkleTree(oddLeaves);
    expect(tree.root).toHaveLength(64);

    for (let i = 0; i < oddLeaves.length; i++) {
      const proof = generateMerkleProof(oddLeaves, i);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it("rejects proof with altered leaf", () => {
    const proof = generateMerkleProof(leaves, 0);
    const tamperedProof = {
      ...proof,
      leaf: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it("rejects proof with altered sibling", () => {
    const proof = generateMerkleProof(leaves, 1);
    const tamperedProof = {
      ...proof,
      siblings: ["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],
    };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it("throws error for out-of-bounds leaf index", () => {
    expect(() => generateMerkleProof(leaves, -1)).toThrow();
    expect(() => generateMerkleProof(leaves, 10)).toThrow();
  });
});
