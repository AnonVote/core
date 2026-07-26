/**
 * Unit + integration tests for on-chain consistency verification (issue #68).
 *
 * verifyBallotConsistency's own contract-reading dependency is injected via
 * `opts.fetchAuditCounts` so these tests don't require a deployed Soroban
 * contract or live RPC access — consistent with how `tallyBallot` already
 * takes `opts.skipSoroban` to avoid real network calls in tests.
 */
import { prisma } from "../prisma/client";
import { generateToken, hashToken } from "../utils/crypto";
import { verifyBallotConsistency } from "../services/sorobanService";
import { tallyBallot } from "../services/resultEngine";

let ballotId: string;
let optionId: string;
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
      name: "Verify Test Org",
      email: "verify@test.com",
      passwordHash: "irrelevant",
    },
  });
  const org = await prisma.organization.findUnique({
    where: { name: "Verify Test Org" },
  });

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;

  const ballot = await prisma.ballot.create({
    data: {
      organizationId: org!.id,
      topic: "Verify Test Ballot",
      deadline: new Date(Date.now() + 3_600_000),
      eligibilityListId,
      status: "CLOSED",
      options: { create: [{ text: "Yes" }] },
    },
    include: { options: true },
  });
  ballotId = ballot.id;
  optionId = ballot.options[0].id;
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { ballotId } });
  await prisma.voterToken.deleteMany({ where: { ballotId } });
  await prisma.vote.deleteMany({ where: { ballotId } });
  await prisma.result.deleteMany({ where: { ballotId } });
});

/** Helper: cast a vote directly against the DB using a raw payload */
async function castVote(weight = 1) {
  const { encryptVote } = await import("../utils/crypto");
  const payload = encryptVote(
    optionId,
    process.env.BALLOT_ENCRYPTION_KEY ?? "test-key-32bytes!padding123456",
  );
  return prisma.vote.create({
    data: { ballotId, optionId, encryptedPayload: payload, weight },
  });
}

describe("verifyBallotConsistency", () => {
  it("returns true when on-chain counters match raw database counts", async () => {
    // Weighted vote — on-chain votes_cast counts calls (1), not weight (5).
    await castVote(5);
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(generateToken()), ballotId, used: true },
    });
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(generateToken()), ballotId, used: false },
    });

    const verified = await verifyBallotConsistency(ballotId, {
      fetchAuditCounts: async () => ({
        tokensIssued: 2,
        votesCast: 1,
        isConsistent: true,
      }),
    });

    expect(verified).toBe(true);
  });

  it("returns false when on-chain counts disagree with the database", async () => {
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(generateToken()), ballotId, used: true },
    });

    const verified = await verifyBallotConsistency(ballotId, {
      // Contract says 5 tokens were issued; the DB only has 1.
      fetchAuditCounts: async () => ({
        tokensIssued: 5,
        votesCast: 0,
        isConsistent: true,
      }),
    });

    expect(verified).toBe(false);
  });

  it("returns false when the contract's own is_consistent reports false, even if counts line up", async () => {
    const verified = await verifyBallotConsistency(ballotId, {
      fetchAuditCounts: async () => ({
        tokensIssued: 0,
        votesCast: 0,
        isConsistent: false,
      }),
    });

    expect(verified).toBe(false);
  });

  it("returns false and does not throw when the contract call errors", async () => {
    const verified = await verifyBallotConsistency(ballotId, {
      fetchAuditCounts: async () => {
        throw new Error("RPC timeout");
      },
    });

    expect(verified).toBe(false);
  });

  it("returns false when SOROBAN_CONTRACT_ID is unset (the default in this test env)", async () => {
    const verified = await verifyBallotConsistency(ballotId);
    expect(verified).toBe(false);
  });
});

describe("tallyBallot — on-chain verification integration", () => {
  it("calls verifyBallotConsistency during finalisation and stores a boolean result", async () => {
    const result = await tallyBallot(ballotId);
    const stored = await prisma.result.findUnique({ where: { id: result.id } });

    // No SOROBAN_CONTRACT_ID in this test env, so verification itself
    // resolves to false — but it must have RUN (not been skipped), i.e. the
    // field is a boolean, not left null.
    expect(typeof stored!.verifiedOnChain).toBe("boolean");
    expect(stored!.verifiedOnChain).toBe(false);
  });

  it("does not run verification when skipSoroban is set", async () => {
    const result = await tallyBallot(ballotId, { skipSoroban: true });
    const stored = await prisma.result.findUnique({ where: { id: result.id } });

    expect(stored!.verifiedOnChain).toBeNull();
  });

  it("still returns the published result even though on-chain verification fails", async () => {
    await castVote();
    const result = await tallyBallot(ballotId);

    expect(result.totalVotes).toBe(1);
    expect(result.id).toBeTruthy();
  });
});
