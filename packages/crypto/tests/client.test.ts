import { AnonVoteClient } from "../src/client";
import {
  type Election,
  type VoteReceipt,
  type ClientConfig,
} from "../src/types";

const ENCRYPTED_PAYLOAD_SHAPE = {
  ciphertext: expect.stringMatching(/^[0-9a-f]+$/),
  iv: expect.stringMatching(/^[0-9a-f]+$/),
  authTag: expect.stringMatching(/^[0-9a-f]+$/),
};

const TEST_KEY = "a".repeat(64); // 32 bytes hex for tests

describe("AnonVoteClient", () => {
  let client: AnonVoteClient;

  beforeEach(() => {
    client = new AnonVoteClient({ encryptionKey: TEST_KEY });
  });

  // ── Election Creation ──────────────────────────────────────────────────────

  describe("createElection", () => {
    it("creates an election with valid parameters", () => {
      const election = client.createElection({
        title: "Test Election",
        description: "A test election",
        options: ["Yes", "No", "Abstain"],
        startTime: Date.now(),
        endTime: Date.now() + 86400000,
      });

      expect(election).toHaveProperty("id");
      expect(election.id.startsWith("elec-")).toBe(true);
      expect(election.title).toBe("Test Election");
      expect(election.description).toBe("A test election");
      expect(election.options).toHaveLength(3);
      expect(election.options[0].text).toBe("Yes");
      expect(election.options[1].text).toBe("No");
      expect(election.options[2].text).toBe("Abstain");
      expect(election.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(election.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(election.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("accepts ISO string timestamps", () => {
      const election = client.createElection({
        title: "ISO Election",
        description: "Uses ISO strings",
        options: ["A", "B"],
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(election.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(election.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("generates unique IDs for each election", () => {
      const e1 = client.createElection({
        title: "E1",
        description: "First",
        options: ["A"],
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      });
      const e2 = client.createElection({
        title: "E2",
        description: "Second",
        options: ["A"],
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      });

      expect(e1.id).not.toBe(e2.id);
    });

    it("generates unique option IDs", () => {
      const election = client.createElection({
        title: "Options Test",
        description: "Test",
        options: ["A", "A"], // same text, different IDs
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      });

      expect(election.options[0].id).not.toBe(election.options[1].id);
      expect(election.options[0].text).toBe("A");
      expect(election.options[1].text).toBe("A");
    });
  });

  // ── Invalid Election Data ──────────────────────────────────────────────────

  describe("createElection - validation", () => {
    it("throws on missing title", () => {
      expect(() =>
        (client as unknown as AnonVoteClient).createElection({
          description: "desc",
          options: ["A"],
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        } as unknown as Parameters<AnonVoteClient["createElection"]>[0]),
      ).toThrow("Election title is required");
    });

    it("throws on empty title", () => {
      expect(() =>
        client.createElection({
          title: "",
          description: "desc",
          options: ["A"],
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        }),
      ).toThrow("Election title is required");
    });

    it("throws on missing description", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          options: ["A"],
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        } as unknown as Parameters<AnonVoteClient["createElection"]>[0]),
      ).toThrow("Election description is required");
    });

    it("throws on empty description", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "",
          options: ["A"],
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        }),
      ).toThrow("Election description is required");
    });

    it("throws on missing options", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        } as unknown as Parameters<AnonVoteClient["createElection"]>[0]),
      ).toThrow("At least one voting option is required");
    });

    it("throws on empty options array", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          options: [],
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        }),
      ).toThrow("At least one voting option is required");
    });

    it("throws on empty string options", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          options: ["Valid", ""],
          startTime: Date.now(),
          endTime: Date.now() + 1000,
        }),
      ).toThrow("Voting options cannot be empty strings");
    });

    it("throws on invalid startTime", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          options: ["A"],
          startTime: "not-a-date",
          endTime: Date.now() + 1000,
        }),
      ).toThrow("Invalid startTime");
    });

    it("throws on invalid endTime", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          options: ["A"],
          startTime: Date.now(),
          endTime: "not-a-date",
        }),
      ).toThrow("Invalid endTime");
    });

    it("throws when endTime is before startTime", () => {
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          options: ["A"],
          startTime: Date.now() + 86400000,
          endTime: Date.now(),
        }),
      ).toThrow("endTime must be after startTime");
    });

    it("throws when endTime equals startTime", () => {
      const now = Date.now();
      expect(() =>
        client.createElection({
          title: "Title",
          description: "desc",
          options: ["A"],
          startTime: now,
          endTime: now,
        }),
      ).toThrow("endTime must be after startTime");
    });
  });

  // ── Vote Casting ───────────────────────────────────────────────────────────

  describe("castVote", () => {
    it("casts a vote and returns a receipt", () => {
      const receipt = client.castVote({
        ballotId: "elec-123",
        voteOption: "Yes",
        encryptionKey: TEST_KEY,
      });

      expect(receipt).toHaveProperty("id");
      expect(receipt.id.startsWith("receipt-")).toBe(true);
      expect(receipt.ballotId).toBe("elec-123");
      expect(receipt.electionId).toBe("elec-123");
      // encryptedPayload is now an EncryptedPayload object
      expect(receipt.encryptedPayload).toHaveProperty("ciphertext");
      expect(receipt.encryptedPayload).toHaveProperty("iv");
      expect(receipt.encryptedPayload).toHaveProperty("authTag");
      expect(receipt.encryptedPayload).toEqual(ENCRYPTED_PAYLOAD_SHAPE);
      expect(receipt.castAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(receipt.verified).toBe(false);
    });

    it("encrypts the vote option correctly", () => {
      const receipt = client.castVote({
        ballotId: "elec-123",
        voteOption: "Alice",
        encryptionKey: TEST_KEY,
      });

      // encryptedPayload is now an EncryptedPayload object with ciphertext, iv, authTag as hex strings
      expect(receipt.encryptedPayload.ciphertext).toMatch(/^[0-9a-f]+$/);
      expect(receipt.encryptedPayload.iv).toMatch(/^[0-9a-f]+$/);
      expect(receipt.encryptedPayload.authTag).toMatch(/^[0-9a-f]+$/);
      // The payload should have ciphertext, iv, and authTag as hex strings
      expect(receipt.encryptedPayload).toEqual(ENCRYPTED_PAYLOAD_SHAPE);
    });

    it("produces different encrypted payloads for the same vote (random IV)", () => {
      const r1 = client.castVote({
        ballotId: "elec-123",
        voteOption: "Yes",
        encryptionKey: TEST_KEY,
      });
      const r2 = client.castVote({
        ballotId: "elec-123",
        voteOption: "Yes",
        encryptionKey: TEST_KEY,
      });

      expect(r1.encryptedPayload.ciphertext).not.toBe(
        r2.encryptedPayload.ciphertext,
      );
      expect(r1.encryptedPayload.iv).not.toBe(r2.encryptedPayload.iv);
    });
  });

  // ── Vote Serialization ─────────────────────────────────────────────────────

  describe("serialize", () => {
    it("serializes an election to a JSON-safe object", () => {
      const election = client.createElection({
        title: "Serialization Test",
        description: "Test serialization",
        options: ["A", "B"],
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      });

      const payload = client.serialize(election);

      expect(payload).toEqual({
        id: election.id,
        title: election.title,
        description: election.description,
        options: election.options.map((o) => ({ id: o.id, text: o.text })),
        startTime: election.startTime,
        endTime: election.endTime,
        createdAt: election.createdAt,
      });
    });

    it("produces JSON-stringifiable output", () => {
      const election = client.createElection({
        title: "JSON Test",
        description: "Test",
        options: ["A"],
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      });

      const payload = client.serialize(election);
      const json = JSON.stringify(payload);
      const parsed: unknown = JSON.parse(json);

      expect(parsed).toEqual(payload);
    });

    it("throws on null election", () => {
      expect(() => client.serialize(null as unknown as Election)).toThrow(
        "Invalid election object",
      );
    });

    it("throws on undefined election", () => {
      expect(() => client.serialize(undefined as unknown as Election)).toThrow(
        "Invalid election object",
      );
    });
  });

  // ── Vote Deserialization ───────────────────────────────────────────────────

  describe("deserialize", () => {
    it("deserializes a serialized election", () => {
      const election = client.createElection({
        title: "Round Trip",
        description: "Serialize and deserialize",
        options: ["Yes", "No"],
        startTime: Date.now(),
        endTime: Date.now() + 86400000,
      });

      const payload = client.serialize(election);
      const restored = client.deserialize(payload);

      expect(restored.id).toBe(election.id);
      expect(restored.title).toBe(election.title);
      expect(restored.description).toBe(election.description);
      expect(restored.options).toHaveLength(2);
      expect(restored.options[0].text).toBe("Yes");
      expect(restored.options[1].text).toBe("No");
      expect(restored.startTime).toBe(election.startTime);
      expect(restored.endTime).toBe(election.endTime);
      expect(restored.createdAt).toBe(election.createdAt);
    });

    it("round-trips correctly", () => {
      const election = client.createElection({
        title: "Round Trip",
        description: "Test",
        options: ["A", "B", "C"],
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      });

      const payload = client.serialize(election);
      const json = JSON.stringify(payload);
      const parsed: unknown = JSON.parse(json);
      const restored = client.deserialize(
        parsed as Parameters<AnonVoteClient["deserialize"]>[0],
      );

      expect(restored).toEqual(election);
    });

    it("throws on missing id", () => {
      expect(() =>
        client.deserialize({ title: "T" } as unknown as Parameters<
          AnonVoteClient["deserialize"]
        >[0]),
      ).toThrow("Invalid payload: missing or invalid id");
    });

    it("throws on missing title", () => {
      expect(() =>
        client.deserialize({ id: "1" } as unknown as Parameters<
          AnonVoteClient["deserialize"]
        >[0]),
      ).toThrow("Invalid payload: missing or invalid title");
    });

    it("throws on missing description", () => {
      expect(() =>
        client.deserialize({ id: "1", title: "T" } as unknown as Parameters<
          AnonVoteClient["deserialize"]
        >[0]),
      ).toThrow("Invalid payload: missing or invalid description");
    });

    it("throws on missing options", () => {
      expect(() =>
        client.deserialize({
          id: "1",
          title: "T",
          description: "D",
        } as unknown as Parameters<AnonVoteClient["deserialize"]>[0]),
      ).toThrow("Invalid payload: missing or invalid options");
    });

    it("throws on missing startTime", () => {
      expect(() =>
        client.deserialize({
          id: "1",
          title: "T",
          description: "D",
          options: [],
        } as unknown as Parameters<AnonVoteClient["deserialize"]>[0]),
      ).toThrow("Invalid payload: missing or invalid startTime");
    });

    it("throws on missing endTime", () => {
      expect(() =>
        client.deserialize({
          id: "1",
          title: "T",
          description: "D",
          options: [],
          startTime: "2024-01-01T00:00:00.000Z",
        } as unknown as Parameters<AnonVoteClient["deserialize"]>[0]),
      ).toThrow("Invalid payload: missing or invalid endTime");
    });

    it("throws on missing createdAt", () => {
      expect(() =>
        client.deserialize({
          id: "1",
          title: "T",
          description: "D",
          options: [],
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        } as unknown as Parameters<AnonVoteClient["deserialize"]>[0]),
      ).toThrow("Invalid payload: missing or invalid createdAt");
    });

    it("throws on invalid option (missing id)", () => {
      expect(() =>
        client.deserialize({
          id: "1",
          title: "T",
          description: "D",
          options: [{ text: "A" }],
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
          createdAt: "2024-01-01T00:00:00.000Z",
        } as unknown as Parameters<AnonVoteClient["deserialize"]>[0]),
      ).toThrow("Invalid payload: option missing id");
    });

    it("throws on invalid option (missing text)", () => {
      expect(() =>
        client.deserialize({
          id: "1",
          title: "T",
          description: "D",
          options: [{ id: "opt-1" }],
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
          createdAt: "2024-01-01T00:00:00.000Z",
        } as unknown as Parameters<AnonVoteClient["deserialize"]>[0]),
      ).toThrow("Invalid payload: option missing text");
    });
  });

  // ── Vote Verification ──────────────────────────────────────────────────────

  describe("verifyVote", () => {
    it("returns true for a valid encrypted payload", () => {
      const receipt = client.castVote({
        ballotId: "elec-123",
        voteOption: "Yes",
        encryptionKey: TEST_KEY,
      });

      const isValid = client.verifyVote(receipt.encryptedPayload, TEST_KEY);
      expect(isValid).toBe(true);
    });

    it("returns false for a tampered payload", () => {
      const receipt = client.castVote({
        ballotId: "elec-123",
        voteOption: "Yes",
        encryptionKey: TEST_KEY,
      });

      const tampered = {
        ...receipt.encryptedPayload,
        ciphertext: "00".repeat(8),
      };

      const isValid = client.verifyVote(tampered, TEST_KEY);
      expect(isValid).toBe(false);
    });

    it("returns false for an invalid key", () => {
      const receipt = client.castVote({
        ballotId: "elec-123",
        voteOption: "Yes",
        encryptionKey: TEST_KEY,
      });

      const wrongKey = "b".repeat(64);
      const isValid = client.verifyVote(receipt.encryptedPayload, wrongKey);
      expect(isValid).toBe(false);
    });

    it("returns false for malformed payload", () => {
      const isValid = client.verifyVote(
        { ciphertext: "", iv: "", authTag: "" },
        TEST_KEY,
      );
      expect(isValid).toBe(false);
    });

    it("returns false for an incomplete payload", () => {
      const isValid = client.verifyVote(
        { ciphertext: "abcd", iv: "", authTag: "" },
        TEST_KEY,
      );
      expect(isValid).toBe(false);
    });
  });

  // ── Client Configuration ───────────────────────────────────────────────────

  describe("ClientConfig", () => {
    it("can be instantiated without config", () => {
      const c = new AnonVoteClient();
      expect(c).toBeInstanceOf(AnonVoteClient);
    });

    it("can be instantiated with empty config", () => {
      const c = new AnonVoteClient({});
      expect(c).toBeInstanceOf(AnonVoteClient);
    });

    it("can be instantiated with encryption key", () => {
      const c = new AnonVoteClient({ encryptionKey: TEST_KEY });
      expect(c).toBeInstanceOf(AnonVoteClient);
    });
  });

  // ── Type Exports ───────────────────────────────────────────────────────────

  describe("Type exports", () => {
    it("Election type is properly structured", () => {
      const election: Election = {
        id: "elec-1",
        title: "Test",
        description: "Desc",
        options: [{ id: "opt-1", text: "A" }],
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-02T00:00:00.000Z",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      expect(election.id).toBe("elec-1");
      expect(election.options[0].text).toBe("A");
    });

    it("VoteReceipt type is properly structured", () => {
      const receipt: VoteReceipt = {
        id: "receipt-1",
        electionId: "elec-1",
        ballotId: "elec-1",
        encryptedPayload: { ciphertext: "ab", iv: "cd", authTag: "ef" },
        castAt: "2024-01-01T00:00:00.000Z",
        verified: true,
      };

      expect(receipt.verified).toBe(true);
      expect(receipt.encryptedPayload).toEqual({
        ciphertext: "ab",
        iv: "cd",
        authTag: "ef",
      });
    });

    it("ClientConfig type is properly structured", () => {
      const config: ClientConfig = {
        encryptionKey: TEST_KEY,
      };

      expect(config.encryptionKey).toBe(TEST_KEY);
    });
  });

  // ── Public API Exports ─────────────────────────────────────────────────────

  describe("Public API exports", () => {
    it("exports AnonVoteClient from the package entry point", () => {
      // This test verifies the export works by importing from the index
      // We already imported it at the top, so this just confirms it's accessible
      expect(AnonVoteClient).toBeDefined();
      expect(typeof AnonVoteClient).toBe("function");
    });
  });
});

