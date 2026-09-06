import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRpc,
  resetMockRpc,
  simulationSuccess,
  simulationError,
  txSuccess,
  txNotFound,
  txFailed,
} from "./test-helpers/mockStellarSdk";

vi.mock("stellar-sdk", async () => {
  const { createStellarSdkMock } = await import("./test-helpers/mockStellarSdk");
  return createStellarSdkMock();
});

// Imported after vi.mock so sorobanService picks up the mocked stellar-sdk.
import * as StellarSdk from "stellar-sdk";
import {
  invokeContract,
  readContract,
  validateSorobanConfig,
  validateContractId,
  sorobanRecordBallotsBatch,
  sorobanRecordResult,
  sorobanResultExists,
  sorobanVerifyResultProof,
  verifyBallotConsistency,
  sorobanRotateAdmin,
  sorobanGetRotationHistory,
  sorobanGetBallotMetadata,
  sorobanGetBallotStats,
  sorobanGetAllBallots,
  sorobanGetVersion,
  sorobanBallotIsActive,
  sorobanIsBallotFinalized,
  SorobanErrorCode,
  SorobanServiceError,
  SorobanServiceErrorCode,
  DEFAULT_RETRY_POLICY,
  createSorobanService,
  createDefaultTestnetConfig,
  createDefaultMainnetConfig,
  type SorobanConfig,
} from "./sorobanService";

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

describe("validateSorobanConfig / validateContractId", () => {
  it("rejects an invalid sourceKeypair", () => {
    const result = validateSorobanConfig(makeConfig({ sourceKeypair: undefined as any }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.field).toBe("sourceKeypair");
    }
  });

  it("rejects an invalid contract ID format", () => {
    const result = validateSorobanConfig(makeConfig({ contractId: "not-a-real-contract" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.field).toBe("contractId");
    }
  });

  it("accepts a well-formed config", () => {
    expect(validateSorobanConfig(makeConfig())).toEqual({ valid: true });
  });

  it("validateContractId allows checking the contract ID alone (no secret key required)", () => {
    expect(validateContractId(VALID_CONTRACT_ID)).toEqual({ valid: true });
    expect(validateContractId("bogus").valid).toBe(false);
  });
});

describe("invokeContract — mocked RPC", () => {
  it("returns success and a txHash when simulation + send + confirmation all succeed", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-abc" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await invokeContract(makeConfig(), "record_ballot", [
      { value: "GADMIN", type: "address" },
      { value: "hash1", type: "string" },
    ]);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("tx-abc");
  });

  it("returns a typed error when simulation fails with a contract error code", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    const result = await invokeContract(makeConfig(), "record_token", [
      { value: "GADMIN", type: "address" },
      { value: "missing-ballot", type: "string" },
    ]);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.BallotNotFound);
    // sendTransaction should never be reached once simulation fails
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("falls back to NotConfigured without throwing when sourceKeypair is missing", async () => {
    const result = await invokeContract(
      makeConfig({ sourceKeypair: undefined as any }),
      "record_ballot",
      [{ value: "GADMIN", type: "address" }],
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.NotConfigured);
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("readContract — mocked RPC", () => {
  it("returns the parsed value on a successful simulation", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(42));

    const { value } = await readContract(makeConfig(), "get_tokens_issued", [
      { value: "hash1", type: "string" },
    ]);
    expect(value).toBe(42);
  });

  it("guards against a successful simulation with no result/retval instead of crashing", async () => {
    // simulation reports success but `result` itself is undefined — this is
    // exactly the malformed-response shape the issue calls out (line 197).
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(undefined));

    const { value, errorCode } = await readContract(makeConfig(), "get_tokens_issued", [
      { value: "hash1", type: "string" },
    ]);
    expect(value).toBeNull();
    expect(errorCode).toBeUndefined();
  });
});

