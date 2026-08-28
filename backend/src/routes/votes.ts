import { Router, Request, Response, NextFunction } from "express";
import { submitVote } from "../services/privacyEngine";
import { checkVoteRateLimits } from "../services/voteRateLimiter";
import { rateLimitExceeded } from "../utils/errors";
import { prisma } from "../prisma/client";
import { logger } from "../utils/logger";
import { validate } from "../middleware/validate";
import { submitVoteSchema } from "../validation/schemas";

const router = Router();

// Normalise legacy snake_case / alternate field names sent by older clients.
// `validate(submitVoteSchema)` expects camelCase, so we copy before it runs.
function normaliseVoteBody(req: Request, _res: Response, next: NextFunction): void {
  const b = req.body as Record<string, unknown>;
  if (b.ballot_id !== undefined && b.ballotId === undefined) b.ballotId = b.ballot_id;
  if (b.option_id !== undefined && b.optionId === undefined) b.optionId = b.option_id;
  // "token" is the legacy name; "voterToken" is the schema-canonical name
  if (b.token !== undefined && b.voterToken === undefined) b.voterToken = b.token;
  next();
}

// POST /api/votes — Submit an anonymous vote
// Middleware order is critical for DDoS protection:
// 1. Circuit breaker - fail fast if system is overloaded
// 2. Validation - reject malformed requests early
// 3. Rate limiting - enforce per-IP, per-ballot, per-token limits
router.post(
  "/",
  normaliseVoteBody,
  validate(submitVoteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballotId = (req.body.ballotId as string).trim();
      const token = (req.body.voterToken as string).trim();
      const optionId = (req.body.optionId as string).trim();
      const weight = req.body.weight ?? 1;
      const rank = req.body.rank;

      // Derive the real IP (respects X-Forwarded-For when behind a proxy)
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          .trim() ?? req.socket.remoteAddress ?? "unknown";

      // Check all three rate-limit dimensions before processing the vote
      const rlResult = await checkVoteRateLimits(ip, ballotId, token);

      if (!rlResult.allowed) {
        // Log violation to audit table (best-effort, non-blocking)
        prisma.ballot
          .findUnique({ where: { id: ballotId }, select: { organizationId: true } })
          .then((b) =>
            b &&
            prisma.auditEvent.create({
              data: {
                ballotId,
                organizationId: b.organizationId,
                eventType: "RATE_LIMIT_EXCEEDED",
              },
            }),
          )
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

      const result = await submitVote(ballotId, token, optionId, weight, rank);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
