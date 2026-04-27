import { Router, Request, Response, NextFunction } from "express";
import { getResult } from "../services/resultEngine";
import { notFound } from "../utils/errors";

const router = Router();

// GET /api/results/:ballotId — Get published result (public)
router.get(
  "/:ballotId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getResult(req.params.ballotId);
      if (!result) throw notFound("No published result found for this ballot");
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
