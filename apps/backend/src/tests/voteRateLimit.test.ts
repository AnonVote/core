/**
 * Unit tests for vote-submission rate limiting (issue #36).
 *
 * Strategy: mock `checkVoteRateLimits` from voteRateLimiter so tests are
 * fast and don't need a live database, then verify that the route responds
 * correctly for each scenario.
 *
 * Separate unit tests for the checkVoteRateLimits logic itself verify the
 * per-IP / per-ballot / per-token counter behaviour using a mocked Prisma
 * client.
 */

process.env.ENABLE_RATE_LIMITS = "true";
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { generateToken, hashToken, hashIdentifier } from "../utils/crypto";
import {
  VOTE_IP_LIMIT,
  VOTE_BALLOT_LIMIT,
  VOTE_TOKEN_LIMIT,
  VOTE_IP_WINDOW_MS,
  VOTE_BALLOT_WINDOW_MS,
  VOTE_TOKEN_WINDOW_MS,
  checkVoteRateLimits,
} from "../services/voteRateLimiter";

// ── Mock the rate limiter so route tests don't touch the DB ─────────────────
jest.mock("../services/voteRateLimiter", () => {
  const actual = jest.requireActual("../services/voteRateLimiter");
  return {
    ...actual,
    checkVoteRateLimits: jest.fn(),
  };
});

const mockedCheck = checkVoteRateLimits as jest.MockedFunction<
  typeof checkVoteRateLimits
>;

// ── Test fixtures ────────────────────────────────────────────────────────────

let ballotId: string;
let optionId: string;
let validToken: string;

beforeAll(async () => {
  // Clean slate
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.result.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.rateLimitEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationKey.deleteMany();
  await prisma.organization.deleteMany();

  // Create org + ballot
  await request(app)
    .post("/api/organizations")
    .send({ name: "RateLimit Test Org", email: "rl@test.com", password: "pass1234" });

  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "RateLimit Test Org", password: "pass1234" });
  const cookie = loginRes.headers["set-cookie"];

  const list = await prisma.eligibilityList.create({ data: {} });
  await prisma.eligibilityEntry.create({
    data: {
      eligibilityListId: list.id,
      identifierHash: hashIdentifier("rlvoter@test.com"),
    },
  });

  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Rate Limit Test Ballot",
      options: ["Yes", "No"],
      eligibilityListId: list.id,
      deadline: new Date(Date.now() + 7_200_000).toISOString(),
    });
  if (ballotRes.status !== 201) throw new Error("Ballot creation failed: " + JSON.stringify(ballotRes.body));
  ballotId = ballotRes.body.data.id;
  optionId = ballotRes.body.data.options[0].id;
  await prisma.ballot.update({ where: { id: ballotId }, data: { status: "ACTIVE" } });

  // Issue a valid token via the tokens API
  const tokenRes = await request(app)
    .post("/api/tokens")
    .send({ ballotId, voterIdentifier: "rlvoter@test.com" });
  validToken = tokenRes.body.data.token;
});

afterAll(() => prisma.$disconnect());

// ── Route-level tests (mocked rate limiter) ──────────────────────────────────

describe("POST /api/votes — rate limiting", () => {
  beforeEach(() => {
    // Default: allow the request through
    mockedCheck.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("allows a successful vote when under all limits", async () => {
    mockedCheck.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });

    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: validToken, optionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
  });

  it("returns 429 with Retry-After when IP limit is exceeded", async () => {
    mockedCheck.mockResolvedValue({
      allowed: false,
      dimension: "ip",
      retryAfterSeconds: 42,
    });

    const rawToken = generateToken();
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: rawToken, optionId });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("RATE_LIMIT_EXCEEDED");
    expect(res.headers["retry-after"]).toBe("42");
  });

  it("returns 429 with Retry-After when ballot limit is exceeded", async () => {
    mockedCheck.mockResolvedValue({
      allowed: false,
      dimension: "ballot",
      retryAfterSeconds: 55,
    });

    const rawToken = generateToken();
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: rawToken, optionId });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("RATE_LIMIT_EXCEEDED");
    expect(res.headers["retry-after"]).toBe("55");
  });

  it("returns 429 with Retry-After when token limit is exceeded", async () => {
    mockedCheck.mockResolvedValue({
      allowed: false,
      dimension: "token",
      retryAfterSeconds: 3600,
    });

    const rawToken = generateToken();
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: rawToken, optionId });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("RATE_LIMIT_EXCEEDED");
    expect(res.headers["retry-after"]).toBe("3600");
  });

  it("Retry-After header is always present in 429 responses", async () => {
    mockedCheck.mockResolvedValue({
      allowed: false,
      dimension: "ip",
      retryAfterSeconds: 60,
    });

    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: generateToken(), optionId });

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});

// ── Unit tests for checkVoteRateLimits logic ─────────────────────────────────

