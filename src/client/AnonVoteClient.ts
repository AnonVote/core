import { encryptVote } from "../crypto";
import { withRetry, resolveRetryConfig, HttpError } from "../retry";
import { ValidationError } from "../errors";
import {
  InvalidTokenError,
  BallotClosedError,
  BallotNotFoundError,
  AuthError,
  TimeoutError,
} from "./errors";
import type { Ballot, EncryptedPayload, RetryConfig } from "../types";
import type {
  PaillierPublicKey,
  HomomorphicEncryptedVote,
} from "../zkp/types";
import { createHomomorphicVote } from "../zkp/proofs";

// ── Config & response types ────────────────────────────────────────────────

/**
 * Configuration object for {@link AnonVoteClient}.
 */
export interface AnonVoteClientConfig {
  /**
   * Base URL of the AnonVote backend API, without a trailing slash.
   * @example "https://api.anonvote.io"
   */
  apiUrl: string;

  /**
   * 64-character hex string (32 bytes) used to encrypt votes before
   * submission. Generate with: `crypto.randomBytes(32).toString("hex")`.
   */
  ballotEncryptionKey: string;

  /**
   * Optional Paillier public key for Zero-Knowledge Proofs and Additive Homomorphic Encryption.
   */
  paillierPublicKey?: PaillierPublicKey;

  /**
   * Bearer token for authenticated API requests. Required for methods that
   * write data (createBallot, uploadVoters, issueBallotTokens).
   */
  authToken?: string;

  /**
   * Request timeout in milliseconds. Defaults to 30 000 (30 seconds).
   */
  timeoutMs?: number;

  /**
   * Retry configuration for transient network failures. Defaults are applied
   * for any omitted fields.
   */
  retryConfig?: Partial<RetryConfig>;
}

/**
 * Result of uploading a voter list to a ballot.
 */
export interface UploadResult {
  /** Number of voters successfully added to the eligibility list. */
  added: number;
  /** Number of entries that were duplicates and skipped. */
  skipped: number;
  /** The eligibility list ID associated with this ballot. */
  eligibilityListId: string;
}

/**
 * A batch of issued voter tokens.
 */
export interface TokenBatch {
  /** Total number of tokens issued in this batch. */
  issued: number;
  /** Raw token values to distribute to voters. Never persisted server-side. */
  tokens: string[];
}

/**
 * Result of a successfully submitted vote.
 */
export interface VoteResult {
  /** Unique ID of the submitted vote record. */
  voteId: string;
  /** The ballot this vote belongs to. */
  ballotId: string;
  /** ISO 8601 timestamp of when the vote was recorded. */
  submittedAt: string;
}

/**
 * Tally results for a single option.
 */
export interface OptionResult {
  optionId: string;
  text: string;
  votes: number;
  percentage: number;
}

/**
 * Full results for a ballot.
 */
export interface BallotResults {
  ballotId: string;
  totalVotes: number;
  options: OptionResult[];
  publishedAt: string;
  stellarTxId?: string;
}

/**
 * Verification report for a ballot's result integrity.
 */
export interface VerificationReport {
  ballotId: string;
  isConsistent: boolean;
  totalVotes: number;
  checkedAt: string;
  stellarTxId?: string;
}

// ── AnonVoteClient ─────────────────────────────────────────────────────────

/**
 * High-level SDK client for the AnonVote backend API.
 *
 * Abstracts ballot creation, voter upload, token issuance, vote submission,
 * and result retrieval. Automatically encrypts votes before submission and
 * maps backend error codes to typed SDK error classes.
 *
 * All methods are async and include automatic retry with exponential backoff
 * for transient network failures. Requests time out after `timeoutMs`
 * milliseconds (default 30 seconds).
 *
 * @example
 * ```typescript
 * import { AnonVoteClient } from "@anonvote/crypto/client";
 * import { randomBytes } from "crypto";
 *
 * const client = new AnonVoteClient({
 *   apiUrl: "https://api.anonvote.io",
 *   ballotEncryptionKey: randomBytes(32).toString("hex"),
 *   authToken: process.env.ANONVOTE_AUTH_TOKEN,
 * });
 *
 * const ballot = await client.createBallot(
 *   "Board Election",
 *   "Elect new members",
 *   ["Alice", "Bob"],
 *   new Date(Date.now() + 7 * 86_400_000).toISOString(),
 * );
 * ```
 */
