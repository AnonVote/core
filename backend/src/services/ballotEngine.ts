import { prisma } from "../prisma/client";
import { badRequest, notFound } from "../utils/errors";

export async function createBallot(
  orgId: string,
  topic: string,
  options: string[],
  eligibilityListId: string,
  deadline: Date,
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
      options: {
        create: options.map((text) => ({ text: text.trim() })),
      },
    },
    include: { options: true },
  });

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

  return ballots.map((b) => ({
    id: b.id,
    topic: b.topic,
    status: b.status,
    deadline: b.deadline,
    createdAt: b.createdAt,
    options: b.options,
    eligibleVoters: b.eligibilityList._count.entries,
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
