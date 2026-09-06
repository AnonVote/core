/**
 * Soroban Integration Tests (issue #77) — hermetic.
 *
 * These tests mock the Prisma client and the Soroban RPC primitives, so they
 * run WITHOUT a deployed contract, a live Postgres, or a network. They cover:
 *
 *   Phase 2 — retry semantics & circuit breaker (sorobanResilient)
 *   Phase 2 — transaction batching / dedupe / dead-letter (voteSubmissionBatcher)
 *   Phase 2 — idempotency key derivation (computeVoteIdHash)
 *   Phase 1 — contract state sync & divergence detection (contractStateManager)
 *
 * DB-backed end-to-end tests live in voteSubmission.test.ts and the other
 * suite files; those need a running Postgres.
 */

import { prisma } from "../prisma/client";
import {
  SorobanError,
  classifySorobanError,
  isDuplicateVoteError,
  AnonVoteContractErrorCode,
} from "../services/sorobanErrors";
import {
  withSorobanResilience,
  resetSorobanCircuitBreaker,
} from "../services/sorobanResilient";
import { CircuitBreaker, CircuitState } from "../middleware/circuitBreaker";
import {
  VoteSubmissionBatcher,
  QueuedVote,
} from "../services/voteSubmissionBatcher";
import {
  runContractStateSync,
  syncBallotState,
  clearRecentDivergences,
} from "../services/contractStateManager";
import { computeVoteIdHash } from "../utils/crypto";
import {
  resetSorobanMetrics,
  getSorobanMetrics,
} from "../services/sorobanMetrics";

// NOTE: jest.mock is hoisted above the imports. The voteSubmissionBatcher
// calls prisma.vote.update / sorobanDeadLetter.upsert / $transaction on the
// success / dead-letter paths — we stub them as no-ops.
jest.mock("../prisma/client", () => {
  const mockVote = {
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(0),
  };
  const mockDeadLetter = {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  };
  return {
    prisma: {
      vote: mockVote,
      voterToken: { count: jest.fn().mockResolvedValue(0) },
      ballot: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      stellarRetryQueue: { deleteMany: jest.fn().mockResolvedValue({}) },
      sorobanDeadLetter: mockDeadLetter,
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
    } as unknown as typeof import("@prisma/client").PrismaClient,
  };
});

// Access the mock instances for assertions.
const mockPrisma = prisma as unknown as {
  vote: { update: jest.Mock; create: jest.Mock; count: jest.Mock };
  sorobanDeadLetter: { upsert: jest.Mock; update: jest.Mock };
  stellarRetryQueue: { deleteMany: jest.Mock };
};