export class AnonVoteClient {
  private readonly config: AnonVoteClientConfig;
  private readonly retryConfig: RetryConfig;
  private readonly timeoutMs: number;

  constructor(config: AnonVoteClientConfig) {
    if (!config.apiUrl || config.apiUrl.trim().length === 0) {
      throw new ValidationError("apiUrl is required");
    }
    if (!/^[0-9a-f]{64}$/i.test(config.ballotEncryptionKey)) {
      throw new ValidationError(
        "ballotEncryptionKey must be a 64-character hex string (32 bytes)",
      );
    }
    this.config = config;
    this.retryConfig = resolveRetryConfig(config.retryConfig);
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Creates a new ballot on the AnonVote backend.
   *
   * @description Sends a POST request to `/ballots` with the ballot details.
   * Returns the created {@link Ballot} object including its generated ID.
   *
   * @param title       - The ballot title.
   * @param description - A description of what voters are deciding.
   * @param options     - Array of option label strings (min 2).
   * @param deadline    - ISO 8601 string or Unix timestamp (ms) for when the ballot closes.
   * @returns The created {@link Ballot}.
   *
   * @throws {ValidationError}   If any argument fails validation.
   * @throws {AuthError}         If the authToken is missing or rejected (401/403).
   * @throws {ApiError}          For unexpected server errors.
   * @throws {TimeoutError}      If the request exceeds `timeoutMs`.
   *
   * @example
   * ```typescript
   * const ballot = await client.createBallot(
   *   "Q3 Budget Vote",
   *   "Approve or reject the Q3 budget",
   *   ["Approve", "Reject", "Abstain"],
   *   new Date(Date.now() + 7 * 86_400_000).toISOString(),
   * );
   * console.log(ballot.id);
   * ```
   */
  async createBallot(
    title: string,
    description: string,
    options: string[],
    deadline: string | number,
  ): Promise<Ballot> {
    if (!title || title.trim().length === 0) {
      throw new ValidationError("title is required");
    }
    if (!description || description.trim().length === 0) {
      throw new ValidationError("description is required");
    }
    if (!Array.isArray(options) || options.length < 2) {
      throw new ValidationError("options must contain at least 2 entries");
    }

    return this.request<Ballot>("POST", "/ballots", {
      title: title.trim(),
      description: description.trim(),
      options,
      deadline:
        typeof deadline === "number"
          ? new Date(deadline).toISOString()
          : deadline,
    });
  }

  /**
   * Uploads a list of voter identifiers to a ballot's eligibility list.
   *
   * Identifiers are hashed server-side before storage — raw values are never
   * persisted. Duplicate entries are silently skipped.
   *
   * @description Sends a POST request to `/ballots/:ballotId/voters`.
   *
   * @param ballotId - The ID of the ballot to add voters to.
   * @param voters   - Array of voter identifier strings (e.g. email addresses).
   * @returns An {@link UploadResult} with counts of added and skipped entries.
   *
   * @throws {ValidationError}     If ballotId or voters is invalid.
   * @throws {BallotNotFoundError} If the ballotId does not exist.
   * @throws {AuthError}           If the authToken is missing or rejected.
   * @throws {TimeoutError}        If the request exceeds `timeoutMs`.
   *
   * @example
   * ```typescript
   * const result = await client.uploadVoters(ballot.id, [
   *   "alice@example.com",
   *   "bob@example.com",
   * ]);
   * console.log(`Added ${result.added} voters`);
   * ```
   */
  async uploadVoters(
    ballotId: string,
    voters: string[],
  ): Promise<UploadResult> {
    this.requireBallotId(ballotId);
    if (!Array.isArray(voters) || voters.length === 0) {
      throw new ValidationError("voters must be a non-empty array");
    }

    return this.request<UploadResult>("POST", `/ballots/${ballotId}/voters`, {
      voters,
    });
  }

  /**
   * Issues one-time anonymous voter tokens for all eligible voters on a ballot.
   *
   * Each token is a 32-byte hex string. Only the hash is stored server-side.
   * The raw token values returned here must be distributed to voters and then
   * discarded — they cannot be recovered after this call.
   *
   * @description Sends a POST request to `/ballots/:ballotId/tokens`.
   *
   * @param ballotId - The ID of the ballot to issue tokens for.
   * @returns A {@link TokenBatch} containing the raw token values.
   *
   * @throws {ValidationError}     If ballotId is invalid.
   * @throws {BallotNotFoundError} If the ballotId does not exist.
   * @throws {AuthError}           If the authToken is missing or rejected.
   * @throws {TimeoutError}        If the request exceeds `timeoutMs`.
   *
   * @security Raw token values in the returned batch must be distributed to
   * voters immediately and then discarded. Do not persist the raw tokens.
   *
   * @example
   * ```typescript
   * const batch = await client.issueBallotTokens(ballot.id);
   * // Distribute batch.tokens to voters; discard after sending
   * ```
   */
  async issueBallotTokens(ballotId: string): Promise<TokenBatch> {
    this.requireBallotId(ballotId);

    return this.request<TokenBatch>("POST", `/ballots/${ballotId}/tokens`);
  }

  /**
   * Submits an encrypted vote to the AnonVote backend.
   *
   * The vote option is encrypted with AES-256-GCM using `ballotEncryptionKey`
   * before the request is sent. The plaintext option never leaves this method.
   *
   * @description Sends a POST request to `/ballots/:ballotId/votes`.
   * Encrypts `option` automatically using the client's `ballotEncryptionKey`.
   *
   * @param ballotId - The ID of the ballot to vote in.
   * @param token    - The voter's raw one-time token (64-char hex string).
   * @param option   - The plaintext vote option string.
   * @returns A {@link VoteResult} confirming the submission.
   *
   * @throws {ValidationError}     If any argument is missing or malformed.
   * @throws {InvalidTokenError}   If the token is invalid or already used.
   * @throws {BallotClosedError}   If the ballot is no longer accepting votes.
   * @throws {BallotNotFoundError} If the ballotId does not exist.
   * @throws {TimeoutError}        If the request exceeds `timeoutMs`.
   *
   * @security The plaintext `option` is encrypted before transmission and is
   * never included in the outgoing request body.
   *
   * @example
   * ```typescript
   * const result = await client.submitVote(ballot.id, voterToken, "Approve");
   * console.log(result.voteId);
   * ```
   */
  async submitVote(
    ballotId: string,
    token: string,
    option: string,
  ): Promise<VoteResult> {
    this.requireBallotId(ballotId);
    if (!token || token.trim().length === 0) {
      throw new ValidationError("token is required");
    }
    if (!option || option.trim().length === 0) {
      throw new ValidationError("option is required");
    }

    const encryptedPayload: EncryptedPayload = encryptVote(
      option,
      this.config.ballotEncryptionKey,
    );

    return this.request<VoteResult>("POST", `/ballots/${ballotId}/votes`, {
      token,
      encryptedPayload,
    });
  }

  /**
   * Submits a homomorphic encrypted vote with an attached Zero-Knowledge Proof.
   *
   * @param ballotId - The ID of the ballot.
   * @param token - One-time voter token.
   * @param optionIndex - Selected option index.
   * @param totalOptions - Total options count.
   * @param paillierKey - Optional explicit Paillier key (defaults to config).
   */
  async submitHomomorphicVote(
    ballotId: string,
    token: string,
    optionIndex: number,
    totalOptions: number,
    paillierKey?: PaillierPublicKey,
  ): Promise<VoteResult> {
    this.requireBallotId(ballotId);
    if (!token || token.trim().length === 0) {
      throw new ValidationError("token is required");
    }

    const key = paillierKey || this.config.paillierPublicKey;
    if (!key) {
      throw new ValidationError(
        "paillierPublicKey is required either in params or client config",
      );
    }

    const homomorphicVote: HomomorphicEncryptedVote = createHomomorphicVote(
      optionIndex,
      totalOptions,
      ballotId,
      key,
    );

    return this.request<VoteResult>("POST", `/ballots/${ballotId}/votes`, {
      token,
      homomorphicVote,
    });
  }

  /**
   * Retrieves the published tally results for a ballot.
   *
   * @description Sends a GET request to `/ballots/:ballotId/results`.
   *
   * @param ballotId - The ID of the ballot to retrieve results for.
   * @returns {@link BallotResults} including per-option vote counts.
   *
   * @throws {ValidationError}     If ballotId is invalid.
   * @throws {BallotNotFoundError} If the ballotId does not exist.
   * @throws {TimeoutError}        If the request exceeds `timeoutMs`.
   *
   * @example
   * ```typescript
   * const results = await client.getBallotResults(ballot.id);
   * for (const opt of results.options) {
   *   console.log(`${opt.text}: ${opt.votes} votes (${opt.percentage}%)`);
   * }
   * ```
   */
  async getBallotResults(ballotId: string): Promise<BallotResults> {
    this.requireBallotId(ballotId);

    return this.request<BallotResults>("GET", `/ballots/${ballotId}/results`);
  }

  /**
   * Verifies the integrity of a ballot's published results.
   *
   * Checks that the vote count is consistent with audit records and, if
   * available, the Stellar blockchain anchor.
   *
   * @description Sends a GET request to `/ballots/:ballotId/verify`.
   *
   * @param ballotId - The ID of the ballot to verify.
   * @returns A {@link VerificationReport} with consistency status.
   *
   * @throws {ValidationError}     If ballotId is invalid.
   * @throws {BallotNotFoundError} If the ballotId does not exist.
   * @throws {TimeoutError}        If the request exceeds `timeoutMs`.
   *
   * @example
   * ```typescript
   * const report = await client.verifyResults(ballot.id);
   * console.log(report.isConsistent); // true
   * ```
   */
  async verifyResults(ballotId: string): Promise<VerificationReport> {
    this.requireBallotId(ballotId);

    return this.request<VerificationReport>(
      "GET",
      `/ballots/${ballotId}/verify`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Core request method. Wraps fetch with timeout, auth headers, and retry.
   * Maps HTTP error status codes to typed SDK error classes.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return withRetry(
      () => this.fetchWithTimeout<T>(method, path, body),
      this.retryConfig,
    );
  }

  private async fetchWithTimeout<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.authToken) {
      headers["Authorization"] = `Bearer ${this.config.authToken}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new TimeoutError(
          `Request to ${method} ${path} timed out after ${this.timeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      await this.throwForStatus(res, path);
    }

    return res.json() as Promise<T>;
  }

  /** Maps HTTP status codes to typed SDK errors. */
  private async throwForStatus(res: Response, path: string): Promise<never> {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore — use statusText
    }

    switch (res.status) {
      case 401:
      case 403:
        throw new AuthError(`Authentication failed: ${message}`);
      case 404:
        throw new BallotNotFoundError(
          `Resource not found at ${path}: ${message}`,
        );
      case 409:
        throw new InvalidTokenError(`Token conflict: ${message}`);
      case 410:
        throw new BallotClosedError(`Ballot is closed: ${message}`);
      case 422:
        throw new InvalidTokenError(`Invalid token: ${message}`);
      default:
        throw new HttpError(res.status, message);
    }
  }

  private requireBallotId(ballotId: string): void {
    if (!ballotId || ballotId.trim().length === 0) {
      throw new ValidationError("ballotId is required");
    }
  }
}
