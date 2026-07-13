import { Router, Request, Response, NextFunction } from "express";
import { getResult, tallyBallot } from "../services/resultEngine";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../prisma/client";
import { notFound, badRequest } from "../utils/errors";
import { config } from "../config";

const router = Router();

/** Build the Stellar explorer URL for a given tx hash. */
function explorerUrl(txHash: string): string {
  const network =
    config.stellarNetwork === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

// GET /api/results/:ballotId — Public: enriched result with option breakdown
router.get(
  "/:ballotId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId } = req.params;

      const [result, ballot] = await Promise.all([
        prisma.result.findUnique({ where: { ballotId } }),
        prisma.ballot.findUnique({
          where: { id: ballotId },
          include: { options: true },
        }),
      ]);

      if (!result) throw notFound("No published result found for this ballot");
      if (!ballot) throw notFound("Ballot not found");

      const tally: Record<string, number> = JSON.parse(result.tallyJson);

      // Build per-option breakdown
      const options = ballot.options.map((opt) => {
        const count = tally[opt.id] ?? 0;
        const percentage =
          result.totalVotes > 0
            ? Math.round((count / result.totalVotes) * 10000) / 100
            : 0;
        return { optionId: opt.id, optionText: opt.text, count, percentage };
      });

      // Participation rate: votes cast / tokens issued
      const tokensIssued = await prisma.voterToken.count({
        where: { ballotId },
      });
      const participationRate =
        tokensIssued > 0
          ? Math.round((result.totalVotes / tokensIssued) * 10000) / 100
          : 0;

      res.status(200).json({
        data: {
          ...result,
          options,
          participationRate,
          tokensIssued,
          explorerUrl: result.stellarTxId
            ? explorerUrl(result.stellarTxId)
            : null,
          sorobanExplorerUrl: result.sorobanTxId
            ? explorerUrl(result.sorobanTxId)
            : null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/results/:ballotId/finalise — Admin: idempotent tally + on-chain anchor
router.post(
  "/:ballotId/finalise",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId } = req.params;

      const ballot = await prisma.ballot.findUnique({
        where: { id: ballotId },
      });

      if (!ballot) throw notFound("Ballot not found");
      if (ballot.organizationId !== req.organization!.id)
        throw badRequest("You can only finalise your own ballots");

      // Idempotency check — if already finalised, return existing result
      const existing = await prisma.result.findUnique({
        where: { ballotId },
      });
      if (existing?.finalised) {
        console.log(
          `[Results] Ballot ${ballotId} already finalised — returning cached result`,
        );
        return res.status(200).json({ data: existing, idempotent: true });
      }

      // Auto-close ballot if still OPEN
      if (ballot.status === "OPEN") {
        await prisma.ballot.update({
          where: { id: ballotId },
          data: { status: "CLOSED" },
        });
        console.log(`[Results] Auto-closed ballot ${ballotId} for finalisation`);
      }

      // Run tally (wires Soroban internally)
      const result = await tallyBallot(ballotId);

      // Mark as finalised
      const finalised = await prisma.result.update({
        where: { id: result.id },
        data: { finalised: true, finalisedAt: new Date() },
      });

      console.log(`[Results] Ballot ${ballotId} finalised`);
      res.status(200).json({ data: finalised, idempotent: false });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/results/:ballotId/tally — Admin: manually close and tally (legacy, kept for compat)
router.post(
  "/:ballotId/tally",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId } = req.params;

      const ballot = await prisma.ballot.findUnique({
        where: { id: ballotId },
      });

      if (!ballot) throw notFound("Ballot not found");
      if (ballot.organizationId !== req.organization!.id)
        throw badRequest("You can only tally your own ballots");

      // Close ballot if still open
      if (ballot.status === "OPEN") {
        await prisma.ballot.update({
          where: { id: ballotId },
          data: { status: "CLOSED" },
        });
        console.log(`[Results] Manually closed ballot ${ballotId}`);
      }

      const result = await tallyBallot(ballotId);
      console.log(`[Results] Manually tallied ballot ${ballotId}`);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
