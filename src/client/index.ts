import { randomUUID } from "../random";
import { encryptVote, decryptVote } from "../crypto";
import { ValidationError } from "../errors";
import {
  createHomomorphicVote,
  verifyHomomorphicVote,
} from "../zkp/proofs";
import type {
  PaillierPublicKey,
  HomomorphicEncryptedVote,
  ZKPVerificationReport,
} from "../zkp/types";
import type {
  ClientConfig,
  ElectionOptions,
  Election,
  ElectionOption,
  Ballot,
  VerificationResult,
} from "./types";

export type {
  ClientConfig,
  ElectionOptions,
  Election,
  ElectionOption,
  Ballot,
  VoteReceipt,
  VerificationResult,
} from "./types";

/** Regex that matches a valid 64-character lowercase hex string. */
const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Generates an RFC 4122 v4 UUID from 16 cryptographically random bytes.
 *
 * Delegates to the shared cross-runtime implementation; the local copy used
 * Node's `randomBytes` and `Buffer.prototype.toString("hex")`, neither of
 * which exists in edge runtimes.
 */
const generateUUID = randomUUID;

/** Returns the derived status of an election relative to now. */
function deriveStatus(election: Election): Election["status"] {
  const now = Date.now();
  if (now < election.startTime.getTime()) return "draft";
  if (now > election.endTime.getTime()) return "closed";
  return "active";
}

/**
 * AnonVoteClient — the developer-facing SDK for the AnonVote ecosystem.
 *
 * Wraps the low-level cryptographic primitives in an opinionated, minimal API
 * that enforces correct usage patterns. It is impossible to use this client in
 * a way that violates the AnonVote privacy model.
 *
 * @example
 * ```typescript
 * import { AnonVoteClient } from "@anonvote/crypto/client";
 * import { randomBytes } from "crypto";
 *
 * const client = new AnonVoteClient({
 *   ballotKey: randomBytes(32).toString("hex"),
 * });
 *
 * const election = client.createElection({
 *   title: "Board vote 2026",
 *   description: "Elect the new board.",
 *   options: ["Alice", "Bob"],
 *   startTime: new Date(),
 *   endTime: new Date(Date.now() + 86_400_000),
 * });
 *
 * const ballot = client.castVote(election, election.options[0].id);
 * const result = client.verifyVote(ballot);
 * console.log(result.confirmed); // true
 * ```
 */
export class AnonVoteClient {
  private readonly config: ClientConfig;

  /**
   * Creates a new AnonVoteClient.
   *
   * @param config - Client configuration containing the per-ballot encryption key.
   * @throws {ValidationError} INVALID_KEY — if `ballotKey` is not a 64-character hex string.
   *
   * @example
   * ```typescript
   * const client = new AnonVoteClient({
   *   ballotKey: randomBytes(32).toString("hex"),
   * });
   * ```
   */
  constructor(config: ClientConfig) {
    if (!HEX_64.test(config.ballotKey)) {
      throw new ValidationError(
        "INVALID_KEY: ballotKey must be a 64-character hex string (32 bytes). " +
          "Generate one with: crypto.randomBytes(32).toString('hex')",
      );
    }
    this.config = config;
  }

  /**
   * Creates a new election object.
   *
   * This is a pure client-side operation — no network calls are made.
   * Generates a UUID for the election and for each option. Option UUIDs
   * (not labels) are what get passed to castVote, ensuring no option text
   * ever reaches the encryption layer.
   *
   * @description Creates and returns an Election with unique UUIDs for the
   * election ID and every option ID. All validation is performed before any
   * IDs are generated.
   *
   * @param options - Election creation parameters.
   * @returns A fully formed {@link Election} object ready for use with castVote.
   *
   * @throws {ValidationError} INVALID_ELECTION — fewer than 2 options.
   * @throws {ValidationError} INVALID_ELECTION — more than 10 options.
   * @throws {ValidationError} INVALID_ELECTION — endTime is not after startTime.
   * @throws {ValidationError} INVALID_ELECTION — endTime is in the past.
   *
   * @example
   * ```typescript
   * const election = client.createElection({
   *   title: "Budget vote",
   *   description: "Approve or reject the Q3 budget.",
   *   options: ["Approve", "Reject"],
   *   startTime: new Date(),
   *   endTime: new Date(Date.now() + 7 * 86_400_000),
   * });
   * ```
   */
  createElection(options: ElectionOptions): Election {
    if (!options.title || options.title.trim().length === 0) {
      throw new ValidationError("INVALID_ELECTION: title is required");
    }
    if (!options.description || options.description.trim().length === 0) {
      throw new ValidationError("INVALID_ELECTION: description is required");
    }
    if (!Array.isArray(options.options) || options.options.length < 2) {
      throw new ValidationError(
        "INVALID_ELECTION: options must contain at least 2 entries",
      );
    }
    if (options.options.length > 10) {
      throw new ValidationError(
        "INVALID_ELECTION: options must contain at most 10 entries",
      );
    }
    if (!(options.startTime instanceof Date) || isNaN(options.startTime.getTime())) {
      throw new ValidationError("INVALID_ELECTION: startTime must be a valid Date");
    }
    if (!(options.endTime instanceof Date) || isNaN(options.endTime.getTime())) {
      throw new ValidationError("INVALID_ELECTION: endTime must be a valid Date");
    }
    if (options.endTime.getTime() <= options.startTime.getTime()) {
      throw new ValidationError("INVALID_ELECTION: endTime must be after startTime");
    }
    if (options.endTime.getTime() <= Date.now()) {
      throw new ValidationError("INVALID_ELECTION: endTime must be in the future");
    }

    const electionOptions: ElectionOption[] = options.options.map(
      (label, index) => ({
        id: generateUUID(),
        label,
        index,
      }),
    );

    const election: Election = {
      id: generateUUID(),
      title: options.title,
      description: options.description,
      options: electionOptions,
      startTime: options.startTime,
      endTime: options.endTime,
      createdAt: new Date(),
      status: "draft",
    };

    // status is computed dynamically — set it now based on current time
    election.status = deriveStatus(election);

    return election;
  }

