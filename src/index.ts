/**
 * @anonvote/crypto
 *
 * Public API for the AnonVote cryptographic primitives, shared types,
 * and the AnonVoteClient SDK.
 */

// Crypto primitives
export {
  hashIdentifier,
  generateToken,
  hashToken,
  encryptVote,
  decryptVote,
  verifyVoteHash,
  verifyVoteProof,
} from "./crypto";

// Helper utilities
export { bytesToBase64Url } from "./utils";

// Retry utility
export {
  withRetry,
  resolveRetryConfig,
  calculateDelay,
  HttpError,
  DEFAULT_RETRY_CONFIG,
} from "./retry";
export type { RetryConfig } from "./types";

// Client SDK
export { AnonVoteClient } from "./client";
export type { SerializedElection } from "./client";

// Error types
export { AnonVoteError, ValidationError, CryptoError } from "./errors";

// Key management (issue #76)
export {
  deriveKey,
  deriveKeyVersion,
  createKeyVersion,
  generateKeyId,
  rotateKey,
  isRotationDue,
  lookupKeyVersion,
  getCurrentKeyHex,
  SimpleKeyManager,
} from "./keyManagement";
export type {
  KeyMetadata,
  KeyVersion,
  RotationPolicy,
  KeyManager,
} from "./keyManagement";

// Core types
export type {
  BallotStatus,
  Option,
  Ballot,
  EligibilityList,
  EligibilityEntry,
  Token,
  VoterToken,
  EncryptedVote,
  Vote,
  EncryptedPayload,
  EncryptedPayloadWithKeyRef,
  Organization,
  Result,
  AuditEventType,
  AuditEvent,
  AuditCounts,
  ApiResponse,
  TokenResponse,
  LoginResponse,
  ClientConfig,
  ElectionOption,
  CreateElectionParams,
  Election,
  CastVoteParams,
  VoteReceipt,
} from "./types";
