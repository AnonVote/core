import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";

let ballotId: string;
let optionId: string;
let eligibilityListId: string;
let validToken: string;

beforeAll(async () => {
  await prisma.stellarRetryQueue.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.ballotKey.deleteMany();
  await prisma.result.deleteMany();
  await prisma.option.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();

  await request(app)
    .post("/api/organizations")
    .send({ name: "Vote Test Org", email: "v@b.com", password: "pass1234" });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Vote Test Org", password: "pass1234" });
  const cookie = loginRes.headers["set-cookie"];

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
  await prisma.eligibilityEntry.create({
    data: {
      eligibilityListId,
      identifierHash: hashIdentifier("voter@vote.com"),
    },
  });

  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Vote Test Ballot",
      options: ["Option A", "Option B"],
      eligibilityListId,
      deadline: new Date(Date.now() + 7200_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;
  optionId = ballotRes.body.data.options[0].id;

  // Issue a valid token
  const tokenRes = await request(app)
    .post("/api/tokens")
    .send({ ballotId, voterIdentifier: "voter@vote.com" });
  validToken = tokenRes.body.data.token;
});

afterAll(() => prisma.$disconnect());

describe("POST /api/votes", () => {
  it("submits a vote successfully", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: validToken, optionId });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.anchor_status).toBeDefined();
  });

  it("rejects a used token", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: validToken, optionId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("TOKEN_ALREADY_USED");
  });

  it("rejects an invalid token", async () => {
    const fakeToken = generateToken();
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: fakeToken, optionId });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_TOKEN");
  });

  it("rejects an invalid option", async () => {
    const rawToken = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(rawToken), ballotId },
    });
    const res = await request(app)
      .post("/api/votes")
      .send({
        ballotId,
        voterToken: rawToken,
        optionId: "non-existent-option-id",
      });
    expect(res.status).toBe(400);
  });

  it("rejects vote on closed ballot", async () => {
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "CLOSED" },
    });
    const rawToken = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(rawToken), ballotId },
    });
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: rawToken, optionId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BALLOT_CLOSED");
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "OPEN" },
    });
  });
});

describe("GET /api/results/:ballotId — public access", () => {
  it("returns 200 with no authentication when result exists", async () => {
    await prisma.ballot.update({ where: { id: ballotId }, data: { status: "CLOSED" } });
    const { tallyBallot } = await import("../services/resultEngine");
    await tallyBallot(ballotId, { skipSoroban: true });

    const res = await request(app).get(`/api/results/${ballotId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});
