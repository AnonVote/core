import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getRateLimitSettings,
  setRateLimitSettings,
  PRESETS,
  type RateLimitPreset,
} from "../config/rateLimitConfig";
import { badRequest } from "../utils/errors";

const router = Router();

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

export default router;
