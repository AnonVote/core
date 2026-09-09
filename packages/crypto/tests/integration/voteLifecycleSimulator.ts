/**
 * tests/integration/voteLifecycleSimulator.ts
 *
 * Drives a complete election through the HTTP-backed SDK client:
 *
 *   createBallot() -> issueTokens() -> castVotes() -> tallyVotes() -> verifyResult()
 *
 * The client under test is `src/client/AnonVoteClient.ts`, imported by direct
 * path — it is not re-exported from either package entry point, so this is the
 * only way to reach it. Every call travels through the mocked `fetch`, which
 * means `encryptVote`, `withRetry`, the `AbortController` timeout and
 * `throwForStatus` all execute for real.
 *
 * Each step guards its own precondition and throws {@link LifecycleError} if
 * the caller skips one, so a mis-sequenced test fails loudly rather than
 * silently asserting on empty state.
 */

import { AnonVoteClient } from "../../src/client/AnonVoteClient";
import type {
  VoteResult,
  BallotResults,
  VerificationReport,
} from "../../src/client/AnonVoteClient";
import { hashToken } from "../../src/crypto";
import { buildMerkleTree } from "../../src/zkp/merkle";
import type { Ballot, RetryConfig } from "../../src/types";
import type { IntegrationFixture } from "./setupFixture";
import { FAST_RETRY, makeBallotArgs, makeVoters } from "./setupFixture";

/** Thrown when lifecycle steps are run out of order. */
export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Which option each token holder picks. */
export interface VoteChoice {
  /** Index into the token array returned by `issueTokens`. */
  tokenIndex: number;
  /** Index into `ballot.options`. */
  optionIndex: number;
}

export interface SimulatorOptions {
  /** Overrides for the SDK client's retry policy. Defaults to {@link FAST_RETRY}. */
  retryConfig?: Partial<RetryConfig>;
  /** Request timeout in ms. Defaults to 1000 — long enough to never flake. */
  timeoutMs?: number;
  /** Bearer token. Defaults to the fixture's. Set to "" to simulate no auth. */
  authToken?: string;
}

export class VoteLifecycleSimulator {
  readonly client: AnonVoteClient;
  private readonly fixture: IntegrationFixture;

  private ballot?: Ballot;
  private tokens?: string[];
  private results?: BallotResults;
  private merkleLeaves: string[] = [];
  private merkleRoot = "";

  constructor(fixture: IntegrationFixture, options: SimulatorOptions = {}) {
    this.fixture = fixture;
    const authToken =
      options.authToken === undefined ? fixture.authToken : options.authToken;

    this.client = new AnonVoteClient({
      apiUrl: fixture.apiUrl,
      ballotEncryptionKey: fixture.ballotKey,
      authToken: authToken === "" ? undefined : authToken,
      timeoutMs: options.timeoutMs ?? 1000,
      retryConfig: { ...FAST_RETRY, ...options.retryConfig },
    });
  }

  // ── Step 1 ───────────────────────────────────────────────────────────────

  /** Creates the ballot server-side and anchors it to the simulated ledger. */
  async createBallot(
    overrides: Partial<{ title: string; options: string[]; deadline: string }> = {},
  ): Promise<Ballot> {
    const args = makeBallotArgs(overrides);
    this.ballot = await this.client.createBallot(
      args.title,
      args.description,
      args.options,
      args.deadline,
    );

    if (this.ballot.status !== "OPEN") {
      throw new LifecycleError(
        `expected a freshly created ballot to be OPEN, got ${this.ballot.status}`,
      );
    }
    if (!this.fixture.ledger.getBallot(this.ballot.id)) {
      throw new LifecycleError("ballot was not anchored to the ledger");
    }

    return this.ballot;
  }

  // ── Step 2 ───────────────────────────────────────────────────────────────

