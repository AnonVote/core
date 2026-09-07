/**
 * Shared TypeScript types for the AnonVote ecosystem.
 *
 * These types are the single source of truth for ballot, token, vote,
 * result, and audit data shapes used across core, client SDKs, and
 * any future consumer of the AnonVote protocol.
 */

// Re-export ZKP and Paillier types
export type {
  PaillierPublicKey,
  PaillierPrivateKey,
  HomomorphicEncryptedVote,
  TallyDecryptionProof,
  ZKPVerificationReport,
  MerkleProof,
} from "./zkp/types";

// ── Ballot ────────────────────────────────────────────────────────────────────

export type BallotStatus = "OPEN" | "CLOSED";

export interface Option {
  id: string;
  ballotId: string;
  text: string;
}

export interface Ballot {
  id: string;
  organizationId: string;
  topic: string;
  status: BallotStatus;
  deadline: string;
  eligibilityListId: string;
  allowWeightedVoting: boolean;
  allowRankedChoice: boolean;
  maxRankings?: number;
  createdAt: string;
  options: Option[];
  votesCast?: number;
  tokensIssued?: number;
  eligibleVoters?: number;
}

// ── Eligibility ───────────────────────────────────────────────────────────────

export interface EligibilityList {
  id: string;
  createdAt: string;
}

/**
 * An entry in an eligibility list.
 * `identifierHash` is the SHA-256 hash of the voter identifier — the original
 * is never stored. See {@link hashIdentifier}.
 */
export interface EligibilityEntry {
  id: string;
  eligibilityListId: string;
  identifierHash: string;
  weight: number;
  tokenIssued: boolean;
}

// ── Token ─────────────────────────────────────────────────────────────────────

/**
 * A raw token paired with its hash.
 * `value` is the raw token from {@link generateToken} — never persisted.
 * `hash` is the result of {@link hashToken} — safe to store.
 */
export interface Token {
  value: string;
  hash: string;
}

/**
 * A one-time voter token record.
 * `tokenHash` is the SHA-256 hash of the raw token — the raw value is never
 * stored. See {@link generateToken} and {@link hashToken}.
 */
export interface VoterToken {
  id: string;
  tokenHash: string;
  ballotId: string;
  used: boolean;
  issuedAt: string;
  usedAt?: string;
  /** If set, this token was the recipient of a delegation. */
  delegatedFrom?: string;
  /** If set, this token delegates its vote to another token. */
  delegatedTo?: string;
}

// ── Vote ──────────────────────────────────────────────────────────────────────

/**
 * An encrypted vote payload.
 *
 * AES-256-GCM produces three outputs:
 * - `iv` — a random 96-bit initialization vector (base64-encoded)
 * - `ciphertext` — the encrypted vote option (base64-encoded)
 * - `authTag` — a 128-bit GCM authentication tag (base64-encoded)
 *
 * The auth tag is verified on decryption, making any tampering detectable.
 * The IV ensures that encrypting the same plaintext with the same key
 * produces different ciphertext each time (non-deterministic encryption).
 */
export interface EncryptedVote {
  iv: string;
  ciphertext: string;
  authTag: string;
}

/**
 * A submitted vote.
 * `encryptedPayload` is the AES-256-GCM encrypted option ID.
 * See {@link encryptVote} and {@link decryptVote}.
 * A raw vote, prior to encryption.
 */
export interface Vote {
  ballotId: string;
  option: string;
  timestamp: number;
}

/**
 * An AES-256-GCM encrypted payload, produced by {@link encryptVote} and
 * consumed by {@link decryptVote}. All fields are hex-encoded strings.
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypted payload extended with a reference to the key version used.
 *
 * Store this alongside the ciphertext so the correct historical key can be
 * retrieved for decryption even after a key rotation.
 */
export interface EncryptedPayloadWithKeyRef extends EncryptedPayload {
  /** Key family identifier (matches `KeyMetadata.id`). */
  keyId: string;
  /** Key version number (matches `KeyMetadata.version`). */
  keyVersion: number;
}

// ── Organization ──────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

// ── Results ───────────────────────────────────────────────────────────────────

