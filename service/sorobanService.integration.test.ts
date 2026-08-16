import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRpc,
  resetMockRpc,
  simulationError,
  simulationSuccess,
  txSuccess,
} from "./test-helpers/mockStellarSdk";

vi.mock("stellar-sdk", async () => {
  const { createStellarSdkMock } = await import("./test-helpers/mockStellarSdk");
  return createStellarSdkMock();
});

import * as StellarSdk from "stellar-sdk";
import {
  hashTallyResult,
  publishTallyOnChain,
  recordVote,
  resetSorobanCircuitBreakers,
  SorobanErrorCode,
  SorobanServiceError,
  SorobanServiceErrorCode,
  submitVoteOnChainFirst,
  tally,
  type SorobanConfig,
  type TallyRepository,
  type VoteRepository,
} from "./sorobanService";

const VALID_SECRET_KEY = "S" + "B".repeat(55);
const VALID_CONTRACT_ID = "C" + "D".repeat(55);

function makeConfig(overrides: Partial<SorobanConfig> = {}): SorobanConfig {
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: VALID_CONTRACT_ID,
    sourceKeypair: StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY),
    retryPolicy: { maxAttempts: 1, initialDelayMs: 1, backoffMultiplier: 1 },
    rpcRetryPolicy: { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 2 },
    ...overrides,
  };
}

const encryptedVote = {
  ciphertext: "base64:ciphertext",
  nonce: "base64:nonce",
  tag: "base64:tag",
  algorithm: "xchacha20-poly1305",
};

beforeEach(() => {
  resetMockRpc();
  resetSorobanCircuitBreakers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backend vote submission Soroban integration", () => {
  it("recordVote calls the real record_vote contract method and returns the tx hash", async () => {
    mockRpc.simulateTransaction.mockImplementation(async (tx: any) => {
      expect(tx.operations[0].method).toBe("record_vote");
      expect(tx.operations[0].args[1].value).toBe("ballot-1");
      return simulationSuccess();
    });
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-vote-1" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await recordVote(makeConfig(), "ballot-1", encryptedVote);

    expect(result).toMatchObject({
      ballotIdHash: "ballot-1",
      encryptedVote,
      txHash: "tx-vote-1",
      sorobanTxId: "tx-vote-1",
      confirmed: true,
    });
  });

  it("persists the encrypted vote only after Soroban confirmation with soroban_tx_id", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-vote-db" });

    const calls: string[] = [];
    const repository: VoteRepository = {
      async createVote(record) {
        calls.push("db");
        return record;
      },
    };
    mockRpc.getTransaction.mockImplementationOnce(async () => {
      calls.push("confirmed");
      return txSuccess();
    });

    const persisted = await submitVoteOnChainFirst(
      makeConfig(),
      repository,
      { ballotIdHash: "ballot-db", encryptedVote },
    );

    expect(calls).toEqual(["confirmed", "db"]);
    expect(persisted.soroban_tx_id).toBe("tx-vote-db");
  });

  it("does not store a vote when the contract rejects the vote", async () => {
    mockRpc.simulateTransaction.mockResolvedValueOnce(simulationError("Error(Contract, #4)"));

    const repository: VoteRepository = {
      createVote: vi.fn(),
    };

    await expect(
      submitVoteOnChainFirst(
        makeConfig(),
        repository,
        { ballotIdHash: "missing-ballot", encryptedVote },
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
    expect(repository.createVote).not.toHaveBeenCalled();
  });

  it("retries transient RPC failures up to three attempts with backoff", async () => {
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as typeof setTimeout);

    mockRpc.simulateTransaction
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(simulationSuccess());
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-after-retry" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await recordVote(makeConfig(), "ballot-retry", encryptedVote);

    expect(result.sorobanTxId).toBe("tx-after-retry");
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1, 2]);
  });

  it("opens the circuit breaker and prevents cascading RPC calls", async () => {
    const config = makeConfig({
      rpcRetryPolicy: { maxAttempts: 1, initialDelayMs: 1, backoffMultiplier: 1 },
      circuitBreakerPolicy: { failureThreshold: 2, resetTimeoutMs: 60_000 },
    });
    mockRpc.simulateTransaction.mockRejectedValue(new Error("RPC unavailable"));

    await expect(recordVote(config, "ballot-cb-1", encryptedVote)).rejects.toBeInstanceOf(SorobanServiceError);
    await expect(recordVote(config, "ballot-cb-2", encryptedVote)).rejects.toBeInstanceOf(SorobanServiceError);
    await expect(recordVote(config, "ballot-cb-3", encryptedVote)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.message.includes("circuit breaker is open"),
    );
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry deterministic contract errors", async () => {
    mockRpc.simulateTransaction.mockResolvedValue(simulationError("Error(Contract, #4)"));

    await expect(recordVote(makeConfig(), "missing-ballot", encryptedVote)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.retryable === false,
    );
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("backend tally Soroban integration", () => {
  it("hashes local tally payloads canonically", () => {
    const a = hashTallyResult({ yes: 2, no: 1, nested: { b: true, a: false } });
    const b = hashTallyResult({ nested: { a: false, b: true }, no: 1, yes: 2 });
    expect(a).toBe(b);
  });

  it("tally publishes the local result hash and reads is_consistent from Soroban", async () => {
    mockRpc.simulateTransaction.mockImplementation(async (tx: any) => {
      const method = tx.operations[0].method;
      if (method === "record_result") {
        expect(tx.operations[0].args[1].value).toBe("ballot-tally");
        expect(tx.operations[0].args[2].value).toBe("result-hash");
        return simulationSuccess();
      }
      if (method === "is_consistent") {
        return simulationSuccess(true);
      }
      throw new Error(`unexpected method ${method}`);
    });
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-tally-1" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const result = await tally(
      makeConfig(),
      "ballot-tally",
      { yes: 2, no: 1 },
      { resultHash: "result-hash" },
    );

    expect(result).toMatchObject({
      ballotIdHash: "ballot-tally",
      resultHash: "result-hash",
      txHash: "tx-tally-1",
      sorobanTxId: "tx-tally-1",
      isConsistent: true,
    });
  });

  it("persists TallyResult with soroban_tx_id and is_consistent", async () => {
    mockRpc.simulateTransaction.mockImplementation(async (tx: any) => {
      if (tx.operations[0].method === "is_consistent") return simulationSuccess(true);
      return simulationSuccess();
    });
    mockRpc.sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "tx-tally-db" });
    mockRpc.getTransaction.mockResolvedValueOnce(txSuccess());

    const repository: TallyRepository = {
      async createTallyResult(record) {
        return record;
      },
    };

    const persisted = await publishTallyOnChain(
      makeConfig(),
      repository,
      {
        ballotIdHash: "ballot-tally-db",
        localResult: { yes: 3, no: 0 },
        resultHash: "published-hash",
      },
    );

    expect(persisted.soroban_tx_id).toBe("tx-tally-db");
    expect(persisted.is_consistent).toBe(true);
  });
});
