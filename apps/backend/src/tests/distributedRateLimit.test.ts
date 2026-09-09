describe("distributed vote rate limiter", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.REDIS_URL;
    process.env.VOTE_RATE_LIMIT_PER_SECOND = "2";
    process.env.VOTE_RATE_LIMIT_PER_IP = "3";
    process.env.VOTE_RATE_LIMIT_PER_HOUR = "10";
  });

  it("shares counters across calls and rejects after the shortest bucket is full", async () => {
    const { checkDistributedVoteLimit, resetDistributedRateLimitForTests } = await import("../middleware/distributedRateLimit");
    resetDistributedRateLimitForTests();
    expect((await checkDistributedVoteLimit("10.0.0.1", "ballot-1")).allowed).toBe(true);
    expect((await checkDistributedVoteLimit("10.0.0.1", "ballot-1")).allowed).toBe(true);
    const rejected = await checkDistributedVoteLimit("10.0.0.1", "ballot-1");
    expect(rejected).toMatchObject({ allowed: false, bucket: "second", limit: 2, retryAfterSeconds: 1 });
  });

  it("isolates identities while retaining a shared ballot key shape", async () => {
    const { checkDistributedVoteLimit, resetDistributedRateLimitForTests } = await import("../middleware/distributedRateLimit");
    resetDistributedRateLimitForTests();
    expect((await checkDistributedVoteLimit("10.0.0.2", "ballot-1")).allowed).toBe(true);
    expect((await checkDistributedVoteLimit("10.0.0.3", "ballot-1")).allowed).toBe(true);
  });
});
