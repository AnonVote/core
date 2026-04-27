import { Router, Request, Response, NextFunction } from "express";
import { submitVote } from "../services/privacyEngine";
import { strictRateLimiter } from "../middleware/rateLimiter";
import { badRequest } from "../utils/errors";

const router = Router();

// POST /api/votes — Submit an anonymous vote
router.post(
  "/",
  strictRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId, voterToken, optionId } = req.body;
      if (!ballotId || !voterToken || !optionId) {
        throw badRequest("ballotId, voterToken, and optionId are required");
      }
      const result = await submitVote(ballotId, voterToken.trim(), optionId);
      res
        .status(201)
        .json({ data: { message: "Vote submitted successfully", ...result } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
