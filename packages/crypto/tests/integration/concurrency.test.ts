/**
 * tests/integration/concurrency.test.ts
 *
 * Scenarios 10-12 — interleaved submissions against shared server and ledger
 * state. Latency is real `setTimeout`, not fake timers: faking them would
 * serialise the very interleaving these tests exist to produce.
 */

import {
  setupFixture,
  teardownFixture,
  type IntegrationFixture,
} from "./setupFixture";
import { VoteLifecycleSimulator } from "./voteLifecycleSimulator";
import { BallotClosedError, InvalidTokenError } from "../../src/client/errors";

describe("integration: concurrency", () => {
  let fixture: IntegrationFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    teardownFixture(fixture);
  });

  // Scenario 10 [real]
  it("records all 100 concurrent votes with no lost updates", async () => {
    const sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });

    const ballot = await sim.createBallot({ options: ["Alpha", "Beta"] });
    await sim.issueTokens(100);

    // Small non-zero ledger latency so the 100 submissions genuinely interleave
    // rather than each completing before the next is scheduled.
    fixture.ledger.setLatency(1);

    const choices = Array.from({ length: 100 }, (_, i) => ({
      tokenIndex: i,
      optionIndex: i % 3 === 0 ? 1 : 0, // 34 Beta, 66 Alpha
    }));

    const receipts = await sim.castVotesConcurrently(choices);
    expect(receipts).toHaveLength(100);

    // Every submission got its own vote ID and its own ledger sequence number.
    expect(new Set(receipts.map((r) => r.voteId)).size).toBe(100);
    const ledgerVotes = fixture.ledger.getVotes(ballot.id);
    expect(ledgerVotes).toHaveLength(100);
    expect(new Set(ledgerVotes.map((v) => v.sequence)).size).toBe(100);

    // Every issued token was consumed exactly once.
    expect(fixture.backend.allTokensUsed(ballot.id)).toBe(true);

    fixture.ledger.setLatency(0);
    const results = await sim.tallyVotes();
    expect(results.totalVotes).toBe(100);
    expect(sim.countsByLabel(results)).toEqual({ Alpha: 66, Beta: 34 });
  });

  // Scenario 11 [real]
  it("consumes a token exactly once under a concurrent double-submit", async () => {
    const sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });

    const ballot = await sim.createBallot({ options: ["Yes", "No"] });
    const tokens = await sim.issueTokens(1);
    fixture.ledger.setLatency(2);

    const outcomes = await Promise.allSettled([
      sim.client.submitVote(ballot.id, tokens[0], ballot.options[0].id),
      sim.client.submitVote(ballot.id, tokens[0], ballot.options[1].id),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      InvalidTokenError,
    );

    // Exactly one record on the ledger — the double-spend never anchored.
    expect(fixture.ledger.countVotes(ballot.id)).toBe(1);
  });

  // Scenario 12 [harness] — validates the simulator's snapshot semantics.
  it("publishes an internally consistent tally when a vote races it", async () => {
    const sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });

    const ballot = await sim.createBallot({ options: ["Yes", "No"] });
    const tokens = await sim.issueTokens(5);

    await sim.castVotes([
      { tokenIndex: 0, optionIndex: 0 },
      { tokenIndex: 1, optionIndex: 0 },
      { tokenIndex: 2, optionIndex: 1 },
    ]);

    fixture.ledger.setLatency(2);

    // A fourth vote is in flight while the tally snapshot is taken.
    const [, racingVote] = await Promise.allSettled([
      fixture.backend.tally(ballot.id, "race-root"),
      sim.client.submitVote(ballot.id, tokens[3], ballot.options[0].id),
    ]);

    fixture.ledger.setLatency(0);
    const results = await sim.client.getBallotResults(ballot.id);

    // Whichever side of the snapshot the racing vote landed on, the published
    // numbers add up to the published total. No partial state is ever visible.
    const sum = results.options.reduce((acc, o) => acc + o.votes, 0);
    expect(sum).toBe(results.totalVotes);
    expect([3, 4]).toContain(results.totalVotes);

    // The racing vote either succeeded before the close or was rejected as
    // closed — never silently dropped.
    if (racingVote.status === "rejected") {
      expect(racingVote.reason).toBeInstanceOf(BallotClosedError);
    }

    // Once published, the ballot is closed to every further vote.
    await expect(
      sim.client.submitVote(ballot.id, tokens[4], ballot.options[0].id),
    ).rejects.toBeInstanceOf(BallotClosedError);
  });
});
