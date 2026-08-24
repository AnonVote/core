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
import {
  createOrganizationKey,
  rotateOrganizationKey,
} from "../services/organizationKeyService";

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

// POST /api/admin/organizations/:id/encryption-key — Create encryption key for organization
router.post(
  "/organizations/:id/encryption-key",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.params.id;
      
      // Validate organization can only manage their own key
      if (orgId !== req.organization!.id) {
        throw badRequest("You can only manage your own organization's encryption key");
      }
      
      await createOrganizationKey(orgId);
      
      res.status(201).json({ 
        message: "Encryption key created successfully",
        data: { organizationId: orgId }
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/admin/organizations/:id/rotate-keys — Rotate encryption keys
router.post(
  "/organizations/:id/rotate-keys",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.params.id;
      
      // Validate organization can only rotate their own key
      if (orgId !== req.organization!.id) {
        throw badRequest("You can only rotate your own organization's encryption key");
      }
      
      await rotateOrganizationKey(orgId);
      
      res.status(200).json({ 
        message: "Encryption key rotated successfully",
        data: { organizationId: orgId }
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/admin/organizations/:id/encryption-keys — List encryption keys
router.get(
  "/organizations/:id/encryption-keys",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.params.id;
      
      // Validate organization can only view their own keys
      if (orgId !== req.organization!.id) {
        throw badRequest("You can only view your own organization's encryption keys");
      }
      
      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          keyVersion: true,
          isActive: true,
          createdAt: true,
          rotatedAt: true,
        },
        orderBy: { keyVersion: "desc" },
      });
      
      res.status(200).json({ data: keys });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
