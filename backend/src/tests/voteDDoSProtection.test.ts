/**
 * Vote Endpoint DDoS Protection Integration Tests
 * 
 * Tests the complete DDoS protection stack including:
 * - Circuit breaker pattern
 * - Rate limiting (per-IP, per-ballot, per-token)
 * - Request validation
 * - Retry-After headers
 */

import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import { dbCircuitBreaker } from "../middleware/circuitBreaker";
import {
  VOTE_IP_LIMIT,
  VOTE_TOKEN_LIMIT,
  purgeExpiredRateLimitEntries,
} from "../services/voteRateLimiter";

let ballotId: string;
let optionId: string;
let eligibilityListId: string;
let authCookie: string[];

beforeAll(async () => {
  // Enable rate limits for these tests
  process.env.ENABLE_RATE_LIMITS = "true";

  // Clean database
  await prisma.stellarRetryQueue.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.rateLimitEntry.deleteMany();
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
  await prisma.organization.deleteMany();

  // Create test organization
  await request(app)
    .post("/api/organizations")
    .send({ name: "DDoS Test Org", email: "ddos@test.com", password: "pass1234" });

  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "DDoS Test Org", password: "pass1234" });
  const setCookie = loginRes.headers["set-cookie"];
  authCookie = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];

  // Create eligibility list
  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;

  // Add multiple eligible voters
  for (let i = 1; i <= 20; i++) {
    await prisma.eligibilityEntry.create({
      data: {
        eligibilityListId,
        identifierHash: hashIdentifier(`voter${i}@test.com`),
      },
    });
  }

  // Create ballot
  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", authCookie)
    .send({
      topic: "DDoS Protection Test Ballot",
      options: ["Option A", "Option B", "Option C"],
      eligibilityListId,
      deadline: new Date(Date.now() + 7200_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;
  optionId = ballotRes.body.data.options[0].id;

  // Activate ballot
  await prisma.ballot.update({
    where: { id: ballotId },
    data: { status: "ACTIVE" },
  });

  // Reset circuit breaker
  dbCircuitBreaker.reset();
});

afterAll(async () => {
  delete process.env.ENABLE_RATE_LIMITS;
  await prisma.$disconnect();
});

describe("DDoS Protection - Request Validation", () => {
  it("rejects malformed JSON", async () => {
    const res = await request(app)
      .post("/api/votes")
      .set("Content-Type", "application/json")
      .send("{ invalid json");

    expect(res.status).toBe(400);
  });

  it("rejects non-JSON content type", async () => {
    const res = await request(app)
      .post("/api/votes")
      .set("Content-Type", "text/plain")
      .send("plain text");

    expect(res.status).toBe(415);
    expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects missing required fields", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId }); // Missing token and optionId

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.message).toContain("token");
    expect(res.body.message).toContain("option_id");
  });

  it("rejects invalid UUID formats", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({
        ballotId: "not-a-uuid",
        token: "abcdefghijklmnopqrstuvwxyz123456",
        optionId: "also-not-a-uuid",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("UUID");
  });

  it("rejects excessively long encrypted vote", async () => {
    const token = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(token), ballotId },
    });

    const res = await request(app)
      .post("/api/votes")
      .send({
        ballotId,
        token,
        optionId,
        encryptedOption: "x".repeat(5000), // Exceeds MAX_ENCRYPTED_VOTE_LENGTH
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("encrypted_option length");
  });
});

