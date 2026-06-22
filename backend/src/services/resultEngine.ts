import crypto from "crypto";
import { prisma } from "../prisma/client";
import { decryptVote } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { sorobanRecordResult } from "./sorobanService";
import { config } from "../config";
import { notFound } from "../utils/errors";
import { sendBallotClosedEmail } from "./emailService";

export async function tallyBallot(
  ballotId: string,
  opts: { skipSoroban?: boolean } = {},
) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: {
      options: true,
      votes: true,
      organization: { select: { email: true, name: true } },
    },
  });

  if (!ballot) throw notFound("Ballot not found");

  // Count weighted votes per option by decrypting each payload
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
        tally[optionId] += vote.weight;
      }
    } catch (err) {
      console.error(`[ResultEngine] Failed to decrypt vote ${vote.id}:`, err);
    }
  }

  // Calculate total weighted votes
  const totalWeightedVotes = ballot.votes.reduce(
    (sum, vote) => sum + vote.weight,
    0,
  );
  const usedTokenCount = await prisma.voterToken.count({
    where: { ballotId, used: true },
  });

  const isConsistent = totalWeightedVotes === usedTokenCount;

  if (!isConsistent) {
    console.warn(
      `[ResultEngine] Inconsistency detected for ballot ${ballotId}: weightedVotes=${totalWeightedVotes}, usedTokens=${usedTokenCount}`,
    );
  }

  // Create or update result
  const result = await prisma.result.upsert({
    where: { ballotId },
    create: {
      ballotId,
      tallyJson: JSON.stringify(tally),
      totalVotes: totalWeightedVotes,
      isConsistent,
    },
    update: {
      tallyJson: JSON.stringify(tally),
      totalVotes: totalWeightedVotes,
      isConsistent,
    },
  });

  // Audit event
  const auditEvent = await prisma.auditEvent.create({
    data: { ballotId, eventType: "RESULT_PUBLISHED" },
  });

  // Write to Stellar manageData layer — non-blocking, result is published regardless
  const stellarResult = await writeRecord({
    type: "RESULT_PUBLISHED",
    ballotId,
    totalVotes: totalWeightedVotes,
    isConsistent,
  });

  if (stellarResult.txHash) {
    await prisma.result.update({
      where: { id: result.id },
      data: {
        stellarTxId: stellarResult.txHash,
        stellarLedgerAt: stellarResult.ledgerTimestamp,
      },
    });
    await prisma.auditEvent.update({
      where: { id: auditEvent.id },
      data: {
        stellarTxId: stellarResult.txHash,
        stellarLedgerAt: stellarResult.ledgerTimestamp,
      },
    });
  } else {
    console.warn(
      `[Stellar] RESULT_PUBLISHED write failed for ballot ${ballotId} — result still published`,
    );
  }

  // Write to Soroban contract — non-blocking, result is published regardless
  if (!opts.skipSoroban) {
    const tallyJson = JSON.stringify(tally);
    const resultHash = crypto
      .createHash("sha256")
      .update(tallyJson)
      .digest("hex");
    const ballotIdHash = crypto
      .createHash("sha256")
      .update(ballotId)
      .digest("hex");

    sorobanRecordResult(ballotIdHash, resultHash)
      .then(async (sorobanTxId) => {
        if (sorobanTxId) {
          await prisma.result.update({
            where: { id: result.id },
            data: { sorobanTxId },
          });
          console.log(
            `[Soroban] record_result anchored for ballot ${ballotId} — tx: ${sorobanTxId}`,
          );
        } else {
          console.warn(
            `[Soroban] record_result not anchored for ballot ${ballotId} — contract may not be deployed`,
          );
        }
      })
      .catch((err) => {
        console.error(
          `[Soroban] record_result error for ballot ${ballotId}:`,
          err,
        );
      });
  }

  // Send results notification email to org admin — non-blocking
  sendBallotClosedEmail({
    to: ballot.organization.email,
    orgName: ballot.organization.name,
    topic: ballot.topic,
    totalVotes: totalWeightedVotes,
    ballotId,
  }).catch(() => {});

  return result;
}

export async function getResult(ballotId: string) {
  return prisma.result.findUnique({ where: { ballotId } });
}