  /**
   * Casts a vote in an election.
   *
   * Validates the optionId against the election's options and checks that the
   * election is currently active. Encrypts the optionId using AES-256-GCM.
   * The returned Ballot contains the optionId locally so the voter can confirm
   * their choice before submission — it is not included in the serialized payload.
   *
   * @description Encrypts the selected optionId and returns a Ballot. The
   * optionId is never logged. Only the encryptedPayload is suitable for
   * server submission.
   *
   * @param election - The election to vote in, as returned by createElection.
   * @param optionId - The ID of the chosen option (from election.options[n].id).
   * @returns A {@link Ballot} with the encrypted payload and local optionId.
   *
   * @throws {ValidationError} INVALID_OPTION — optionId not found in election.options.
   * @throws {ValidationError} ELECTION_NOT_ACTIVE — election status is not active
   *   or current time is outside [startTime, endTime].
   *
   * @security The optionId is never logged. Only encryptedPayload leaves this
   * method in a form suitable for server submission. The optionId in the
   * returned Ballot is local only and must not be sent to the server.
   *
   * @example
   * ```typescript
   * const ballot = client.castVote(election, election.options[0].id);
   * const serialized = client.serialize(ballot); // safe to send to server
   * ```
   */
  castVote(election: Election, optionId: string): Ballot {
    const option = election.options.find((o) => o.id === optionId);
    if (!option) {
      throw new ValidationError(
        "INVALID_OPTION: optionId does not match any option in this election",
      );
    }

    const now = Date.now();
    const isActive =
      election.status === "active" &&
      now >= election.startTime.getTime() &&
      now <= election.endTime.getTime();

    if (!isActive) {
      throw new ValidationError(
        "ELECTION_NOT_ACTIVE: this election is not currently accepting votes",
      );
    }

    const encryptedPayload = encryptVote(optionId, this.config.ballotKey);

    return {
      electionId: election.id,
      optionId,
      encryptedPayload,
      createdAt: new Date(),
    };
  }

  /**
   * Casts a homomorphic vote with an attached Zero-Knowledge Proof (NIZK).
   *
   * @param election - The active election to vote in.
   * @param optionId - Selected option UUID.
   * @param paillierKey - Optional explicit Paillier public key (falls back to client config).
   * @returns A {@link HomomorphicEncryptedVote} containing encrypted vector and ZKP validity proof.
   */
  castVoteHomomorphic(
    election: Election,
    optionId: string,
    paillierKey?: PaillierPublicKey,
  ): HomomorphicEncryptedVote {
    const optionIndex = election.options.findIndex((o) => o.id === optionId);
    if (optionIndex === -1) {
      throw new ValidationError(
        "INVALID_OPTION: optionId does not match any option in this election",
      );
    }

    const key = paillierKey || this.config.paillierPublicKey;
    if (!key) {
      throw new ValidationError(
        "paillierPublicKey is required to cast homomorphic vote",
      );
    }

    return createHomomorphicVote(
      optionIndex,
      election.options.length,
      election.id,
      key,
    );
  }

  /**
   * Verifies a voter's zero-knowledge validity proof without decrypting the vote.
   *
   * @param vote - The homomorphic encrypted vote to audit.
   * @param paillierKey - Optional explicit Paillier public key.
   */
  verifyVoteZKP(
    vote: HomomorphicEncryptedVote,
    paillierKey?: PaillierPublicKey,
  ): ZKPVerificationReport {
    const key = paillierKey || this.config.paillierPublicKey;
    if (!key) {
      throw new ValidationError(
        "paillierPublicKey is required to verify vote proof",
      );
    }
    return verifyHomomorphicVote(vote, key);
  }