describe("checkVoteRateLimits — counter logic (DB-backed)", () => {
  const testIp = "10.0.0.99";
  const testBallotId = "ballot-rate-test-" + Date.now();
  const testRawToken = generateToken();

  beforeEach(async () => {
    // Clear rate limit entries before each test
    await prisma.rateLimitEntry.deleteMany({
      where: {
        key: {
          in: [
            `ip:${testIp}`,
            `ballot:${testBallotId}`,
            `token:${hashToken(testRawToken)}`,
          ],
        },
      },
    });
  });

  it("allows requests before any limit is reached", async () => {
    // Use the real implementation (unmock for this suite)
    const { checkVoteRateLimits: realCheck } = jest.requireActual(
      "../services/voteRateLimiter",
    ) as typeof import("../services/voteRateLimiter");

    const result = await realCheck(testIp, testBallotId, testRawToken);
    expect(result.allowed).toBe(true);
  });

  it("IP-based limit triggers after VOTE_IP_LIMIT requests within the window", async () => {
    const { checkVoteRateLimits: realCheck } = jest.requireActual(
      "../services/voteRateLimiter",
    ) as typeof import("../services/voteRateLimiter");

    const ipKey = `ip:${testIp}`;
    // Pre-seed the counter at the limit
    await prisma.rateLimitEntry.deleteMany({ where: { key: ipKey } });
    await prisma.rateLimitEntry.create({
      data: {
        key: ipKey,
        count: VOTE_IP_LIMIT, // already at limit
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + VOTE_IP_WINDOW_MS),
      },
    });

    // Next request should push count over the limit
    const result = await realCheck(testIp, testBallotId, testRawToken);
    expect(result.allowed).toBe(false);
    expect(result.dimension).toBe("ip");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("ballot-based limit triggers after VOTE_BALLOT_LIMIT requests within the window", async () => {
    const { checkVoteRateLimits: realCheck } = jest.requireActual(
      "../services/voteRateLimiter",
    ) as typeof import("../services/voteRateLimiter");

    const ballotKey = `ballot:${testBallotId}`;
    const localIp = "10.0.1.1"; // distinct IP so IP limit doesn't trigger first

    await prisma.rateLimitEntry.deleteMany({ where: { key: ballotKey } });
    await prisma.rateLimitEntry.create({
      data: {
        key: ballotKey,
        count: VOTE_BALLOT_LIMIT,
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + VOTE_BALLOT_WINDOW_MS),
      },
    });

    const result = await realCheck(localIp, testBallotId, testRawToken);
    expect(result.allowed).toBe(false);
    expect(result.dimension).toBe("ballot");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("token-based limit triggers after VOTE_TOKEN_LIMIT requests within the window", async () => {
    const { checkVoteRateLimits: realCheck } = jest.requireActual(
      "../services/voteRateLimiter",
    ) as typeof import("../services/voteRateLimiter");

    const tokenKey = `token:${hashToken(testRawToken)}`;
    const localIp = "10.0.2.1";
    const localBallotId = "ballot-token-limit-" + Date.now();

    await prisma.rateLimitEntry.deleteMany({ where: { key: tokenKey } });
    await prisma.rateLimitEntry.create({
      data: {
        key: tokenKey,
        count: VOTE_TOKEN_LIMIT,
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + VOTE_TOKEN_WINDOW_MS),
      },
    });

    const result = await realCheck(localIp, localBallotId, testRawToken);
    expect(result.allowed).toBe(false);
    expect(result.dimension).toBe("token");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rejects the first request after an expired window when the next count would exceed the limit", async () => {
    const { checkVoteRateLimits: realCheck } = jest.requireActual(
      "../services/voteRateLimiter",
    ) as typeof import("../services/voteRateLimiter");

    const expiredIp = "10.0.3.1";
    const expiredBallotId = "ballot-expired-" + Date.now();
    const expiredToken = generateToken();

    // Seed all three counters as expired at or above the limit.
    const pastTime = new Date(Date.now() - 10_000);
    await prisma.rateLimitEntry.createMany({
      data: [
        { key: `ip:${expiredIp}`, count: VOTE_IP_LIMIT, windowStart: pastTime, expiresAt: pastTime },
        { key: `ballot:${expiredBallotId}`, count: VOTE_BALLOT_LIMIT, windowStart: pastTime, expiresAt: pastTime },
        { key: `token:${hashToken(expiredToken)}`, count: VOTE_TOKEN_LIMIT, windowStart: pastTime, expiresAt: pastTime },
      ],
    });

    const result = await realCheck(expiredIp, expiredBallotId, expiredToken);
    expect(result.allowed).toBe(false);
    expect(result.dimension).toBe("ip");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

// ── Constants sanity check ───────────────────────────────────────────────────

describe("rate limit constants", () => {
  it("exports the correct IP limit (10/min)", () => {
    expect(VOTE_IP_LIMIT).toBe(10);
    expect(VOTE_IP_WINDOW_MS).toBe(60_000);
  });

  it("exports the correct ballot limit (100/min)", () => {
    expect(VOTE_BALLOT_LIMIT).toBe(100);
    expect(VOTE_BALLOT_WINDOW_MS).toBe(60_000);
  });

  it("exports the correct token limit (3/hour)", () => {
    expect(VOTE_TOKEN_LIMIT).toBe(3);
    expect(VOTE_TOKEN_WINDOW_MS).toBe(3_600_000);
  });
});
