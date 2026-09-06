import type { RetryConfig } from "./types";

/**
 * Default retry configuration applied when no (or partial) config is supplied.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Merge a partial RetryConfig with the defaults, returning a complete config.
 *
 * @param partial - Partial retry configuration; any omitted field falls back
 *   to {@link DEFAULT_RETRY_CONFIG}.
 * @returns A complete {@link RetryConfig} with every field populated.
 *
 * @example
 * ```typescript
 * const config = resolveRetryConfig({ maxRetries: 5 });
 * // config.maxRetries === 5, all other fields from DEFAULT_RETRY_CONFIG
 * ```
 */
export function resolveRetryConfig(partial?: Partial<RetryConfig>): RetryConfig {
  if (!partial) return { ...DEFAULT_RETRY_CONFIG };
  return {
    maxRetries: partial.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    initialDelayMs: partial.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: partial.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    backoffMultiplier: partial.backoffMultiplier ?? DEFAULT_RETRY_CONFIG.backoffMultiplier,
    retryableStatusCodes: partial.retryableStatusCodes ?? DEFAULT_RETRY_CONFIG.retryableStatusCodes,
  };
}

/**
 * An error that carries an HTTP status code, used by withRetry to decide
 * whether a failure is retryable.
 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Sleep for `ms` milliseconds. Exposed for use in tests via mocking.
 *
 * @param ms - Number of milliseconds to wait before resolving.
 * @returns A promise that resolves once the delay has elapsed.
 *
 * @example
 * ```typescript
 * await sleep(100); // pause for 100ms
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates the delay (in ms) for a given attempt number using exponential backoff.
 *
 * Formula: min(initialDelayMs * backoffMultiplier^attempt, maxDelayMs)
 *
 * @param attempt  - Zero-based attempt index (0 = first retry).
 * @param config   - Resolved retry configuration.
 * @returns The delay in milliseconds before the next attempt, capped at
 *   `config.maxDelayMs`.
 *
 * @example
 * ```typescript
 * const delayMs = calculateDelay(2, DEFAULT_RETRY_CONFIG);
 * // delayMs === 400 (100 * 2^2, capped at maxDelayMs)
 * ```
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Returns true if the given error should trigger a retry based on the config.
 *
 * Retries are triggered for:
 * - {@link HttpError}s whose status code appears in `retryableStatusCodes`
 * - Non-HTTP errors (network-level failures such as ECONNREFUSED, ETIMEDOUT)
 *
 * Permanent HTTP failures (4xx except those in the allowlist) are NOT retried.
 *
 * @param error  - The error thrown by the failed operation.
 * @param config - Resolved retry configuration, used to check status codes.
 * @returns `true` if the error should trigger a retry, `false` otherwise.
 *
 * @example
 * ```typescript
 * if (isRetryable(err, config)) {
 *   // schedule a retry
 * }
 * ```
 */
export function isRetryable(error: unknown, config: RetryConfig): boolean {
  if (error instanceof HttpError) {
    return config.retryableStatusCodes.includes(error.statusCode);
  }
  // Non-HTTP errors are treated as transient network failures
  return error instanceof Error;
}

/**
 * Wraps an async operation with automatic retry logic and exponential backoff.
 *
 * The operation will be called up to `maxRetries + 1` times total. On each
 * failure that is deemed retryable, the function waits for the computed
 * backoff delay then tries again. If the final attempt also fails, the
 * last error is re-thrown.
 *
 * Retry attempts are reported via the optional `onRetry` callback, which
 * receives the current attempt number (1-based), the delay applied, and the
 * error that caused the retry. This can be used for logging without violating
 * the `no-console` lint rule in the SDK itself.
 *
 * @param operation - Async operation to execute and potentially retry.
 * @param config    - Resolved retry configuration.
 * @param onRetry   - Optional callback invoked before each retry.
 * @returns The resolved value of `operation` once it succeeds.
 * @throws The last error thrown by `operation`, if every attempt fails or the
 *   error is not retryable.
 *
 * @example
 * ```typescript
 * const data = await withRetry(
 *   () => fetch(url).then((res) => res.json()),
 *   resolveRetryConfig({ maxRetries: 3 }),
 *   (attempt, delayMs) => console.log(`retry ${attempt} in ${delayMs}ms`),
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === config.maxRetries;
      if (isLastAttempt || !isRetryable(error, config)) {
        throw error;
      }

      const delayMs = calculateDelay(attempt, config);
      if (onRetry) {
        onRetry(attempt + 1, delayMs, error);
      }

      await sleep(delayMs);
    }
  }

  // Unreachable — the loop always either returns or throws, but TypeScript
  // needs a definitive return/throw after the loop.
  throw lastError;
}
