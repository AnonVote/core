import { AnonVoteError } from "../errors";

/**
 * Thrown when a voter token is invalid, already used, or not recognised
 * by the backend.
 *
 * @example
 * ```typescript
 * try {
 *   await client.submitVote(ballotId, token, option);
 * } catch (err) {
 *   if (err instanceof InvalidTokenError) {
 *     // token was already used or does not belong to this ballot
 *   }
 * }
 * ```
 */
export class InvalidTokenError extends AnonVoteError {}

/**
 * Thrown when an operation is attempted on a ballot that is no longer
 * accepting votes (status is CLOSED or deadline has passed).
 */
export class BallotClosedError extends AnonVoteError {}

/**
 * Thrown when a requested ballot ID does not exist on the server.
 */
export class BallotNotFoundError extends AnonVoteError {}

/**
 * Thrown when the server returns an authentication or authorisation failure
 * (HTTP 401 / 403).
 */
export class AuthError extends AnonVoteError {}

/**
 * Thrown when a request exceeds the configured timeout.
 *
 * @example
 * ```typescript
 * const client = new AnonVoteClient({
 *   apiUrl: "https://api.anonvote.io",
 *   ballotEncryptionKey: key,
 *   timeoutMs: 5_000,
 * });
 * ```
 */
export class TimeoutError extends AnonVoteError {}

/**
 * Thrown when the server returns an unexpected error response that does not
 * map to a more specific SDK error class.
 */
export class ApiError extends AnonVoteError {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
