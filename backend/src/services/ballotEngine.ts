import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";
import { badRequest, notFound } from "../utils/errors";
import { sendBallotCreatedEmail } from "./emailService";
import { sorobanRecordBallot } from "./sorobanService";

export async function createBallot(
  orgId: string,
  topic: string,
  options: string[],
  eligibilityListId: string,
  deadline: Date,
  allowWeightedVoting = false,
) {
  if (!topic?.trim()) throw badRequest("Ballot topic is required");
  if (!options || options.length < 2)
    throw badRequest("At least two options are required");
  if (deadline <= new Date())
    throw badRequest("Deadline must be in the future");

  const eligibilityList = await prisma.eligibilityList.findUnique({
    where: { id: eligibilityListId },
  });
  if (!eligibilityList) throw badRequest("Eligibility list not found");

  const ballot = await prisma.ballot.create({
    data: {
      organizationId: orgId,
      topic: topic.trim(),
      deadline,
      eligibilityListId,
      allowWeightedVoting,
      options: {
        create: options.map((text) => ({ text: text.trim() })),
      },
    },
    include: { options: true },
  });

  // Record ballot creation on-chain
  try {
    const txHash = await sorobanRecordBallot(hashIdentifier(ballot.id));
    if (txHash) {
      await prisma.ballot.update({
        where: { id: ballot.id },
        data: { stellarTxId: txHash, anchorStatus: "SUCCESS" },
      });
    } else {
      await prisma.ballot.update({
        where: { id: ballot.id },
        data: { anchorStatus: "PENDING" },
      });
    }
  } catch (err) {
    console.error("[Soroban] record_ballot failed:", err);
    await prisma.ballot.update({
      where: { id: ballot.id },
      data: { anchorStatus: "PENDING" },
    });
  }

  // Send confirmation email to org admin — non-blocking
  prisma.organization
    .findUnique({ where: { id: orgId }, select: { email: true, name: true } })
    .then((org) => {
      if (org) {
        console.log(`[Email] Sending ballot created email to ${org.email}`);
        sendBallotCreatedEmail({
          to: org.email,
          orgName: org.name,
          topic: ballot.topic,
          deadline: ballot.deadline,
          ballotId: ballot.id,
        })
          .then(() =>
            console.log(
              `[Email] Ballot created email delivered to ${org.email}`,
            ),
          )
          .catch((err) =>
            console.error("[Email] Ballot created send error:", err),
          );
      } else {
        console.warn("[Email] Org not found for ballot created email");
      }
    })
    .catch((err) =>
      console.error("[Email] Failed to fetch org for email:", err),
    );

  return ballot;
}

export async function getBallotsByOrg(orgId: string) {
  const ballots = await prisma.ballot.findMany({
    where: { organizationId: orgId },
    include: {
      options: true,
      eligibilityList: { include: { _count: { select: { entries: true } } } },
      _count: { select: { votes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get tokens issued count per ballot from audit events
  const ballotIds = ballots.map((b) => b.id);
  const tokenCounts = await prisma.auditEvent.groupBy({
    by: ["ballotId"],
    where: {
      ballotId: { in: ballotIds },
      eventType: "TOKEN_ISSUED",
    },
    _count: { id: true },
  });
  const tokenCountMap = Object.fromEntries(
    tokenCounts.map((t) => [t.ballotId, t._count.id]),
  );

  return ballots.map((b) => ({
    id: b.id,
    topic: b.topic,
    status: b.status,
    deadline: b.deadline,
    createdAt: b.createdAt,
    options: b.options,
    eligibleVoters: b.eligibilityList._count.entries,
    tokensIssued: tokenCountMap[b.id] ?? 0,
    votesCast: b._count.votes,
  }));
}

export async function getBallotById(id: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id },
    include: { options: true },
  });
  if (!ballot) throw notFound("Ballot not found");
  return ballot;
}

export async function updateBallot(
  ballotId: string,
  orgId: string,
  data: {
    topic?: string;
    deadline?: Date;
    eligibilityListId?: string;
    options?: string[];
  },
) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { _count: { select: { votes: true } } },
  });

  if (!ballot) throw notFound("Ballot not found");
  if (ballot.organizationId !== orgId)
    throw badRequest("You can only edit your own ballots");
  if (ballot.status === "CLOSED")
    throw badRequest("Closed ballots cannot be edited");

  const hasVotes = ballot._count.votes > 0;

  if (hasVotes && (data.options || data.eligibilityListId)) {
    throw badRequest(
      "Options and eligibility list cannot be changed after votes have been cast",
    );
  }

  if (data.topic !== undefined && !data.topic.trim())
    throw badRequest("Ballot topic cannot be empty");
  if (data.deadline !== undefined && data.deadline <= new Date())
    throw badRequest("Deadline must be in the future");
  if (data.options !== undefined && data.options.length < 2)
    throw badRequest("At least two options are required");

  if (data.eligibilityListId) {
    const list = await prisma.eligibilityList.findUnique({
      where: { id: data.eligibilityListId },
    });
    if (!list) throw badRequest("Eligibility list not found");
  }

  return prisma.$transaction(async (tx) => {
    // Replace options if provided
    if (data.options) {
      await tx.option.deleteMany({ where: { ballotId } });
      await tx.option.createMany({
        data: data.options.map((text) => ({ ballotId, text: text.trim() })),
      });
    }

    const updated = await tx.ballot.update({
      where: { id: ballotId },
      data: {
        ...(data.topic && { topic: data.topic.trim() }),
        ...(data.deadline && { deadline: data.deadline }),
        ...(data.eligibilityListId && {
          eligibilityListId: data.eligibilityListId,
        }),
      },
      include: { options: true },
    });

    return updated;
  });
}

export async function closeBallot(ballotId: string) {
  await prisma.ballot.update({
    where: { id: ballotId },
    data: { status: "CLOSED" },
  });
}

export async function getOpenExpiredBallots() {
  return prisma.ballot.findMany({
    where: { status: "OPEN", deadline: { lt: new Date() } },
  });
}

/**
 * Background worker to retry pending Stellar anchors.
 */
export async function processPendingAnchors() {
  const pending = await prisma.ballot.findMany({
    where: { anchorStatus: "PENDING" },
  });

  if (pending.length === 0) return;

  console.log(`[Anchor] Processing ${pending.length} pending ballots...`);

  for (const ballot of pending) {
    try {
      const txHash = await sorobanRecordBallot(hashIdentifier(ballot.id));
      if (txHash) {
        await prisma.ballot.update({
          where: { id: ballot.id },
          data: { stellarTxId: txHash, anchorStatus: "SUCCESS" },
        });
        console.log(`[Anchor] Ballot ${ballot.id} anchored: ${txHash}`);
      }
    } catch (err) {
      console.error(`[Anchor] Retry failed for ballot ${ballot.id}:`, err);
    }
  }
}

export async function deleteBallot(ballotId: string, orgId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
  });

  if (!ballot) throw notFound("Ballot not found");
  if (ballot.organizationId !== orgId) {
    throw badRequest("You can only delete your own ballots");
  }

  // Delete in correct order — child records first
  await prisma.auditEvent.deleteMany({ where: { ballotId } });
  await prisma.result.deleteMany({ where: { ballotId } });
  await prisma.vote.deleteMany({ where: { ballotId } });
  await prisma.option.deleteMany({ where: { ballotId } });
  await prisma.voterToken.deleteMany({ where: { ballotId } });

  await prisma.ballot.delete({
    where: { id: ballotId },
  });
}