  /** Uploads voters and issues one anonymous token per eligible voter. */
  async issueTokens(voterCount: number): Promise<string[]> {
    const ballot = this.requireBallot();
    const voters = makeVoters(voterCount);

    const upload = await this.client.uploadVoters(ballot.id, voters);
    if (upload.added !== voterCount) {
      throw new LifecycleError(
        `expected ${voterCount} voters added, got ${upload.added}`,
      );
    }

    const batch = await this.client.issueBallotTokens(ballot.id);
    if (batch.issued !== voterCount || batch.tokens.length !== voterCount) {
      throw new LifecycleError(
        `expected ${voterCount} tokens issued, got ${batch.issued}`,
      );
    }

    this.tokens = batch.tokens;
    return batch.tokens;
  }

  // ── Step 3 ───────────────────────────────────────────────────────────────

  /** Casts one vote per choice, sequentially. */
  async castVotes(choices: VoteChoice[]): Promise<VoteResult[]> {
    const ballot = this.requireBallot();
    const tokens = this.requireTokens();

    const submitted: VoteResult[] = [];
    for (const choice of choices) {
      submitted.push(
        await this.client.submitVote(
          ballot.id,
          tokens[choice.tokenIndex],
          ballot.options[choice.optionIndex].id,
        ),
      );
    }
    return submitted;
  }

  /** Casts every vote concurrently — the concurrency scenarios use this. */
  async castVotesConcurrently(choices: VoteChoice[]): Promise<VoteResult[]> {
    const ballot = this.requireBallot();
    const tokens = this.requireTokens();

    return Promise.all(
      choices.map((choice) =>
        this.client.submitVote(
          ballot.id,
          tokens[choice.tokenIndex],
          ballot.options[choice.optionIndex].id,
        ),
      ),
    );
  }

  // ── Step 4 ───────────────────────────────────────────────────────────────

  /**
   * Builds the Merkle commitment over the recorded ballots, runs the tally
   * server-side, anchors it, then reads the published results back over HTTP.
   */
  async tallyVotes(): Promise<BallotResults> {
    const ballot = this.requireBallot();

    const stored = this.fixture.backend.getStoredVotes(ballot.id);
    if (stored.length === 0) {
      throw new LifecycleError("cannot tally a ballot with no recorded votes");
    }

    this.merkleLeaves = stored.map((v) => hashToken(v.encryptedPayload.ciphertext));
    this.merkleRoot = buildMerkleTree(this.merkleLeaves).root;

    await this.fixture.backend.tally(ballot.id, this.merkleRoot);

    this.results = await this.client.getBallotResults(ballot.id);
    if (this.results.totalVotes !== stored.length) {
      throw new LifecycleError(
        `published total ${this.results.totalVotes} does not match ${stored.length} recorded votes`,
      );
    }

    return this.results;
  }

  // ── Step 5 ───────────────────────────────────────────────────────────────

  /** Asks the backend to confirm the published tally against the ledger. */
  async verifyResult(): Promise<VerificationReport> {
    const ballot = this.requireBallot();
    if (!this.results) {
      throw new LifecycleError("verifyResult() called before tallyVotes()");
    }
    return this.client.verifyResults(ballot.id);
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  /** Merkle leaves in ledger order — the audit path inputs for a voter. */
  getMerkleLeaves(): string[] {
    return this.merkleLeaves.slice();
  }

  /** Root anchored to the ledger by {@link tallyVotes}. */
  getMerkleRoot(): string {
    return this.merkleRoot;
  }

  /** Convenience: option counts keyed by option text. */
  countsByLabel(results: BallotResults): Record<string, number> {
    const out: Record<string, number> = {};
    for (const option of results.options) {
      out[option.text] = option.votes;
    }
    return out;
  }

  private requireBallot(): Ballot {
    if (!this.ballot) {
      throw new LifecycleError("createBallot() must run first");
    }
    return this.ballot;
  }

  private requireTokens(): string[] {
    if (!this.tokens) {
      throw new LifecycleError("issueTokens() must run before casting votes");
    }
    return this.tokens;
  }
}
