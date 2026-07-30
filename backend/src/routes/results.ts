import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { getResult, tallyBallot } from "../services/resultEngine";
import { sorobanGetAuditCounts } from "../services/sorobanService";
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

/**
 * Plain-language explanation of the privacy/verification model, surfaced to
 * observers alongside the results so they can understand what "verified"
 * means for this tally without reading the source code.
 */
const ENCRYPTION_NOTE =
  "Each vote is encrypted at submission time with AES-256-GCM using the " +
  "ballot's encryption key. Votes are never stored or transmitted in " +
  "plaintext — they are decrypted only in aggregate, during tallying, to " +
  "compute the counts below. Individual vote payloads are not exposed by " +
  "this API.";

/**
 * Determine the on-chain consistency flag for a ballot's result.
 *
 * Falls back to the DB-level consistency check (weighted votes vs. used
 * tokens, computed in resultEngine) whenever the Soroban contract isn't
 * deployed/configured (SOROBAN_CONTRACT_ID unset — see issue #12), so the
 * flag always reflects the best verification available rather than
 * silently reporting false.
 */
async function resolveIsConsistent(
  ballotId: string,
  dbIsConsistent: boolean,
): Promise<{ isConsistent: boolean; source: "contract" | "database" }> {
  if (!config.sorobanContractId) {
    return { isConsistent: dbIsConsistent, source: "database" };
  }

  const ballotIdHash = crypto.createHash("sha256").update(ballotId).digest("hex");
  const onChain = await sorobanGetAuditCounts(ballotIdHash).catch(() => null);

  if (!onChain) {
    return { isConsistent: dbIsConsistent, source: "database" };
  }

  return { isConsistent: onChain.isConsistent, source: "contract" };
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

      const { isConsistent, source: consistencySource } =
        await resolveIsConsistent(ballotId, result.isConsistent);

      // Simple label -> count map for observers/auditors (e.g. { "Option A": 45 })
      const resultsByLabel: Record<string, number> = {};
      options.forEach((opt) => {
        resultsByLabel[opt.optionText] = opt.count;
      });

      const metadata = {
        ballot_id: ballotId,
        ballot_title: ballot.topic,
        total_votes: result.totalVotes,
        tally_timestamp: result.publishedAt,
        stellar_transaction_id: result.stellarTxId ?? null,
        soroban_transaction_id: result.sorobanTxId ?? null,
        is_consistent: isConsistent,
        consistency_source: consistencySource,
        encryption_note: ENCRYPTION_NOTE,
      };

      res.status(200).json({
        data: {
          ...result,
          isConsistent,
          options,
          participationRate,
          tokensIssued,
          explorerUrl: result.stellarTxId
            ? explorerUrl(result.stellarTxId)
            : null,
          sorobanExplorerUrl: result.sorobanTxId
            ? explorerUrl(result.sorobanTxId)
            : null,
          metadata,
          results: resultsByLabel,
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

      // Auto-close ballot if still ACTIVE
      if (ballot.status === "ACTIVE") {
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

      // Close ballot if still ACTIVE
      if (ballot.status === "ACTIVE") {
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
