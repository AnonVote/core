import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";
import { reissueLimitExceeded } from "../utils/errors";

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in ms
const MAX_ATTEMPTS = 3;

/**
 * DB-backed rate limiter for token reissuance.
 * Limits each voter identifier (hashed) to maximum 3 reissue requests per 24 hours.
 */
export async function checkReissueRateLimit(voterIdentifier: string): Promise<void> {
  if (process.env.NODE_ENV === "test" && process.env.ENABLE_RATE_LIMITS !== "true") return;
  if (!voterIdentifier || typeof voterIdentifier !== "string") return;

  const identifierHash = hashIdentifier(voterIdentifier.trim());
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const record = await tx.reissueRateLimit.findUnique({
      where: { identifierHash },
    });

    if (!record) {
      await tx.reissueRateLimit.create({
        data: {
          identifierHash,
          attempts: 1,
          windowStart: now,
        },
      });
      return;
    }

    const elapsed = now.getTime() - record.windowStart.getTime();

    if (elapsed > WINDOW_MS) {
      // 24-hour window has expired — reset window and attempt counter
      await tx.reissueRateLimit.update({
        where: { identifierHash },
        data: {
          attempts: 1,
          windowStart: now,
        },
      });
      return;
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      throw reissueLimitExceeded();
    }

    await tx.reissueRateLimit.update({
      where: { identifierHash },
      data: {
        attempts: record.attempts + 1,
      },
    });
  });
}

export const reissueRateLimiter = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const voterIdentifier = req.body?.voterIdentifier;
    if (voterIdentifier) {
      await checkReissueRateLimit(voterIdentifier);
    }
    next();
  } catch (err) {
    next(err);
  }
};
