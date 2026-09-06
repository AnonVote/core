import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createBallotSchema, updateBallotSchema } from "../validation/schemas";
import { verifyBallotCommitment } from "../services/verificationService";
import {
  createBallot,
  getBallotsByOrg,
  getBallotById,
  getBallotSummary,
  updateBallot,
  deleteBallot,
  retryBallotAnchor,
} from "../services/ballotEngine";
import { getResultsSummary } from "../services/resultEngine";
import { getAuditTrail } from "./audit";
import { badRequest, ballotNotEditable } from "../utils/errors";
import { hashToken } from "../utils/crypto";
import { prisma } from "../prisma/client";


const router = Router();

// POST /api/ballots — Create a new ballot
router.post(
  "/",
  requireAuth,
  validate(createBallotSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        topic,
        options,
        eligibilityListId,
        deadline,
        allowWeightedVoting,
        startTime,
        autoFinalise,
        descriptionCiphertext,
        descriptionHash,
      } = req.body;
      const ballot = await createBallot(
        req.organization!.id,
        topic,
        options,
        eligibilityListId,
        new Date(deadline),
        allowWeightedVoting,
        startTime ? new Date(startTime) : undefined,
        autoFinalise,
        descriptionCiphertext,
        descriptionHash,
      );
      res.status(201).json({ data: ballot });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ballots — List org ballots with optional status filter and pagination
router.get(
  "/",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const page = typeof req.query.page === "string" ? parseInt(req.query.page, 10) : undefined;
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;

      const result = await getBallotsByOrg(req.organization!.id, {
        status,
        page,
        limit,
      });
      res.status(200).json({
        data: result.data,
        total_count: result.total_count,
        page: result.page,
        limit: result.limit,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ballots/:id — Get ballot (public)
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ballot = await getBallotById(req.params.id);
    res.status(200).json({ data: ballot });
  } catch (err) {
    next(err);
  }
});

// GET /api/ballots/:id/summary — Public: aggregated ballot + options + stats
// in a single call (options, eligible voters, tokens issued, votes cast).
router.get(
  "/:id/summary",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await getBallotSummary(req.params.id);
      res.status(200).json({ data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ballots/:id/results-summary — Public: aggregated ballot + tally +
// participation + on-chain verification in a single call.
router.get(
  "/:id/results-summary",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await getResultsSummary(req.params.id);
      res.status(200).json({ data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ballots/:id/audit-trail — Public: aggregated ballot info + token
// and vote counts + full event log in a single call.
router.get(
  "/:id/audit-trail",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const trail = await getAuditTrail(req.params.id);
      res.status(200).json({ data: trail });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/ballots/:id — Edit a ballot
router.patch(
  "/:id",
  requireAuth,
  validate(updateBallotSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        topic,
        deadline,
        eligibilityListId,
        options,
        descriptionCiphertext,
        descriptionHash,
      } = req.body;
      const updated = await updateBallot(req.params.id, req.organization!.id, {
        ...(topic !== undefined && { topic }),
        ...(deadline !== undefined && { deadline: new Date(deadline) }),
        ...(eligibilityListId !== undefined && { eligibilityListId }),
        ...(options !== undefined && { options }),
        ...(descriptionCiphertext !== undefined && {
          descriptionCiphertext,
          descriptionHash,
        }),
      });
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ballots/:id/commitment — Public: verify ballot content against its anchor
router.get(
  "/:id/commitment",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyBallotCommitment(req.params.id);
      res.status(200).json({
        data: {
          ballotId: req.params.id,
          commitmentHash: result.expected,
          onChain: result.onChain,
          status: result.status,
          source: result.source,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/ballots/:id — Delete a ballot
router.delete(
  "/:id",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("[DELETE] Deleting ballot:", req.params.id);
      console.log("[DELETE] Org ID:", req.organization?.id);
      await deleteBallot(req.params.id, req.organization!.id);
      res.status(200).json({ message: "Ballot deleted successfully" });
    } catch (err) {
      console.error("[DELETE] Error:", err);
      next(err);
    }
  },
);

// POST /api/ballots/:id/retry-anchor — Admin: retry Stellar anchor for a failed ballot
router.post(
  "/:id/retry-anchor",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballot = await retryBallotAnchor(req.params.id, req.organization!.id);
      res.status(200).json({ data: ballot });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/ballots/:id/verify — Public: self-verification via raw token
// Privacy boundary: returns ONLY { confirmed: boolean }. Nothing else.
router.post(
  "/:id/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: ballotId } = req.params;
      const { token } = req.body;

      if (!token || typeof token !== "string") {
        throw badRequest("token is required");
      }

      const tokenHash = hashToken(token);

      const match = await prisma.voterToken.findFirst({
        where: { tokenHash, ballotId, used: true },
        select: { id: true }, // select minimum — never expose hash or voter data
      });

      // Return ONLY the boolean. Do not include vote option, token hash,
      // voter identifier, or any aggregate data not already on the public results page.
      res.status(200).json({ confirmed: match !== null });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

