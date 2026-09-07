import { getRandomBytes, bytesToHex } from "./random";
import {
  encryptVote,
  decryptVote,
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
} from "./crypto";
import { ValidationError } from "./errors";
import { withRetry, resolveRetryConfig } from "./retry";
import { getCurrentKeyHex, lookupKeyVersion } from "./keyManagement";
import type {
  Election,
  ElectionOption,
  VoteReceipt,
  ClientConfig,
  RetryConfig,
  CreateElectionParams,
  CastVoteParams,
  EncryptedPayload,
  EncryptedPayloadWithKeyRef,
  PaillierPublicKey,
  PaillierPrivateKey,
  HomomorphicEncryptedVote,
  TallyDecryptionProof,
  ZKPVerificationReport,
} from "./types";
import type { KeyManager } from "./keyManagement";

/**
 * Serialized election payload suitable for APIs or blockchain transactions.
 *
 * All date fields are ISO 8601 strings. This interface mirrors {@link Election}
 * but guarantees JSON-safe output (no `Date` objects).
 */
export interface SerializedElection {
  id: string;
  title: string;
  description: string;
  options: ElectionOption[];
  startTime: string;
  endTime: string;
  createdAt: string;
}

/**
 * The primary SDK interface for interacting with AnonVote.
 *
 * `AnonVoteClient` provides a minimal, consistent, and framework-agnostic API
 * for creating elections, casting votes, verifying encrypted payloads, and
 * serializing/deserializing election objects. It encapsulates all cryptographic
 * operations so callers never need to handle raw keys or payloads directly.
 *
 * @example
 * ```typescript
 * import { AnonVoteClient } from "@anonvote/crypto";
 *
 * const client = new AnonVoteClient({
 *   encryptionKey: process.env.BALLOT_ENCRYPTION_KEY!,
 * });
 *
 * const election = client.createElection({
 *   title: "Board Election 2024",
 *   description: "Elect the new board members",
 *   options: ["Alice", "Bob", "Charlie"],
 *   startTime: Date.now(),
 *   endTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
 * });
 *
 * const receipt = client.castVote({
 *   ballotId: election.id,
 *   voteOption: election.options[0].text,
 * });
 *
 * const isValid = client.verifyVote(receipt.encryptedPayload);
 * ```
 */
export class AnonVoteClient {
  private readonly config: ClientConfig;
  private readonly retryConfig: RetryConfig;

  /**
   * Optional callback invoked before each retry attempt. Receives the
   * 1-based attempt number, the computed backoff delay in milliseconds, and
   * the error that caused the retry. Override this on the instance to add
   * custom logging without violating the no-console lint rule.
   *
   * @example
   * ```typescript
   * const client = new AnonVoteClient({ encryptionKey: key });
   * client.onRetry = (attempt, delayMs, error) => {
   *   myLogger.warn(`Retry attempt ${attempt} after ${delayMs}ms`, error);
   * };
   * ```
   */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;

  /**
   * Creates a new `AnonVoteClient` instance.
   *
   * @param config - Optional client configuration. When `encryptionKey` is
   *                 provided here it is used as the default for all operations
   *                 that require a key; individual method calls can override it.
   *                 If omitted, an `encryptionKey` must be supplied explicitly
   *                 in each method call that requires one.
   */
  constructor(config: ClientConfig = {}) {
    this.config = config;
    this.retryConfig = resolveRetryConfig(config.retryConfig);
  }

