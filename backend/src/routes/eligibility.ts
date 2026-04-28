import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { prisma } from "../prisma/client";
import { requireAuth } from "../middleware/auth";
import { hashIdentifier } from "../utils/crypto";
import { badRequest } from "../utils/errors";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1, // only one file
  },
  fileFilter: (_req, file, cb) => {
    // Validate file type
    const allowedTypes = ["text/csv", "text/plain", "application/vnd.ms-excel"];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(
        new Error("Invalid file type. Please upload a CSV or plain-text file."),
      );
      return;
    }
    cb(null, true);
  },
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

      // Validate file size (double-check in case limits didn't catch it)
      if (req.file.size > 10 * 1024 * 1024) {
        throw badRequest("File size exceeds 10MB limit");
      }

      // Parse and sanitize content
      const content = req.file.buffer.toString("utf-8");

      // Remove BOM if present
      let cleanedContent = content;
      if (content.charCodeAt(0) === 0xfeff) {
        cleanedContent = content.slice(1);
      }

      // Split lines and normalize
      const lines = cleanedContent
        .split(/\r?\n/)
        .map((l) => {
          // Trim whitespace and normalize line endings
          return l.trim().replace(/\s+/g, " ");
        })
        .filter((l) => l.length > 0);

      // Validate line count (prevent DoS)
      const MAX_LINES = 100000; // 100k voters max
      if (lines.length > MAX_LINES) {
        throw badRequest(
          `Eligibility list exceeds maximum of ${MAX_LINES} entries`,
        );
      }

      if (lines.length === 0) {
        throw badRequest("Eligibility list file is empty");
      }

      // Validate each line (prevent injection)
      const sanitizedLines: string[] = [];
      for (const line of lines) {
        // Remove any control characters except space
        const sanitized = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

        // Skip if empty after sanitization
        if (sanitized.length === 0) continue;

        // Limit line length (prevent injection/DoS)
        if (sanitized.length > 256) {
          throw badRequest(
            `One or more entries exceed the maximum length of 256 characters`,
          );
        }

        sanitizedLines.push(sanitized);
      }

      if (sanitizedLines.length === 0) {
        throw badRequest("No valid entries found in eligibility list");
      }

      // Hash and deduplicate
      const seen = new Set<string>();
      const uniqueHashes: string[] = [];
      for (const line of sanitizedLines) {
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
