import { Router, Request, Response, NextFunction } from "express";
import { submitVote } from "../services/privacyEngine";
import { checkVoteRateLimits } from "../services/voteRateLimiter";
import { badRequest, rateLimitExceeded } from "../utils/errors";
import { prisma } from "../prisma/client";
import { strictRateLimiter } from "../middleware/rateLimiter";
import { AppError } from "../utils/errors";

const router = Router();

// POST /api/votes — Submit an anonymous vote
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballotId = req.body.ballot_id ?? req.body.ballotId;
      const token = req.body.token ?? req.body.voterToken;
      const optionId = req.body.option_id ?? req.body.optionId;
      const weight = req.body.weight ?? 1;
      const rank = req.body.rank;

      const fieldErrors: Record<string, string> = {};
      if (!ballotId || typeof ballotId !== "string" || !ballotId.trim()) {
        fieldErrors.ballot_id = "ballot_id is required and must be a non-empty string";
      }
      if (!token || typeof token !== "string" || !token.trim()) {
        fieldErrors.token = "token is required and must be a non-empty string";
      }
      if (!optionId || typeof optionId !== "string" || !optionId.trim()) {
        fieldErrors.option_id = "option_id is required and must be a non-empty string";
      }
      if (weight !== undefined && weight !== null && typeof weight !== "number" && isNaN(Number(weight))) {
        fieldErrors.weight = "weight must be a valid number";
      }
      if (rank !== undefined && rank !== null && typeof rank !== "number" && isNaN(Number(rank))) {
        fieldErrors.rank = "rank must be a valid number";
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
      if (Object.keys(fieldErrors).length > 0) {
        throw new AppError(
          `Validation failed: ${Object.values(fieldErrors).join("; ")}`,
          400,
          "VALIDATION_ERROR"
        );
      }

      const result = await submitVote(
        ballotId.trim(),
        token.trim(),
        optionId.trim(),
        weight,
        rank
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
