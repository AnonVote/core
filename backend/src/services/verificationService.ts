import { prisma } from "../prisma/client";
import { badRequest, notFound } from "../utils/errors";
import { hashIdentifier } from "../utils/crypto";
import { computeBallotCommitment } from "../utils/commitment";
import { sorobanGetBallotCommitment } from "./sorobanService";

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

export type CommitmentStatus = "verified" | "mismatch" | "unanchored";

export interface BallotCommitmentVerification {
  status: CommitmentStatus;
  /** Recomputed from the ballot's current content. */
  expected: string;
  /** What the anchor actually holds, or null when nothing is anchored. */
  onChain: string | null;
  /** Where `onChain` came from. */
  source: "chain" | "database" | "none";
}

/**
 * Verifies a ballot's content against its anchored commitment (Issue #86).
 *
 * Resolution order is chain → DB copy → unanchored. When `SOROBAN_CONTRACT_ID`
 * is unset (the default, including CI) the Soroban helper returns null and the
 * check degrades to the DB copy, reporting `source: "database"` so the UI can
 * say what it actually verified rather than overclaiming.
 *
 * @param opts.fetchCommitment - Injectable in tests to avoid a live RPC call;
 *                   mirrors `verifyBallotConsistency`'s `opts.fetchAuditCounts`.
 */
export async function verifyBallotCommitment(
  ballotId: string,
  opts: { fetchCommitment?: typeof sorobanGetBallotCommitment } = {},
): Promise<BallotCommitmentVerification> {
  if (!ballotId || typeof ballotId !== "string") {
    throw badRequest("Missing or malformed field: ballotId");
  }

  const fetchCommitment = opts.fetchCommitment ?? sorobanGetBallotCommitment;

  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { options: true },
  });
  if (!ballot) throw notFound("Ballot not found");

  const expected = computeBallotCommitment({
    topic: ballot.topic,
    descriptionCiphertext: ballot.descriptionCiphertext,
    options: ballot.options,
    deadline: ballot.deadline,
  });

  let onChain: string | null = null;
  let source: "chain" | "database" | "none" = "none";

  try {
    onChain = await fetchCommitment(hashIdentifier(ballotId));
    if (onChain) source = "chain";
  } catch {
    // A read failure is not a mismatch — fall through to the DB copy.
    onChain = null;
  }

  if (!onChain && ballot.commitmentHash) {
    onChain = ballot.commitmentHash;
    source = "database";
  }

  if (!onChain) {
    return { status: "unanchored", expected, onChain: null, source: "none" };
  }

  return {
    status: onChain === expected ? "verified" : "mismatch",
    expected,
    onChain,
    source,
  };
}
