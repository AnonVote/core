/**
 * Base class for all `@anonvote/crypto` SDK errors.
 *
 * Thrown when a general SDK error occurs that does not fall into a more
 * specific category. Callers can catch any SDK error with
 * `instanceof AnonVoteError` and then narrow further using
 * {@link ValidationError} or {@link CryptoError}.
 */
export class AnonVoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (required when targeting ES5/commonjs)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a caller supplies an argument that fails input validation.
 *
 * Common triggers:
 * - A required field is missing or empty (e.g. blank election title, missing `ballotId`).
 * - A value has the wrong format (e.g. `encryptionKey` is not a 64-character hex string).
 * - A logical constraint is violated (e.g. `endTime` is not after `startTime`).
 *
 * Extends {@link AnonVoteError}, so callers that catch `AnonVoteError` will
 * also catch `ValidationError`.
 */
export class ValidationError extends AnonVoteError {}

/**
 * Thrown when a cryptographic operation fails at runtime.
 *
 * Common triggers:
 * - AES-256-GCM decryption fails because the ciphertext has been tampered with
 *   or the provided key does not match the key used for encryption.
 *
 * Extends {@link AnonVoteError}, so callers that catch `AnonVoteError` will
 * also catch `CryptoError`.
 */
export class CryptoError extends AnonVoteError {}
