import { prisma } from "../prisma/client";
import { badRequest, notFound } from "../utils/errors";

/**
 * Generate a verification hash for a vote.
 * Voters can use this to confirm their vote was recorded without exposing identity.
 * The hash is simply voteId:ballotId — deterministic and verifiable.
 */
export async function generateVoteVerification(
  ballotId: string,
  voteId: string,
): Promise<{ verificationHash: string; voteId: string }> {
  const vote = await prisma.vote.findUnique({
    where: { id: voteId },
  });

  if (!vote || vote.ballotId !== ballotId) {
    throw badRequest("No vote found for this ballot.");
  }

  const verificationHash = `${vote.id}:${ballotId}`;
  return { verificationHash, voteId: vote.id };
}

/**
 * Verify a vote using the verification hash.
 * Returns vote info without revealing voter identity.
 */
export async function verifyVote(
  ballotId: string,
  voteId: string,
  verificationHash: string,
): Promise<{
  ballotId: string;
  voteId: string;
  verified: boolean;
  optionsCount: number;
  submittedAt: string;
}> {
  const expectedHash = `${voteId}:${ballotId}`;
  if (verificationHash !== expectedHash) {
    throw badRequest("Invalid verification hash.");
  }

  const vote = await prisma.vote.findUnique({
    where: { id: voteId },
    include: {
      ballot: {
        select: {
          options: { select: { id: true, text: true } },
        },
      },
    },
  });

  if (!vote) throw notFound("Vote not found.");
  if (vote.ballotId !== ballotId)
    throw badRequest("Vote does not belong to this ballot.");

  return {
    ballotId: vote.ballotId,
    voteId: vote.id,
    verified: true,
    optionsCount: vote.ballot.options.length,
    submittedAt: vote.submittedAt.toISOString(),
  };
}
