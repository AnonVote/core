/**
 * tests/integration/mockBackend.ts
 *
 * An in-memory AnonVote API, sitting on top of {@link MockStellarNetwork}.
 * The `fetch` mock installed by `setupFixture` routes requests here.
 *
 * It owns the parts a real backend would own and this library deliberately
 * does not: token issuance and consumption, the ballot state machine, and the
 * mapping of domain outcomes onto HTTP status codes. Tests assert on the
 * *library's* reaction to those status codes (`throwForStatus`, `withRetry`,
 * timeouts) — see the [real]/[harness] labels in the scenario files.
 */

import { randomUUID } from "../../src/random";
import { generateToken, hashToken, decryptVote } from "../../src/crypto";
import type { Ballot, Option, EncryptedPayload } from "../../src/types";
import { MockStellarNetwork } from "./mockStellarNetwork";

/** A response the mock backend hands back to the fetch mock. */
export interface BackendResponse {
  status: number;
  body: unknown;
}

/** Thrown by the simulator-facing methods (not the HTTP surface). */
export class BackendStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendStateError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface StoredVote {
  voteId: string;
  tokenHash: string;
  encryptedPayload: EncryptedPayload;
  submittedAt: string;
  txId: string;
}

interface StoredBallot {
  ballot: Ballot;
  /** Hashes of issued tokens → whether they have been consumed. */
  tokens: Map<string, boolean>;
  identifierHashes: Set<string>;
  votes: StoredVote[];
  /** Set once tallied; results are unavailable over HTTP before that. */
  published?: {
    results: Record<string, number>;
    totalVotes: number;
    publishedAt: string;
    merkleRoot: string;
    stellarTxId: string;
  };
}

export interface MockBackendOptions {
  ledger: MockStellarNetwork;
  /**
   * AES key used to decrypt vote payloads at tally time. In production the
   * backend would never hold this; here it stands in for the trustee that
   * performs the decryption, so scenario 18 can assert on real round-tripping.
   */
  ballotKey: string;
  /** Bearer token required on write endpoints. Omit to disable auth checks. */
  authToken?: string;
}

const BALLOTS_RE = /^\/ballots$/;
const BALLOT_VOTERS_RE = /^\/ballots\/([^/]+)\/voters$/;
const BALLOT_TOKENS_RE = /^\/ballots\/([^/]+)\/tokens$/;
const BALLOT_VOTES_RE = /^\/ballots\/([^/]+)\/votes$/;
const BALLOT_RESULTS_RE = /^\/ballots\/([^/]+)\/results$/;
const BALLOT_VERIFY_RE = /^\/ballots\/([^/]+)\/verify$/;

export class MockBackend {
  private readonly ledger: MockStellarNetwork;
  private readonly ballotKey: string;
  private readonly authToken?: string;
  private readonly ballots = new Map<string, StoredBallot>();

  constructor(options: MockBackendOptions) {
    this.ledger = options.ledger;
    this.ballotKey = options.ballotKey;
    this.authToken = options.authToken;
  }