describe("invokeContract — exponential backoff polling", () => {
  it("applies the configured backoff multiplier to successive retry delays", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-backoff" });
    mockRpc.getTransaction
      .mockResolvedValueOnce(txNotFound())
      .mockResolvedValueOnce(txNotFound())
      .mockResolvedValueOnce(txNotFound())
      .mockResolvedValueOnce(txSuccess());

    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, 0); // fire immediately so the test stays fast
    }) as typeof setTimeout);

    const result = await invokeContract(
      makeConfig({ retryPolicy: { maxAttempts: 5, initialDelayMs: 100, backoffMultiplier: 1.5 } }),
      "record_ballot",
      [{ value: "GADMIN", type: "address" }],
    );

    expect(result.success).toBe(true);
    expect(delays).toEqual([100, 150, 225]);
  });

  it("stops after maxAttempts and returns TransactionFailed if the tx is never confirmed", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-stuck" });
    mockRpc.getTransaction.mockResolvedValue(txNotFound());

    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout);

    const result = await invokeContract(
      makeConfig({ retryPolicy: { maxAttempts: 3, initialDelayMs: 10, backoffMultiplier: 2 } }),
      "record_ballot",
      [{ value: "GADMIN", type: "address" }],
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.TransactionFailed);
    // initial getTransaction call + 3 retries = 4 calls
    expect(mockRpc.getTransaction).toHaveBeenCalledTimes(4);
  });

  it("the default retry policy is 10 attempts / 1500ms initial delay / 1.5x backoff", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 10,
      initialDelayMs: 1500,
      backoffMultiplier: 1.5,
    });
  });
});

describe("sorobanRecordResult — finality guard / idempotency", () => {
  it("returns success (no new tx) when ResultAlreadyPublished and on-chain hash matches", async () => {
    // record_result simulation returns ResultAlreadyPublished
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationError("Error(Contract, #6)"))
      // readContract for get_result_hash returns the same hash
      .mockResolvedValueOnce(simulationSuccess("result-hash-abc"));

    const result = await sorobanRecordResult(makeConfig(), "ballot-x", "result-hash-abc");
    expect(result.success).toBe(true);
    // No new transaction was sent; txHash is blank
    expect(result.txHash).toBe("");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns ResultAlreadyPublished error when the on-chain hash differs (conflict)", async () => {
    // record_result simulation returns ResultAlreadyPublished
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationError("Error(Contract, #6)"))
      // readContract for get_result_hash returns a DIFFERENT hash
      .mockResolvedValueOnce(simulationSuccess("result-hash-DIFFERENT"));

    await expect(
      sorobanRecordResult(makeConfig(), "ballot-y", "result-hash-mine"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.ResultAlreadyPublished,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("propagates non-finality errors (e.g. BallotNotFound) unchanged", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    await expect(
      sorobanRecordResult(makeConfig(), "missing-ballot", "hash"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
  });
});

describe("sorobanResultExists — finality pre-check query", () => {
  it("returns false when no result has been published", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(false));
    const result = await sorobanResultExists(makeConfig(), "ballot-a");
    expect(result).toBe(false);
  });

  it("returns true when a result has already been published", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(true));
    const result = await sorobanResultExists(makeConfig(), "ballot-b");
    expect(result).toBe(true);
  });

  it("returns null when the contract ID is invalid without throwing", async () => {
    const result = await sorobanResultExists(
      makeConfig({ contractId: "not-a-contract" }),
      "ballot-c",
    );
    expect(result).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("returns null when the RPC call itself fails", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #3)"));
    const result = await sorobanResultExists(makeConfig(), "ballot-d");
    expect(result).toBeNull();
  });
});

