/**
 * Token format validation tests — Issue #71
 *
 * Verifies that:
 *   1. POST /api/votes rejects tokens that are not 64-char lowercase hex.
 *   2. POST /api/votes accepts valid 64-char hex tokens (both cases).
 *   3. POST /api/tokens and POST /api/tokens/reissue reject voterIdentifier
 *      values that exceed 500 characters.
 *   4. The legacy "token" field alias is transparently normalised to "voterToken"
 *      before schema validation, so existing clients are not broken.
 */

import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";

// A valid token: exactly 64 lowercase hex chars
const VALID_TOKEN = "a".repeat(64);
// A valid token with uppercase letters (pattern is /i so must also pass)
const VALID_TOKEN_UPPER = "A".repeat(64);

describe("Token format validation — POST /api/votes", () => {
  let ballotId: string;
  let optionId: string;
  let realToken: string;

  beforeEach(async () => {
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

    const org = await prisma.organization.create({
      data: {
        name: "Token Format Test Org",
        email: "tokenformat@test.com",
        passwordHash: "hash123",
      },
    });

    const list = await prisma.eligibilityList.create({ data: {} });
    await prisma.eligibilityEntry.create({
      data: {
        eligibilityListId: list.id,
        identifierHash: hashIdentifier("voter@tokenformat.com"),
      },
    });

    const ballot = await prisma.ballot.create({
      data: {
        organizationId: org.id,
        topic: "Token Format Validation Test",
        eligibilityListId: list.id,
        deadline: new Date(Date.now() + 3_600_000),
        status: "ACTIVE",
        options: { create: [{ text: "Yes" }, { text: "No" }] },
      },
      include: { options: true },
    });

    ballotId = ballot.id;
    optionId = (ballot as any).options[0].id;

    // Register a real valid token so accepted payloads can reach the handler
    realToken = generateToken(); // 64-char hex
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(realToken), ballotId },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Format rejection tests ────────────────────────────────────────────────

  it("rejects an empty voterToken with 400", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "", optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a voterToken shorter than 64 chars with 400", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "abc123", optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a voterToken of exactly 63 chars with 400", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "a".repeat(63), optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a voterToken of exactly 65 chars with 400", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "a".repeat(65), optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a voterToken with non-hex characters with 400", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "g".repeat(64), optionId }); // 'g' is not hex

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a voterToken that contains spaces with 400", async () => {
    const spacedToken = "a".repeat(32) + " " + "a".repeat(31);
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: spacedToken, optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a voterToken with hyphens (UUID-like) with 400", async () => {
    // A UUID is 36 chars and contains hyphens — clearly not a valid token
    const uuidLike = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: uuidLike, optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a missing voterToken with 400", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  // ── Format acceptance tests ───────────────────────────────────────────────

  it("accepts a valid 64-char lowercase hex voterToken (reaches service layer)", async () => {
    // realToken is a generateToken() result — exactly 64 lowercase hex chars
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: realToken, optionId });

    // Must not be a validation error; may be 200 or a business-logic error
    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe("ValidationError");
  });

  it("accepts a valid 64-char uppercase hex voterToken (pattern is case-insensitive)", async () => {
    // Register the uppercase token so it exists in the DB
    const upperToken = realToken.toUpperCase();
    // The DB stores lowercase hashes, so we need to hash the upper version as-is
    // — this test is only about schema acceptance, not DB lookup
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: upperToken, optionId });

    // Validation must pass; business layer may return 401 (token not found) but
    // NOT 400 ValidationError
    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe("ValidationError");
  });

  // ── Legacy alias normalisation ────────────────────────────────────────────

  it("accepts the legacy 'token' field alias and treats it identically to 'voterToken'", async () => {
    // Existing clients send { token: "..." }; we normalise it before validation
    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: realToken, option_id: optionId });

    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe("ValidationError");
  });

  it("rejects the legacy 'token' alias when the value is not 64-char hex", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballot_id: ballotId, token: "short", option_id: optionId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("includes field-level error details in the 400 response", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "tooshort", optionId });

    expect(res.status).toBe(400);
    expect(res.body.fields).toBeDefined();
    expect(Array.isArray(res.body.fields)).toBe(true);
    const tokenError = res.body.fields.find((f: { field: string }) => f.field === "voterToken");
    expect(tokenError).toBeDefined();
  });
});

describe("voterIdentifier length validation — POST /api/tokens and POST /api/tokens/reissue", () => {
  let ballotId: string;

  beforeEach(async () => {
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

    const org = await prisma.organization.create({
      data: {
        name: "Identifier Length Test Org",
        email: "identlen@test.com",
        passwordHash: "hash123",
      },
    });

    const ballot = await prisma.ballot.create({
      data: {
        organizationId: org.id,
        topic: "Identifier Length Test",
        eligibilityListId: (await prisma.eligibilityList.create({ data: {} })).id,
        deadline: new Date(Date.now() + 3_600_000),
        status: "ACTIVE",
        options: { create: [{ text: "Yes" }] },
      },
    });

    ballotId = ballot.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a voterIdentifier longer than 500 chars with 400 on POST /api/tokens", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: "x".repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("accepts a voterIdentifier of exactly 500 chars on POST /api/tokens", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: "x".repeat(500) });

    // Validation passes; service layer may return a business error (not on eligibility
    // list) but must NOT return 400 ValidationError
    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe("ValidationError");
  });

  it("rejects a voterIdentifier longer than 500 chars with 400 on POST /api/tokens/reissue", async () => {
    const res = await request(app)
      .post("/api/tokens/reissue")
      .send({ ballotId, voterIdentifier: "x".repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("accepts a voterIdentifier of exactly 500 chars on POST /api/tokens/reissue", async () => {
    const res = await request(app)
      .post("/api/tokens/reissue")
      .send({ ballotId, voterIdentifier: "x".repeat(500) });

    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe("ValidationError");
  });

  it("rejects an empty voterIdentifier with 400 on POST /api/tokens", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId, voterIdentifier: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects a missing voterIdentifier with 400 on POST /api/tokens", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });
});
