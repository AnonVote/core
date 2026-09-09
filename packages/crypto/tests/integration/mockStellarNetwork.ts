/**
 * tests/integration/mockStellarNetwork.ts
 *
 * A simulated Stellar/Soroban ledger for integration tests.
 *
 * This package contains no Stellar code — the only trace of it is four inert
 * `stellarTxId?: string` type fields. This module therefore does not mock an
 * existing integration; it simulates the boundary the AnonVote ecosystem
 * *would* sit on, so that library code paths (encryption, retry, timeout,
 * status mapping) can be exercised end-to-end against something that behaves
 * like a real, latent, occasionally-failing ledger.
 *
 * Scenarios that assert on this simulator's own behaviour are labelled
 * [harness] in the test files; everything else asserts on library behaviour.
 */

/** A single anonymised vote record, as anchored on the simulated ledger. */
export interface LedgerVoteRecord {
  /** Ledger-assigned transaction ID. */
  txId: string;
  ballotId: string;
  /** SHA-256 hash of the voter's one-time token. The raw token never lands here. */
  tokenHash: string;
  /** Opaque encrypted payload — the ledger never sees plaintext. */
  payload: unknown;
  /** Ledger sequence number at which this record was written. */
  sequence: number;
  recordedAt: string;
}

/** Ballot metadata mirrored onto the ledger at creation time. */
export interface LedgerBallotRecord {
  ballotId: string;
  txId: string;
  optionIds: string[];
  createdAt: string;
}

/** A tally result anchored to the ledger, with the Merkle root of its ballots. */
export interface LedgerTallyRecord {
  ballotId: string;
  txId: string;
  merkleRoot: string;
  results: Record<string, number>;
  totalVotes: number;
  anchoredAt: string;
}

/** Operations the simulated ledger accepts. */
export type LedgerOperation =
  | { type: "CREATE_BALLOT"; ballotId: string; optionIds: string[] }
  | {
      type: "RECORD_VOTE";
      ballotId: string;
      tokenHash: string;
      payload: unknown;
    }
  | {
      type: "ANCHOR_TALLY";
      ballotId: string;
      merkleRoot: string;
      results: Record<string, number>;
      totalVotes: number;
    };

/** Result of a successful ledger submission. */
export interface LedgerTxResult {
  txId: string;
  sequence: number;
  /** Always "SUCCESS" — failures are thrown, never returned. */
  status: "SUCCESS";
}

/** Failure modes the ledger can be told to inject. */
export type LedgerFailureMode =
  | "none"
  /** Never settles — the caller's AbortSignal/timeout must win. */
  | "timeout"
  /** The Soroban contract rejected the invocation. */
  | "contract-error"
  /** The transaction was submitted but failed to apply. */
  | "tx-failed";

export interface MockStellarNetworkOptions {
  /** Artificial per-call latency in milliseconds. Real timers, 0-5ms by default. */
  latencyMs?: number;
  /** Failure to inject on the next submissions. Defaults to "none". */
  failureMode?: LedgerFailureMode;
  /**
   * How many submissions the injected failure applies to before the ledger
   * reverts to healthy. `Infinity` keeps failing. Defaults to `Infinity`.
   */
  failureCount?: number;
}

/** Thrown when the simulated ledger rejects or fails a transaction. */
export class LedgerError extends Error {
  readonly kind: Exclude<LedgerFailureMode, "none">;

