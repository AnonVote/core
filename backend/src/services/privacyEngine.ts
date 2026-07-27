import { prisma } from "../prisma/client";
import { hashToken, encryptVote, hashIdentifier } from "../utils/crypto";
import { sorobanRecordVote } from "./sorobanService";
import { config } from "../config";
import { AppError } from "../utils/errors";
import { getEffectiveVoter } from "./delegationManager";

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
  const voteResult = await prisma.$transaction(async (tx) => {
    // Acquire row-level lock on VoterToken record
    const lockedTokens: any[] = await tx.$queryRaw`
      SELECT * FROM "VoterToken"
      WHERE "tokenHash" = ${effectiveToken}
      FOR UPDATE
    `;

    if (!lockedTokens || lockedTokens.length === 0) {
      throw new AppError("This token is not recognised for this ballot.", 401, "INVALID_TOKEN");
    }

    const voterToken = lockedTokens[0];
    if (voterToken.ballotId !== ballotId) {
      throw new AppError("This token is not recognised for this ballot.", 401, "INVALID_TOKEN");
    }

    if (voterToken.used) {
      await tx.auditEvent.create({
        data: { ballotId, eventType: "DUPLICATE_VOTE_ATTEMPT" },
      }).catch(() => {});
      throw new AppError("This token has already been used to cast a vote.", 409, "TOKEN_ALREADY_USED");
    }

    // Validate ballot exists, open status, and deadline
    const ballot = await tx.ballot.findUnique({
      where: { id: ballotId },
      include: { options: true },
    });

    if (!ballot) {
      throw new AppError("This token is not recognised for this ballot.", 401, "INVALID_TOKEN");
    }

    const now = new Date();
    if (ballot.status === "CLOSED" || (ballot.deadline && new Date(ballot.deadline) < now)) {
      throw new AppError("This ballot has closed and is no longer accepting votes.", 403, "BALLOT_CLOSED");
    }

    // Validate option belongs to ballot
    const validOption = ballot.options.find((o) => o.id === optionId);
    if (!validOption) {
      throw new AppError("Invalid option for this ballot.", 400, "INVALID_OPTION");
    }

    // Retrieve per-ballot encryption key from ballot_keys table if available
    const keyRecord = await tx.ballotKey.findUnique({
      where: { ballotId },
    });
    const ballotKey = keyRecord ? keyRecord.key : config.ballotEncryptionKey;

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

    // Mark eligibility token as used
    await tx.voterToken.update({
      where: { id: voterToken.id },
      data: { used: true, usedAt: now },
    });

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
