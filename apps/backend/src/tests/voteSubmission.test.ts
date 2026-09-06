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
    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    // Anchoring is now ASYNC and batched (issue #77): the API confirms the
    // vote immediately with anchor_status PENDING; the submission batcher
    // anchors it to the Soroban contract in a later batch transaction.
    expect(res.body.anchor_status).toBe("PENDING");
    expect(res.body.stellar_tx_id).toBeNull();
    expect(res.body.soroban_tx_id).toBeNull();
    expect(res.body.voteId).toBeTruthy();

    // Check DB
    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);
    expect(votes[0].encryptedOption).toBeDefined();
    expect(votes[0].anchorStatus).toBe("PENDING");
    // Deterministic idempotency key stored for later batched anchoring.
    expect(votes[0].voteIdHash).toBeTruthy();
    expect(votes[0].sorobanTxId).toBeNull();

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

  it("handles Soroban unavailability: vote is still confirmed as PENDING with a stored idempotency key (async anchoring)", async () => {
    // Anchoring is asynchronous — the contract layer being down never fails
    // (or even delays) the vote confirmation. The batcher handles retries.
    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.anchor_status).toBe("PENDING");
    expect(res.body.stellar_tx_id).toBeNull();
    expect(res.body.soroban_tx_id).toBeNull();

    // Check database vote row — PENDING, ready for batched anchoring.
    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);
    expect(votes[0].anchorStatus).toBe("PENDING");
    expect(votes[0].voteIdHash).toBeTruthy();

    // No legacy retry-queue row is inserted up front (retries happen inside
    // the submission batcher / resilience layer).
    const retryEntries = await prisma.stellarRetryQueue.findMany({
      where: { voteId: votes[0].id },
    });
    expect(retryEntries.length).toBe(0);
  });

  it("never fails the vote when the contract invocation throws — confirmed as PENDING", async () => {
    // A throwing contract call used to surface 500 TRANSACTION_FAILED; under
    // batched async anchoring the vote is always confirmed and the failure is
    // absorbed by the resilience/retry layer offline.
    jest.spyOn(sorobanService, "sorobanRecordVote").mockRejectedValueOnce(
      new Error("RPC connection refused"),
    );

    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: validToken, option_id: optionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.anchor_status).toBe("PENDING");

    const votes = await prisma.vote.findMany({ where: { ballotId } });
    expect(votes.length).toBe(1);
    expect(votes[0].anchorStatus).toBe("PENDING");
  });
});
