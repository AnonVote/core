import { Router, Request, Response, NextFunction } from "express";
import {
  generateVoteVerification,
  verifyVote,
} from "../services/verificationService";
import { badRequest } from "../utils/errors";

const router = Router();

// POST /api/verification/generate — Generate a verification hash for a vote
router.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId, voterToken } = req.body;
      if (!ballotId || !voterToken) {
        throw badRequest("ballotId and voterToken are required");
      }
      const result = await generateVoteVerification(ballotId, voterToken);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/verification/verify — Verify a vote using the verification hash
router.post(
  "/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId, voteId, verificationHash } = req.body;
      if (!ballotId || !voteId || !verificationHash) {
        throw badRequest("ballotId, voteId, and verificationHash are required");
      }
      const result = await verifyVote(ballotId, voteId, verificationHash);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
