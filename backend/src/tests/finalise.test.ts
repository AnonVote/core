/**
 * Unit tests for idempotent ballot finalisation
 * POST /api/results/:ballotId/finalise
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import * as resultEngine from "../services/resultEngine";

let cookie: string;
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

  await request(app)
    .post("/api/organizations")
    .send({ name: "Finalise Test Org", email: "f@test.com", password: "pass1234" });

  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Finalise Test Org", password: "pass1234" });
  cookie = loginRes.headers["set-cookie"];

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;

  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Finalise Test Ballot",
      options: ["Yes", "No"],
      eligibilityListId,
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;
  optionId = ballotRes.body.data.options[0].id;

  // Cast a vote
  const { encryptVote } = await import("../utils/crypto");
  const payload = encryptVote(
    optionId,
    process.env.BALLOT_ENCRYPTION_KEY ?? "test-key-32bytes!padding123456",
  );
  await prisma.vote.create({ data: { ballotId, optionId, encryptedPayload: payload, weight: 1 } });
  await prisma.voterToken.create({
    data: { tokenHash: hashToken(generateToken()), ballotId, used: true },
  });
});

afterAll(() => prisma.$disconnect());

describe("POST /api/results/:ballotId/finalise — idempotency", () => {
  it("first call finalises the ballot and returns the result", async () => {
    const res = await request(app)
      .post(`/api/results/${ballotId}/finalise`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.finalised).toBe(true);
    expect(res.body.data.finalisedAt).toBeTruthy();
    expect(res.body.idempotent).toBe(false);
  });

  it("second call returns existing result without re-running tally", async () => {
    const tallySpy = jest.spyOn(resultEngine, "tallyBallot");

    const res = await request(app)
      .post(`/api/results/${ballotId}/finalise`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.finalised).toBe(true);
    expect(res.body.idempotent).toBe(true);
    // tallyBallot must NOT have been called again
    expect(tallySpy).not.toHaveBeenCalled();

    tallySpy.mockRestore();
  });

  it("rejects non-owner caller", async () => {
    // Register a second org
    await request(app)
      .post("/api/organizations")
      .send({ name: "Other Org", email: "other@test.com", password: "pass1234" });
    const otherLogin = await request(app)
      .post("/api/organizations/login")
      .send({ name: "Other Org", password: "pass1234" });
    const otherCookie = otherLogin.headers["set-cookie"];

    const res = await request(app)
      .post(`/api/results/${ballotId}/finalise`)
      .set("Cookie", otherCookie);

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent ballot", async () => {
    const res = await request(app)
      .post("/api/results/nonexistent-ballot-id/finalise")
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