  constructor(kind: Exclude<LedgerFailureMode, "none">, message: string) {
    super(message);
    this.name = "LedgerError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory ledger simulator.
 *
 * State is append-only and monotonically sequenced, which is what makes the
 * concurrency scenarios meaningful: 100 interleaved `submitTransaction` calls
 * must produce 100 distinct sequence numbers and 100 records.
 */
export class MockStellarNetwork {
  private sequence = 0;
  private txCounter = 0;
  private latencyMs: number;
  private failureMode: LedgerFailureMode;
  private failuresRemaining: number;

  private readonly ballots = new Map<string, LedgerBallotRecord>();
  private readonly votes: LedgerVoteRecord[] = [];
  private readonly tallies = new Map<string, LedgerTallyRecord>();

  constructor(options: MockStellarNetworkOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.failureMode = options.failureMode ?? "none";
    this.failuresRemaining = options.failureCount ?? Infinity;
  }

  /** Injects a failure mode for the next `count` submissions. */
  injectFailure(mode: LedgerFailureMode, count = Infinity): void {
    this.failureMode = mode;
    this.failuresRemaining = mode === "none" ? 0 : count;
  }

  /** Sets artificial per-call latency, in milliseconds. */
  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  /** Current ledger sequence number. */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Submits an operation to the simulated ledger.
   *
   * @throws {LedgerError} when a failure mode is active. A "timeout" failure
   * never settles, leaving the caller's own timeout to fire.
   */
  async submitTransaction(op: LedgerOperation): Promise<LedgerTxResult> {
    await sleep(this.latencyMs);

    if (this.failureMode !== "none" && this.failuresRemaining > 0) {
      const mode = this.failureMode;
      this.failuresRemaining -= 1;
      if (this.failuresRemaining <= 0) {
        this.failureMode = "none";
        this.failuresRemaining = 0;
      }
      return this.fail(mode, op);
    }

    this.sequence += 1;
    const txId = this.nextTxId();
    const now = new Date().toISOString();

    switch (op.type) {
      case "CREATE_BALLOT":
        this.ballots.set(op.ballotId, {
          ballotId: op.ballotId,
          txId,
          optionIds: op.optionIds,
          createdAt: now,
        });
        break;
      case "RECORD_VOTE":
        this.votes.push({
          txId,
          ballotId: op.ballotId,
          tokenHash: op.tokenHash,
          payload: op.payload,
          sequence: this.sequence,
          recordedAt: now,
        });
        break;
      case "ANCHOR_TALLY":
        this.tallies.set(op.ballotId, {
          ballotId: op.ballotId,
          txId,
          merkleRoot: op.merkleRoot,
          results: op.results,
          totalVotes: op.totalVotes,
          anchoredAt: now,
        });
        break;
    }

    return { txId, sequence: this.sequence, status: "SUCCESS" };
  }

  /** Reads back a previously submitted transaction by ID. */
  async readTransaction(
    txId: string,
  ): Promise<LedgerVoteRecord | LedgerBallotRecord | LedgerTallyRecord | null> {
    await sleep(this.latencyMs);

    const vote = this.votes.find((v) => v.txId === txId);
    if (vote) return vote;

    for (const ballot of this.ballots.values()) {
      if (ballot.txId === txId) return ballot;
    }
    for (const tally of this.tallies.values()) {
      if (tally.txId === txId) return tally;
    }
    return null;
  }

  /** All vote records anchored for a ballot, in ledger order. */
  getVotes(ballotId: string): LedgerVoteRecord[] {
    return this.votes.filter((v) => v.ballotId === ballotId);
  }

  /** Number of votes anchored for a ballot. */
  countVotes(ballotId: string): number {
    return this.getVotes(ballotId).length;
  }

  /** The ballot record, if it was created on the ledger. */
  getBallot(ballotId: string): LedgerBallotRecord | undefined {
    return this.ballots.get(ballotId);
  }

  /** The anchored tally for a ballot, if one was published. */
  getTally(ballotId: string): LedgerTallyRecord | undefined {
    return this.tallies.get(ballotId);
  }

  /** Wipes all ledger state. Called between tests. */
  reset(): void {
    this.sequence = 0;
    this.txCounter = 0;
    this.latencyMs = 0;
    this.failureMode = "none";
    this.failuresRemaining = 0;
    this.ballots.clear();
    this.votes.length = 0;
    this.tallies.clear();
  }

  private nextTxId(): string {
    this.txCounter += 1;
    return `tx_${this.txCounter.toString(16).padStart(12, "0")}`;
  }

  private async fail(
    mode: LedgerFailureMode,
    op: LedgerOperation,
  ): Promise<never> {
    switch (mode) {
      case "timeout":
        // Never settles. The caller's AbortController/timeout must win.
        await new Promise<never>(() => {});
        throw new LedgerError("timeout", "unreachable");
      case "contract-error":
        throw new LedgerError(
          "contract-error",
          `Soroban contract rejected ${op.type}`,
        );
      default:
        throw new LedgerError(
          "tx-failed",
          `Transaction ${op.type} failed to apply to the ledger`,
        );
    }
  }
}
