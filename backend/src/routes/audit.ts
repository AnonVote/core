import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma/client";

const router = Router();

// GET /api/audit/:ballotId — Get audit event counts (public)
router.get(
  "/:ballotId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId } = req.params;

      const [tokensIssued, votesCast, events] = await Promise.all([
        prisma.auditEvent.count({
          where: { ballotId, eventType: "TOKEN_ISSUED" },
        }),
        prisma.auditEvent.count({
          where: { ballotId, eventType: "VOTE_CAST" },
        }),
        prisma.auditEvent.findMany({
          where: { ballotId },
          select: { eventType: true, stellarTxId: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      res.status(200).json({
        data: { ballotId, tokensIssued, votesCast, events },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
