/**
 * tests/zkp-threshold.test.ts
 *
 * Tests for K-of-N threshold decryption and Shamir secret sharing.
 */

import { generatePaillierKeyPair, aggregatePaillier } from "../src/zkp/paillier";
import { createHomomorphicVote } from "../src/zkp/proofs";
import {
  generateThresholdKeyShares,
  generatePartialDecryption,
  combineThresholdDecryptions,
} from "../src/zkp/threshold";

describe("Threshold Decryption and Secret Sharing", () => {
  const keyPair = generatePaillierKeyPair(128);
  const thresholdK = 3;
  const totalN = 5;

  it("splits private key into N shares with threshold K", () => {
    const shares = generateThresholdKeyShares(keyPair.privateKey, thresholdK, totalN);
    expect(shares).toHaveLength(totalN);
    for (let i = 0; i < totalN; i++) {
      expect(shares[i].index).toBe(i + 1);
      expect(shares[i].threshold).toBe(thresholdK);
      expect(shares[i].totalShares).toBe(totalN);
      expect(shares[i].shareHex).toBeTruthy();
    }
  });

  it("decrypts aggregated election tally when K shares are provided", () => {
    const shares = generateThresholdKeyShares(keyPair.privateKey, thresholdK, totalN);

    // Votes: 2 for Opt 0, 1 for Opt 1
    const votes = [
      createHomomorphicVote(0, 2, "v-1", keyPair.publicKey),
      createHomomorphicVote(0, 2, "v-2", keyPair.publicKey),
      createHomomorphicVote(1, 2, "v-3", keyPair.publicKey),
    ];

    const agg0 = aggregatePaillier([votes[0].encryptedVector[0], votes[1].encryptedVector[0], votes[2].encryptedVector[0]], keyPair.publicKey);
    const agg1 = aggregatePaillier([votes[0].encryptedVector[1], votes[1].encryptedVector[1], votes[2].encryptedVector[1]], keyPair.publicKey);
    const aggregated = [agg0, agg1];

    // Pick 3 trustees (e.g. trustees 1, 3, 5)
    const trusteeIndices = [0, 2, 4];
    const partialShares = trusteeIndices.map((idx) =>
      generatePartialDecryption(aggregated, shares[idx]),
    );

    const result = combineThresholdDecryptions(
      partialShares,
      aggregated,
      keyPair.publicKey,
      thresholdK,
      keyPair.privateKey.mu,
    );

    expect(result.isValid).toBe(true);
    expect(result.results).toEqual([2, 1]);
    expect(result.participatingTrustees).toEqual([1, 3, 5]);
  });

  it("fails decryption if fewer than K shares are provided", () => {
    const shares = generateThresholdKeyShares(keyPair.privateKey, thresholdK, totalN);
    const vote = createHomomorphicVote(0, 2, "v-1", keyPair.publicKey);
    const aggregated = vote.encryptedVector;

    // Only 2 shares provided (threshold is 3)
    const partialShares = [
      generatePartialDecryption(aggregated, shares[0]),
      generatePartialDecryption(aggregated, shares[1]),
    ];

    expect(() =>
      combineThresholdDecryptions(
        partialShares,
        aggregated,
        keyPair.publicKey,
        thresholdK,
        keyPair.privateKey.mu,
      ),
    ).toThrow("Insufficient threshold shares");
  });
});
