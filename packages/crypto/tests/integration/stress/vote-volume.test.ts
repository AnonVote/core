/**
 * tests/integration/stress/vote-volume.test.ts
 *
 * Opt-in stress tier — excluded from CI and from `npm run test:integration`
 * by construction (the integration config matches a single directory level).
 *
 * Run with: npm run test:integration:stress
 *
 * This is where volume lives so the fast tier can stay under its 5-second
 * ceiling. Nothing here is a different kind of assertion from the fast tier;
 * it is the same invariants at a scale that would be too slow to gate a PR on.
 */

import {
  setupFixture,
  teardownFixture,
  sharedPaillierKeys,
  type IntegrationFixture,
} from "../setupFixture";
import { VoteLifecycleSimulator } from "../voteLifecycleSimulator";
import {
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
} from "../../../src/index";
import { buildMerkleTree, generateMerkleProof, verifyMerkleProof } from "../../../src/zkp/merkle";

const VOTE_COUNT = 1200;
const HOMOMORPHIC_VOTE_COUNT = 50;

describe("stress: vote volume", () => {
  let fixture: IntegrationFixture;
  let sim: VoteLifecycleSimulator;

  beforeEach(() => {
    fixture = setupFixture();
    sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
      timeoutMs: 60_000,
    });
  });

  afterEach(() => {
    teardownFixture(fixture);
  });

  it(`tallies ${VOTE_COUNT} AES votes exactly, with no lost or duplicated records`, async () => {
    const ballot = await sim.createBallot({
      options: ["Alpha", "Beta", "Gamma", "Delta"],
    });
    const tokens = await sim.issueTokens(VOTE_COUNT);
    expect(tokens).toHaveLength(VOTE_COUNT);

    const expected: Record<string, number> = {
      Alpha: 0,
      Beta: 0,
      Gamma: 0,
      Delta: 0,
    };
    const choices = Array.from({ length: VOTE_COUNT }, (_, i) => {
      const optionIndex = i % 4;
      expected[ballot.options[optionIndex].text] += 1;
      return { tokenIndex: i, optionIndex };
    });

    // Submitted in concurrent batches so the run interleaves without opening
    // 1200 simultaneous promises.
    const BATCH = 100;
    for (let start = 0; start < choices.length; start += BATCH) {
      await sim.castVotesConcurrently(choices.slice(start, start + BATCH));
    }

    expect(fixture.ledger.countVotes(ballot.id)).toBe(VOTE_COUNT);
    expect(
      new Set(fixture.ledger.getVotes(ballot.id).map((v) => v.sequence)).size,
    ).toBe(VOTE_COUNT);
    expect(fixture.backend.allTokensUsed(ballot.id)).toBe(true);

    const results = await sim.tallyVotes();
    expect(results.totalVotes).toBe(VOTE_COUNT);
    expect(sim.countsByLabel(results)).toEqual(expected);

    // Every one of the 1200 ballots is provable against the anchored root.
    const leaves = sim.getMerkleLeaves();
    expect(leaves).toHaveLength(VOTE_COUNT);
    expect(new Set(leaves).size).toBe(VOTE_COUNT);
    for (const index of [0, 1, VOTE_COUNT >> 1, VOTE_COUNT - 1]) {
      expect(verifyMerkleProof(generateMerkleProof(leaves, index))).toBe(true);
    }
    expect(buildMerkleTree(leaves).root).toBe(sim.getMerkleRoot());

    const report = await sim.verifyResult();
    expect(report.isConsistent).toBe(true);
  });

  it(`verifies and tallies ${HOMOMORPHIC_VOTE_COUNT} homomorphic votes`, () => {
    const keys = sharedPaillierKeys();
    const ballotId = "stress-homomorphic-ballot";
    const optionCount = 3;

    const expected = [0, 0, 0];
    const votes = Array.from({ length: HOMOMORPHIC_VOTE_COUNT }, (_, i) => {
      const optionIndex = i % optionCount;
      expected[optionIndex] += 1;
      return encryptVoteHomomorphic(
        optionIndex,
        optionCount,
        ballotId,
        keys.publicKey,
      );
    });

    for (const vote of votes) {
      expect(verifyVoteZKP(vote, keys.publicKey).isValid).toBe(true);
    }

    const root = buildMerkleTree(votes.map((v) => v.receiptHash)).root;
    const proof = tallyHomomorphic(votes, keys.publicKey, keys.privateKey, root);

    expect(proof.tallyResults).toEqual(expected);
    expect(proof.totalBallotsCounted).toBe(HOMOMORPHIC_VOTE_COUNT);
    expect(verifyHomomorphicTallyProof(proof, keys.publicKey)).toBe(true);
  });
});
