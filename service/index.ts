/**
 * AnonVote Soroban Service — public API surface
 *
 * Import SorobanServiceError and SorobanServiceErrorCode from here in any
 * code that calls the service helpers. This keeps the import path stable
 * even if the internal file layout changes.
 *
 * All five service helpers (sorobanRecordBallot, sorobanRecordBallotsBatch,
 * sorobanRecordToken, sorobanRecordVote, sorobanRecordResult) throw
 * SorobanServiceError on any failure. Callers should wrap these calls in
 * try/catch and inspect `err.retryable` to decide whether to enqueue a retry
 * or surface the error immediately.
 *
 * @example
 * ```ts
 * import { SorobanServiceError, SorobanServiceErrorCode } from "@anonvote/contracts/service";
 *
 * try {
 *   await sorobanRecordBallot(config, ballotIdHash);
 * } catch (err) {
 *   if (err instanceof SorobanServiceError) {
 *     if (err.retryable) {
 *       // enqueue for retry with backoff
 *     } else if (err.code === SorobanServiceErrorCode.CONTRACT_ERROR) {
 *       // logic error — do not retry, alert
 *     }
 *   }
 *   throw err; // re-throw unexpected errors
 * }
 * ```
 */

export {
  SorobanServiceError,
  SorobanServiceErrorCode,
  SOROBAN_SERVICE_ERROR_RETRYABLE,
  toSorobanDomainError,
} from "./sorobanService.js";

// Re-export the full service surface so callers can use a single import path.
export * from "./sorobanService.js";
