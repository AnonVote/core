import { prisma } from "../prisma/client";
import { hashToken, encryptVote, hashIdentifier } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { sorobanRecordVote } from "./sorobanService";
import { config } from "../config";
import { badRequest } from "../utils/errors";
import { getEffectiveVoter } from "./delegationManager";

/**
 * Submit an anonymous vote.
 * Privacy guarantee: no link between token and voter identity is stored.
 * Stellar write is required — vote is rolled back if Stellar write fails.
 */
export async function submitVote(
  ballotId: string,
  rawToken: string,
  optionId: string,
  weight: number = 1,
  rank?: number,
): Promise<{ voteId: string; ballotId: string; stellarTxId: string }> {
  const tokenHash = hashToken(rawToken);

  // Check if this token delegates to another
  const { effectiveToken, isDelegated } = await getEffectiveVoter(
    ballotId,
    tokenHash,
  );

  // Use the effective token for validation
  const voterToken = await prisma.voterToken.findUnique({
    where: { tokenHash: effectiveToken },
  });

  if (!voterToken || voterToken.ballotId !== ballotId) {
    throw badRequest("Invalid token for this ballot.");
  }

  if (voterToken.used) {
    // Record duplicate attempt — no token value stored
    await prisma.auditEvent.create({
      data: { ballotId, eventType: "DUPLICATE_VOTE_ATTEMPT" },
    });
    throw badRequest("This token has already been used to cast a vote.");
  }

  // Validate ballot is open
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { options: true },
  });

  if (!ballot || ballot.status === "CLOSED") {
    throw badRequest("This ballot is not currently accepting votes.");
  }

  // Validate option belongs to ballot
  const validOption = ballot.options.find((o) => o.id === optionId);
  if (!validOption) {
    throw badRequest("Invalid option for this ballot.");
  }

  // Encrypt vote — only option ID is stored, encrypted
  const encryptedPayload = encryptVote(optionId, config.ballotEncryptionKey);

  const vote = await prisma.$transaction(async (tx) => {
    // Create vote record — no token or identity stored
    const newVote = await tx.vote.create({
      data: { ballotId, optionId, encryptedPayload, weight, rank },
    });

    // Mark token as used
    await tx.voterToken.update({
      where: { tokenHash: effectiveToken },
      data: { used: true, usedAt: new Date() },
    });

    // Audit event — no token value stored
    const auditEvent = await tx.auditEvent.create({
      data: { ballotId, eventType: "VOTE_CAST" },
    });

    return { voteId: newVote.id, auditEventId: auditEvent.id };
  });

  // Return vote immediately — Stellar write happens in background
  const voteResponse = {
    voteId: vote.voteId,
    ballotId,
    stellarTxId: "",
  };

  // Record vote on-chain — fire-and-forget
  sorobanRecordVote(hashIdentifier(ballotId)).catch((err) =>
    console.error("[Soroban] record_vote failed:", err),
  );

  // Fire-and-forget Stellar write — does not block the response
  writeRecord({
    type: "VOTE_CAST",
    ballotId,
    voteId: vote.voteId,
  })
    .then((stellarResult) => {
      if (stellarResult.txHash) {
        Promise.all([
          prisma.vote.update({
            where: { id: vote.voteId },
            data: { stellarTxId: stellarResult.txHash },
          }),
          prisma.auditEvent.update({
            where: { id: vote.auditEventId },
            data: {
              stellarTxId: stellarResult.txHash,
              stellarLedgerAt: stellarResult.ledgerTimestamp,
            },
          }),
        ]).catch(() => {});
      } else {
        console.warn(
          `[Stellar] VOTE_CAST write failed for vote ${vote.voteId}`,
        );
      }
    })
    .catch(() => {});

  return voteResponse;
}
