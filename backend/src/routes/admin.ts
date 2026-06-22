import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../prisma/client";
import {
  getRateLimitSettings,
  setRateLimitSettings,
  PRESETS,
  type RateLimitPreset,
} from "../config/rateLimitConfig";
import { badRequest } from "../utils/errors";
import { adminAuditHandler } from "./audit";


const router = Router();

// GET /api/admin/tokens-issued — Total tokens issued across all org ballots
router.get(
  "/tokens-issued",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get all ballot IDs for this org
      const ballots = await prisma.ballot.findMany({
        where: { organizationId: req.organization!.id },
        select: { id: true },
      });
      const ballotIds = ballots.map((b) => b.id);

      const count = await prisma.auditEvent.count({
        where: {
          ballotId: { in: ballotIds },
          eventType: "TOKEN_ISSUED",
        },
      });

      res.status(200).json({ data: { tokensIssued: count } });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/admin/rate-limit — Get current rate limit settings
router.get("/rate-limit", requireAuth, (_req: Request, res: Response) => {
  res.status(200).json({
    data: {
      current: getRateLimitSettings(),
      presets: PRESETS,
    },
  });
});

// PATCH /api/admin/rate-limit — Update rate limit preset
router.patch(
  "/rate-limit",
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { preset } = req.body;
      const validPresets: RateLimitPreset[] = [
        "off",
        "relaxed",
        "standard",
        "strict",
      ];
      if (!preset || !validPresets.includes(preset)) {
        throw badRequest(
          `Invalid preset. Must be one of: ${validPresets.join(", ")}`,
        );
      }
      const updated = setRateLimitSettings(preset as RateLimitPreset);
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/admin/audit/:ballotId — Admin: full structured audit export (JSON or CSV)
router.get("/audit/:ballotId", requireAuth, adminAuditHandler);

export default router;