describe("sorobanGetBallotMetadata — view function", () => {
  it("returns ballot metadata for an existing ballot", async () => {
    const raw = { created_at: 1718880000, admin: "GADMIN", is_active: true };
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(raw));

    const meta = await sorobanGetBallotMetadata(makeConfig(), "ballot-1");
    expect(meta).toEqual({ created_at: 1718880000, admin: "GADMIN", is_active: true });
  });

  it("returns null when ballot does not exist", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));
    const meta = await sorobanGetBallotMetadata(makeConfig(), "missing");
    expect(meta).toBeNull();
  });

  it("returns null when contract ID is invalid without calling RPC", async () => {
    const meta = await sorobanGetBallotMetadata(makeConfig({ contractId: "bad-id" }), "ballot-1");
    expect(meta).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanGetVersion — view function", () => {
  it("returns the contract semantic version string", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess("0.1.0"));

    const version = await sorobanGetVersion(makeConfig());
    expect(version).toBe("0.1.0");
  });

  it("returns null when the contract ID is invalid without calling RPC", async () => {
    const version = await sorobanGetVersion(makeConfig({ contractId: "bad-id" }));
    expect(version).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanGetBallotStats — view function", () => {
  it("returns ballot stats for an existing ballot", async () => {
    const raw = { tokens_issued: 5, votes_cast: 3, result_hash: null };
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(raw));

    const stats = await sorobanGetBallotStats(makeConfig(), "ballot-1");
    expect(stats).toEqual({ tokens_issued: 5, votes_cast: 3, result_hash: null });
  });

  it("returns stats with result_hash when published", async () => {
    const raw = { tokens_issued: 5, votes_cast: 5, result_hash: "tally-hash" };
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(raw));

    const stats = await sorobanGetBallotStats(makeConfig(), "ballot-1");
    expect(stats).toEqual({ tokens_issued: 5, votes_cast: 5, result_hash: "tally-hash" });
  });

  it("returns null for invalid contract ID", async () => {
    const stats = await sorobanGetBallotStats(makeConfig({ contractId: "bad-id" }), "ballot-1");
    expect(stats).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanGetAllBallots — view function", () => {
  it("returns list of ballot hashes", async () => {
    const raw = ["ballot-a", "ballot-b", "ballot-c"];
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(raw));

    const all = await sorobanGetAllBallots(makeConfig());
    expect(all).toEqual(["ballot-a", "ballot-b", "ballot-c"]);
  });

  it("returns empty array when no ballots exist", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess([]));
    const all = await sorobanGetAllBallots(makeConfig());
    expect(all).toEqual([]);
  });

  it("returns empty array for invalid contract ID", async () => {
    const all = await sorobanGetAllBallots(makeConfig({ contractId: "bad-id" }));
    expect(all).toEqual([]);
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanBallotIsActive — view function", () => {
  it("returns true for an active ballot", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(true));
    const active = await sorobanBallotIsActive(makeConfig(), "ballot-1");
    expect(active).toBe(true);
  });

  it("returns false for a finalized or non-existent ballot", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(false));
    const active = await sorobanBallotIsActive(makeConfig(), "ballot-1");
    expect(active).toBe(false);
  });

  it("returns null for invalid contract ID", async () => {
    const active = await sorobanBallotIsActive(makeConfig({ contractId: "bad-id" }), "ballot-1");
    expect(active).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanIsBallotFinalized — view function", () => {
  it("returns true when result has been published", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(true));
    const finalized = await sorobanIsBallotFinalized(makeConfig(), "ballot-1");
    expect(finalized).toBe(true);
  });

  it("returns false when no result published", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(false));
    const finalized = await sorobanIsBallotFinalized(makeConfig(), "ballot-1");
    expect(finalized).toBe(false);
  });

  it("returns null for invalid contract ID", async () => {
    const finalized = await sorobanIsBallotFinalized(makeConfig({ contractId: "bad-id" }), "ballot-1");
    expect(finalized).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanVerifyResultProof", () => {
  const dummyProof = {
    vote_hash: "00".repeat(32),
    path: ["11".repeat(32)],
    index: 0,
  };

  it("returns true when proof verifies successfully", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(true));
    const result = await sorobanVerifyResultProof(makeConfig(), "ballot-1", dummyProof, "result-hash");
    expect(result).toBe(true);
  });

  it("returns false when proof verification fails", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(false));
    const result = await sorobanVerifyResultProof(makeConfig(), "ballot-1", dummyProof, "result-hash");
    expect(result).toBe(false);
  });

  it("returns null when contract ID is invalid without calling RPC", async () => {
    const result = await sorobanVerifyResultProof(
      makeConfig({ contractId: "invalid-id" }),
      "ballot-1",
      dummyProof,
      "result-hash",
    );
    expect(result).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("returns null when RPC simulation fails (e.g., BallotNotFound)", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));
    const result = await sorobanVerifyResultProof(makeConfig(), "ballot-1", dummyProof, "result-hash");
    expect(result).toBeNull();
  });
});

