/**
 * Unit tests for SorobanServiceError — Issue #73
 *
 * Verifies that every public service helper throws a typed SorobanServiceError
 * (never an unhandled rejection) with the correct `code` and `retryable` values
 * for network failures, RPC timeouts, and contract logic errors.
 *
 * All Stellar SDK calls are replaced by the hand-rolled mock in
 * test-helpers/mockStellarSdk.ts so no live network is required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRpc,
  resetMockRpc,
  simulationSuccess,
  simulationError,
  txSuccess,
  txNotFound,
} from "./test-helpers/mockStellarSdk";

vi.mock("stellar-sdk", async () => {
  const { createStellarSdkMock } = await import("./test-helpers/mockStellarSdk");
  return createStellarSdkMock();
});

// Imported after vi.mock so the service picks up the mocked stellar-sdk.
import * as StellarSdk from "stellar-sdk";
import {
  SorobanServiceError,
  SorobanServiceErrorCode,
  SorobanErrorCode,
  sorobanRecordBallot,
  sorobanRecordBallotsBatch,
  sorobanRecordToken,
  sorobanRecordVote,
  sorobanRecordResult,
  type SorobanConfig,
} from "./sorobanService";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET_KEY = "S" + "B".repeat(55);
const VALID_CONTRACT_ID = "C" + "D".repeat(55);

function makeConfig(overrides: Partial<SorobanConfig> = {}): SorobanConfig {
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: VALID_CONTRACT_ID,
    sourceKeypair: StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY),
    ...overrides,
  };
}

beforeEach(() => {
  resetMockRpc();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── SorobanServiceError class ─────────────────────────────────────────────────

describe("SorobanServiceError class", () => {
  it("is an instance of Error and SorobanServiceError", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.NETWORK_ERROR, "test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SorobanServiceError);
  });

  it("sets name to 'SorobanServiceError'", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.NETWORK_ERROR, "test");
    expect(err.name).toBe("SorobanServiceError");
  });

  it("exposes the code field", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.CONTRACT_ERROR, "test");
    expect(err.code).toBe(SorobanServiceErrorCode.CONTRACT_ERROR);
  });

  it("sets retryable: true for NETWORK_ERROR", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.NETWORK_ERROR, "test");
    expect(err.retryable).toBe(true);
  });

  it("sets retryable: true for SIMULATION_FAILED", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.SIMULATION_FAILED, "test");
    expect(err.retryable).toBe(true);
  });

  it("sets retryable: false for CONTRACT_ERROR", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.CONTRACT_ERROR, "test");
    expect(err.retryable).toBe(false);
  });

  it("sets retryable: false for TRANSACTION_FAILED", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.TRANSACTION_FAILED, "test");
    expect(err.retryable).toBe(false);
  });

  it("stores contractErrorCode when provided", () => {
    const err = new SorobanServiceError(
      SorobanServiceErrorCode.CONTRACT_ERROR,
      "ballot not found",
      SorobanErrorCode.BallotNotFound,
    );
    expect(err.contractErrorCode).toBe(SorobanErrorCode.BallotNotFound);
  });

  it("leaves contractErrorCode undefined when not provided", () => {
    const err = new SorobanServiceError(SorobanServiceErrorCode.NETWORK_ERROR, "test");
    expect(err.contractErrorCode).toBeUndefined();
  });
});

// ── Network failure → NETWORK_ERROR (retryable: true) ────────────────────────

describe("network failure — all helpers throw NETWORK_ERROR (retryable: true)", () => {
  const networkError = new Error("connection refused");

  it("sorobanRecordBallot throws NETWORK_ERROR on RPC rejection", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(networkError);

    await expect(sorobanRecordBallot(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR &&
        err.retryable === true,
    );
  });

  it("sorobanRecordToken throws NETWORK_ERROR on RPC rejection", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(networkError);

    await expect(sorobanRecordToken(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR &&
        err.retryable === true,
    );
  });

  it("sorobanRecordVote throws NETWORK_ERROR on RPC rejection", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(networkError);

    await expect(sorobanRecordVote(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR &&
        err.retryable === true,
    );
  });

  it("sorobanRecordResult throws NETWORK_ERROR on RPC rejection", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(networkError);

    await expect(sorobanRecordResult(makeConfig(), "hash-1", "result-hash")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR &&
        err.retryable === true,
    );
  });

  it("sorobanRecordBallotsBatch throws NETWORK_ERROR on RPC rejection", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(networkError);

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), [{ ballotIdHash: "hash-1" }]),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR &&
        err.retryable === true,
    );
  });

  it("sorobanRecordVote throws NETWORK_ERROR when getAccount rejects (DNS/TCP failure)", async () => {
    mockRpc.getAccount.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(sorobanRecordVote(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR,
    );
  });
});

// ── RPC timeout / simulation failed → SIMULATION_FAILED (retryable: true) ────

describe("RPC timeout — helpers throw SIMULATION_FAILED (retryable: true)", () => {
  it("sorobanRecordBallot throws SIMULATION_FAILED when simulation error has no contract code", async () => {
    // A generic RPC error string (no "Error(Contract, #N)" pattern) is treated
    // as SimulationFailed internally and surfaced as SIMULATION_FAILED.
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("request timeout"));

    await expect(sorobanRecordBallot(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.SIMULATION_FAILED &&
        err.retryable === true,
    );
  });

  it("sorobanRecordToken throws SIMULATION_FAILED on RPC timeout", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("read timeout after 30s"));

    await expect(sorobanRecordToken(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.SIMULATION_FAILED &&
        err.retryable === true,
    );
  });

  it("sorobanRecordVote throws SIMULATION_FAILED on RPC timeout", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("upstream error"));

    await expect(sorobanRecordVote(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.SIMULATION_FAILED &&
        err.retryable === true,
    );
  });

  it("sorobanRecordResult throws SIMULATION_FAILED on RPC timeout", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("gateway timeout"));

    await expect(sorobanRecordResult(makeConfig(), "hash-1", "result-hash")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.SIMULATION_FAILED &&
        err.retryable === true,
    );
  });

  it("sorobanRecordBallotsBatch throws SIMULATION_FAILED on RPC timeout", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("connection timeout"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), [{ ballotIdHash: "hash-1" }]),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.SIMULATION_FAILED &&
        err.retryable === true,
    );
  });
});

// ── Contract error → CONTRACT_ERROR (retryable: false) ───────────────────────

describe("contract logic error — helpers throw CONTRACT_ERROR (retryable: false)", () => {
  it("sorobanRecordBallot throws CONTRACT_ERROR with contractErrorCode BallotAlreadyExists", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #5)"));

    await expect(sorobanRecordBallot(makeConfig(), "hash-dup")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.retryable === false &&
        err.contractErrorCode === SorobanErrorCode.BallotAlreadyExists,
    );
    // Must not attempt to submit a transaction
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("sorobanRecordToken throws CONTRACT_ERROR with contractErrorCode BallotNotFound", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    await expect(sorobanRecordToken(makeConfig(), "missing-ballot")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.retryable === false &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("sorobanRecordVote throws CONTRACT_ERROR with contractErrorCode BallotNotFound", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    await expect(sorobanRecordVote(makeConfig(), "missing-ballot")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.retryable === false &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("sorobanRecordResult throws CONTRACT_ERROR with contractErrorCode BallotNotFound", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    await expect(sorobanRecordResult(makeConfig(), "missing-ballot", "h")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.retryable === false &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("sorobanRecordResult throws CONTRACT_ERROR on conflicting ResultAlreadyPublished", async () => {
    // record_result → ResultAlreadyPublished
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationError("Error(Contract, #6)"))
      // get_result_hash returns a DIFFERENT hash
      .mockResolvedValueOnce(simulationSuccess("conflicting-hash"));

    await expect(
      sorobanRecordResult(makeConfig(), "ballot-conflict", "my-hash"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.retryable === false &&
        err.contractErrorCode === SorobanErrorCode.ResultAlreadyPublished,
    );
  });

  it("sorobanRecordBallotsBatch throws CONTRACT_ERROR with contractErrorCode ContractPaused", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #13)"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), [{ ballotIdHash: "hash-1" }]),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.retryable === false &&
        err.contractErrorCode === SorobanErrorCode.ContractPaused,
    );
  });

  it("contract errors are not retryable — BallotAlreadyExists must never be retried", async () => {
    // Explicit assertion that a logic error is NOT retryable, to prevent
    // regression of the core safety property described in the issue.
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #5)"));

    const result = await sorobanRecordBallot(makeConfig(), "dup-hash").catch((e) => e);
    expect(result).toBeInstanceOf(SorobanServiceError);
    expect((result as SorobanServiceError).retryable).toBe(false);
  });
});

// ── TRANSACTION_FAILED (retryable: false) ────────────────────────────────────

describe("transaction failure — helpers throw TRANSACTION_FAILED (retryable: false)", () => {
  it("sorobanRecordBallot throws TRANSACTION_FAILED when sendTransaction returns ERROR", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "ERROR", errorResult: "fee too low" });

    await expect(sorobanRecordBallot(makeConfig(), "hash-1")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.TRANSACTION_FAILED &&
        err.retryable === false,
    );
  });

  it("sorobanRecordVote throws TRANSACTION_FAILED when tx is never confirmed (maxAttempts exceeded)", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-stuck" });
    mockRpc.getTransaction.mockResolvedValue(txNotFound());

    // Speed up the test — bypass real delays
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(
      ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout,
    );

    await expect(
      sorobanRecordVote(
        makeConfig({ retryPolicy: { maxAttempts: 2, initialDelayMs: 1, backoffMultiplier: 1 } }),
        "hash-1",
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.TRANSACTION_FAILED &&
        err.retryable === false,
    );
  });
});

// ── Successful calls do NOT throw ─────────────────────────────────────────────

describe("successful calls — no throw, return SorobanInvokeResult", () => {
  it("sorobanRecordBallot resolves successfully without throwing", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-ok" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await sorobanRecordBallot(makeConfig(), "hash-1");
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("tx-ok");
  });

  it("sorobanRecordToken resolves successfully without throwing", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-token" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await sorobanRecordToken(makeConfig(), "hash-1");
    expect(result.success).toBe(true);
  });

  it("sorobanRecordVote resolves successfully without throwing", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-vote" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await sorobanRecordVote(makeConfig(), "hash-1");
    expect(result.success).toBe(true);
  });

  it("sorobanRecordResult resolves successfully without throwing", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-result" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess("result-hash"));

    const result = await sorobanRecordResult(makeConfig(), "hash-1", "result-hash");
    expect(result.success).toBe(true);
  });

  it("sorobanRecordResult resolves (no throw) when ResultAlreadyPublished matches on-chain hash", async () => {
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationError("Error(Contract, #6)"))
      .mockResolvedValueOnce(simulationSuccess("result-hash-matching"));

    const result = await sorobanRecordResult(makeConfig(), "hash-1", "result-hash-matching");
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("");
  });
});

// ── Error is not exposed in message (only code/retryable) ────────────────────

describe("error details are not exposed to callers in the message", () => {
  it("NETWORK_ERROR message does not contain raw RPC error details", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(
      new Error("internal server error: node crashed at ledger 99999"),
    );

    const err = await sorobanRecordBallot(makeConfig(), "hash-1").catch((e) => e);
    expect(err).toBeInstanceOf(SorobanServiceError);
    // The message exposed on the thrown error must not contain raw node details
    expect((err as SorobanServiceError).message).not.toContain("node crashed");
    expect((err as SorobanServiceError).message).not.toContain("99999");
  });

  it("CONTRACT_ERROR message does not contain raw simulation diagnostic text", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(
      simulationError("Error(Contract, #5): some internal diagnostic: ballot_id=0xdeadbeef"),
    );

    const err = await sorobanRecordBallot(makeConfig(), "dup-hash").catch((e) => e);
    expect(err).toBeInstanceOf(SorobanServiceError);
    // Raw diagnostic text must not leak; the mapped human message is fine
    expect((err as SorobanServiceError).message).not.toContain("0xdeadbeef");
    expect((err as SorobanServiceError).message).not.toContain("ballot_id=");
  });
});