  /**
   * Routes one request. Returns a status + body; it never throws for domain
   * failures — those are expressed as status codes, which is the whole point.
   */
  async handle(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    headers: Record<string, string>,
  ): Promise<BackendResponse> {
    let m: RegExpMatchArray | null;

    if (method === "POST" && BALLOTS_RE.test(path)) {
      return this.requireAuth(headers) ?? (await this.createBallot(body));
    }
    if (method === "POST" && (m = path.match(BALLOT_VOTERS_RE))) {
      return this.requireAuth(headers) ?? this.uploadVoters(m[1], body);
    }
    if (method === "POST" && (m = path.match(BALLOT_TOKENS_RE))) {
      return this.requireAuth(headers) ?? this.issueTokens(m[1]);
    }
    if (method === "POST" && (m = path.match(BALLOT_VOTES_RE))) {
      return this.submitVote(m[1], body);
    }
    if (method === "GET" && (m = path.match(BALLOT_RESULTS_RE))) {
      return this.getResults(m[1]);
    }
    if (method === "GET" && (m = path.match(BALLOT_VERIFY_RE))) {
      return this.verify(m[1]);
    }

    return { status: 404, body: { message: `No route for ${method} ${path}` } };
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  private async createBallot(
    body: Record<string, unknown> | undefined,
  ): Promise<BackendResponse> {
    const title = typeof body?.title === "string" ? body.title : "";
    const labels = Array.isArray(body?.options)
      ? (body.options as unknown[]).filter(
          (o): o is string => typeof o === "string",
        )
      : [];
    if (!title || labels.length < 2) {
      return { status: 422, body: { message: "invalid ballot payload" } };
    }

    const id = randomUUID();
    const options: Option[] = labels.map((text) => ({
      id: randomUUID(),
      ballotId: id,
      text,
    }));

    const deadline =
      typeof body?.deadline === "string"
        ? body.deadline
        : new Date(Date.now() + 86_400_000).toISOString();

    const ballot: Ballot = {
      id,
      organizationId: "org_integration_test",
      topic: title,
      status: "OPEN",
      deadline,
      eligibilityListId: randomUUID(),
      allowWeightedVoting: false,
      allowRankedChoice: false,
      createdAt: new Date().toISOString(),
      options,
      votesCast: 0,
      tokensIssued: 0,
      eligibleVoters: 0,
    };

    this.ballots.set(id, {
      ballot,
      tokens: new Map(),
      identifierHashes: new Set(),
      votes: [],
    });

    await this.ledger.submitTransaction({
      type: "CREATE_BALLOT",
      ballotId: id,
      optionIds: options.map((o) => o.id),
    });

    return { status: 201, body: ballot };
  }

  private uploadVoters(
    ballotId: string,
    body: Record<string, unknown> | undefined,
  ): BackendResponse {
    const stored = this.ballots.get(ballotId);
    if (!stored) return notFound(ballotId);

    const voters = Array.isArray(body?.voters)
      ? (body.voters as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    if (voters.length === 0) {
      return { status: 422, body: { message: "voters must be non-empty" } };
    }

    let added = 0;
    let skipped = 0;
    for (const voter of voters) {
      // Raw identifiers are never stored — only their hash. Same invariant the
      // library enforces via hashIdentifier.
      const hash = hashToken(voter);
      if (stored.identifierHashes.has(hash)) {
        skipped += 1;
      } else {
        stored.identifierHashes.add(hash);
        added += 1;
      }
    }
    stored.ballot.eligibleVoters = stored.identifierHashes.size;

    return {
      status: 200,
      body: {
        added,
        skipped,
        eligibilityListId: stored.ballot.eligibilityListId,
      },
    };
  }

  private issueTokens(ballotId: string): BackendResponse {
    const stored = this.ballots.get(ballotId);
    if (!stored) return notFound(ballotId);
    if (stored.identifierHashes.size === 0) {
      return { status: 422, body: { message: "no eligible voters" } };
    }

    const tokens: string[] = [];
    for (let i = 0; i < stored.identifierHashes.size; i++) {
      const raw = generateToken();
      // Only the hash is retained server-side.
      stored.tokens.set(hashToken(raw), false);
      tokens.push(raw);
    }
    stored.ballot.tokensIssued = stored.tokens.size;

    return { status: 200, body: { issued: tokens.length, tokens } };
  }

  private async submitVote(
    ballotId: string,
    body: Record<string, unknown> | undefined,
  ): Promise<BackendResponse> {
    const stored = this.ballots.get(ballotId);
    if (!stored) return notFound(ballotId);

    if (this.isClosed(stored)) {
      return { status: 410, body: { message: "ballot is closed" } };
    }

    const token = typeof body?.token === "string" ? body.token : "";
    const encryptedPayload = body?.encryptedPayload as
      | EncryptedPayload
      | undefined;
    if (!token || !encryptedPayload) {
      return { status: 422, body: { message: "token and payload required" } };
    }

    const tokenHash = hashToken(token);
    const used = stored.tokens.get(tokenHash);
    if (used === undefined) {
      return { status: 422, body: { message: "token not recognised" } };
    }
    if (used) {
      return { status: 409, body: { message: "token already used" } };
    }

    // Compare-and-set BEFORE any await. Two concurrent submissions of the same
    // token must not both observe `used === false` — this is what makes
    // scenario 11 a real single-consumption test rather than a formality.
    stored.tokens.set(tokenHash, true);

    const voteId = randomUUID();
    const submittedAt = new Date().toISOString();

    let txId: string;
    try {
      const tx = await this.ledger.submitTransaction({
        type: "RECORD_VOTE",
        ballotId,
        tokenHash,
        payload: encryptedPayload,
      });
      txId = tx.txId;
    } catch (err) {
      // Compensating rollback: the token was never actually spent.
      stored.tokens.set(tokenHash, false);
      return {
        status: 500,
        body: {
          message: `ledger rejected the vote: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      };
    }

    stored.votes.push({ voteId, tokenHash, encryptedPayload, submittedAt, txId });
    stored.ballot.votesCast = stored.votes.length;

    return { status: 201, body: { voteId, ballotId, submittedAt } };
  }

  private getResults(ballotId: string): BackendResponse {
    const stored = this.ballots.get(ballotId);
    if (!stored) return notFound(ballotId);
    if (!stored.published) {
      // Results are a subresource that does not exist until the tally is run.
      return { status: 404, body: { message: "results not published yet" } };
    }

    const { results, totalVotes, publishedAt, stellarTxId } = stored.published;
    return {
      status: 200,
      body: {
        ballotId,
        totalVotes,
        options: stored.ballot.options.map((o) => ({
          optionId: o.id,
          text: o.text,
          votes: results[o.id] ?? 0,
          percentage:
            totalVotes === 0
              ? 0
              : Math.round(((results[o.id] ?? 0) / totalVotes) * 10000) / 100,
        })),
        publishedAt,
        stellarTxId,
      },
    };
  }

  private verify(ballotId: string): BackendResponse {
    const stored = this.ballots.get(ballotId);
    if (!stored) return notFound(ballotId);
    if (!stored.published) {
      return { status: 404, body: { message: "results not published yet" } };
    }

    const anchored = this.ledger.getTally(ballotId);
    const ledgerVoteCount = this.ledger.countVotes(ballotId);

    return {
      status: 200,
      body: {
        ballotId,
        isConsistent:
          anchored !== undefined &&
          anchored.totalVotes === stored.published.totalVotes &&
          ledgerVoteCount === stored.votes.length,
        totalVotes: stored.published.totalVotes,
        checkedAt: new Date().toISOString(),
        stellarTxId: anchored?.txId,
      },
    };
  }

  // ── Simulator-facing operations (not exposed over HTTP) ──────────────────

  /** Closes a ballot so further votes get a 410. */
  closeBallot(ballotId: string): void {
    const stored = this.requireBallot(ballotId);
    stored.ballot.status = "CLOSED";
  }

  /** Forces a ballot's deadline into the past. */
  expireBallot(ballotId: string): void {
    const stored = this.requireBallot(ballotId);
    stored.ballot.deadline = new Date(Date.now() - 1000).toISOString();
  }

  /**
   * Decrypts every stored payload, counts the options, and anchors the result
   * to the ledger. Snapshots the vote list first, so a vote landing mid-tally
   * cannot make the published totals internally inconsistent.
   *
   * @param keyOverride - Decrypt with this key instead of the configured one.
   *   Models a trustee turning up with the wrong key; the resulting
   *   {@link CryptoError} propagates rather than being swallowed.
   * @throws {BackendStateError} if the ballot was already tallied.
   */
  async tally(
    ballotId: string,
    merkleRoot = "",
    keyOverride?: string,
  ): Promise<{ results: Record<string, number>; totalVotes: number; txId: string }> {
    const stored = this.requireBallot(ballotId);
    if (stored.published) {
      throw new BackendStateError(
        `ballot ${ballotId} has already been tallied and published`,
      );
    }

    const snapshot = stored.votes.slice();
    const results: Record<string, number> = {};
    for (const option of stored.ballot.options) {
      results[option.id] = 0;
    }

    for (const vote of snapshot) {
      const optionId = decryptVote(
        vote.encryptedPayload,
        keyOverride ?? this.ballotKey,
      );
      results[optionId] = (results[optionId] ?? 0) + 1;
    }

    const tx = await this.ledger.submitTransaction({
      type: "ANCHOR_TALLY",
      ballotId,
      merkleRoot,
      results,
      totalVotes: snapshot.length,
    });

    stored.published = {
      results,
      totalVotes: snapshot.length,
      publishedAt: new Date().toISOString(),
      merkleRoot,
      stellarTxId: tx.txId,
    };
    stored.ballot.status = "CLOSED";

    return { results, totalVotes: snapshot.length, txId: tx.txId };
  }

  /** The raw stored ballot, for assertions on server-side state. */
  getStoredBallot(ballotId: string): Ballot {
    return this.requireBallot(ballotId).ballot;
  }

  /** The payloads the server received, for privacy-invariant assertions. */
  getStoredVotes(ballotId: string): ReadonlyArray<StoredVote> {
    return this.requireBallot(ballotId).votes;
  }

  /** True once every issued token has been consumed. */
  allTokensUsed(ballotId: string): boolean {
    const stored = this.requireBallot(ballotId);
    return [...stored.tokens.values()].every((used) => used);
  }

  private requireBallot(ballotId: string): StoredBallot {
    const stored = this.ballots.get(ballotId);
    if (!stored) {
      throw new BackendStateError(`unknown ballot ${ballotId}`);
    }
    return stored;
  }

  private isClosed(stored: StoredBallot): boolean {
    return (
      stored.ballot.status === "CLOSED" ||
      Date.parse(stored.ballot.deadline) <= Date.now()
    );
  }

  private requireAuth(headers: Record<string, string>): BackendResponse | null {
    if (!this.authToken) return null;
    const provided = headers["authorization"] ?? headers["Authorization"];
    if (provided !== `Bearer ${this.authToken}`) {
      return { status: 401, body: { message: "missing or invalid bearer token" } };
    }
    return null;
  }
}

function notFound(ballotId: string): BackendResponse {
  return { status: 404, body: { message: `ballot ${ballotId} does not exist` } };
}