describe("sorobanRotateAdmin — unit tests (mocked RPC)", () => {
  it("returns success and a txHash when simulation and confirmation succeed", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(0));
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-rotate-1" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess(0));

    const result = await sorobanRotateAdmin(makeConfig(), "G" + "A".repeat(55));
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("tx-rotate-1");
  });

  it("returns SameAdmin error when contract rejects same-address rotation", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #22)"));

    const result = await sorobanRotateAdmin(makeConfig(), "G" + "A".repeat(55));
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.SameAdmin);
    expect(result.errorMessage).toBe("New admin must be different from the current admin");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns AdminUnauthorized when caller is not the current admin", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #1)"));

    const result = await sorobanRotateAdmin(makeConfig(), "G" + "B".repeat(55));
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.AdminUnauthorized);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns NotConfigured without calling RPC when sourceKeypair is missing", async () => {
    const result = await sorobanRotateAdmin(
      makeConfig({ sourceKeypair: undefined as any }),
      "G" + "A".repeat(55),
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.NotConfigured);
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe("sorobanGetRotationHistory — unit tests (mocked RPC)", () => {
  it("returns an empty array when no rotations have occurred", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess([]));

    const history = await sorobanGetRotationHistory(makeConfig());
    expect(history).toEqual([]);
  });

  it("maps contract field names to camelCase and returns records in order", async () => {
    const raw = [
      { old_admin: "GOLD1", new_admin: "GNEW1", rotated_at: 1000 },
      { old_admin: "GNEW1", new_admin: "GNEW2", rotated_at: 2000 },
    ];
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(raw));

    const history = await sorobanGetRotationHistory(makeConfig());
    expect(history).toEqual([
      { oldAdmin: "GOLD1", newAdmin: "GNEW1", rotatedAt: 1000 },
      { oldAdmin: "GNEW1", newAdmin: "GNEW2", rotatedAt: 2000 },
    ]);
  });

  it("returns null when the contract ID is invalid", async () => {
    const result = await sorobanGetRotationHistory(makeConfig({ contractId: "bad-id" }));
    expect(result).toBeNull();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("returns null when the RPC call fails", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #3)"));
    const result = await sorobanGetRotationHistory(makeConfig());
    expect(result).toBeNull();
  });
});

describe("sorobanRecordBallotsBatch — unit tests (mocked RPC)", () => {
  const ballots = [
    { ballotIdHash: "hash-a", limits: { maxTokens: 100, maxVotes: 100 } },
    { ballotIdHash: "hash-b", limits: { maxTokens: 200, maxVotes: 200 } },
  ];

  it("returns success and a txHash when simulation and confirmation succeed", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(["hash-a", "hash-b"]));
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-batch-1" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess(["hash-a", "hash-b"]));

    const result = await sorobanRecordBallotsBatch(makeConfig(), ballots);
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("tx-batch-1");
    expect(result.returnValue).toEqual(["hash-a", "hash-b"]);
  });

  it("returns BallotAlreadyExists when any ballot in the batch already exists", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #5)"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), ballots),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotAlreadyExists,
    );
    // Batch rejected at simulation — no transaction sent
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns InvalidBallotHash when any ballot has an empty hash", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #8)"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), [
        { ballotIdHash: "good-hash" },
        { ballotIdHash: "" },
      ]),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.InvalidBallotHash,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns ContractPaused when the contract is paused", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #13)"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), ballots),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.ContractPaused,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns AdminUnauthorized when caller is not the admin", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #1)"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), ballots),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.AdminUnauthorized,
    );
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns NotConfigured without calling RPC when sourceKeypair is missing", async () => {
    const result = await sorobanRecordBallotsBatch(
      makeConfig({ sourceKeypair: undefined as any }),
      ballots,
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.NotConfigured);
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("applies default limits when none are supplied for an entry", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(["hash-default"]));
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-default" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess(["hash-default"]));

    // No limits provided — should fall back to { maxTokens: 10000, maxVotes: 10000 }
    const result = await sorobanRecordBallotsBatch(makeConfig(), [{ ballotIdHash: "hash-default" }]);
    expect(result.success).toBe(true);
  });

  it("returns NetworkError without throwing when the RPC call rejects", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      sorobanRecordBallotsBatch(makeConfig(), ballots),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR &&
        err.retryable === true,
    );
  });
});

// ── Config helpers ──────────────────────────────────────────────────────────────

