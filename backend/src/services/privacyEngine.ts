import { prisma } from "../prisma/client";
import {
  hashToken,
  encryptVote,
  hashIdentifier,
  computeVoteIdHash,
} from "../utils/crypto";
import { getVoteSubmissionBatcher } from "./voteSubmissionBatcher";
import { config } from "../config";
import { AppError } from "../utils/errors";
import { getEffectiveVoter } from "./delegationManager";
import { getBallotEncryptionKey } from "./ballotKeyService";
import { logger } from "../utils/logger";

export interface VoteSubmissionResponse {
  status: "confirmed";
  stellar_tx_id: string | null;
  soroban_tx_id: string | null;
  anchor_status: "ANCHORED" | "PENDING";
  explorer_url?: string;
  voteId?: string;
}

/**
 * Submit an anonymous vote.
 * Atomic vote write and eligibility token invalidation using SELECT FOR UPDATE lock.
 * Vote option is encrypted with per-ballot encryption key before database write.
 */
export async function submitVote(
  ballotId: string,
  rawToken: string,
  optionId: string,
  weight: number = 1,
  rank?: number,
): Promise<VoteSubmissionResponse> {
  if (!ballotId || typeof ballotId !== "string" || !ballotId.trim()) {
    throw new AppError("Missing or malformed field: ballot_id", 400, "INVALID_INPUT");
  }
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    throw new AppError("Missing or malformed field: token", 400, "INVALID_INPUT");
  }
  if (!optionId || typeof optionId !== "string" || !optionId.trim()) {
    throw new AppError("Missing or malformed field: option_id", 400, "INVALID_INPUT");
  }

  const cleanToken = rawToken.trim();
  const tokenHash = hashToken(cleanToken);

  // Check delegation if present
  let effectiveToken = tokenHash;
  try {
    const delegationResult = await getEffectiveVoter(ballotId, tokenHash);
    if (delegationResult && delegationResult.effectiveToken) {
      effectiveToken = delegationResult.effectiveToken;
    }
  } catch (err) {
    // If delegation lookup fails, continue with tokenHash
  }

  // Atomic transaction with SELECT FOR UPDATE row-level lock
  const now = new Date();
  const voteResult = await prisma.$transaction(async (tx) => {
    // Atomic update: only update if used is false
    const tokenUpdate = await tx.voterToken.updateMany({
      where: { tokenHash: effectiveToken, used: false, ballotId },
      data: { used: true, usedAt: now },
    });

    if (tokenUpdate.count === 0) {
      // Find out why it failed
      const existing = await tx.voterToken.findUnique({ where: { tokenHash: effectiveToken } });
      if (!existing || existing.ballotId !== ballotId) {
        throw new AppError("This token is not recognised for this ballot.", 401, "INVALID_TOKEN");
      }
      if (existing.used) {
        await tx.auditEvent.create({
          data: { ballotId, eventType: "DUPLICATE_VOTE_ATTEMPT" },
        }).catch((err) =>
          logger.warn("duplicate_vote_audit_failed", {
            ballotId,
            error: err,
          }),
        );
        throw new AppError("This token has already been used to cast a vote.", 409, "TOKEN_ALREADY_USED");
      }
    }

    // Validate ballot exists, open status, and deadline
    const ballot = await tx.ballot.findUnique({
      where: { id: ballotId },
      include: { options: true },
    });

    if (!ballot) {
      throw new AppError("This token is not recognised for this ballot.", 401, "INVALID_TOKEN");
    }

    // State machine: only ACTIVE ballots accept votes
    if (ballot.status !== "ACTIVE" || (ballot.deadline && new Date(ballot.deadline) < now)) {
      throw new AppError("This ballot has closed and is no longer accepting votes.", 403, "BALLOT_CLOSED");
    }

    // Validate option belongs to ballot
    const validOption = ballot.options.find((o) => o.id === optionId);
    if (!validOption) {
      throw new AppError("Invalid option for this ballot.", 400, "INVALID_OPTION");
    }

    // Retrieve the ballot-specific encryption key stored in the database.
    const ballotKey = await getBallotEncryptionKey(ballotId, tx);

    // Encrypt raw option ID
    const encryptedOption = encryptVote(optionId, ballotKey);

    // Deterministic idempotency key for on-chain anchoring (issue #77).
    // HMAC-keyed so a DB-only leak cannot link votes back to token hashes.
    const voteIdHash = computeVoteIdHash(
      ballotId,
      effectiveToken,
      config.dataEncryptionKey || undefined,
    );

    // Create vote record with anchorStatus PENDING — the submission batcher
    // anchors it on-chain asynchronously (batched, retried, DLQ'd on failure).
    let vote;
    try {
      vote = await tx.vote.create({
        data: {
          ballotId,
          encryptedOption,
          weight,
          rank,
          voteIdHash,
          anchorStatus: "PENDING",
        },
      });
    } catch (createErr) {
      // Unique violation on vote_id_hash ⇒ this exact ballot+token already
      // cast a vote — a replay. Surface it without leaking which option won.
      if (
        createErr instanceof Error &&
        /unique|duplicate/i.test(createErr.message)
      ) {
        throw new AppError(
          "A vote has already been recorded for this token.",
          409,
          "DUPLICATE_VOTE_ID",
        );
      }
      throw createErr;
    }


    // Audit log
    await tx.auditEvent.create({
      data: {
        ballotId,
        eventType: "VOTE_CAST",
      },
    });

    return vote;
  }).catch((err) => {
    if (err instanceof AppError) throw err;
    console.error("[VoteTransaction] Atomic vote write failed:", err);
    throw new AppError("Database transaction failed during vote submission", 500, "DATABASE_ERROR");
  });

  // ── On-chain anchoring (async, batched) ─────────────────────────────────
  // The vote is durably confirmed in the database; anchoring now happens via
  // the VoteSubmissionBatcher: votes are grouped into a single atomic Soroban
  // transaction (up to VOTE_BATCH_SIZE), retried with exponential backoff,
  // circuit-breaker protected, and dead-lettered if all retries fail.
  // The API therefore responds immediately with anchor_status PENDING — the
  // contract state manager and verification endpoints reflect final status.
  const ballotIdHash = hashIdentifier(ballotId);
  const queued = getVoteSubmissionBatcher().enqueue({
    voteId: voteResult.id,
    ballotId,
    ballotIdHash,
    voteIdHash: voteResult.voteIdHash!,
  });

  if (!queued) {
    logger.info("vote_anchor_enqueue_deduplicated", {
      voteId: voteResult.id,
      message:
        "Vote was already queued/anchored recently — idempotent replay ignored.",
    });
  }

  return {
    status: "confirmed",
    stellar_tx_id: null,
    soroban_tx_id: null,
    anchor_status: "PENDING",
    voteId: voteResult.id,
  };
}
