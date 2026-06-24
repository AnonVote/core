import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../prisma/client";
import {
  getRateLimitSettings,
  setRateLimitSettings,
  PRESETS,
  type RateLimitPreset,
} from "../config/rateLimitConfig";
import { validate } from "../middleware/validate";
import { createBallotSchema } from "../validation/schemas";
import { createBallot } from "../services/ballotEngine";
import { badRequest } from "../utils/errors";
import { adminAuditHandler } from "./audit";
import multer from "multer";
import { hashIdentifier, generateToken, hashToken, encryptString } from "../utils/crypto";
import { sendVoterTokenEmail } from "../services/emailService";
import { config } from "../config";


const router = Router();

// GET /api/admin/ballots — Returns all ballots for the authenticated admin
router.get(
  "/ballots",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballots = await prisma.ballot.findMany({
        where: { organizationId: req.organization!.id },
        include: {
          options: true,
          _count: { select: { votes: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({ data: ballots });
    } catch (err) {
      next(err);
    }
  },
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// POST /api/admin/ballots/:id/eligibility — upload CSV for a specific ballot
router.post(
  "/ballots/:id/eligibility",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballotId = req.params.id;

      const ballot = await prisma.ballot.findUnique({
        where: { id: ballotId },
      });
      if (!ballot || ballot.organizationId !== req.organization!.id) {
        throw badRequest("Ballot not found or access denied");
      }

      if (!req.file) throw badRequest("No file uploaded");
      const content = req.file.buffer.toString("utf-8");

      // Remove BOM if present
      let cleanedContent = content;
      if (content.charCodeAt(0) === 0xfeff) cleanedContent = content.slice(1);

      // Split lines, sanitize and normalize
      const rawLines = cleanedContent.split(/\r?\n/);
      const rows: { original: string; sanitized: string }[] = [];
      for (let i = 0; i < rawLines.length; i++) {
        const l = rawLines[i].trim().replace(/\s+/g, " ");
        if (l.length === 0) continue;
        const sanitized = l.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
        if (sanitized.length === 0) continue;
        if (sanitized.length > 256) {
          // return an error summary for this row
          rows.push({ original: l, sanitized: "" });
          continue;
        }
        rows.push({ original: l, sanitized });
      }

      if (rows.length === 0) throw badRequest("No valid entries found in file");

      // Fetch existing hashes for this eligibility list
      const existingEntries = await prisma.eligibilityEntry.findMany({
        where: { eligibilityListId: ballot.eligibilityListId },
        select: { identifierHash: true },
      });
      const existingSet = new Set(existingEntries.map((e) => e.identifierHash));

      const insertHashes: string[] = [];
      const resultRows: Array<{ row: number; status: string; reason?: string }>
        = [];

      const seenInFile = new Set<string>();
      let rowIndex = 0;
      for (const r of rows) {
        rowIndex++;
        if (!r.sanitized) {
          resultRows.push({ row: rowIndex, status: "skipped", reason: "invalid or too long" });
          continue;
        }
        const hash = hashIdentifier(r.sanitized);
        if (existingSet.has(hash)) {
          resultRows.push({ row: rowIndex, status: "skipped", reason: "duplicate_existing" });
          continue;
        }
        if (seenInFile.has(hash)) {
          resultRows.push({ row: rowIndex, status: "skipped", reason: "duplicate_in_file" });
          continue;
        }
        seenInFile.add(hash);
        insertHashes.push(hash);
        resultRows.push({ row: rowIndex, status: "queued" });
      }

      // Bulk insert new entries (skipDuplicates defensive)
      if (insertHashes.length > 0) {
        await prisma.eligibilityEntry.createMany({
          data: insertHashes.map((h) => ({
            eligibilityListId: ballot.eligibilityListId,
            identifierHash: h,
          })),
          skipDuplicates: true,
        });
      }

      // Map hashes to sanitized recipients for emailing
      const hashToRecipient = new Map<string, string>();
      {
        // Rebuild mapping from rows in the same order
        const seen = new Set<string>();
        for (const r of rows) {
          if (!r.sanitized) continue;
          const h = hashIdentifier(r.sanitized);
          if (seen.has(h)) continue;
          seen.add(h);
          if (insertHashes.includes(h)) {
            hashToRecipient.set(h, r.sanitized);
          }
        }
      }

      // For each newly-inserted hash: create a voterToken, mark entry tokenIssued and audit, then send email.
      const issuanceResults: Array<{ hash: string; emailed: boolean; error?: string }>
        = [];

      for (const h of insertHashes) {
        const recipient = hashToRecipient.get(h);
        try {
          const rawToken = generateToken();
          const tokenHash = hashToken(rawToken);

          // Create token, mark entry issued, audit in transaction
          const txResult = await prisma.$transaction(async (tx) => {
            const token = await tx.voterToken.create({ data: { tokenHash, ballotId: ballot.id } });
            await tx.eligibilityEntry.updateMany({
              where: { eligibilityListId: ballot.eligibilityListId, identifierHash: h },
              data: { tokenIssued: true },
            });
            const audit = await tx.auditEvent.create({ data: { ballotId: ballot.id, eventType: "TOKEN_ISSUED" } });
            return { tokenId: token.id, auditId: audit.id };
          });

          // Send email (may throw)
          if (!recipient) throw new Error("Recipient missing for hash");
          try {
            await sendVoterTokenEmail({ to: recipient, ballotId: ballot.id, token: rawToken });
            issuanceResults.push({ hash: h, emailed: true });
          } catch (emailErr: any) {
            // Enqueue retry record with encrypted recipient
            const recipientEncrypted = encryptString(recipient, config.ballotEncryptionKey);
            await prisma.tokenDeliveryRetry.create({
              data: {
                ballotId: ballot.id,
                voterTokenId: txResult.tokenId,
                recipientEncrypted,
                attempts: 0,
                nextAttemptAt: new Date(Date.now() + 60 * 1000),
                lastError: String(emailErr?.message ?? emailErr),
              },
            });
            issuanceResults.push({ hash: h, emailed: false, error: String(emailErr?.message ?? emailErr) });
          }
        } catch (err: any) {
          issuanceResults.push({ hash: h, emailed: false, error: String(err?.message ?? err) });
        }
      }

      const inserted = insertHashes.length;
      const skipped = resultRows.filter((r) => r.status !== "queued").length;

      res.status(200).json({
        data: {
          ballotId,
          totalRows: rows.length,
          inserted,
          skipped,
          rowDetails: resultRows.slice(0, 200),
          issuanceResults: issuanceResults.slice(0, 200),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

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

// POST /api/admin/ballots — Create ballot as admin
router.post(
  "/ballots",
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
