/**
 * Vote-specific rate limiter backed by the database.
 * Persists across server restarts (unlike in-memory stores).
 *
 * Limits enforced:
 *   - Per-IP:     10 attempts per minute
 *   - Per-ballot: 100 attempts per minute
 *   - Per-token:  3 attempts per hour
 *
 * Returns the number of seconds until the window resets when a limit is hit.
 */

import { prisma } from "../prisma/client";
import { hashToken } from "../utils/crypto";

// ── Constants ────────────────────────────────────────────────────────────────

export const VOTE_IP_LIMIT = 10;
export const VOTE_IP_WINDOW_MS = 60 * 1000; // 1 minute

export const VOTE_BALLOT_LIMIT = 100;
export const VOTE_BALLOT_WINDOW_MS = 60 * 1000; // 1 minute

export const VOTE_TOKEN_LIMIT = 3;
export const VOTE_TOKEN_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ── Core upsert helper ───────────────────────────────────────────────────────

interface CheckResult {
  allowed: boolean;
  /** Seconds remaining in the current window (used for Retry-After). */
  retryAfterSeconds: number;
  current: number;
  limit: number;
}

/**
 * Atomically increments the counter for `key` within its window.
 * If the window has expired it is reset before incrementing.
 * Returns whether the request is within the allowed limit.
 */
async function checkAndIncrement(
  key: string,
  limit: number,
  windowMs: number,
): Promise<CheckResult> {
  const now = new Date();
  const windowStart = now;
  const expiresAt = new Date(now.getTime() + windowMs);

  // Upsert: create a fresh entry or increment the existing counter.
  // If the window has already expired we treat it as a fresh window.
  const entry = await prisma.rateLimitEntry.upsert({
    where: { key },
    create: {
      key,
      count: 1,
      windowStart,
      expiresAt,
    },
    update: {
      // Reset window when it has expired
      count: {
        increment: 1,
      },
      // Keep existing expiresAt (don't extend the window on each hit)
    },
  });

  // If the stored window has expired, reset it atomically
  if (entry.expiresAt <= now) {
    const reset = await prisma.rateLimitEntry.update({
      where: { key },
      data: {
        count: 1,
        windowStart: now,
        expiresAt,
      },
    });
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      current: reset.count,
      limit,
    };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((entry.expiresAt.getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: entry.count <= limit,
    retryAfterSeconds,
    current: entry.count,
    limit,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface RateLimitCheckResult {
  allowed: boolean;
  /** Which dimension triggered the limit (for logging). */
  dimension?: "ip" | "ballot" | "token";
  retryAfterSeconds: number;
}

/**
 * Checks all three rate-limit dimensions for a vote submission attempt.
 * Counters are always incremented regardless of the outcome so that
 * repeated attempts against a limit continue to be tracked.
 *
 * @param ip        - The requester's IP address
 * @param ballotId  - The ballot being voted on
 * @param rawToken  - The raw (unhashed) voter token
 */
export async function checkVoteRateLimits(
  ip: string,
  ballotId: string,
  rawToken: string,
): Promise<RateLimitCheckResult> {
  if (process.env.NODE_ENV === "test" && process.env.ENABLE_RATE_LIMITS !== "true") {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Hash the token so we never persist raw token values
  const tokenHash = hashToken(rawToken);

  const ipKey = `ip:${ip}`;
  const ballotKey = `ballot:${ballotId}`;
  const tokenKey = `token:${tokenHash}`;

  // Run all three checks in parallel
  const [ipResult, ballotResult, tokenResult] = await Promise.all([
    checkAndIncrement(ipKey, VOTE_IP_LIMIT, VOTE_IP_WINDOW_MS),
    checkAndIncrement(ballotKey, VOTE_BALLOT_LIMIT, VOTE_BALLOT_WINDOW_MS),
    checkAndIncrement(tokenKey, VOTE_TOKEN_LIMIT, VOTE_TOKEN_WINDOW_MS),
  ]);

  if (!ipResult.allowed) {
    console.warn(`[RateLimit] IP limit exceeded for ${ip}`);
    return {
      allowed: false,
      dimension: "ip",
      retryAfterSeconds: ipResult.retryAfterSeconds,
    };
  }

  if (!ballotResult.allowed) {
    console.warn(`[RateLimit] Ballot limit exceeded for ballot ${ballotId}`);
    return {
      allowed: false,
      dimension: "ballot",
      retryAfterSeconds: ballotResult.retryAfterSeconds,
    };
  }

  if (!tokenResult.allowed) {
    console.warn(`[RateLimit] Token limit exceeded (hash: ${tokenHash})`);
    return {
      allowed: false,
      dimension: "token",
      retryAfterSeconds: tokenResult.retryAfterSeconds,
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Purges expired rate-limit entries from the database.
 * Should be called periodically (e.g. via the scheduler) to prevent
 * unbounded table growth.
 */
export async function purgeExpiredRateLimitEntries(): Promise<number> {
  const result = await prisma.rateLimitEntry.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
