import crypto from "crypto";
import { prisma } from "../prisma/client";
import { decryptVoteWithKeys, hashIdentifier } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { sorobanRecordResult, verifyBallotConsistency } from "./sorobanService";
import { notFound } from "../utils/errors";
import { sendBallotClosedEmail } from "./emailService";
import { getBallotEncryptionKeyRecord } from "./ballotKeyService";
import { logger } from "../utils/logger";
import { config } from "../config";

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
    data: { 
      ballotId, 
      organizationId: ballot.organizationId,
      eventType: "RESULT_PUBLISHED" 
    },
  });

  // Write to Stellar manageData layer — non-blocking, result is published regardless
  const stellarResult = await writeRecord({
    type: "RESULT_PUBLISHED",
    ballotId: hashIdentifier(ballotId),
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

/** Build the Stellar explorer URL for a given tx hash. */
function explorerUrl(txHash: string): string {
  const network = config.stellarNetwork === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

/**
 * Get an aggregated results summary — ballot info, tally breakdown,
 * participation, and on-chain verification links — in a single call.
 *
 * Replaces the previous pattern where the results page had to separately
 * fetch the ballot, the result, and the audit counts (3+ requests).
 */
export async function getResultsSummary(ballotId: string) {
  const [result, ballot] = await Promise.all([
    prisma.result.findUnique({ where: { ballotId } }),
    prisma.ballot.findUnique({
      where: { id: ballotId, deletedAt: null },
      include: { options: true },
    }),
  ]);

  if (!ballot) throw notFound("Ballot not found");

  const ballotSummary = {
    id: ballot.id,
    topic: ballot.topic,
    status: ballot.status,
    deadline: ballot.deadline,
  };

  if (!result) {
    return { ballot: ballotSummary, result: null };
  }

  const tally: Record<string, number> = JSON.parse(result.tallyJson);
  const options = ballot.options.map((opt) => {
    const count = tally[opt.id] ?? 0;
    const percentage =
      result.totalVotes > 0
        ? Math.round((count / result.totalVotes) * 10000) / 100
        : 0;
    return { optionId: opt.id, optionText: opt.text, count, percentage };
  });

  const tokensIssued = await prisma.voterToken.count({
    where: { ballotId },
  });
  const participationRate =
    tokensIssued > 0
      ? Math.round((result.totalVotes / tokensIssued) * 10000) / 100
      : 0;

  return {
    ballot: ballotSummary,
    result: {
      ...result,
      options,
      participationRate,
      tokensIssued,
      explorerUrl: result.stellarTxId ? explorerUrl(result.stellarTxId) : null,
      sorobanExplorerUrl: result.sorobanTxId
        ? explorerUrl(result.sorobanTxId)
        : null,
    },
  };
}
