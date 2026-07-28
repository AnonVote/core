import { Router, Request, Response, NextFunction } from "express";
import { submitVote } from "../services/privacyEngine";
import { checkVoteRateLimits } from "../services/voteRateLimiter";
import { badRequest, rateLimitExceeded } from "../utils/errors";
import { prisma } from "../prisma/client";

const router = Router();

// POST /api/votes — Submit an anonymous vote
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId, voterToken, optionId, weight, rank } = req.body;
      if (!ballotId || !voterToken || !optionId) {
        throw badRequest("ballotId, voterToken, and optionId are required");
      }

      // Derive the real IP (respects X-Forwarded-For when behind a proxy)
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          .trim() ?? req.socket.remoteAddress ?? "unknown";

      // Check all three rate-limit dimensions before processing the vote
      const rlResult = await checkVoteRateLimits(ip, ballotId, voterToken.trim());

      if (!rlResult.allowed) {
        // Log violation to audit table (best-effort, non-blocking)
        prisma.auditEvent
          .create({ data: { ballotId, eventType: "RATE_LIMIT_EXCEEDED" } })
          .catch(() => {});

        const err = rateLimitExceeded(rlResult.retryAfterSeconds);
        res.setHeader("Retry-After", String(rlResult.retryAfterSeconds));
        return next(err);
      }

      const result = await submitVote(
        ballotId,
        voterToken.trim(),
        optionId,
        weight || 1,
        rank,
      );

      res
        .status(201)
        .json({ data: { message: "Vote submitted successfully", ...result } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
