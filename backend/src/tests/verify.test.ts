/**
 * Unit tests for POST /api/ballots/:id/verify — privacy-safe self-verification
 *
 * Privacy contract: response must contain ONLY { confirmed: boolean }.
 * These tests enforce that no vote option, token hash, or voter identity
 * is ever present in the response body.
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";

let ballotId: string;
let optionId: string;
let eligibilityListId: string;
let usedToken: string;   // A token that has voted
let unusedToken: string; // A token that has NOT voted

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
    .send({ name: "Verify Test Org", email: "v@verify.com", password: "pass1234" });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Verify Test Org", password: "pass1234" });
  const cookie = loginRes.headers["set-cookie"];

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
  await prisma.eligibilityEntry.create({
    data: { eligibilityListId, identifierHash: hashIdentifier("voter@verify.com") },
  });

  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Verify Test Ballot",
      options: ["Approve", "Reject"],
      eligibilityListId,
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;
  optionId = ballotRes.body.data.options[0].id;

  // Issue and use a token
  const tokenRes = await request(app)
    .post("/api/tokens")
    .send({ ballotId, voterIdentifier: "voter@verify.com" });
  usedToken = tokenRes.body.data.token;

  await request(app)
    .post("/api/votes")
    .send({ ballotId, voterToken: usedToken, optionId });

  // Create an unused token directly in DB
  unusedToken = generateToken();
  await prisma.voterToken.create({
    data: { tokenHash: hashToken(unusedToken), ballotId, used: false },
  });
});

afterAll(() => prisma.$disconnect());

describe("POST /api/ballots/:id/verify — privacy-safe self-verification", () => {
  it("returns { confirmed: true } for a token that voted", async () => {
    const res = await request(app)
      .post(`/api/ballots/${ballotId}/verify`)
      .send({ token: usedToken });

    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
  });

  it("returns { confirmed: false } for a token that did not vote", async () => {
    const res = await request(app)
      .post(`/api/ballots/${ballotId}/verify`)
      .send({ token: unusedToken });

    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(false);
  });

  it("returns { confirmed: false } for a random unknown token", async () => {
    const res = await request(app)
      .post(`/api/ballots/${ballotId}/verify`)
      .send({ token: generateToken() });

    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(false);
  });

  it("response contains ONLY the confirmed field — no vote option, no token hash, no voter data", async () => {
    const res = await request(app)
      .post(`/api/ballots/${ballotId}/verify`)
      .send({ token: usedToken });

    const keys = Object.keys(res.body);
    expect(keys).toEqual(["confirmed"]);
    // Explicitly assert forbidden fields are absent
    expect(res.body.optionId).toBeUndefined();
    expect(res.body.option).toBeUndefined();
    expect(res.body.optionText).toBeUndefined();
    expect(res.body.tokenHash).toBeUndefined();
    expect(res.body.voterIdentifier).toBeUndefined();
    expect(res.body.identifierHash).toBeUndefined();
    expect(res.body.voteId).toBeUndefined();
    expect(res.body.submittedAt).toBeUndefined();
  });

  it("returns 400 when token is missing", async () => {
    const res = await request(app)
      .post(`/api/ballots/${ballotId}/verify`)
      .send({});
    expect(res.status).toBe(400);
  });
});
