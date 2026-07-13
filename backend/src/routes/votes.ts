import { Router, Request, Response, NextFunction } from "express";
import { submitVote } from "../services/privacyEngine";
import { strictRateLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { submitVoteSchema } from "../validation/schemas";

const router = Router();

// POST /api/votes — Submit an anonymous vote
router.post(
  "/",
  strictRateLimiter,
  validate(submitVoteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId, voterToken, optionId, weight, rank } = req.body;
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