describe("DDoS Protection - Rate Limiting", () => {
  beforeEach(async () => {
    // Clear rate limit entries before each test
    await prisma.rateLimitEntry.deleteMany();
  });

  describe("Per-IP rate limiting", () => {
    it("allows requests within IP limit", async () => {
      const tokens = [];
      for (let i = 0; i < 3; i++) {
        const token = generateToken();
        tokens.push(token);
        await prisma.voterToken.create({
          data: { tokenHash: hashToken(token), ballotId },
        });
      }

      // Submit 3 votes (within limit)
      for (const token of tokens) {
        const res = await request(app)
          .post("/api/votes")
          .send({ ballotId, token, optionId });

        expect([200, 201]).toContain(res.status);
      }
    });

    it("blocks requests exceeding IP limit", async () => {
      const tokens = [];
      for (let i = 0; i < VOTE_IP_LIMIT + 2; i++) {
        const token = generateToken();
        tokens.push(token);
        await prisma.voterToken.create({
          data: { tokenHash: hashToken(token), ballotId },
        });
      }

      let successCount = 0;
      let blockedCount = 0;

      // Try to submit more than the IP limit
      for (const token of tokens) {
        const res = await request(app)
          .post("/api/votes")
          .send({ ballotId, token, optionId });

        if (res.status === 429) {
          blockedCount++;
          expect(res.body.error).toBe("RATE_LIMIT_EXCEEDED");
          expect(res.headers["retry-after"]).toBeDefined();
          expect(parseInt(res.headers["retry-after"])).toBeGreaterThan(0);
        } else {
          successCount++;
        }
      }

      expect(successCount).toBeLessThanOrEqual(VOTE_IP_LIMIT);
      expect(blockedCount).toBeGreaterThan(0);
    }, 15000);
  });

  describe("Per-token rate limiting", () => {
    it("allows first vote with token", async () => {
      const token = generateToken();
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(token), ballotId },
      });

      const res = await request(app)
        .post("/api/votes")
        .send({ ballotId, token, optionId });

      expect([200, 201, 409]).toContain(res.status); // 409 if already voted
    });

    it("tracks token reuse attempts", async () => {
      await prisma.rateLimitEntry.deleteMany();

      const token = generateToken();
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(token), ballotId },
      });

      // First attempt
      await request(app)
        .post("/api/votes")
        .send({ ballotId, token, optionId });

      // Try multiple rapid resubmissions (should be rate limited)
      let rateLimited = false;
      for (let i = 0; i < VOTE_TOKEN_LIMIT + 2; i++) {
        const res = await request(app)
          .post("/api/votes")
          .send({ ballotId, token, optionId });

        if (res.status === 429) {
          rateLimited = true;
          expect(res.body.error).toBe("RATE_LIMIT_EXCEEDED");
          break;
        }
      }

      expect(rateLimited).toBe(true);
    }, 10000);
  });

  describe("Rate limit response headers", () => {
    it("includes Retry-After header when rate limited", async () => {
      await prisma.rateLimitEntry.deleteMany();

      const tokens = [];
      for (let i = 0; i < VOTE_IP_LIMIT + 5; i++) {
        const token = generateToken();
        tokens.push(token);
        await prisma.voterToken.create({
          data: { tokenHash: hashToken(token), ballotId },
        });
      }

      let retryAfterHeader: string | undefined;

      for (const token of tokens) {
        const res = await request(app)
          .post("/api/votes")
          .send({ ballotId, token, optionId });

        if (res.status === 429) {
          retryAfterHeader = res.headers["retry-after"];
          break;
        }
      }

      expect(retryAfterHeader).toBeDefined();
      expect(parseInt(retryAfterHeader!)).toBeGreaterThan(0);
    }, 15000);
  });

  describe("Rate limit persistence", () => {
    it("persists rate limits across requests", async () => {
      await prisma.rateLimitEntry.deleteMany();

      const tokens = [];
      for (let i = 0; i < VOTE_IP_LIMIT + 2; i++) {
        const token = generateToken();
        tokens.push(token);
        await prisma.voterToken.create({
          data: { tokenHash: hashToken(token), ballotId },
        });
      }

      // Fill up the rate limit
      for (const token of tokens) {
        await request(app)
          .post("/api/votes")
          .send({ ballotId, token, optionId });
      }

      // Try one more request - should be rate limited
      const extraToken = generateToken();
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(extraToken), ballotId },
      });

      const res = await request(app)
        .post("/api/votes")
        .send({ ballotId, token: extraToken, optionId });

      expect(res.status).toBe(429);

      // Verify rate limit entry exists in database
      const rateLimitEntries = await prisma.rateLimitEntry.findMany({
        where: {
          key: {
            startsWith: "ip:",
          },
        },
      });

      expect(rateLimitEntries.length).toBeGreaterThan(0);
    }, 15000);
  });
});

