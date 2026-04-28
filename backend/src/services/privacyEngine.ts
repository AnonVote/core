import { prisma } from "../prisma/client";
import { hashToken, encryptVote } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { config } from "../config";
import { badRequest } from "../utils/errors";

/**
 * Submit an anonymous vote.
 * Privacy guarantee: no link between token and voter identity is stored.
 * Stellar write is required — vote is rolled back if Stellar write fails.
 */
export async function submitVote(
  ballotId: string,
  rawToken: string,
  optionId: string,
): Promise<{ voteId: string; ballotId: string; stellarTxId: string }> {
  const tokenHash = hashToken(rawToken);

  const voterToken = await prisma.voterToken.findUnique({
    where: { tokenHash },
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
      data: { ballotId, optionId, encryptedPayload },
    });

    // Mark token as used
    await tx.voterToken.update({
      where: { tokenHash },
      data: { used: true, usedAt: new Date() },
    });

    // Audit event — no token value stored
    const auditEvent = await tx.auditEvent.create({
      data: { ballotId, eventType: "VOTE_CAST" },
    });

    return { voteId: newVote.id, auditEventId: auditEvent.id };
  });

  // Write to Stellar (required for transaction to complete)
  const stellarTxId = await writeRecord({
    type: "VOTE_CAST",
    ballotId,
    voteId: vote.voteId,
  });

  if (!stellarTxId) {
    throw new Error(
      "Stellar blockchain write failed. Vote could not be recorded.",
    );
  }

  // Update vote and audit event with Stellar transaction ID
  await prisma.vote.update({
    where: { id: vote.voteId },
    data: { stellarTxId },
  });

  await prisma.auditEvent.update({
    where: { id: vote.auditEventId },
    data: { stellarTxId },
  });

  return { voteId: vote.voteId, ballotId, stellarTxId };
}