describe("createDefaultTestnetConfig", () => {
  it("returns a config with testnet RPC URL and passphrase", () => {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY);
    const config = createDefaultTestnetConfig({
      contractId: VALID_CONTRACT_ID,
      sourceKeypair,
    });
    expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(config.contractId).toBe(VALID_CONTRACT_ID);
    expect(config.sourceKeypair).toBe(sourceKeypair);
    expect(config.retryPolicy).toBeUndefined();
  });

  it("accepts an optional retryPolicy override", () => {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY);
    const retryPolicy = { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2 };
    const config = createDefaultTestnetConfig({
      contractId: VALID_CONTRACT_ID,
      sourceKeypair,
      retryPolicy,
    });
    expect(config.retryPolicy).toEqual(retryPolicy);
  });

  it("produces a config validatable by validateSorobanConfig", () => {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY);
    const config = createDefaultTestnetConfig({
      contractId: VALID_CONTRACT_ID,
      sourceKeypair,
    });
    expect(validateSorobanConfig(config)).toEqual({ valid: true });
  });
});

describe("createDefaultMainnetConfig", () => {
  it("returns a config with mainnet RPC URL and passphrase", () => {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY);
    const config = createDefaultMainnetConfig({
      contractId: VALID_CONTRACT_ID,
      sourceKeypair,
    });
    expect(config.rpcUrl).toBe("https://soroban-mainnet.stellar.org");
    expect(config.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
    expect(config.contractId).toBe(VALID_CONTRACT_ID);
    expect(config.sourceKeypair).toBe(sourceKeypair);
  });
});

// ── Factory ─────────────────────────────────────────────────────────────────────

describe("createSorobanService", () => {
  it("returns an object with all expected methods", () => {
    const config = makeConfig();
    const service = createSorobanService(config);
    expect(service).toHaveProperty("sorobanRecordBallot");
    expect(service).toHaveProperty("sorobanRecordBallotsBatch");
    expect(service).toHaveProperty("sorobanRecordToken");
    expect(service).toHaveProperty("sorobanRecordVote");
    expect(service).toHaveProperty("sorobanRecordResult");
    expect(service).toHaveProperty("sorobanFilterEvents");
    expect(service).toHaveProperty("sorobanRotateAdmin");
    expect(service).toHaveProperty("sorobanGetRotationHistory");
    expect(service).toHaveProperty("sorobanTransitionBallotState");
    expect(service).toHaveProperty("sorobanGetAuditCounts");
    expect(service).toHaveProperty("sorobanResultExists");
    expect(service).toHaveProperty("sorobanGetBallotState");
    expect(service).toHaveProperty("sorobanGetBallotCreatedAt");
    expect(service).toHaveProperty("sorobanGetAuditReport");
    expect(service).toHaveProperty("sorobanVerifyResultProof");
    expect(service).toHaveProperty("sorobanGetBallotMetadata");
    expect(service).toHaveProperty("sorobanGetBallotStats");
    expect(service).toHaveProperty("sorobanGetAllBallots");
    expect(service).toHaveProperty("sorobanBallotIsActive");
    expect(service).toHaveProperty("sorobanIsBallotFinalized");
    expect(service).toHaveProperty("sorobanGetBallotExpiration");
    expect(service).toHaveProperty("sorobanScheduleUpgrade");
    expect(service).toHaveProperty("sorobanCancelUpgrade");
    expect(service).toHaveProperty("sorobanExecuteUpgrade");
    expect(service).toHaveProperty("sorobanGetPendingUpgrade");
    expect(service).toHaveProperty("invokeContract");
    expect(service).toHaveProperty("readContract");
  });

  it("binds sorobanRecordBallot to config so callers don't pass it", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-factory" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const service = createSorobanService(makeConfig());
    const result = await service.sorobanRecordBallot("hash-factory");

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("tx-factory");
  });

  it("binds sorobanResultExists to config so callers don't pass it", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(true));

    const service = createSorobanService(makeConfig());
    const result = await service.sorobanResultExists("ballot-exists");

    expect(result).toBe(true);
  });

  it("binds invokeContract to config", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-bound" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const service = createSorobanService(makeConfig());
    const result = await service.invokeContract("record_ballot", [
      { value: "GADMIN", type: "address" },
      { value: "hash1", type: "string" },
    ]);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("tx-bound");
  });

  it("binds readContract to config", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess(42));

    const service = createSorobanService(makeConfig());
    const { value } = await service.readContract("get_tokens_issued", [
      { value: "hash1", type: "string" },
    ]);

    expect(value).toBe(42);
  });

  it("throws SorobanServiceError on network error through bound methods", async () => {
    mockRpc.simulateTransaction.mockRejectedValueOnce(new Error("connection timeout"));

    const service = createSorobanService(makeConfig());

    await expect(service.sorobanRecordBallot("hash-err")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.NETWORK_ERROR,
    );
  });

  it("creates independent services with different configs", async () => {
    const keypairA = StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY);
    const keypairB = StellarSdk.Keypair.fromSecret("S" + "C".repeat(55));

    const configA = createDefaultTestnetConfig({ contractId: "C" + "A".repeat(55), sourceKeypair: keypairA });
    const configB = createDefaultTestnetConfig({ contractId: "C" + "B".repeat(55), sourceKeypair: keypairB });

    expect(configA.contractId).not.toBe(configB.contractId);
    expect(configA.sourceKeypair.publicKey()).not.toBe(configB.sourceKeypair.publicKey());
  });
});

