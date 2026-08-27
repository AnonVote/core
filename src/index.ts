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
  encryptVoteHomomorphic,
  verifyVoteZKP,
  tallyHomomorphic,
  verifyHomomorphicTallyProof,
} from "./crypto";

// FIPS 140-2 Compliance Validation
export {
  validateFIPSCompliance,
  getCachedValidation,
  clearValidationCache,
} from "./fipsValidator";
export type {
  FIPSValidationResult,
  FIPSConfiguration,
} from "./fipsValidator";

// ZKP and Homomorphic Subsystem
export {
  // Math
  mod,
  gcd,
  lcm,
  extendedGcd,
  modInverse,
  modPow,
  hexToBigInt,
  bigIntToHex,
  randomBigInt,
  randomCoprime,
  isProbablePrime,
  generatePrime,
  // Paillier
  paillierL,
  generatePaillierKeyPair,
  encryptPaillier,
  decryptPaillier,
  addPaillier,
  aggregatePaillier,
  multiplyPaillier,
  // Pedersen
  generatePedersenParams,
  commitPedersen,
  verifyPedersenCommitment,
  addPedersenCommitments,
  // ZKP Proofs
  generateBinaryValidityProof,
  verifyBinaryValidityProof,
  createHomomorphicVote,
  verifyHomomorphicVote,
  tallyHomomorphicVotes,
  verifyTallyDecryptionProof,
  // Threshold
  generateThresholdKeyShares,
  generatePartialDecryption,
  combineThresholdDecryptions,
  // Merkle
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from "./zkp";
export type {
  PaillierPublicKey,
  PaillierPrivateKey,
  PaillierKeyPair,
  PaillierCiphertext,
  HomomorphicEncryptedVote,
  BinaryValidityProof,
  BallotValidityProof,
  TallyDecryptionProof,
  ThresholdKeyShare,
  PartialDecryptionShare,
  ThresholdDecryptionResult,
  MerkleProof,
  MerkleTreeCommitment,
  ZKPVerificationReport,
  PedersenParams,
  PedersenCommitment,
} from "./zkp";

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