  /**
   * Executes an async operation with automatic retry and exponential backoff
   * using the client's configured {@link RetryConfig}.
   *
   * Useful for wrapping HTTP calls that talk to the AnonVote backend:
   *
   * @example
   * ```typescript
   * const result = await client.execute(() =>
   *   fetch(`${apiUrl}/ballots`, { method: "POST", body: JSON.stringify(data) })
   *     .then(async (res) => {
   *       if (!res.ok) throw new HttpError(res.status, res.statusText);
   *       return res.json();
   *     })
   * );
   * ```
   *
   * @param operation - Async operation to execute and potentially retry.
   * @returns The resolved value of the operation.
   */
  execute<T>(operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, this.retryConfig, this.onRetry?.bind(this));
  }

  /**
   * Creates a new election object.
   *
   * Validates all inputs, generates a unique election ID, assigns IDs to each
   * option, and returns a fully formed {@link Election} ready for storage or
   * submission.
   *
   * @param params - The election creation parameters including title,
   *                 description, options array, and start/end times.
   * @returns A strongly typed {@link Election} object.
   * @throws {@link ValidationError} if `title` or `description` is empty, if
   *         `options` is empty or contains blank entries, if `startTime` or
   *         `endTime` is not a valid date or timestamp, or if `endTime` is not
   *         after `startTime`.
   *
   * @example
   * ```typescript
   * const election = client.createElection({
   *   title: "Q1 Budget Vote",
   *   description: "Approve or reject the Q1 budget proposal.",
   *   options: ["Approve", "Reject"],
   *   startTime: "2024-03-01T00:00:00Z",
   *   endTime: "2024-03-08T00:00:00Z",
   * });
   * ```
   */
  createElection(params: CreateElectionParams): Election {
    // Validate title
    if (
      !params.title ||
      (typeof params.title === "string" && params.title.trim().length === 0)
    ) {
      throw new ValidationError("Election title is required");
    }

    // Validate description
    if (
      !params.description ||
      (typeof params.description === "string" &&
        params.description.trim().length === 0)
    ) {
      throw new ValidationError("Election description is required");
    }

    // Validate options
    if (
      !params.options ||
      !Array.isArray(params.options) ||
      params.options.length === 0
    ) {
      throw new ValidationError("At least one voting option is required");
    }

    // Validate each option is non-empty
    for (const opt of params.options) {
      if (!opt || (typeof opt === "string" && opt.trim().length === 0)) {
        throw new ValidationError("Voting options cannot be empty strings");
      }
    }

    // Validate startTime
    const startTimeMs = this.parseTimestamp(params.startTime);
    if (isNaN(startTimeMs)) {
      throw new ValidationError(
        "Invalid startTime: must be a valid date or timestamp",
      );
    }

    // Validate endTime
    const endTimeMs = this.parseTimestamp(params.endTime);
    if (isNaN(endTimeMs)) {
      throw new ValidationError(
        "Invalid endTime: must be a valid date or timestamp",
      );
    }

    if (endTimeMs <= startTimeMs) {
      throw new ValidationError("endTime must be after startTime");
    }

    const now = new Date();
    const createdAt = now.toISOString();

    // Generate election ID
    const id = this.generateId("elec");

    // Create options with generated IDs
    const electionOptions: ElectionOption[] = params.options.map(
      (text, index) => ({
        id: this.generateId(`option-${index}`),
        text: text.trim(),
      }),
    );

    return {
      id,
      title:
        typeof params.title === "string"
          ? params.title.trim()
          : String(params.title),
      description:
        typeof params.description === "string"
          ? params.description.trim()
          : String(params.description),
      options: electionOptions,
      startTime: new Date(startTimeMs).toISOString(),
      endTime: new Date(endTimeMs).toISOString(),
      createdAt,
    };
  }

  /**
   * Casts a vote for a specific option in an election.
   *
   * Validates all inputs, encrypts the selected option using AES-256-GCM via
   * {@link encryptVote}, and returns a {@link VoteReceipt} containing the
   * encrypted payload ready for submission.
   *
   * @param params - The vote casting parameters: `ballotId`, `voteOption`, and
   *                 an optional `encryptionKey` (falls back to the key in the
   *                 client config if not provided).
   * @returns A {@link VoteReceipt} containing the encrypted payload, receipt ID,
   *          and timestamp.
   * @throws {@link ValidationError} if `ballotId` or `voteOption` is empty, or
   *         if no `encryptionKey` is available from params or client config.
   * @throws {@link ValidationError} if the resolved `encryptionKey` is not a
   *         valid 64-character hex string (propagated from {@link encryptVote}).
   *
   * @example
   * ```typescript
   * const receipt = client.castVote({
   *   ballotId: election.id,
   *   voteOption: "Alice",
   * });
   * // receipt.encryptedPayload contains the AES-256-GCM ciphertext
   * ```
   */
  castVote(params: CastVoteParams): VoteReceipt {
    if (
      !params.ballotId ||
      (typeof params.ballotId === "string" &&
        params.ballotId.trim().length === 0)
    ) {
      throw new ValidationError("ballotId is required");
    }

    if (
      !params.voteOption ||
      (typeof params.voteOption === "string" &&
        params.voteOption.trim().length === 0)
    ) {
      throw new ValidationError("voteOption is required");
    }

    // Resolve encryption key: KeyManager takes precedence over raw key.
    let encryptionKey: string;
    let keyRef: { keyId: string; keyVersion: number } | undefined;

    if (this.config.keyManager) {
      const kv = this.config.keyManager.getCurrentKey();
      encryptionKey = kv.keyHex;
      keyRef = { keyId: kv.metadata.id, keyVersion: kv.metadata.version };
    } else {
      encryptionKey = params.encryptionKey || this.config.encryptionKey || "";
    }

    if (!encryptionKey) {
      throw new ValidationError(
        "encryptionKey is required either in params, client config, or via a KeyManager",
      );
    }

    // Encrypt the vote
    const encryptedVote = encryptVote(params.voteOption.trim(), encryptionKey);

    const id = this.generateId("receipt");
    const castAt = new Date().toISOString();

    const encryptedPayload: EncryptedPayload | EncryptedPayloadWithKeyRef =
      keyRef
        ? {
            ...encryptedVote,
            keyId: keyRef.keyId,
            keyVersion: keyRef.keyVersion,
          }
        : encryptedVote;

    return {
      id,
      electionId: params.ballotId,
      ballotId: params.ballotId,
      encryptedPayload,
      castAt,
      verified: false,
    };
  }

  /**
   * Verifies that an encrypted vote payload is valid and can be decrypted.
   *
   * Attempts to decrypt the payload using the provided or configured encryption
   * key. Returns `true` if decryption succeeds and produces a non-empty string;
   * returns `false` for any failure including missing fields, missing key, or
   * authentication tag mismatch.
   *
   * @param encryptedPayload - The {@link EncryptedPayload} to verify, as
   *                           returned by {@link castVote}.
   * @param encryptionKey    - Optional 64-character hex key. Falls back to the
   *                           key supplied in the client config.
   * @returns `true` if the payload decrypts successfully; `false` otherwise.
   *
   * @example
   * ```typescript
   * const isValid = client.verifyVote(receipt.encryptedPayload);
   * console.log(isValid); // true
   * ```
   */
  verifyVote(
    encryptedPayload: EncryptedPayload,
    encryptionKey?: string,
  ): boolean {
    if (
      !encryptedPayload ||
      !encryptedPayload.ciphertext ||
      !encryptedPayload.iv ||
      !encryptedPayload.authTag
    ) {
      return false;
    }

    // If the payload carries a key reference and we have a KeyManager,
    // retrieve the exact historical key version used at encryption time.
    const payloadWithRef = encryptedPayload as EncryptedPayloadWithKeyRef;
    if (
      this.config.keyManager &&
      payloadWithRef.keyId !== undefined &&
      payloadWithRef.keyVersion !== undefined
    ) {
      try {
        const kv = lookupKeyVersion(
          this.config.keyManager,
          payloadWithRef.keyId,
          payloadWithRef.keyVersion,
        );
        const decrypted = decryptVote(encryptedPayload, kv.keyHex);
        return typeof decrypted === "string" && decrypted.length > 0;
      } catch {
        return false;
      }
    }

    const key =
      encryptionKey ||
      getCurrentKeyHex(
        this.config.keyManager ?? {
          getCurrentKey: () => ({
            keyHex: this.config.encryptionKey ?? "",
            metadata: { id: "", version: 0, derivedAt: "" },
          }),
          getKeyVersion: () => null,
        },
      ) ||
      this.config.encryptionKey;
    if (!key) {
      return false;
    }

    try {
      const decrypted = decryptVote(encryptedPayload, key);
      // If decryption succeeded, the payload is valid
      return typeof decrypted === "string" && decrypted.length > 0;
    } catch {
      // Decryption failed - invalid payload
      return false;
    }
  }

  /**
   * Casts a homomorphic vote with a Zero-Knowledge Proof (NIZK).
   *
   * @param params - Vote parameters including optionIndex, totalOptions, ballotId, and publicKey.
   * @returns {@link HomomorphicEncryptedVote}
   */
  castVoteHomomorphic(params: {
    ballotId: string;
    optionIndex: number;
    totalOptions: number;
    publicKey: PaillierPublicKey;
  }): HomomorphicEncryptedVote {
    if (!params.ballotId || params.ballotId.trim().length === 0) {
      throw new ValidationError("ballotId is required");
    }
    if (params.optionIndex < 0 || params.optionIndex >= params.totalOptions) {
      throw new ValidationError("optionIndex out of bounds");
    }
    if (!params.publicKey) {
      throw new ValidationError("publicKey is required");
    }

    return encryptVoteHomomorphic(
      params.optionIndex,
      params.totalOptions,
      params.ballotId,
      params.publicKey,
    );
  }

  /**
   * Verifies a Zero-Knowledge Proof attached to an encrypted vote.
   *
   * @param vote - Homomorphic encrypted vote
   * @param publicKey - Paillier public key
   */
  verifyVoteZKP(
    vote: HomomorphicEncryptedVote,
    publicKey: PaillierPublicKey,
  ): ZKPVerificationReport {
    return verifyVoteZKP(vote, publicKey);
  }

  /**
   * Homomorphically aggregates encrypted votes into a verifiable tally result.
   */
  tallyHomomorphic(
    votes: HomomorphicEncryptedVote[],
    publicKey: PaillierPublicKey,
    privateKey: PaillierPrivateKey,
    merkleRoot = "",
  ): TallyDecryptionProof {
    return tallyHomomorphic(votes, publicKey, privateKey, merkleRoot);
  }

  /**
   * Verifies a homomorphic tally decryption proof.
   */
  verifyTallyProof(
    proof: TallyDecryptionProof,
    publicKey: PaillierPublicKey,
  ): boolean {
    return verifyHomomorphicTallyProof(proof, publicKey);
  }

  /**
   * Serializes an {@link Election} object to a JSON-safe payload.
   *
   * Produces a {@link SerializedElection} where all date fields are ISO 8601
   * strings. Suitable for storing in a database, sending over an API, or
   * submitting to a blockchain transaction.
   *
   * @param election - The {@link Election} object to serialize.
   * @returns A {@link SerializedElection} with all fields as plain strings.
   * @throws {@link ValidationError} if `election` is not a valid object.
   *
   * @example
   * ```typescript
   * const payload = client.serialize(election);
   * const json = JSON.stringify(payload);
   * ```
   */
  serialize(election: Election): SerializedElection {
    if (!election || typeof election !== "object") {
      throw new ValidationError("Invalid election object");
    }

    return {
      id: election.id,
      title: election.title,
      description: election.description,
      options: election.options,
      startTime: election.startTime,
      endTime: election.endTime,
      createdAt: election.createdAt,
    };
  }

  /**
   * Deserializes a {@link SerializedElection} payload back into an
   * {@link Election} object.
   *
   * Validates all required fields and their types before returning. Useful for
   * reconstructing an election from a stored JSON payload or an API response.
   *
   * @param payload - The {@link SerializedElection} payload to deserialize.
   * @returns A strongly typed {@link Election} object.
   * @throws {@link ValidationError} if `payload` is not a valid object, or if
   *         any required field (`id`, `title`, `description`, `options`,
   *         `startTime`, `endTime`, `createdAt`) is missing or of the wrong type.
   *
   * @example
   * ```typescript
   * const election = client.deserialize(JSON.parse(storedJson));
   * ```
   */
  deserialize(payload: SerializedElection): Election {
    if (!payload || typeof payload !== "object") {
      throw new ValidationError("Invalid election object");
    }

    // Validate required fields
    if (!payload.id || typeof payload.id !== "string") {
      throw new ValidationError("Invalid payload: missing or invalid id");
    }

    if (!payload.title || typeof payload.title !== "string") {
      throw new ValidationError("Invalid payload: missing or invalid title");
    }

    if (!payload.description || typeof payload.description !== "string") {
      throw new ValidationError(
        "Invalid payload: missing or invalid description",
      );
    }

    if (!Array.isArray(payload.options)) {
      throw new ValidationError("Invalid payload: missing or invalid options");
    }

    // Validate each option has id and text
    for (const opt of payload.options) {
      if (!opt.id || typeof opt.id !== "string") {
        throw new ValidationError("Invalid payload: option missing id");
      }
      if (!opt.text || typeof opt.text !== "string") {
        throw new ValidationError("Invalid payload: option missing text");
      }
    }

    if (!payload.startTime || typeof payload.startTime !== "string") {
      throw new ValidationError(
        "Invalid payload: missing or invalid startTime",
      );
    }

    if (!payload.endTime || typeof payload.endTime !== "string") {
      throw new ValidationError("Invalid payload: missing or invalid endTime");
    }

    if (!payload.createdAt || typeof payload.createdAt !== "string") {
      throw new ValidationError(
        "Invalid payload: missing or invalid createdAt",
      );
    }

    return {
      id: payload.id,
      title: payload.title,
      description: payload.description,
      options: payload.options,
      startTime: payload.startTime,
      endTime: payload.endTime,
      createdAt: payload.createdAt,
    };
  }

  /**
   * Parses a timestamp value (string or number) into milliseconds.
   *
   * @param value - A Unix timestamp in milliseconds (number), an ISO 8601 date
   *                string, or a numeric string representing milliseconds.
   * @returns The timestamp in milliseconds, or `NaN` if the value cannot be
   *          parsed.
   */
  private parseTimestamp(value: string | number): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!isNaN(parsed)) {
        return parsed;
      }
      // Try parsing as a number string
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        return numValue;
      }
    }
    return NaN;
  }

  /**
   * Generates a unique identifier with a given prefix.
   *
   * @param prefix - A short string prepended to the UUID (e.g. `"elec"`,
   *                 `"receipt"`).
   * @returns A string in the form `"<prefix>-<uuid>"` where the UUID is derived
   *          from 16 cryptographically random bytes.
   */
  private generateId(prefix: string): string {
    const hex = bytesToHex(getRandomBytes(16));

    const uuid = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");

    return `${prefix}-${uuid}`;
  }
}
