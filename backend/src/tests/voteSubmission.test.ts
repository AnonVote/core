import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import * as sorobanService from "../services/sorobanService";

describe("Vote Submission Pipeline (backend/src/tests/voteSubmission.test.ts)", () => {
  let ballotId: string;
  let optionId: string;
  let validToken: string;

  beforeEach(async () => {
    // Clear test tables
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
    await prisma.organizationKey.deleteMany();
    await prisma.organization.deleteMany();

    // Create org
    const org = await prisma.organization.create({
      data: {
        name: "Test Org Submission",
        email: "submission@test.com",
        passwordHash: "hash123",
      },
    });

    // Create eligibility list & entry
    const list = await prisma.eligibilityList.create({ data: {} });
    await prisma.eligibilityEntry.create({
      data: {
        eligibilityListId: list.id,
        identifierHash: hashIdentifier("voter@submission.com"),
      },
    });

    // Create ballot
    const ballot = await prisma.ballot.create({
      data: {
        organizationId: org.id,
        topic: "Vote Submission Test Topic",
        eligibilityListId: list.id,
        deadline: new Date(Date.now() + 3600_000),
        status: "ACTIVE",
        options: {
          create: [{ text: "Option A" }, { text: "Option B" }],
        },
      },
      include: { options: true },
    });
    ballotId = ballot.id;
    optionId = (ballot as any).options[0].id;

    // Issue token
    validToken = generateToken();
    await prisma.voterToken.create({
      data: {
        tokenHash: hashToken(validToken),
        ballotId,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("submits a valid token + valid option → 200, encrypted payload, token used, audit row written", async () => {
    // Spy sorobanRecordVote to simulate success
    jest.spyOn(sorobanService, "sorobanRecordVote").mockResolvedValueOnce("0xstellar123abc");

    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.anchor_status).toBe("ANCHORED");
    expect(res.body.stellar_tx_id).toBe("0xstellar123abc");
    expect(res.body.soroban_tx_id).toBe("0xstellar123abc");
    expect(res.body.explorer_url).toContain("0xstellar123abc");

    // Check DB
    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);
    expect(votes[0].encryptedOption).toBeDefined();
    expect(votes[0].stellarTxId).toBe("0xstellar123abc");
    expect(votes[0].sorobanTxId).toBe("0xstellar123abc");
    expect(votes[0].anchorStatus).toBe("ANCHORED");

    // Token marked used with timestamp
    const tokenRecord = await prisma.voterToken.findUnique({
      where: { tokenHash: hashToken(validToken) },
    });
    expect(tokenRecord?.used).toBe(true);
    expect(tokenRecord?.usedAt).not.toBeNull();

    // Audit event written
    const auditEvents = await prisma.auditEvent.findMany({
      where: { ballotId, eventType: "VOTE_CAST" },
    });
    expect(auditEvents.length).toBe(1);
  });

  it("returns 401 INVALID_TOKEN for an unknown token", async () => {
    const fakeToken = generateToken();
    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: fakeToken, option_id: optionId });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_TOKEN");
  });

  it("returns 409 TOKEN_ALREADY_USED when submitting the same token twice", async () => {
    jest.spyOn(sorobanService, "sorobanRecordVote").mockResolvedValueOnce("0xtx1");

    // First submission
    const res1 = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });
    expect(res1.status).toBe(200);

    // Second submission with same token
    const res2 = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toBe("TOKEN_ALREADY_USED");
  });

  it("returns 403 BALLOT_CLOSED when ballot deadline has passed or ballot is CLOSED", async () => {
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "CLOSED" },
    });

    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BALLOT_CLOSED");
  });

  it("ensures raw option_id never appears in the database after successful submission", async () => {
    jest.spyOn(sorobanService, "sorobanRecordVote").mockResolvedValueOnce("0xtx1");

    await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);

    // Query entire raw string output of votes table
    const voteJson = JSON.stringify(votes[0]);
    expect(voteJson).not.toContain(optionId);
    expect(votes[0].encryptedOption).not.toBe(optionId);
  });

  it("handles Soroban failure: returns PENDING, saves vote, inserts 1 entry in stellar_retry_queue", async () => {
    // Simulate Soroban failure (returning empty string or throwing)
    jest.spyOn(sorobanService, "sorobanRecordVote").mockResolvedValueOnce("");

    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.anchor_status).toBe("PENDING");
    expect(res.body.stellar_tx_id).toBeNull();
    expect(res.body.soroban_tx_id).toBeNull();

    // Check database vote row
    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);
    expect(votes[0].anchorStatus).toBe("FAILED");

    // Check retry queue has 1 entry
    const retryEntries = await prisma.stellarRetryQueue.findMany({
      where: { voteId: votes[0].id },
    });
    expect(retryEntries.length).toBe(1);
    expect(retryEntries[0].retryCount).toBe(0);
  });

  it("returns 500 TRANSACTION_FAILED when contract invocation throws", async () => {
    jest.spyOn(sorobanService, "sorobanRecordVote").mockRejectedValueOnce(
      new Error("RPC connection refused"),
    );

    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("TRANSACTION_FAILED");

    // Vote should still be saved with FAILED anchor status
    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);
    expect(votes[0].anchorStatus).toBe("FAILED");
  });
});
