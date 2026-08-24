import { prisma } from "../prisma/client";
import { hashToken, encryptVote, hashIdentifier } from "../utils/crypto";
import { sorobanRecordVote } from "./sorobanService";
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

  // Validate ballot is open (fetch early for organizationId)
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { options: true },
  });

  if (!ballot || ballot.status === "CLOSED") {
    throw badRequest("This ballot is not currently accepting votes.");
  }

  if (voterToken.used) {
    // Record duplicate attempt — no token value stored
    await prisma.auditEvent.create({
      data: { 
        ballotId, 
        organizationId: ballot.organizationId,
        eventType: "DUPLICATE_VOTE_ATTEMPT" 
      },
    });
    throw badRequest("This token has already been used to cast a vote.");
  }

  // Validate option belongs to ballot
  const validOption = ballot.options.find((o) => o.id === optionId);
  if (!validOption) {
    throw badRequest("Invalid option for this ballot.");
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

    // Create vote record with anchorStatus PENDING
    const vote = await tx.vote.create({
      data: {
        ballotId,
        encryptedOption,
        weight,
        rank,
        anchorStatus: "PENDING",
      },
    });

    // Audit event — no token value stored
    const auditEvent = await tx.auditEvent.create({
      data: { 
        ballotId, 
        organizationId: ballot.organizationId,
        eventType: "VOTE_CAST" 

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

  // Stellar/Soroban anchoring after transaction commits
  let stellarTxId: string | null = null;
  let sorobanTxId: string | null = null;
  let anchorStatus: "ANCHORED" | "PENDING" = "PENDING";
  const ballotIdHash = hashIdentifier(ballotId);

  try {
    const txHash = await sorobanRecordVote(ballotIdHash);
    if (txHash) {
      stellarTxId = txHash;
      sorobanTxId = txHash;
      anchorStatus = "ANCHORED";

      await prisma.vote.update({
        where: { id: voteResult.id },
        data: {
          stellarTxId: txHash,
          sorobanTxId: txHash,
          anchorStatus: "ANCHORED",
        },
      }).catch((err) => console.error("[Soroban] Failed to update vote status on anchor success:", err));
    } else {
      await handleStellarAnchorFailure(voteResult.id);
    }
  } catch (err) {
    console.error("[Soroban] Error recording vote on-chain:", err);
    // A thrown error means the contract invocation itself failed (not just skipped)
    // Mark the vote as failed and surface TRANSACTION_FAILED to the caller
    await handleStellarAnchorFailure(voteResult.id);
    throw new AppError(
      "Contract invocation failed during vote submission",
      500,
      "TRANSACTION_FAILED",
    );
  }

  const explorer_url = sorobanTxId
    ? `https://stellar.expert/explorer/testnet/tx/${sorobanTxId}`
    : undefined;

  return {
    status: "confirmed",
    stellar_tx_id: stellarTxId,
    soroban_tx_id: sorobanTxId,
    anchor_status: anchorStatus,
    ...(explorer_url ? { explorer_url } : {}),
    voteId: voteResult.id,
  };
}

async function handleStellarAnchorFailure(voteId: string): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.vote.update({
        where: { id: voteId },
        data: { anchorStatus: "FAILED" },
      }),
      prisma.stellarRetryQueue.upsert({
        where: { voteId },
        create: { voteId, retryCount: 0 },
        update: {},
      }),
    ]);
  } catch (err) {
    console.error(`[Stellar] Failed to queue retry for vote ${voteId}:`, err);
  }
}