export interface Result {
  id: string;
  ballotId: string;
  tallyJson: string;
  totalVotes: number;
  isConsistent: boolean;
  stellarTxId?: string;
  publishedAt: string;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export type AuditEventType =
  | "TOKEN_ISSUED"
  | "VOTE_CAST"
  | "RESULT_PUBLISHED"
  | "DUPLICATE_TOKEN_ATTEMPT"
  | "DUPLICATE_VOTE_ATTEMPT";

export interface AuditEvent {
  id: string;
  ballotId: string;
  eventType: AuditEventType;
  stellarTxId?: string;
  createdAt: string;
}

export interface AuditCounts {
  tokensIssued: number;
  votesCast: number;
  events: AuditEvent[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface TokenResponse {
  token: string;
  weight: number;
}

export interface LoginResponse {
  organizationId: string;
  name: string;
}

// ── Client SDK Types ──────────────────────────────────────────────────────────

/**
 * Configuration for automatic retry with exponential backoff.
 *
 * Retries are only attempted for transient failures (network errors or
 * specific HTTP status codes). Permanent failures (e.g. 4xx except 429)
 * are not retried.
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts before giving up.
   * @default 3
   */
  maxRetries: number;
  /**
   * Initial delay in milliseconds before the first retry.
   * @default 100
   */
  initialDelayMs: number;
  /**
   * Maximum delay in milliseconds between retries. The exponential
   * backoff is capped at this value.
   * @default 5000
   */
  maxDelayMs: number;
  /**
   * Multiplier applied to the delay on each successive retry.
   * Delay formula: min(initialDelayMs * backoffMultiplier^attempt, maxDelayMs)
   * @default 2
   */
  backoffMultiplier: number;
  /**
   * HTTP status codes that should trigger a retry.
   * @default [408, 429, 500, 502, 503, 504]
   */
  retryableStatusCodes: number[];
}

/**
 * Configuration options for the AnonVoteClient.
 *
 * Supports two modes:
 * - **Legacy**: supply `encryptionKey` as a 64-char hex string (unchanged behavior).
 * - **Managed**: supply a `KeyManager` instance for versioned key rotation.
 *
 * When `keyManager` is present it takes precedence over `encryptionKey`.
 */
export interface ClientConfig {
  /** The encryption key used for vote encryption (64-char hex string). */
  encryptionKey?: string;
  /**
   * A `KeyManager` for versioned key derivation and rotation.
   * When provided, takes precedence over `encryptionKey`.
   * Import `SimpleKeyManager` from `@anonvote/crypto` for an in-process implementation.
   */
  keyManager?: import("./keyManagement").KeyManager;
  /** Optional retry configuration. Defaults are applied for any omitted fields. */
  retryConfig?: Partial<RetryConfig>;
}

/**
 * An option within an election.
 */
export interface ElectionOption {
  /** Unique identifier for this option. */
  id: string;
  /** The text displayed to voters for this option. */
  text: string;
}

/**
 * Input parameters for creating a new election.
 */
export interface CreateElectionParams {
  /** The title of the election. */
  title: string;
  /** A description of the election. */
  description: string;
  /** The available voting options (e.g. ["Yes", "No", "Abstain"]). */
  options: string[];
  /** The election start time (ISO 8601 string or Unix timestamp). */
  startTime: string | number;
  /** The election end time (ISO 8601 string or Unix timestamp). */
  endTime: string | number;
}

/**
 * Represents an election created by the AnonVoteClient.
 */
export interface Election {
  /** Unique identifier for the election. */
  id: string;
  /** The title of the election. */
  title: string;
  /** A description of what the election is about. */
  description: string;
  /** The available voting options. */
  options: ElectionOption[];
  /** When the election starts (ISO 8601). */
  startTime: string;
  /** When the election ends (ISO 8601). */
  endTime: string;
  /** When the election was created (ISO 8601). */
  createdAt: string;
}

/**
 * Input parameters for casting a vote.
 */
export interface CastVoteParams {
  /** The ballot/election ID to vote in. */
  ballotId: string;
  /** The selected vote option (must match one of the election's options). */
  voteOption: string;
  /** The encryption key (64-char hex string) for encrypting the vote. Falls back to client config. */
  encryptionKey?: string;
}

/**
 * A receipt confirming a vote was successfully cast.
 */
export interface VoteReceipt {
  /** Unique identifier for this receipt. */
  id: string;
  /** The election ID this vote belongs to. */
  electionId: string;
  /** The ballot ID associated with this vote. */
  ballotId: string;
  /** The encrypted vote payload. */
  encryptedPayload: EncryptedPayload;
  /** When the vote was cast (ISO 8601). */
  castAt: string;
  /** Whether the vote has been verified. */
  verified: boolean;
}
