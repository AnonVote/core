import { prisma } from "../prisma/client";
import { hashToken, encryptVote } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { config } from "../config";
import { badRequest } from "../utils/errors";

/**
 * Submit an anonymous vote.
 * Privacy guarantee: no link between token and voter identity is stored.
 */
export async function submitVote(
  ballotId: string,
  rawToken: string,
  optionId: string,
): Promise<{ voteId: string; ballotId: string }> {
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

    // Write to Stellar async (non-blocking)
    writeRecord({ type: "VOTE_CAST", ballotId, voteId: newVote.id })
      .then((txId) => {
        if (txId) {
          Promise.all([
            prisma.vote.update({
              where: { id: newVote.id },
              data: { stellarTxId: txId },
            }),
            prisma.auditEvent.update({
              where: { id: auditEvent.id },
              data: { stellarTxId: txId },
            }),
          ]).catch(console.error);
        }
      })
      .catch(console.error);

    return newVote;
  });

  return { voteId: vote.id, ballotId };
}
