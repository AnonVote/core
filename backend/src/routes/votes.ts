import { Router, Request, Response, NextFunction } from "express";
import { submitVote } from "../services/privacyEngine";
import { checkVoteRateLimits } from "../services/voteRateLimiter";
import { badRequest, rateLimitExceeded } from "../utils/errors";
import { prisma } from "../prisma/client";
import { strictRateLimiter } from "../middleware/rateLimiter";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { dbCircuitBreakerMiddleware, executeWithCircuitBreaker } from "../middleware/circuitBreaker";
import { validateVoteRequest } from "../middleware/voteValidation";

const router = Router();

// POST /api/votes — Submit an anonymous vote
// Middleware order is critical for DDoS protection:
// 1. Circuit breaker - fail fast if system is overloaded
// 2. Validation - reject malformed requests early
// 3. Rate limiting - enforce per-IP, per-ballot, per-token limits
router.post(
  "/",
  dbCircuitBreakerMiddleware,
  validateVoteRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract and normalize parameters (validation already done by middleware)
      const ballotId = req.body.ballot_id ?? req.body.ballotId;
      const token = req.body.token ?? req.body.voterToken;
      const optionId = req.body.option_id ?? req.body.optionId;
      const weight = req.body.weight ?? 1;
      const rank = req.body.rank;

      // Derive the real IP (respects X-Forwarded-For when behind a proxy)
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          .trim() ?? req.socket.remoteAddress ?? "unknown";

      // Check all three rate-limit dimensions before processing the vote
      // Wrap in circuit breaker to track database health
      const rlResult = await executeWithCircuitBreaker(() =>
        checkVoteRateLimits(ip, ballotId, token.trim())
      );

      if (!rlResult.allowed) {
        // Log violation to audit table (best-effort, non-blocking)
        prisma.auditEvent
          .create({ data: { ballotId, eventType: "RATE_LIMIT_EXCEEDED" } })
          .catch((err) =>
            logger.warn("rate_limit_audit_failed", {
              ballotId,
              error: err,
            }),
          );

        const err = rateLimitExceeded(rlResult.retryAfterSeconds);
        res.setHeader("Retry-After", String(rlResult.retryAfterSeconds));
        return next(err);
      }

      // Submit the vote (wrapped in circuit breaker in submitVote function)
      const result = await executeWithCircuitBreaker(() =>
        submitVote(
          ballotId.trim(),
          token.trim(),
          optionId.trim(),
          weight,
          rank
        )
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