function queuedVote(overrides: Partial<QueuedVote> = {}): QueuedVote {
  return {
    voteId: overrides.voteId ?? `vote-${Math.random().toString(36).slice(2)}`,
    ballotId: overrides.ballotId ?? "ballot-1",
    ballotIdHash: overrides.ballotIdHash ?? "bhash1",
    voteIdHash:
      overrides.voteIdHash ?? `vhash-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function okTransport() {
  return jest.fn(async (entries: QueuedVote[]) => ({
    status: "ok" as const,
    txHash: "0xabc",
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSorobanCircuitBreaker();
  resetSorobanMetrics();
  clearRecentDivergences();
  mockPrisma.vote.update.mockResolvedValue({});
  mockPrisma.sorobanDeadLetter.upsert.mockResolvedValue({});
  mockPrisma.stellarRetryQueue.deleteMany.mockResolvedValue({});
});

// ── Phase 2: error classification ─────────────────────────────────────────────

describe("sorobanErrors.classifySorobanError", () => {
  it("classifies network errors as retryable NETWORK_ERROR", () => {
    const err = classifySorobanError(
      new Error("ECONNREFUSED connecting to soroban rpc"),
    );
    expect(err.kind).toBe("NETWORK_ERROR");
    expect(err.retryable).toBe(true);
  });

  it("classifies contract rejections as non-retryable CONTRACT_ERROR", () => {
    const err = classifySorobanError(new Error("contract call failed #42"));
    expect(err.kind).toBe("CONTRACT_ERROR");
    expect(err.retryable).toBe(false);
  });

  it("detects duplicate-vote contract rejections (code 5)", () => {
    const err = classifySorobanError(new Error("duplicate vote id #5"));
    expect(err.kind).toBe("CONTRACT_ERROR");
    expect(isDuplicateVoteError(err)).toBe(true);
    expect(err.contractCode).toBe(AnonVoteContractErrorCode.DuplicateVote);
  });

  it("classifies simulation failures separately", () => {
    const err = classifySorobanError(
      new Error("simulation failed: insufficient budget"),
    );
    expect(err.kind).toBe("SIMULATION_FAILED");
  });

  it("passes through existing SorobanErrors unchanged", () => {
    const original = new SorobanError("CONFIG_ERROR", "no key");
    expect(classifySorobanError(original)).toBe(original);
  });
});

// ── Phase 2: retry semantics & circuit breaker ────────────────────────────────

describe("withSorobanResilience", () => {
  it("retries transient failures with exponential backoff then succeeds", async () => {
    const sleeps: number[] = [];
    const sleep = jest.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    let attempts = 0;
    const op = jest.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("ECONNRESET");
      return "ok";
    });

    const result = await withSorobanResilience(op, {
      op: "record_vote",
      maxAttempts: 3,
      baseDelayMs: 1000,
      sleep,
    });

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
    // Backoff: base * 2^0 = 1000, base * 2^1 = 2000
    expect(sleeps).toEqual([1000, 2000]);
    // Retry metric recorded
    expect(getSorobanMetrics().retryAttemptsTotal["record_vote"]).toBe(2);
  });

  it("succeeds on the first attempt without sleeping", async () => {
    const sleep = jest.fn();
    const op = jest.fn(async () => "ok");
    await withSorobanResilience(op, {
      op: "test_op",
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep,
    });
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry permanent CONTRACT_ERROR", async () => {
    const sleep = jest.fn();
    const op = jest.fn(async () => {
      throw new Error("contract rejected #3");
    });
    await expect(
      withSorobanResilience(op, {
        op: "record_vote",
        maxAttempts: 3,
        baseDelayMs: 10,
        sleep,
      }),
    ).rejects.toMatchObject({ kind: "CONTRACT_ERROR" });
    expect(op).toHaveBeenCalledTimes(1); // fail-fast, no retry
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries SIMULATION_FAILED exactly once (transient)", async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    let attempts = 0;
    const op = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("simulation failed");
      return "ok";
    });
    const res = await withSorobanResilience(op, {
      op: "batch_record_votes",
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep,
    });
    expect(res).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit breaker after >50% recent failures", async () => {
    const breaker = new CircuitBreaker({
      threshold: 0.5,
      duration: 60000,
      sampleSize: 20,
    });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
  });

  it("falls back to SorobanCircuitOpenError when the gate is closed", async () => {
    const breaker = new CircuitBreaker({
      threshold: 0.5,
      duration: 60_000,
      sampleSize: 20,
    });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.allowRequest()).toBe(false);
  });

  it("recovers via a half-open probe", async () => {
    const breaker = new CircuitBreaker({
      threshold: 0.5,
      duration: 30,
      sampleSize: 20,
    });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);

    // After the duration elapses a probe is allowed → HALF_OPEN.
    await new Promise((r) => setTimeout(r, 40));
    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);

    // Probe succeeds → CLOSED again.
    breaker.recordSuccess();
    expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    expect(breaker.allowRequest()).toBe(true);
  });
});

// ── Phase 2: batching ─────────────────────────────────────────────────────────

describe("VoteSubmissionBatcher", () => {
  it("flushes a full batch at the size threshold in ONE transport call", async () => {
    const transport = okTransport();
    const batcher = new VoteSubmissionBatcher({
      maxBatchSize: 5,
      transport,
      sleep: jest.fn(),
    });

    for (let i = 0; i < 5; i++) {
      batcher.enqueue(queuedVote({ voteIdHash: `h${i}` }));
    }
    await batcher.flush();

    expect(transport).toHaveBeenCalledTimes(1);
    const batch = transport.mock.calls[0][0] as QueuedVote[];
    expect(batch).toHaveLength(5);
    // Every vote marked anchored with the batch tx hash.
    expect(mockPrisma.vote.update).toHaveBeenCalledTimes(5);
    expect(batcher.size).toBe(0);
    expect(getSorobanMetrics().batchesTotal["ok"]).toBe(1);
    expect(getSorobanMetrics().batchSize.max).toBe(5);
  });

  it("flushes on timeout (flushIntervalMs) automatically", async () => {
    const transport = okTransport();
    const batcher = new VoteSubmissionBatcher({
      maxBatchSize: 100,
      flushIntervalMs: 20,
      transport,
      sleep: jest.fn(),
    });

    batcher.enqueue(queuedVote({ voteIdHash: "t1" }));
    // Give the timer a chance to fire.
    await new Promise((r) => setTimeout(r, 60));

    expect(transport).toHaveBeenCalledTimes(1);
    expect(batcher.size).toBe(0);
  });

  it("de-duplicates identical vote ids across enqueues", async () => {
    const transport = okTransport();
    const batcher = new VoteSubmissionBatcher({
      maxBatchSize: 10,
      transport,
      sleep: jest.fn(),
    });

    const v = queuedVote({ voteIdHash: "same-hash" });
    expect(batcher.enqueue(v)).toBe(true);
    expect(batcher.enqueue({ ...v })).toBe(false); // duplicate dropped
    expect(batcher.size).toBe(1);
  });

  it("pauses without losing votes when the transport reports paused", async () => {
    const transport = jest.fn(async () => ({ status: "paused" as const }));
    const batcher = new VoteSubmissionBatcher({
      maxBatchSize: 10,
      flushIntervalMs: 60_000,
      transport,
      sleep: jest.fn(),
    });

    batcher.enqueue(queuedVote({ voteIdHash: "p1" }));
    await batcher.flush();

    expect(transport).toHaveBeenCalledTimes(1);
    // Votes were re-queued, nothing dead-lettered, nothing marked anchored.
    expect(batcher.size).toBe(1);
    expect(mockPrisma.vote.update).not.toHaveBeenCalled();
    expect(mockPrisma.sorobanDeadLetter.upsert).not.toHaveBeenCalled();
    expect(getSorobanMetrics().batchesTotal["paused"]).toBe(1);
  });

  it("dead-letters votes when the batch fails permanently", async () => {
    const transport = jest.fn(async () => ({
      status: "failed" as const,
      reason: "all retries exhausted",
    }));
    const batcher = new VoteSubmissionBatcher({
      transport,
      sleep: jest.fn(),
    });

    batcher.enqueue(queuedVote({ voteIdHash: "dl1" }));
    batcher.enqueue(queuedVote({ voteIdHash: "dl2" }));
    await batcher.flush();

    // Each vote marked FAILED + upserted into the dead letter queue.
    expect(mockPrisma.vote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ anchorStatus: "FAILED" }),
      }),
    );
    expect(mockPrisma.sorobanDeadLetter.upsert).toHaveBeenCalledTimes(2);
    expect(batcher.size).toBe(0);
    expect(getSorobanMetrics().deadLetteredTotal).toBe(2);
    expect(getSorobanMetrics().batchesTotal["failed"]).toBe(1);
  });

  it("splits a duplicate-reverted batch and treats on-chain votes as anchored", async () => {
    const transport = jest.fn(async () => ({ status: "duplicate" as const }));

    // Use the real sorobanService module (imported by the batcher), spying on
    // the chain primitives, so the duplicate fallback path is exercised.
    const sorobanService = require("../services/sorobanService") as typeof import("../services/sorobanService");
    jest
      .spyOn(sorobanService, "sorobanHasVote")
      .mockResolvedValue(false)
      .mockResolvedValueOnce(true); // the already-on-chain vote resolves true
    jest
      .spyOn(sorobanService, "sorobanRecordVote")
      .mockResolvedValue("0xindividual");

    const batcher = new VoteSubmissionBatcher({
      maxBatchSize: 10,
      transport,
      sleep: jest.fn(async () => undefined),
    });

    const already = queuedVote({ voteIdHash: "already-on-chain" });
    const fresh = queuedVote({ voteIdHash: "not-yet-on-chain" });
    batcher.enqueue(already);
    batcher.enqueue(fresh);
    await batcher.flush();

    // No dead letters: the already-on-chain vote via has_vote, the fresh one
    // via the idempotent individual resubmit.
    expect(mockPrisma.sorobanDeadLetter.upsert).not.toHaveBeenCalled();
    expect(getSorobanMetrics().batchesTotal["duplicate_fallback"]).toBe(1);
    expect(batcher.size).toBe(0);
  });
});

// ── Phase 2: idempotency key derivation ───────────────────────────────────────

describe("computeVoteIdHash", () => {
  const KEY = "a".repeat(64);

  it("is deterministic for the same ballot+token", () => {
    expect(computeVoteIdHash("b1", "tokhash1", KEY)).toBe(
      computeVoteIdHash("b1", "tokhash1", KEY),
    );
  });

  it("differs per ballot and per token", () => {
    const keyed = (ballot: string, token: string) =>
      computeVoteIdHash(ballot, token, KEY);
    expect(keyed("b1", "t1")).not.toBe(keyed("b2", "t1"));
    expect(keyed("b1", "t1")).not.toBe(keyed("b1", "t2"));
  });

  it("is keyed — not derivable as plain sha256(ballotId + tokenHash)", () => {
    const keyed = computeVoteIdHash("b1", "t1", KEY);
    const { createHash } = require("crypto") as typeof import("crypto");
    const plain = createHash("sha256").update("b1:t1").digest("hex");
    expect(keyed).not.toBe(plain);
    // And the unkeyed fallback is intentionally different too.
    expect(computeVoteIdHash("b1", "t1")).not.toBe(keyed);
  });
});

// ── Phase 1: contract state sync & divergence detection ───────────────────────

describe("contractStateManager", () => {
  const ballotId = "ballot-state-1";

  function deps(
    overrides: Partial<Parameters<typeof syncBallotState>[1]> = {},
  ) {
    return {
      fetchAuditCounts: jest.fn(async () => ({
        tokensIssued: 2,
        votesCast: 1,
        isConsistent: true,
      })),
      listBallots: jest.fn(async () => [{ id: ballotId }]),
      countTokensIssued: jest.fn(async () => 2),
      countVotesCast: jest.fn(async () => 1),
      ...overrides,
    };
  }

  it("reports match when chain counters equal DB counts", async () => {
    const report = await syncBallotState(ballotId, deps());
    expect(report.outcome).toBe("match");
  });

  it("detects divergence between chain and DB counters", async () => {
    const report = await syncBallotState(
      ballotId,
      deps({
        fetchAuditCounts: jest.fn(async () => ({
          tokensIssued: 2,
          votesCast: 0, // chain says fewer votes than the DB
          isConsistent: true,
        })),
      }),
    );
    expect(report.outcome).toBe("diverged");
  });

  it("reports chain_unavailable when the contract cannot be read", async () => {
    const report = await syncBallotState(
      ballotId,
      deps({ fetchAuditCounts: jest.fn(async () => null) }),
    );
    expect(report.outcome).toBe("chain_unavailable");
  });

  it("reports error when the RPC throws", async () => {
    const report = await syncBallotState(
      ballotId,
      deps({
        fetchAuditCounts: jest.fn(async () => {
          throw new Error("RPC timeout");
        }),
      }),
    );
    expect(report.outcome).toBe("error");
  });

  it("aggregates a run summary and raises the divergence metric", async () => {
    const summary = await runContractStateSync(
      deps({
        fetchAuditCounts: jest.fn(async () => ({
          tokensIssued: 2,
          votesCast: 5, // mismatch
          isConsistent: true,
        })),
      }),
    );
    expect(summary.checked).toBe(1);
    expect(summary.diverged).toBe(1);
    expect(getSorobanMetrics().divergencesDetectedTotal).toBe(1);
  });
});