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
import {
  invokeContract,
  readContract,
  validateSorobanConfig,
  validateContractId,
  sorobanRecordBallotsBatch,
  sorobanRecordResult,
  sorobanResultExists,
  sorobanVerifyResultProof,
  sorobanRotateAdmin,
  sorobanGetRotationHistory,
  SorobanErrorCode,
  DEFAULT_RETRY_POLICY,
  type SorobanConfig,
} from "./sorobanService";

const VALID_SECRET_KEY = "S" + "B".repeat(55);
const VALID_CONTRACT_ID = "C" + "D".repeat(55);

function makeConfig(overrides: Partial<SorobanConfig> = {}): SorobanConfig {
  return {
    stellarSecretKey: VALID_SECRET_KEY,
    stellarNetwork: "testnet",
    contractId: VALID_CONTRACT_ID,
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
  it("rejects an invalid secret key format", () => {
    const result = validateSorobanConfig(makeConfig({ stellarSecretKey: "not-a-real-key" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.field).toBe("stellarSecretKey");
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

  it("falls back to NotConfigured without throwing when the secret key is malformed", async () => {
    const result = await invokeContract(
      makeConfig({ stellarSecretKey: "bad-secret" }),
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

    const result = await sorobanRecordResult(makeConfig(), "ballot-y", "result-hash-mine");
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.ResultAlreadyPublished);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("propagates non-finality errors (e.g. BallotNotFound) unchanged", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    const result = await sorobanRecordResult(makeConfig(), "missing-ballot", "hash");
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.BallotNotFound);
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

  it("returns NotConfigured without calling RPC when secret key is invalid", async () => {
    const result = await sorobanRotateAdmin(
      makeConfig({ stellarSecretKey: "not-a-valid-key" }),
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

    const result = await sorobanRecordBallotsBatch(makeConfig(), ballots);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.BallotAlreadyExists);
    // Batch rejected at simulation — no transaction sent
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns InvalidBallotHash when any ballot has an empty hash", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #8)"));

    const result = await sorobanRecordBallotsBatch(makeConfig(), [
      { ballotIdHash: "good-hash" },
      { ballotIdHash: "" },
    ]);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.InvalidBallotHash);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns ContractPaused when the contract is paused", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #13)"));

    const result = await sorobanRecordBallotsBatch(makeConfig(), ballots);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.ContractPaused);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns AdminUnauthorized when caller is not the admin", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #1)"));

    const result = await sorobanRecordBallotsBatch(makeConfig(), ballots);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.AdminUnauthorized);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns NotConfigured without calling RPC when the secret key is invalid", async () => {
    const result = await sorobanRecordBallotsBatch(
      makeConfig({ stellarSecretKey: "not-a-real-key" }),
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

    const result = await sorobanRecordBallotsBatch(makeConfig(), ballots);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.NetworkError);
  });
});