describe("verifyBallotConsistency", () => {
  it("returns a consistent report when on-chain tokens_issued == votes_cast and it matches the database count", async () => {
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationSuccess(5)) // get_tokens_issued
      .mockResolvedValueOnce(simulationSuccess(5)) // get_votes_cast
      .mockResolvedValueOnce(simulationSuccess(true)); // is_consistent

    const report = await verifyBallotConsistency(makeConfig(), "ballot-ok", 5);

    expect(report).toMatchObject({
      ballotIdHash: "ballot-ok",
      consistent: true,
      tokensIssuedOnChain: 5,
      votesCastOnChain: 5,
      votesCastInDatabase: 5,
      databaseMatchesChain: true,
    });
    expect(report.error).toBeUndefined();
    expect(typeof report.checkedAt).toBe("number");
  });

  it("returns consistent: false when the contract reports tokens_issued != votes_cast", async () => {
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationSuccess(10)) // get_tokens_issued
      .mockResolvedValueOnce(simulationSuccess(7)) // get_votes_cast
      .mockResolvedValueOnce(simulationSuccess(false)); // is_consistent

    const report = await verifyBallotConsistency(makeConfig(), "ballot-bad", 7);

    expect(report.consistent).toBe(false);
    expect(report.tokensIssuedOnChain).toBe(10);
    expect(report.votesCastOnChain).toBe(7);
    expect(report.databaseMatchesChain).toBe(true);
  });

  it("flags databaseMatchesChain: false when the database vote count disagrees with the chain", async () => {
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationSuccess(5))
      .mockResolvedValueOnce(simulationSuccess(5))
      .mockResolvedValueOnce(simulationSuccess(true));

    const report = await verifyBallotConsistency(makeConfig(), "ballot-drift", 4);

    expect(report.consistent).toBe(true);
    expect(report.votesCastOnChain).toBe(5);
    expect(report.votesCastInDatabase).toBe(4);
    expect(report.databaseMatchesChain).toBe(false);
  });

  it("leaves databaseMatchesChain null when no database vote count is supplied", async () => {
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationSuccess(3))
      .mockResolvedValueOnce(simulationSuccess(3))
      .mockResolvedValueOnce(simulationSuccess(true));

    const report = await verifyBallotConsistency(makeConfig(), "ballot-no-db-count");

    expect(report.consistent).toBe(true);
    expect(report.votesCastInDatabase).toBeNull();
    expect(report.databaseMatchesChain).toBeNull();
  });

  it("returns an error report (not a throw) when the contract ID is invalid", async () => {
    const report = await verifyBallotConsistency(
      makeConfig({ contractId: "not-a-contract" }),
      "ballot-x",
      3,
    );

    expect(report.consistent).toBe(false);
    expect(report.tokensIssuedOnChain).toBeNull();
    expect(report.votesCastOnChain).toBeNull();
    expect(report.error).toBeTruthy();
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("returns an error report (not a throw) when the contract call fails", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    const report = await verifyBallotConsistency(makeConfig(), "ballot-unreachable", 2);

    expect(report.consistent).toBe(false);
    expect(report.tokensIssuedOnChain).toBeNull();
    expect(report.votesCastOnChain).toBeNull();
    expect(report.error).toBeTruthy();
  });

  it("logs a warning (not an error/throw) when the ballot is inconsistent", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRpc.simulateTransaction
      .mockResolvedValueOnce(simulationSuccess(10))
      .mockResolvedValueOnce(simulationSuccess(7))
      .mockResolvedValueOnce(simulationSuccess(false));

    const report = await verifyBallotConsistency(makeConfig(), "ballot-logged", 7);

    expect(report.consistent).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});
