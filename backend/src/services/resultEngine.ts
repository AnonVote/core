import { prisma } from "../prisma/client";
import { decryptVote } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { config } from "../config";
import { notFound } from "../utils/errors";

export async function tallyBallot(ballotId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { options: true, votes: true },
  });

  if (!ballot) throw notFound("Ballot not found");

  // Count votes per option by decrypting each payload
  const tally: Record<string, number> = {};
  ballot.options.forEach((o) => {
    tally[o.id] = 0;
  });

  for (const vote of ballot.votes) {
    try {
      const optionId = decryptVote(
        vote.encryptedPayload,
        config.ballotEncryptionKey,
      );
      if (tally[optionId] !== undefined) {
        tally[optionId]++;
      }
    } catch (err) {
      console.error(`[ResultEngine] Failed to decrypt vote ${vote.id}:`, err);
    }
  }

  const totalVotes = ballot.votes.length;
  const usedTokenCount = await prisma.voterToken.count({
    where: { ballotId, used: true },
  });

  const isConsistent = totalVotes === usedTokenCount;

  if (!isConsistent) {
    console.warn(
      `[ResultEngine] Inconsistency detected for ballot ${ballotId}: votes=${totalVotes}, usedTokens=${usedTokenCount}`,
    );
  }

  // Create or update result
  const result = await prisma.result.upsert({
    where: { ballotId },
    create: {
      ballotId,
      tallyJson: JSON.stringify(tally),
      totalVotes,
      isConsistent,
    },
    update: {
      tallyJson: JSON.stringify(tally),
      totalVotes,
      isConsistent,
    },
  });

  // Audit event
  const auditEvent = await prisma.auditEvent.create({
    data: { ballotId, eventType: "RESULT_PUBLISHED" },
  });

  // Write to Stellar (required for transaction to complete)
  const stellarTxId = await writeRecord({
    type: "RESULT_PUBLISHED",
    ballotId,
    totalVotes,
    isConsistent,
  });

  if (!stellarTxId) {
    throw new Error(
      "Stellar blockchain write failed. Result could not be published.",
    );
  }

  // Update result and audit event with Stellar transaction ID
  await prisma.result.update({
    where: { id: result.id },
    data: { stellarTxId },
  });

  await prisma.auditEvent.update({
    where: { id: auditEvent.id },
    data: { stellarTxId },
  });

  return result;
}

export async function getResult(ballotId: string) {
  return prisma.result.findUnique({ where: { ballotId } });
}
