import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";

let ballotId: string;
let eligibilityListId: string;
const VOTER_ID = "voter@test.com";

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
      deadline: new Date(Date.now() + 3600_000).toISOString(),
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
    expect(res.status).toBe(400);
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
      data: { status: "OPEN" },
    });
  });
});
