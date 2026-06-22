import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createBallotSchema, updateBallotSchema } from "../validation/schemas";
import {
  createBallot,
  getBallotsByOrg,
  getBallotById,
  updateBallot,
  deleteBallot,
} from "../services/ballotEngine";

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
      } = req.body;
      const ballot = await createBallot(
        req.organization!.id,
        topic,
        options,
        eligibilityListId,
        new Date(deadline),
        allowWeightedVoting,
      );
      res.status(201).json({ data: ballot });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ballots — List org ballots
router.get(
  "/",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballots = await getBallotsByOrg(req.organization!.id);
      res.status(200).json({ data: ballots });
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

// PATCH /api/ballots/:id — Edit a ballot
router.patch(
  "/:id",
  requireAuth,
  validate(updateBallotSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { topic, deadline, eligibilityListId, options } = req.body;
      const updated = await updateBallot(req.params.id, req.organization!.id, {
        ...(topic !== undefined && { topic }),
        ...(deadline !== undefined && { deadline: new Date(deadline) }),
        ...(eligibilityListId !== undefined && { eligibilityListId }),
        ...(options !== undefined && { options }),
      });
      res.status(200).json({ data: updated });
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

export default router;
