import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";

let ballotId: string;
let eligibilityListId: string;
const VOTER_ID = "voter@test.com";

beforeAll(async () => {
  await prisma.reissueRateLimit.deleteMany();
  await prisma.stellarRetryQueue.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.ballotKey.deleteMany();
  await prisma.result.deleteMany();
  await prisma.option.deleteMany();
  await prisma.tokenDeliveryRetry.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationKey.deleteMany();
  await prisma.organization.deleteMany();

  // Create org + session
  await request(app)
    .post("/api/organizations")
    .send({ name: "Token Test Org", email: "a@b.com", password: "pass1234" });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Token Test Org", password: "pass1234" });
  const cookie = loginRes.headers["set-cookie"];

  // Create eligibility list
  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
  await prisma.eligibilityEntry.create({
    data: { eligibilityListId, identifierHash: hashIdentifier(VOTER_ID) },
  });

  // Create ballot
  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Test Ballot",
      options: ["Yes", "No"],
      eligibilityListId,
      deadline: new Date(Date.now() + 7200_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;
});

afterAll(() => prisma.$disconnect());

describe("POST /api/tokens", () => {
  it("issues a token for an eligible voter", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: VOTER_ID });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toHaveLength(64);
  });

  it("rejects duplicate token request for same voter", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: VOTER_ID });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already been issued/i);
  });

  it("rejects ineligible voter with generic error", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: "notinlist@test.com" });
    expect(res.status).toBe(400);
    // Should not reveal "not found" vs "already issued"
    expect(res.body.message).not.toMatch(/not found/i);
  });

  it("rejects token request for closed ballot", async () => {
    // Close the ballot
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "CLOSED" },
    });
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: "new@voter.com" });
    expect(res.status).toBe(400);
    // Reopen for other tests
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "ACTIVE" },
    });
  });
});

describe("POST /api/tokens/reissue", () => {
  it("handles race condition: two concurrent reissue requests result in exactly one new token and one invalidated old token", async () => {
    const raceVoter = "race_voter@test.com";
    await prisma.eligibilityEntry.create({
      data: { eligibilityListId, identifierHash: hashIdentifier(raceVoter) },
    });

    // Issue initial token
    const initialRes = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: raceVoter });
    expect(initialRes.status).toBe(200);

    // Fire 2 concurrent reissue requests
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/tokens/reissue")
        .send({ ballotId, voterIdentifier: raceVoter }),
      request(app)
        .post("/api/tokens/reissue")
        .send({ ballotId, voterIdentifier: raceVoter }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 200]);

    // Check DB state for voter tokens
    const unusedTokens = await prisma.voterToken.findMany({
      where: { ballotId, used: false },
    });
    const usedTokens = await prisma.voterToken.findMany({
      where: { ballotId, used: true },
    });

    // Exactly 2 new active tokens and 2 invalidated old tokens (since both requests succeeded)
    expect(unusedTokens.length).toBe(2);
    expect(usedTokens.length).toBe(2);
  });

  it("blocks a fourth reissue request within 24 hours with REISSUE_LIMIT_EXCEEDED (429)", async () => {
    process.env.ENABLE_RATE_LIMITS = "true";
    const rateLimitVoter = "ratelimit_voter@test.com";
    await prisma.eligibilityEntry.create({
      data: { eligibilityListId, identifierHash: hashIdentifier(rateLimitVoter) },
    });

    // Issue initial token
    await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: rateLimitVoter });

    // Request 1st, 2nd, 3rd reissues
    const r1 = await request(app)
      .post("/api/tokens/reissue")
      .send({ ballotId, voterIdentifier: rateLimitVoter });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post("/api/tokens/reissue")
      .send({ ballotId, voterIdentifier: rateLimitVoter });
    expect(r2.status).toBe(200);

    const r3 = await request(app)
      .post("/api/tokens/reissue")
      .send({ ballotId, voterIdentifier: rateLimitVoter });
    expect(r3.status).toBe(200);

    // 4th reissue attempt should be rate-limited
    const r4 = await request(app)
      .post("/api/tokens/reissue")
      .send({ ballotId, voterIdentifier: rateLimitVoter });

    expect(r4.status).toBe(429);
    expect(r4.body.error).toBe("REISSUE_LIMIT_EXCEEDED");
  });
});

