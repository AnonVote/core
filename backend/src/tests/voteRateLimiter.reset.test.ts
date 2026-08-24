process.env.DATABASE_URL = "postgresql://anonvote:anonvote_secret@localhost:5432/anonvote";
process.env.DIRECT_URL = "postgresql://anonvote:anonvote_secret@localhost:5432/anonvote";
process.env.JWT_SECRET = "12345678901234567890123456789012";
process.env.STELLAR_SECRET_KEY = "SCKEYTEST1234567890123456789012345678901234567890";
process.env.ENABLE_RATE_LIMITS = "true";

jest.mock("../prisma/client", () => ({
  prisma: {
    rateLimitEntry: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../utils/crypto", () => ({
  hashToken: (token: string) => `token-hash-${token}`,
}));

const { prisma } = jest.requireMock("../prisma/client") as {
  prisma: {
    rateLimitEntry: {
      upsert: jest.Mock;
      update: jest.Mock;
    };
  };
};
const {
  checkVoteRateLimits,
  VOTE_IP_LIMIT,
  VOTE_IP_WINDOW_MS,
} = require("../services/voteRateLimiter") as typeof import("../services/voteRateLimiter");

describe("checkVoteRateLimits expired-window reset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects the first request after an expired window when the next count would exceed the limit", async () => {
    const expiredAt = new Date(Date.now() - 10_000);
    const futureAt = new Date(Date.now() + VOTE_IP_WINDOW_MS);

    prisma.rateLimitEntry.upsert.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "ip:10.0.0.99") {
        return Promise.resolve({ count: VOTE_IP_LIMIT, expiresAt: expiredAt });
      }
      return Promise.resolve({ count: 1, expiresAt: futureAt });
    });

    prisma.rateLimitEntry.update.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "ip:10.0.0.99") {
        return Promise.resolve({ count: VOTE_IP_LIMIT + 1, expiresAt: futureAt });
      }
      return Promise.resolve({ count: 1, expiresAt: futureAt });
    });

    const result = await checkVoteRateLimits("10.0.0.99", "ballot-reset-test", "raw-token");

    expect(result).toMatchObject({
      allowed: false,
      dimension: "ip",
      retryAfterSeconds: expect.any(Number),
    });
    expect(prisma.rateLimitEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "ip:10.0.0.99" },
        data: expect.objectContaining({
          count: VOTE_IP_LIMIT + 1,
        }),
      }),
    );
  });
});
