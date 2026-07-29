import { prisma } from "../prisma/client";
import {
  getDraftBallotsToActivate,
  getActiveExpiredBallots,
  closeBallot,
  finaliseBallot,
} from "../services/ballotEngine";

async function cleanDb() {
  await prisma.stellarRetryQueue.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.ballotKey.deleteMany();
  await prisma.result.deleteMany();
  await prisma.option.deleteMany();
  await prisma.tokenDeliveryRetry.deleteMany();
  await prisma.ballotAnchorRetry.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();
}

beforeAll(async () => {
  try {
    await cleanDb();
  } catch (e) {
    console.warn("DB not reachable, skipping integration tests");
    return;
  }
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("Ballot Scheduler — State Transitions", () => {
  it("scheduler transitions DRAFT ballot with past start_time to ACTIVE", async () => {
    // Create a draft ballot with a past start_time
    const org = await prisma.organization.create({
      data: {
        name: "Scheduler Test Org",
        email: "scheduler@test.org",
        passwordHash: "hash",
      },
    });
    const list = await prisma.eligibilityList.create({ data: {} });

    const ballot = await prisma.ballot.create({
      data: {
        organizationId: org.id,
        topic: "Scheduler Draft",
        status: "DRAFT",
        deadline: new Date(Date.now() + 7200000),
        startTime: new Date(Date.now() - 3600000), // 1 hour ago
        eligibilityListId: list.id,
        optionCount: 2,
      },
    });

    const drafts = await getDraftBallotsToActivate();
    expect(drafts.some((b) => b.id === ballot.id)).toBe(true);

    // Activate it
    await prisma.ballot.update({
      where: { id: ballot.id },
      data: { status: "ACTIVE" },
    });

    const updated = await prisma.ballot.findUnique({ where: { id: ballot.id } });
    expect(updated?.status).toBe("ACTIVE");
  });

  it("scheduler transitions ACTIVE ballot with past deadline to CLOSED", async () => {
    const org = await prisma.organization.findFirst({ where: { name: "Scheduler Test Org" } });
    if (!org) return;

    const list = await prisma.eligibilityList.create({ data: {} });

    const ballot = await prisma.ballot.create({
      data: {
        organizationId: org.id,
        topic: "Scheduler Active",
        status: "ACTIVE",
        deadline: new Date(Date.now() - 3600000), // 1 hour ago
        eligibilityListId: list.id,
        optionCount: 2,
      },
    });

    const expired = await getActiveExpiredBallots();
    expect(expired.some((b) => b.id === ballot.id)).toBe(true);

    await closeBallot(ballot.id);
    const updated = await prisma.ballot.findUnique({ where: { id: ballot.id } });
    expect(updated?.status).toBe("CLOSED");
  });

  it("scheduler does not transition FINALISED ballots", async () => {
    const org = await prisma.organization.findFirst({ where: { name: "Scheduler Test Org" } });
    if (!org) return;

    const list = await prisma.eligibilityList.create({ data: {} });

    const ballot = await prisma.ballot.create({
      data: {
        organizationId: org.id,
        topic: "Scheduler Finalised",
        status: "FINALISED",
        deadline: new Date(Date.now() - 3600000), // 1 hour ago
        eligibilityListId: list.id,
        optionCount: 2,
      },
    });

    // Should not be returned by getActiveExpiredBallots
    const expired = await getActiveExpiredBallots();
    expect(expired.some((b) => b.id === ballot.id)).toBe(false);

    // Should not be returned by getDraftBallotsToActivate
    const drafts = await getDraftBallotsToActivate();
    expect(drafts.some((b) => b.id === ballot.id)).toBe(false);
  });
});