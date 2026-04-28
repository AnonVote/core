import { Router, Request, Response, NextFunction } from "express";
import { issueToken } from "../services/identityManager";
import { strictRateLimiter } from "../middleware/rateLimiter";
import { badRequest } from "../utils/errors";

const router = Router();

// POST /api/tokens — Request a voter token
router.post(
  "/",
  strictRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId, voterIdentifier } = req.body;
      if (!ballotId || !voterIdentifier) {
        throw badRequest("ballotId and voterIdentifier are required");
      }
      const result = await issueToken(ballotId, voterIdentifier.trim());
      res.status(200).json({ data: { token: result.token } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
