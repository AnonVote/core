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
import {
  createOrganizationKey,
  rotateOrganizationKey,
} from "../services/organizationKeyService";
import { adminAuditHandler } from "./audit";
import multer from "multer";
import {
  hashIdentifier,
  generateToken,
  hashToken,
  encryptString,
} from "../utils/crypto";
import { sendVoterTokenEmail } from "../services/emailService";
import { config } from "../config";
import { sorobanRotateAdminKey } from "../services/sorobanService";
import { rotateBallotEncryptionKey } from "../services/ballotKeyService";
import { getSorobanMetrics } from "../services/sorobanMetrics";
import { getSorobanCircuitBreakerStatus } from "../services/sorobanResilient";
import {
  getRecentDivergences,
  runContractStateSync,
} from "../services/contractStateManager";
import { getVoteSubmissionBatcher } from "../services/voteSubmissionBatcher";
import { isSorobanConfigured } from "../services/sorobanService";
import { notFound as notFoundError } from "../utils/errors";

function isValidStellarPublicKey(key: string): boolean {
  return typeof key === "string" && /^G[A-Z2-7]{55}$/.test(key);
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

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

// GET /api/admin/ballots/summary — aggregated ballot stats for the admin dashboard
router.get(
  "/ballots/summary",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ballots = await prisma.ballot.findMany({
        where: { organizationId: req.organization!.id },
        select: {
          id: true,
          topic: true,
          status: true,
          deadline: true,
          eligibilityListId: true,
          result: true,
          _count: {
            select: { votes: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const data = await Promise.all(
        ballots.map(async (ballot) => {
          const [voterCount, tokensIssued, votesReceived] = await Promise.all([
            prisma.eligibilityEntry.count({
              where: { eligibilityListId: ballot.eligibilityListId },
            }),
            prisma.voterToken.count({
              where: { ballotId: ballot.id },
            }),
            prisma.vote.count({
              where: { ballotId: ballot.id },
            }),
          ]);

          let tallyStatus: "PENDING" | "READY" | "FINALISED" = "PENDING";
          if (ballot.result?.finalised || ballot.status === "FINALISED") {
            tallyStatus = "FINALISED";
          } else if (votesReceived > 0 || ballot.status === "CLOSED") {
            tallyStatus = "READY";
          }

          return {
            id: ballot.id,
            topic: ballot.topic,
            status: ballot.status,
            deadline: ballot.deadline,
            voterCount,
            tokensIssued,
            votesReceived,
            tallyStatus,
          };
        }),
      );

      res.status(200).json({ data });
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
            if (config.dataEncryptionKey) {
              const recipientEncrypted = encryptString(
                recipient,
                config.dataEncryptionKey,
              );
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
            } else {
              console.warn(
                "[Email] No data encryption key configured; skipping delivery retry persistence",
              );
            }
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
// GET /api/admin/audit/:ballotId — Admin: full structured audit export (JSON or CSV)
router.get("/audit/:ballotId", requireAuth, adminAuditHandler);

// POST /api/admin/rotate-key — Rotate admin public key
router.post(
  "/rotate-key",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { newAdminPublicKey, currentAdminPublicKey } = req.body;
      const targetNewKey = newAdminPublicKey || req.body.newAdminKey;

      if (!targetNewKey) {
        throw badRequest("newAdminPublicKey is required");
      }

      if (!isValidStellarPublicKey(targetNewKey)) {
        throw badRequest("INVALID_KEY: Invalid Stellar public key format");
      }

      if (currentAdminPublicKey && !isValidStellarPublicKey(currentAdminPublicKey)) {
        throw badRequest("INVALID_KEY: Invalid current Stellar public key format");
      }

      if (currentAdminPublicKey && currentAdminPublicKey === targetNewKey) {
        throw badRequest("INVALID_KEY: New key cannot be the same as the current key");
      }

      const callerKey = currentAdminPublicKey || "CURRENT_ADMIN";
      const sorobanResult = await sorobanRotateAdminKey(callerKey, targetNewKey);

      console.log(
        `[Admin Key Rotation] Event: Admin key rotated. Caller: ${maskKey(callerKey)}, ` +
          `New Key: ${maskKey(targetNewKey)}, Soroban TxHash: ${sorobanResult.txHash || "N/A"}`
      );

      res.status(200).json({
        data: {
          message: "Admin key rotated successfully",
          newAdminKeyMasked: maskKey(targetNewKey),
          sorobanTxId: sorobanResult.txHash || null,
        },
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
// POST /api/admin/ballots/:ballotId/rotate-key — Rotate a ballot encryption key
router.post(
  "/ballots/:ballotId/rotate-key",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId } = req.params;
      const result = await rotateBallotEncryptionKey(
        ballotId,
        req.organization!.id,
      );
      res.status(200).json({
        data: {
          ballotId: result.ballotId,
          rotatedAt: result.rotatedAt,
        },
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

// ── Soroban integration observability & dead-letter recovery (issue #77) ────

// GET /api/admin/soroban/metrics — contract call metrics, batcher stats,
// circuit breaker state and recent chain-vs-DB divergences.
router.get(
  "/soroban/metrics",
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        data: {
          configured: isSorobanConfigured(),
          metrics: getSorobanMetrics(),
          circuitBreaker: getSorobanCircuitBreakerStatus(),
          batcher: getVoteSubmissionBatcher().stats(),
          recentDivergences: getRecentDivergences(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/admin/soroban/state-sync — trigger a contract↔DB reconciliation
// run on demand (also runs automatically every minute).
router.post(
  "/soroban/state-sync",
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await runContractStateSync();
      res.status(200).json({ data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/admin/soroban/dead-letters — votes whose anchoring permanently failed.
router.get(
  "/soroban/dead-letters",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const letters = await prisma.sorobanDeadLetter.findMany({
        where: { resolvedAt: null },
        include: {
          vote: {
            select: { id: true, ballotId: true, anchorStatus: true, submittedAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.status(200).json({
        data: letters.map((l) => ({
          id: l.id,
          voteId: l.voteId,
          ballotId: l.ballotId,
          reason: l.reason,
          lastError: l.lastError,
          attempts: l.attempts,
          createdAt: l.createdAt,
          anchorStatus: l.vote?.anchorStatus ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/admin/soroban/dead-letters/:id/replay — requeue a dead-lettered
// vote into the submission batcher for another anchoring attempt.
router.post(
  "/soroban/dead-letters/:id/replay",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const letter = await prisma.sorobanDeadLetter.findUnique({
        where: { id: req.params.id },
        include: { vote: true },
      });
      if (!letter) throw notFoundError("Dead letter entry not found");
      if (!letter.vote) throw notFoundError("Vote for dead letter not found");

      const { hashIdentifier } = await import("../utils/crypto");
      const accepted = getVoteSubmissionBatcher().enqueue({
        voteId: letter.vote.id,
        ballotId: letter.vote.ballotId,
        ballotIdHash: hashIdentifier(letter.vote.ballotId),
        voteIdHash: letter.vote.voteIdHash!,
      });

      await prisma.sorobanDeadLetter.update({
        where: { id: letter.id },
        data: { resolvedAt: new Date() },
      });

      res.status(200).json({
        data: {
          id: letter.id,
          voteId: letter.voteId,
          requeued: accepted,
          message: accepted
            ? "Vote requeued for anchoring."
            : "Vote was already queued or anchored recently.",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
