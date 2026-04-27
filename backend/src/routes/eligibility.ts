import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { prisma } from "../prisma/client";
import { requireAuth } from "../middleware/auth";
import { hashIdentifier } from "../utils/crypto";
import { badRequest } from "../utils/errors";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/eligibility — Upload voter eligibility list
router.post(
  "/",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw badRequest(
          "No file uploaded. Please provide a CSV or plain-text file.",
        );
      }

      const content = req.file.buffer.toString("utf-8");
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        throw badRequest("Eligibility list file is empty");
      }

      // Hash and deduplicate
      const seen = new Set<string>();
      const uniqueHashes: string[] = [];
      for (const line of lines) {
        const hash = hashIdentifier(line);
        if (!seen.has(hash)) {
          seen.add(hash);
          uniqueHashes.push(hash);
        }
      }

      // Create EligibilityList + entries in a transaction
      const eligibilityList = await prisma.$transaction(async (tx) => {
        const list = await tx.eligibilityList.create({ data: {} });
        await tx.eligibilityEntry.createMany({
          data: uniqueHashes.map((hash) => ({
            eligibilityListId: list.id,
            identifierHash: hash,
          })),
        });
        return list;
      });

      res.status(201).json({
        data: {
          eligibilityListId: eligibilityList.id,
          count: uniqueHashes.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
