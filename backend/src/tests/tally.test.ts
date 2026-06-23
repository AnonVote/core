/**
 * Unit tests for the tally engine (resultEngine.tallyBallot)
 */
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import { tallyBallot } from "../services/resultEngine";

let ballotId: string;
let optionAId: string;
let optionBId: string;
let eligibilityListId: string;

beforeAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.result.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();

  await prisma.organization.create({
    data: {
      name: "Tally Test Org",
      email: "tally@test.com",
      passwordHash: "irrelevant",
    },
  });

  const org = await prisma.organization.findUnique({
    where: { name: "Tally Test Org" },
  });

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;

  const ballot = await prisma.ballot.create({
    data: {
      organizationId: org!.id,
      topic: "Tally Test Ballot",
      deadline: new Date(Date.now() + 3_600_000),
      eligibilityListId,
      status: "CLOSED",
      options: { create: [{ text: "Option A" }, { text: "Option B" }] },
    },
    include: { options: true },
  });
  ballotId = ballot.id;
  optionAId = ballot.options.find((o) => o.text === "Option A")!.id;
  optionBId = ballot.options.find((o) => o.text === "Option B")!.id;
});

afterAll(() => prisma.$disconnect());

/** Helper: cast a vote directly against the DB using a raw payload */
async function castVote(optionId: string, weight = 1) {
  const { encryptVote } = await import("../utils/crypto");
  const payload = encryptVote(
    optionId,
    process.env.BALLOT_ENCRYPTION_KEY ?? "test-key-32bytes!padding123456",
  );
  return prisma.vote.create({
    data: { ballotId, optionId, encryptedPayload: payload, weight },
  });
}

describe("tallyBallot — tally engine", () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({ where: { ballotId } });
    await prisma.voterToken.deleteMany({ where: { ballotId } });
    await prisma.vote.deleteMany({ where: { ballotId } });
    await prisma.result.deleteMany({ where: { ballotId } });
  });

  it("correctly counts votes per option", async () => {
    await castVote(optionAId);
    await castVote(optionAId);
    await castVote(optionBId);

    // Issue tokens so consistency check passes
    for (let i = 0; i < 3; i++) {
      const t = generateToken();
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(t), ballotId, used: true },
      });
    }

    const result = await tallyBallot(ballotId, { skipSoroban: true });
    const tally = JSON.parse(result.tallyJson);
    expect(tally[optionAId]).toBe(2);
    expect(tally[optionBId]).toBe(1);
    expect(result.totalVotes).toBe(3);
    expect(result.isConsistent).toBe(true);
  });

  it("handles empty ballot", async () => {
    const result = await tallyBallot(ballotId, { skipSoroban: true });
    const tally = JSON.parse(result.tallyJson);
    expect(tally[optionAId]).toBe(0);
    expect(tally[optionBId]).toBe(0);
    expect(result.totalVotes).toBe(0);
  });

  it("handles single vote", async () => {
    await castVote(optionBId);
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(generateToken()), ballotId, used: true },
    });

    const result = await tallyBallot(ballotId, { skipSoroban: true });
    const tally = JSON.parse(result.tallyJson);
    expect(tally[optionBId]).toBe(1);
    expect(result.totalVotes).toBe(1);
  });

  it("handles maximum voter count without errors", async () => {
    const COUNT = 50;
    const voteOps = Array.from({ length: COUNT }, () => castVote(optionAId));
    await Promise.all(voteOps);

    const tokenOps = Array.from({ length: COUNT }, () =>
      prisma.voterToken.create({
        data: { tokenHash: hashToken(generateToken()), ballotId, used: true },
      }),
    );
    await Promise.all(tokenOps);

    const result = await tallyBallot(ballotId, { skipSoroban: true });
    expect(result.totalVotes).toBe(COUNT);
    expect(result.isConsistent).toBe(true);
  });
});