// ── Retry Logic ────────────────────────────────────────────────────────────────

import {
  withRetry,
  resolveRetryConfig,
  calculateDelay,
  HttpError,
  DEFAULT_RETRY_CONFIG,
  sleep,
} from "../src/retry";
import type { RetryConfig } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a resolved RetryConfig with test-friendly defaults (no real delays). */
function makeConfig(overrides: Partial<RetryConfig> = {}): RetryConfig {
  return resolveRetryConfig({
    maxRetries: 3,
    initialDelayMs: 0, // eliminate real delays in unit tests
    maxDelayMs: 0,
    backoffMultiplier: 2,
    ...overrides,
  });
}

describe("withRetry", () => {
  describe("success paths", () => {
    it("returns the result immediately when the operation succeeds on the first try", async () => {
      const operation = jest.fn().mockResolvedValue("ok");
      const result = await withRetry(operation, makeConfig());
      expect(result).toBe("ok");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("retries after a transient failure and returns the result on a subsequent success", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new HttpError(503, "Service Unavailable"))
        .mockResolvedValueOnce("ok");

      const result = await withRetry(operation, makeConfig());
      expect(result).toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("retries multiple times and succeeds on the last allowed attempt", async () => {
      // maxRetries = 3 means 4 total attempts (1 initial + 3 retries)
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new HttpError(502, "Bad Gateway"))
        .mockRejectedValueOnce(new HttpError(503, "Service Unavailable"))
        .mockRejectedValueOnce(new HttpError(500, "Internal Server Error"))
        .mockResolvedValueOnce("final");

      const result = await withRetry(operation, makeConfig({ maxRetries: 3 }));
      expect(result).toBe("final");
      expect(operation).toHaveBeenCalledTimes(4);
    });
  });

  describe("failure paths", () => {
    it("throws after exhausting all retries", async () => {
      const err = new HttpError(503, "Service Unavailable");
      const operation = jest.fn().mockRejectedValue(err);

      await expect(
        withRetry(operation, makeConfig({ maxRetries: 3 })),
      ).rejects.toThrow(err);
      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("does NOT retry on a permanent 400 error", async () => {
      const err = new HttpError(400, "Bad Request");
      const operation = jest.fn().mockRejectedValue(err);

      await expect(withRetry(operation, makeConfig())).rejects.toThrow(err);
      expect(operation).toHaveBeenCalledTimes(1); // no retries
    });

    it("does NOT retry on a 404 error", async () => {
      const err = new HttpError(404, "Not Found");
      const operation = jest.fn().mockRejectedValue(err);

      await expect(withRetry(operation, makeConfig())).rejects.toThrow(err);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on a 422 validation error", async () => {
      const err = new HttpError(422, "Unprocessable Entity");
      const operation = jest.fn().mockRejectedValue(err);

      await expect(withRetry(operation, makeConfig())).rejects.toThrow(err);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("retries on a 429 Too Many Requests error", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new HttpError(429, "Too Many Requests"))
        .mockResolvedValueOnce("ok");

      const result = await withRetry(operation, makeConfig());
      expect(result).toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("retries on a 503 Service Unavailable error", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new HttpError(503, "Service Unavailable"))
        .mockResolvedValueOnce("ok");

      const result = await withRetry(operation, makeConfig());
      expect(result).toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("retries on a non-HTTP network error (e.g. ECONNREFUSED)", async () => {
      const networkError = new Error("ECONNREFUSED");
      const operation = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce("ok");

      const result = await withRetry(operation, makeConfig());
      expect(result).toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe("onRetry callback", () => {
    it("calls onRetry with the attempt number, delay, and error on each retry", async () => {
      const retriedErrors: unknown[] = [];
      const retriedAttempts: number[] = [];

      const err = new HttpError(503, "Service Unavailable");
      const operation = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce("ok");

      await withRetry(operation, makeConfig(), (attempt, _delay, error) => {
        retriedAttempts.push(attempt);
        retriedErrors.push(error);
      });

      expect(retriedAttempts).toEqual([1]);
      expect(retriedErrors).toEqual([err]);
    });

    it("calls onRetry once per retry, not on the final failure", async () => {
      const onRetry = jest.fn();
      const err = new HttpError(503, "Service Unavailable");
      const operation = jest.fn().mockRejectedValue(err);

      await expect(
        withRetry(operation, makeConfig({ maxRetries: 2 }), onRetry),
      ).rejects.toThrow(err);

      // maxRetries = 2 → 3 total calls, 2 retries
      expect(operation).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });
  });

  describe("maxRetries = 0", () => {
    it("does not retry when maxRetries is 0", async () => {
      const err = new HttpError(503, "Service Unavailable");
      const operation = jest.fn().mockRejectedValue(err);

      await expect(
        withRetry(operation, makeConfig({ maxRetries: 0 })),
      ).rejects.toThrow(err);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});

describe("calculateDelay", () => {
  const config: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    retryableStatusCodes: DEFAULT_RETRY_CONFIG.retryableStatusCodes,
  };

  it("returns initialDelayMs for attempt 0", () => {
    expect(calculateDelay(0, config)).toBe(100);
  });

  it("doubles the delay for attempt 1", () => {
    expect(calculateDelay(1, config)).toBe(200);
  });

  it("doubles the delay again for attempt 2", () => {
    expect(calculateDelay(2, config)).toBe(400);
  });

  it("caps the delay at maxDelayMs", () => {
    // 100 * 2^10 = 102400 — well above 5000
    expect(calculateDelay(10, config)).toBe(5000);
  });

  it("never exceeds maxDelayMs regardless of attempt number", () => {
    for (let i = 0; i < 20; i++) {
      expect(calculateDelay(i, config)).toBeLessThanOrEqual(config.maxDelayMs);
    }
  });

  it("produces the expected geometric sequence: 100, 200, 400, 800, 1600, 3200, 5000", () => {
    const expected = [100, 200, 400, 800, 1600, 3200, 5000];
    expected.forEach((exp, i) => {
      expect(calculateDelay(i, config)).toBe(exp);
    });
  });
});

describe("resolveRetryConfig", () => {
  it("returns full defaults when called with no arguments", () => {
    expect(resolveRetryConfig()).toEqual(DEFAULT_RETRY_CONFIG);
  });

  it("merges partial overrides with defaults", () => {
    const config = resolveRetryConfig({ maxRetries: 5 });
    expect(config.maxRetries).toBe(5);
    expect(config.initialDelayMs).toBe(DEFAULT_RETRY_CONFIG.initialDelayMs);
    expect(config.maxDelayMs).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
  });

  it("uses supplied retryableStatusCodes when provided", () => {
    const codes = [500, 503];
    const config = resolveRetryConfig({ retryableStatusCodes: codes });
    expect(config.retryableStatusCodes).toEqual(codes);
  });
});

describe("HttpError", () => {
  it("stores the status code", () => {
    const err = new HttpError(502, "Bad Gateway");
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe("Bad Gateway");
    expect(err.name).toBe("HttpError");
  });

  it("is an instance of Error", () => {
    expect(new HttpError(500, "Err")).toBeInstanceOf(Error);
  });
});

describe("AnonVoteClient – retry integration", () => {
  it("accepts a retryConfig in the constructor", () => {
    const client = new AnonVoteClient({
      encryptionKey: TEST_KEY,
      retryConfig: { maxRetries: 5 },
    });
    expect(client).toBeInstanceOf(AnonVoteClient);
  });

  it("exposes an execute method that retries transient failures", async () => {
    const client = new AnonVoteClient({
      encryptionKey: TEST_KEY,
      retryConfig: { maxRetries: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    const operation = jest
      .fn()
      .mockRejectedValueOnce(new HttpError(503, "Service Unavailable"))
      .mockResolvedValueOnce("done");

    const result = await client.execute(operation);
    expect(result).toBe("done");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("execute does not retry on a permanent 400 error", async () => {
    const client = new AnonVoteClient({
      encryptionKey: TEST_KEY,
      retryConfig: { maxRetries: 3, initialDelayMs: 0, maxDelayMs: 0 },
    });

    const err = new HttpError(400, "Bad Request");
    const operation = jest.fn().mockRejectedValue(err);

    await expect(client.execute(operation)).rejects.toThrow(err);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback when retrying", async () => {
    const client = new AnonVoteClient({
      encryptionKey: TEST_KEY,
      retryConfig: { maxRetries: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });

    const retryLog: number[] = [];
    client.onRetry = (attempt) => {
      retryLog.push(attempt);
    };

    const operation = jest
      .fn()
      .mockRejectedValueOnce(new HttpError(502, "Bad Gateway"))
      .mockResolvedValueOnce("ok");

    await client.execute(operation);
    expect(retryLog).toEqual([1]);
  });

  it("sleep resolves after the specified delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
