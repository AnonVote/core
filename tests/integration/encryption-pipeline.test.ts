/**
 * tests/integration/encryption-pipeline.test.ts
 *
 * Scenarios 18-22 — the cryptographic pipeline end to end, from the client's
 * AES encryption through storage, tampering, and the Paillier/ZKP tally.
 *
 * The 128-bit Paillier keypair from `sharedPaillierKeys()` is built once for
 * this file and reused by every homomorphic scenario. Building a second one is
 * the fastest way to blow the suite's runtime budget.
 */

import {
  setupFixture,
  teardownFixture,
  sharedPaillierKeys,
  WRONG_BALLOT_KEY,
  type IntegrationFixture,
} from "./setupFixture";
import { VoteLifecycleSimulator } from "./voteLifecycleSimulator";
import { CryptoError } from "../../src/errors";
import { decryptVote } from "../../src/crypto";
import {
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
} from "../../src/index";
import { aggregatePaillier } from "../../src/zkp/paillier";
import {
  generateThresholdKeyShares,
  generatePartialDecryption,
  combineThresholdDecryptions,
} from "../../src/zkp/threshold";
import { buildMerkleTree } from "../../src/zkp/merkle";

describe("integration: encryption pipeline", () => {
  let fixture: IntegrationFixture;
  let sim: VoteLifecycleSimulator;

  beforeEach(() => {
    fixture = setupFixture();
    sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });
  });

  afterEach(() => {
    teardownFixture(fixture);
  });

  // Scenario 18 [real]
  it("round-trips every vote through encrypt -> store -> decrypt at tally", async () => {
    const ballot = await sim.createBallot({ options: ["Red", "Green", "Blue"] });
    await sim.issueTokens(6);

    const choices = [0, 0, 1, 2, 2, 2];
    await sim.castVotes(
      choices.map((optionIndex, tokenIndex) => ({ tokenIndex, optionIndex })),
    );

    const stored = fixture.backend.getStoredVotes(ballot.id);
    expect(stored).toHaveLength(6);

    // Every stored payload is distinct even where the plaintext repeats —
    // AES-GCM with a fresh IV per vote is what keeps the tally unlinkable.
    const ciphertexts = stored.map((v) => v.encryptedPayload.ciphertext);
    expect(new Set(ciphertexts).size).toBe(6);
    expect(new Set(stored.map((v) => v.encryptedPayload.iv)).size).toBe(6);

    // Each one decrypts back to the option UUID the voter chose.
    stored.forEach((vote, i) => {
      expect(decryptVote(vote.encryptedPayload, fixture.ballotKey)).toBe(
        ballot.options[choices[i]].id,
      );
    });

    const results = await sim.tallyVotes();
    expect(sim.countsByLabel(results)).toEqual({ Red: 2, Green: 1, Blue: 3 });
    expect(results.options.map((o) => o.percentage)).toEqual([
      33.33, 16.67, 50,
    ]);
  });

  // Scenario 19 [real]
  it("raises CryptoError when a stored ciphertext has been tampered with", async () => {
    const ballot = await sim.createBallot({ options: ["Yes", "No"] });
    await sim.issueTokens(2);
    await sim.castVotes([
      { tokenIndex: 0, optionIndex: 0 },
      { tokenIndex: 1, optionIndex: 1 },
    ]);

    // Flip the leading hex nibble of one stored ciphertext. The GCM auth tag
    // must catch it — this is the invariant that makes at-rest storage safe.
    const stored = fixture.backend.getStoredVotes(ballot.id);
    const original = stored[0].encryptedPayload.ciphertext;
    stored[0].encryptedPayload.ciphertext =
      (original[0] === "0" ? "1" : "0") + original.slice(1);

    await expect(fixture.backend.tally(ballot.id)).rejects.toBeInstanceOf(
      CryptoError,
    );

    // A tampered authTag is caught the same way.
    stored[0].encryptedPayload.ciphertext = original;
    const tag = stored[0].encryptedPayload.authTag;
    stored[0].encryptedPayload.authTag =
      (tag[0] === "0" ? "1" : "0") + tag.slice(1);

    await expect(fixture.backend.tally(ballot.id)).rejects.toBeInstanceOf(
      CryptoError,
    );
  });

  // Scenario 20 [real]
  it("raises CryptoError when the tally runs with the wrong key", async () => {
    const ballot = await sim.createBallot({ options: ["Yes", "No"] });
    await sim.issueTokens(2);
    await sim.castVotes([
      { tokenIndex: 0, optionIndex: 0 },
      { tokenIndex: 1, optionIndex: 1 },
    ]);

    await expect(
      fixture.backend.tally(ballot.id, "", WRONG_BALLOT_KEY),
    ).rejects.toBeInstanceOf(CryptoError);

    // Nothing was published, and the ledger holds no tally anchor.
    expect(fixture.ledger.getTally(ballot.id)).toBeUndefined();

    // The correct key still works — the failure was the key, not the data.
    const ok = await fixture.backend.tally(ballot.id);
    expect(ok.totalVotes).toBe(2);
  });

  // Scenario 21 [real]
  it("verifies, tallies and audits homomorphic votes with ZK proofs", () => {
    const keys = sharedPaillierKeys();
    const ballotId = "homomorphic-integration-ballot";

    // 2 votes for option 0, 1 for option 2.
    const votes = [
      encryptVoteHomomorphic(0, 3, ballotId, keys.publicKey),
      encryptVoteHomomorphic(0, 3, ballotId, keys.publicKey),
      encryptVoteHomomorphic(2, 3, ballotId, keys.publicKey),
    ];

    // Each ballot is proven well-formed without being decrypted.
    for (const vote of votes) {
      const report = verifyVoteZKP(vote, keys.publicKey);
      expect(report.isValid).toBe(true);
      expect(report.ballotId).toBe(ballotId);
      expect(report.optionCount).toBe(3);
    }

    const root = buildMerkleTree(votes.map((v) => v.receiptHash)).root;
    const proof = tallyHomomorphic(
      votes,
      keys.publicKey,
      keys.privateKey,
      root,
    );

    expect(proof.tallyResults).toEqual([2, 0, 1]);
    expect(proof.totalBallotsCounted).toBe(3);
    expect(proof.ballotsMerkleRoot).toBe(root);
    expect(verifyHomomorphicTallyProof(proof, keys.publicKey)).toBe(true);

    // A tampered validity proof is rejected rather than silently counted.
    const forged = JSON.parse(
      JSON.stringify(votes[0]),
    ) as typeof votes[0];
    forged.validityProof.optionProofs[0].z0 = "01";
    expect(verifyVoteZKP(forged, keys.publicKey).isValid).toBe(false);

    // So is a tampered tally proof.
    const forgedTally = JSON.parse(JSON.stringify(proof)) as typeof proof;
    forgedTally.tallyResults = [3, 0, 0];
    expect(verifyHomomorphicTallyProof(forgedTally, keys.publicKey)).toBe(
      false,
    );
  });

  // Scenario 22 [real]
  it("reproduces the tally through K-of-N threshold decryption", () => {
    const keys = sharedPaillierKeys();
    const K = 3;
    const N = 5;
    const ballotId = "threshold-integration-ballot";

    const votes = [
      encryptVoteHomomorphic(0, 2, ballotId, keys.publicKey),
      encryptVoteHomomorphic(0, 2, ballotId, keys.publicKey),
      encryptVoteHomomorphic(1, 2, ballotId, keys.publicKey),
    ];

    // Aggregate each option slot across all ballots.
    const aggregated = [0, 1].map((slot) =>
      aggregatePaillier(
        votes.map((v) => v.encryptedVector[slot]),
        keys.publicKey,
      ),
    );

    const shares = generateThresholdKeyShares(keys.privateKey, K, N);
    expect(shares).toHaveLength(N);

    // Trustees 1, 3 and 5 turn up — exactly K of N.
    const partials = [0, 2, 4].map((i) =>
      generatePartialDecryption(aggregated, shares[i]),
    );

    const combined = combineThresholdDecryptions(
      partials,
      aggregated,
      keys.publicKey,
      K,
      keys.privateKey.mu,
    );

    expect(combined.isValid).toBe(true);
    expect(combined.participatingTrustees).toEqual([1, 3, 5]);
    expect(combined.results).toEqual([2, 1]);

    // The threshold path agrees with the single-key homomorphic tally.
    const single = tallyHomomorphic(votes, keys.publicKey, keys.privateKey);
    expect(combined.results).toEqual(single.tallyResults);

    // Below the threshold, decryption is refused outright.
    expect(() =>
      combineThresholdDecryptions(
        partials.slice(0, K - 1),
        aggregated,
        keys.publicKey,
        K,
        keys.privateKey.mu,
      ),
    ).toThrow(CryptoError);
  });
});
