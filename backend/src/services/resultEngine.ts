import crypto from "crypto";
import { prisma } from "../prisma/client";
import { decryptVoteWithKeys, hashIdentifier } from "../utils/crypto";
import { sorobanRecordResult, verifyBallotConsistency } from "./sorobanService";
import { notFound } from "../utils/errors";
import { sendBallotClosedEmail } from "./emailService";
import { getBallotEncryptionKeyRecord } from "./ballotKeyService";
import { logger } from "../utils/logger";

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

  const keyRecord = await getBallotEncryptionKeyRecord(ballotId);

  for (const vote of ballot.votes) {
    try {
      const optionId = decryptVoteWithKeys(vote.encryptedOption, [
        keyRecord.key,
        keyRecord.previousKey,
      ]);
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

  // Anchor result publication on-chain via Soroban (issue #77 — replaces the
  // deprecated manageData write). Non-fatal: the result is published regardless.
  if (!opts.skipSoroban) {
    const tallyJson = JSON.stringify(tally);
    const resultHash = crypto
      .createHash("sha256")
      .update(tallyJson)
      .digest("hex");
    const ballotIdHash = hashIdentifier(ballotId);

    try {
      const sorobanTxId = await sorobanRecordResult(ballotIdHash, resultHash);
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
    } catch (err) {
      // Resilience layer already retried; never fail the tally on anchor errors
      logger.error("soroban_record_result_error", {
        ballotId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  // Post-finalisation on-chain consistency check (issue #68) — transparency
  // only, never blocks or fails the tally. Skipped alongside the other
  // Soroban calls when opts.skipSoroban is set (e.g. in tests).
  if (!opts.skipSoroban) {
    let verifiedOnChain: boolean | null = null;
    try {
      verifiedOnChain = await verifyBallotConsistency(ballotId);
    } catch (err) {
      // verifyBallotConsistency already catches its own errors internally and
      // resolves to false; this guards against an unexpected throw anyway.
      console.error(
        `[Soroban] Unexpected error running verifyBallotConsistency for ballot ${ballotId}:`,
        err,
      );
      verifiedOnChain = false;
    }

    if (verifiedOnChain === false) {
      console.warn(
        `[ResultEngine] On-chain verification failed for ballot ${ballotId} — ` +
          "the published tally is unaffected; see the Soroban log lines above " +
          "for the detailed chain-vs-database report. Manual review recommended.",
      );
    }

    await prisma.result.update({
      where: { id: result.id },
      data: { verifiedOnChain },
    });
  }

  // Send results notification email to org admin — non-blocking
  sendBallotClosedEmail({
    to: ballot.organization.email,
    orgName: ballot.organization.name,
    topic: ballot.topic,
    totalVotes: totalWeightedVotes,
    ballotId,
  }).catch((err) =>
    logger.warn("ballot_closed_email_failed", {
      ballotId,
      error: err,
    }),
  );

  return result;
}

export async function getResult(ballotId: string) {
  return prisma.result.findUnique({ where: { ballotId } });
}
