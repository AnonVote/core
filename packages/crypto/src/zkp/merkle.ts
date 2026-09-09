/**
 * @anonvote/crypto - Merkle Tree Commitments and Inclusion Proofs
 *
 * Implements cryptographic commitment trees for vote ballots.
 * Voters can independently verify that their encrypted ballot commitment is
 * included in the on-chain Merkle root on Stellar without revealing their identity or vote.
 */

import { getNodeCrypto } from "../random";
import type { MerkleProof, MerkleTreeCommitment } from "./types";
import { ValidationError } from "../errors";

/**
 * Computes SHA-256 hash of data string.
 */
function sha256(data: string): string {
  return getNodeCrypto().createHash("sha256").update(data).digest("hex");
}

/**
 * Computes the parent node hash of two children: H(left || right).
 */
function hashPair(left: string, right: string): string {
  return sha256(left + right);
}

/**
 * Builds a Merkle tree from a list of leaf hashes (e.g. vote receipts / commitments).
 */
export function buildMerkleTree(leafHashes: string[]): {
  root: string;
  layers: string[][];
  commitment: MerkleTreeCommitment;
} {
  if (!Array.isArray(leafHashes) || leafHashes.length === 0) {
    throw new ValidationError("Merkle tree requires at least one leaf hash");
  }

  const layers: string[][] = [leafHashes.slice()];
  let currentLayer = layers[0];

  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      // If odd number of nodes, duplicate the last node
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
      nextLayer.push(hashPair(left, right));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  const root = currentLayer[0];

  return {
    root,
    layers,
    commitment: {
      root,
      leafCount: leafHashes.length,
      depth: layers.length,
      calculatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Generates an inclusion proof (audit path) for a specific leaf index.
 */
export function generateMerkleProof(
  leafHashes: string[],
  leafIndex: number,
): MerkleProof {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new ValidationError(
      `Leaf index ${leafIndex} out of bounds [0, ${leafHashes.length - 1}]`,
    );
  }

  const { root, layers } = buildMerkleTree(leafHashes);
  const targetLeaf = leafHashes[leafIndex];
  const siblings: string[] = [];
  const directions: ("left" | "right")[] = [];

  let currentIndex = leafIndex;

  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const isRightChild = currentIndex % 2 === 1;
    const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

    if (siblingIndex < layer.length) {
      siblings.push(layer[siblingIndex]);
      directions.push(isRightChild ? "left" : "right");
    } else {
      // Duplicated leaf
      siblings.push(layer[currentIndex]);
      directions.push("right");
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf: targetLeaf,
    index: leafIndex,
    siblings,
    directions,
    root,
  };
}

/**
 * Verifies a Merkle inclusion proof against a known Merkle root.
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  if (!proof || !proof.leaf || !proof.root || !Array.isArray(proof.siblings)) {
    return false;
  }

  let currentHash = proof.leaf;

  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    const direction = proof.directions[i];

    if (direction === "left") {
      currentHash = hashPair(sibling, currentHash);
    } else {
      currentHash = hashPair(currentHash, sibling);
    }
  }

  return currentHash.toLowerCase() === proof.root.toLowerCase();
}