  /**
   * Verifies a ballot locally without contacting the server.
   *
   * Decrypts the ballot's encryptedPayload and confirms the result matches
   * the ballot's optionId. If decryptVote throws, the error is propagated —
   * a decryption failure is a different failure mode from an option mismatch
   * and must surface to the caller.
   *
   * @description Local verification that a ballot produced by castVote can be
   * successfully decrypted and that the decrypted value matches optionId.
   *
   * @param ballot - The ballot to verify, as returned by castVote.
   * @returns {@link VerificationResult} with confirmed: true if the decrypted
   * value matches ballot.optionId, confirmed: false if they differ.
   *
   * @throws {CryptoError} If decryptVote fails — payload is corrupted or key
   * is wrong. This is intentionally not caught; callers must handle it.
   *
   * @example
   * ```typescript
   * const result = client.verifyVote(ballot);
   * if (!result.confirmed) {
   *   throw new Error("Ballot integrity check failed");
   * }
   * ```
   */
  verifyVote(ballot: Ballot): VerificationResult {
    // decryptVote errors propagate — do NOT catch them here
    const decrypted = decryptVote(ballot.encryptedPayload, this.config.ballotKey);

    return {
      confirmed: decrypted === ballot.optionId,
      electionId: ballot.electionId,
      checkedAt: new Date(),
    };
  }

  /**
   * Serializes a Ballot to a deterministic JSON string for server submission.
   *
   * Keys are sorted alphabetically so the same ballot always produces the
   * same string. Only electionId and encryptedPayload are included — the
   * optionId is deliberately omitted.
   *
   * @description Converts a Ballot to a stable JSON string. Only fields safe
   * for server submission are included.
   *
   * @param ballot - The ballot to serialize, as returned by castVote.
   * @returns A deterministic JSON string containing electionId and
   * encryptedPayload only.
   *
   * @security The optionId is intentionally excluded. The option the voter
   * chose must never leave the client in plaintext — only the encrypted
   * payload is sent to the server. Including optionId here would break the
   * privacy model.
   *
   * @example
   * ```typescript
   * const json = client.serialize(ballot);
   * await fetch("/api/votes", { method: "POST", body: json });
   * ```
   */
  serialize(ballot: Ballot): string {
    // Sort keys alphabetically for deterministic output.
    // optionId is intentionally excluded — see @security above.
    const payload = {
      electionId: ballot.electionId,
      encryptedPayload: {
        authTag: ballot.encryptedPayload.authTag,
        ciphertext: ballot.encryptedPayload.ciphertext,
        iv: ballot.encryptedPayload.iv,
      },
    };
    return JSON.stringify(payload);
  }

  /**
   * Deserializes a JSON string produced by serialize back into a Ballot.
   *
   * Validates that electionId is a non-empty string and that encryptedPayload
   * contains ciphertext, iv, and authTag. The returned Ballot has no optionId —
   * it was never serialized, by design.
   *
   * @description Parses a serialized ballot string and validates its structure.
   * The resulting Ballot has optionId set to an empty string because the option
   * ID was never included in the serialized form.
   *
   * @param serialized - A JSON string produced by serialize.
   * @returns A {@link Ballot} without optionId (empty string).
   *
   * @throws {ValidationError} INVALID_SERIALIZED_BALLOT — if the JSON is
   * malformed or required fields are missing or invalid.
   *
   * @example
   * ```typescript
   * const ballot = client.deserialize(storedJson);
   * // ballot.optionId === "" — not included in serialized form by design
   * ```
   */
  deserialize(serialized: string): Ballot {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: input is not valid JSON",
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: expected a JSON object",
      );
    }

    const obj = parsed as Record<string, unknown>;

    if (!obj.electionId || typeof obj.electionId !== "string") {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: missing or invalid electionId",
      );
    }

    const ep = obj.encryptedPayload;
    if (!ep || typeof ep !== "object") {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: missing encryptedPayload",
      );
    }

    const epObj = ep as Record<string, unknown>;
    if (!epObj.ciphertext || typeof epObj.ciphertext !== "string") {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: encryptedPayload missing ciphertext",
      );
    }
    if (!epObj.iv || typeof epObj.iv !== "string") {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: encryptedPayload missing iv",
      );
    }
    if (!epObj.authTag || typeof epObj.authTag !== "string") {
      throw new ValidationError(
        "INVALID_SERIALIZED_BALLOT: encryptedPayload missing authTag",
      );
    }

    return {
      electionId: obj.electionId,
      // optionId is not in the serialized form by design
      optionId: "",
      encryptedPayload: {
        ciphertext: epObj.ciphertext,
        iv: epObj.iv,
        authTag: epObj.authTag,
      },
      createdAt: new Date(),
    };
  }
}
