/**
 * AnonVote Soroban Service — public API surface
 *
 * All public functions, types, enums, and constants from sorobanService.ts
 * are re-exported here under explicit named exports so the full API surface is
 * self-documenting and tree-shakeable. The wildcard fallback has been replaced
 * to make it immediately clear what is (and is not) part of the public API.
 *
 * Import paths should always target this module rather than sorobanService.ts
 * directly, so the internal file layout can change without breaking callers.
 *
 * ## Error handling
 *
 * All write helpers (`sorobanRecordBallot`, `sorobanRecordVote`, etc.) throw
 * `SorobanServiceError` on failure. Inspect `err.retryable` to decide whether
 * to enqueue a retry or surface the error immediately.
 *
 * @example
 * ```ts
 * import {
 *   createSorobanService,
 *   createDefaultTestnetConfig,
 *   SorobanServiceError,
 * } from "@anonvote/contracts/service";
 * import { Keypair } from "stellar-sdk";
 *
 * const config = createDefaultTestnetConfig({
 *   contractId: process.env.SOROBAN_CONTRACT_ID!,
 *   sourceKeypair: Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!),
 * });
 * const service = createSorobanService(config);
 *
 * try {
 *   await service.sorobanRecordBallot("ballotIdHash");
 * } catch (err) {
 *   if (err instanceof SorobanServiceError && err.retryable) {
 *     // enqueue for retry with backoff
 *   }
 * }
 * ```
 *
 * See `service/API.md` for the full function reference.
 */

// ── Error types ────────────────────────────────────────────────────────────────
export {
  SorobanServiceError,
  SorobanServiceErrorCode,
  SOROBAN_SERVICE_ERROR_RETRYABLE,
} from "./sorobanService.js";

// ── On-chain error codes ───────────────────────────────────────────────────────
export { SorobanErrorCode } from "./sorobanService.js";

// ── Domain error helper ────────────────────────────────────────────────────────
export { toSorobanDomainError } from "./sorobanService.js";

// ── Enums ──────────────────────────────────────────────────────────────────────
export { BallotState } from "./sorobanService.js";

// ── Interfaces & types ─────────────────────────────────────────────────────────
export type {
  RetryPolicy,
  RpcRetryPolicy,
  CircuitBreakerPolicy,
  SorobanConfig,
  BallotMetadata,
  BallotStats,
  BallotStateSnapshot,
  BallotAuditReport,
  BallotConsistencyReport,
  BallotLimits,
  MerkleProof,
  SorobanInvokeResult,
  EncryptedVote,
  RecordVoteResult,
  TallyResultPayload,
  TallyResult,
  VoteDatabaseRecord,
  PersistedTallyResult,
  VoteRepository,
  TallyRepository,
  VoteSubmissionInput,
  TallySubmissionInput,
  BackendFlowOptions,
  SorobanDomainError,
  SorobanAuditEventType,
  SorobanEventFilter,
  SorobanEventData,
  ConfigError,
} from "./sorobanService.js";

// ── Constants ──────────────────────────────────────────────────────────────────
export {
  DEFAULT_RETRY_POLICY,
  DEFAULT_RPC_RETRY_POLICY,
  DEFAULT_CIRCUIT_BREAKER_POLICY,
  ANONVOTE_CONTRACT_METHODS,
} from "./sorobanService.js";

// ── Validation helpers ─────────────────────────────────────────────────────────
export { validateContractId, validateSorobanConfig } from "./sorobanService.js";

// ── Circuit-breaker control ────────────────────────────────────────────────────
export { resetSorobanCircuitBreakers } from "./sorobanService.js";

// ── Event helpers ──────────────────────────────────────────────────────────────
export { parseSorobanEvent, sorobanFilterEvents } from "./sorobanService.js";

// ── Core RPC primitives ────────────────────────────────────────────────────────
export { invokeContract, readContract } from "./sorobanService.js";

// ── Ballot write operations ────────────────────────────────────────────────────
export {
  sorobanRecordBallot,
  sorobanRecordBallotsBatch,
  sorobanRecordToken,
  sorobanRecordVote,
  sorobanRecordResult,
  sorobanExpireBallot,
  sorobanTransitionBallotState,
} from "./sorobanService.js";

// ── Ballot read operations ─────────────────────────────────────────────────────
export {
  sorobanGetBallotState,
  sorobanGetBallotMetadata,
  sorobanGetBallotStats,
  sorobanGetBallotCreatedAt,
  sorobanGetBallotExpiration,
  sorobanGetAuditCounts,
  sorobanGetAuditReport,
  sorobanGetAllBallots,
  sorobanResultExists,
  sorobanBallotIsActive,
  sorobanIsBallotExpired,
  sorobanIsBallotFinalized,
  sorobanVerifyResultProof,
  sorobanGetVersion,
} from "./sorobanService.js";

// ── Consistency verification ───────────────────────────────────────────────────
export { verifyBallotConsistency } from "./sorobanService.js";

// ── Admin operations ───────────────────────────────────────────────────────────
export {
  sorobanRotateAdmin,
  sorobanGetRotationHistory,
} from "./sorobanService.js";

// ── Upgrade operations ─────────────────────────────────────────────────────────
export {
  sorobanScheduleUpgrade,
  sorobanCancelUpgrade,
  sorobanExecuteUpgrade,
  sorobanGetPendingUpgrade,
} from "./sorobanService.js";

// ── Backend flow helpers ───────────────────────────────────────────────────────
export {
  hashTallyResult,
  recordVote,
  tally,
  submitVoteOnChainFirst,
  publishTallyOnChain,
} from "./sorobanService.js";

// ── Config factories ───────────────────────────────────────────────────────────
export {
  createDefaultTestnetConfig,
  createDefaultMainnetConfig,
  createSorobanService,
} from "./sorobanService.js";
