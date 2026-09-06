/**
 * tests/integration/ballot-state-machine.test.ts
 *
 * Scenarios 13-17 — election lifecycle gating.
 *
 * Local time gating lives in exactly one of this package's three clients:
 * `src/client/index.ts` (`deriveStatus` + the `castVote` guard). It is imported
 * here by explicit `/index` path, because `../../src/client` resolves to
 * `src/client.ts` — file beats directory in Node/TS resolution.
 */

import { AnonVoteClient as StrictClient } from "../../src/client/index";
import type { Election } from "../../src/client/types";
import { AnonVoteClient as RootClient } from "../../src/client";
import { ValidationError } from "../../src/errors";
import { BallotClosedError, BallotNotFoundError } from "../../src/client/errors";
import { BackendStateError } from "./mockBackend";
import {
  setupFixture,
  teardownFixture,
  TEST_BALLOT_KEY,
  type IntegrationFixture,
} from "./setupFixture";
import { VoteLifecycleSimulator } from "./voteLifecycleSimulator";

const DAY = 86_400_000;

function makeElection(
  client: StrictClient,
  startOffsetMs: number,
  endOffsetMs: number,
): Election {
  return client.createElection({
    title: "Lifecycle Election",
    description: "Exercises the open/closed window",
    options: ["Yes", "No"],
    startTime: new Date(Date.now() + startOffsetMs),
    endTime: new Date(Date.now() + endOffsetMs),
  });
}

describe("integration: ballot state machine", () => {
  let fixture: IntegrationFixture;
  const strict = new StrictClient({ ballotKey: TEST_BALLOT_KEY });

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    teardownFixture(fixture);
  });

  // Scenario 13 [real]
  it("rejects a vote cast before startTime", () => {
    const election = makeElection(strict, DAY, 2 * DAY);
    expect(election.status).toBe("draft");

    expect(() => strict.castVote(election, election.options[0].id)).toThrow(
      ValidationError,
    );
    expect(() => strict.castVote(election, election.options[0].id)).toThrow(
      /ELECTION_NOT_ACTIVE/,
    );
  });

  // Scenario 14 [real]
  it("accepts a vote cast inside the voting window", () => {
    const election = makeElection(strict, -1000, DAY);
    expect(election.status).toBe("active");

    const ballot = strict.castVote(election, election.options[1].id);
    expect(ballot.electionId).toBe(election.id);
    expect(ballot.encryptedPayload.ciphertext).not.toBe(election.options[1].id);

    const verification = strict.verifyVote(ballot);
    expect(verification.confirmed).toBe(true);

    // The serialized form drops optionId — the privacy invariant that makes
    // the local optionId safe to hold on to.
    expect(strict.serialize(ballot)).not.toContain(election.options[1].id);
  });

  // Scenario 15 [real] — closed locally, and closed over HTTP.
  it("rejects a vote after endTime locally and with 410 over HTTP", async () => {
    const election = makeElection(strict, -2000, DAY);
    // createElection refuses a past endTime, so the window is expired after
    // the fact — the guard under test reads endTime and status at cast time.
    election.endTime = new Date(Date.now() - 1000);
    election.status = "closed";

    expect(() => strict.castVote(election, election.options[0].id)).toThrow(
      /ELECTION_NOT_ACTIVE/,
    );

    const sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });
    const ballot = await sim.createBallot();
    const tokens = await sim.issueTokens(1);
    fixture.backend.expireBallot(ballot.id);

    await expect(
      sim.client.submitVote(ballot.id, tokens[0], ballot.options[0].id),
    ).rejects.toBeInstanceOf(BallotClosedError);
    expect(fixture.ledger.countVotes(ballot.id)).toBe(0);
  });

  // Scenario 16 [harness] — results are a subresource that does not exist yet.
  it("makes results unavailable until the tally is published", async () => {
    const sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });
    const ballot = await sim.createBallot();
    await sim.issueTokens(2);
    await sim.castVotes([{ tokenIndex: 0, optionIndex: 0 }]);

    await expect(sim.client.getBallotResults(ballot.id)).rejects.toBeInstanceOf(
      BallotNotFoundError,
    );
    await expect(sim.client.verifyResults(ballot.id)).rejects.toBeInstanceOf(
      BallotNotFoundError,
    );

    const results = await sim.tallyVotes();
    expect(results.totalVotes).toBe(1);
    await expect(sim.verifyResult()).resolves.toMatchObject({
      isConsistent: true,
    });
  });

  // Scenario 17 [harness] — publishing is a one-way transition.
  it("refuses to re-tally a published ballot", async () => {
    const sim = new VoteLifecycleSimulator(fixture, {
      retryConfig: { maxRetries: 0 },
    });
    const ballot = await sim.createBallot();
    await sim.issueTokens(2);
    await sim.castVotes([
      { tokenIndex: 0, optionIndex: 0 },
      { tokenIndex: 1, optionIndex: 1 },
    ]);
    await sim.tallyVotes();

    await expect(fixture.backend.tally(ballot.id)).rejects.toBeInstanceOf(
      BackendStateError,
    );

    // The published figures are untouched by the refused re-tally.
    const results = await sim.client.getBallotResults(ballot.id);
    expect(results.totalVotes).toBe(2);
    expect(fixture.ledger.getTally(ballot.id)?.totalVotes).toBe(2);
  });

  /**
   * DOCUMENTATION TEST — pins a known gap, does not endorse it.
   *
   * Of the three clients in this package, only `src/client/index.ts` gates
   * voting by time. The root client (`src/client.ts`, the one exported as
   * `@anonvote/crypto`) takes a bare `ballotId` and has no election window to
   * check, so it encrypts a vote for an election that closed a year ago
   * without complaint. `BallotStatus` in `src/types.ts` is likewise inert:
   * never derived, never compared.
   *
   * Fixing it means a signature or behaviour change to a shipped public API,
   * which does not belong in a testing change. Recorded here so the divergence
   * between the two clients is visible in the suite rather than only in prose.
   *
   * Follow-up: see the PR body for issue #79.
   */
  it("[known gap] root client encrypts a vote for a long-expired election", () => {
    const root = new RootClient({ encryptionKey: TEST_BALLOT_KEY });
    const expired = root.createElection({
      title: "Election that ended last year",
      description: "Closed long ago",
      options: ["Yes", "No"],
      startTime: Date.now() - 2 * 365 * DAY,
      endTime: Date.now() - 365 * DAY,
    });

    // No ELECTION_NOT_ACTIVE, no BallotStatus check — the vote is encrypted.
    const receipt = root.castVote({
      ballotId: expired.id,
      voteOption: expired.options[0].id,
    });
    expect(receipt.encryptedPayload.ciphertext).toEqual(expect.any(String));
    expect(root.verifyVote(receipt.encryptedPayload)).toBe(true);
  });
});