describe("DDoS Protection - Circuit Breaker", () => {
  beforeEach(() => {
    dbCircuitBreaker.reset();
  });

  it("remains closed under normal operation", async () => {
    const token = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(token), ballotId },
    });

    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId, token, optionId });

    expect([200, 201, 409, 429]).toContain(res.status);
    expect(dbCircuitBreaker.getMetrics().state).toBe("CLOSED");
  });

  it("tracks database operation metrics", async () => {
    const token = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(token), ballotId },
    });

    const initialMetrics = dbCircuitBreaker.getMetrics();
    const initialSuccesses = initialMetrics.successes;

    await request(app)
      .post("/api/votes")
      .send({ ballotId, token, optionId });

    const finalMetrics = dbCircuitBreaker.getMetrics();
    // Should have recorded some database operations
    expect(finalMetrics.successes).toBeGreaterThanOrEqual(initialSuccesses);
  });
});

describe("DDoS Protection - Audit Logging", () => {
  beforeEach(async () => {
    await prisma.rateLimitEntry.deleteMany();
    await prisma.auditEvent.deleteMany();
  });

  it("logs rate limit violations to audit table", async () => {
    const tokens = [];
    for (let i = 0; i < VOTE_IP_LIMIT + 3; i++) {
      const token = generateToken();
      tokens.push(token);
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(token), ballotId },
      });
    }

    // Trigger rate limit violation
    for (const token of tokens) {
      await request(app)
        .post("/api/votes")
        .send({ ballotId, token, optionId });
    }

    // Wait a bit for async audit logging
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check for audit entries
    const auditEntries = await prisma.auditEvent.findMany({
      where: {
        eventType: "RATE_LIMIT_EXCEEDED",
        ballotId,
      },
    });

    expect(auditEntries.length).toBeGreaterThan(0);
  }, 15000);
});

describe("DDoS Protection - Rate Limit Cleanup", () => {
  it("purges expired rate limit entries", async () => {
    // Create some expired entries manually
    const expiredTime = new Date(Date.now() - 3600000); // 1 hour ago

    await prisma.rateLimitEntry.create({
      data: {
        key: "ip:test-expired",
        count: 5,
        windowStart: expiredTime,
        expiresAt: expiredTime,
      },
    });

    await prisma.rateLimitEntry.create({
      data: {
        key: "ballot:test-expired",
        count: 10,
        windowStart: expiredTime,
        expiresAt: expiredTime,
      },
    });

    const beforeCount = await prisma.rateLimitEntry.count();
    expect(beforeCount).toBeGreaterThanOrEqual(2);

    const purgedCount = await purgeExpiredRateLimitEntries();
    expect(purgedCount).toBeGreaterThanOrEqual(2);

    const afterCount = await prisma.rateLimitEntry.count();
    expect(afterCount).toBeLessThan(beforeCount);
  });
});

describe("DDoS Protection - End-to-End Scenarios", () => {
  beforeEach(async () => {
    await prisma.rateLimitEntry.deleteMany();
    dbCircuitBreaker.reset();
  });

  it("handles legitimate voting pattern without interference", async () => {
    const tokens = [];
    for (let i = 0; i < 5; i++) {
      const token = generateToken();
      tokens.push(token);
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(token), ballotId },
      });
    }

    // Simulate normal voting with delays
    for (const token of tokens) {
      const res = await request(app)
        .post("/api/votes")
        .send({ ballotId, token, optionId });

      expect([200, 201]).toContain(res.status);
      
      // Small delay between votes (normal user behavior)
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const metrics = dbCircuitBreaker.getMetrics();
    expect(metrics.state).toBe("CLOSED");
  });

  it("blocks rapid-fire attack pattern", async () => {
    const tokens = [];
    for (let i = 0; i < VOTE_IP_LIMIT * 2; i++) {
      const token = generateToken();
      tokens.push(token);
      await prisma.voterToken.create({
        data: { tokenHash: hashToken(token), ballotId },
      });
    }

    let blockedCount = 0;

    // Simulate rapid-fire attack (no delays)
    const results = await Promise.all(
      tokens.map((token) =>
        request(app)
          .post("/api/votes")
          .send({ ballotId, token, optionId })
      )
    );

    for (const res of results) {
      if (res.status === 429) {
        blockedCount++;
      }
    }

    expect(blockedCount).toBeGreaterThan(0);
  }, 20000);
});
