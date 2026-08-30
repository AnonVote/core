/**
 * Tests for AnonVoteClient HTTP SDK
 */

import { AnonVoteClient } from "../src/client/AnonVoteClient";
import {
  InvalidTokenError,
  BallotClosedError,
  BallotNotFoundError,
  AuthError,
  TimeoutError,
} from "../src/client/errors";
import { ValidationError } from "../src/errors";
import { HttpError } from "../src/retry";

// Mock fetch globally
global.fetch = jest.fn();

describe("AnonVoteClient", () => {
  const validConfig = {
    apiUrl: "https://api.test.com",
    ballotEncryptionKey: "a".repeat(64),
    authToken: "test-token",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("creates client with valid config", () => {
      const client = new AnonVoteClient(validConfig);
      expect(client).toBeInstanceOf(AnonVoteClient);
    });

    it("throws ValidationError for empty apiUrl", () => {
      expect(() => {
        new AnonVoteClient({ ...validConfig, apiUrl: "" });
      }).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid encryption key", () => {
      expect(() => {
        new AnonVoteClient({ ...validConfig, ballotEncryptionKey: "short" });
      }).toThrow(ValidationError);
    });

    it("accepts config without authToken", () => {
      const { authToken, ...config } = validConfig;
      const client = new AnonVoteClient(config);
      expect(client).toBeInstanceOf(AnonVoteClient);
    });
  });

  describe("createBallot", () => {
    it("creates ballot successfully", async () => {
      const mockResponse = {
        id: "ballot-123",
        organizationId: "org-1",
        topic: "Test Ballot",
        status: "OPEN",
        deadline: "2026-12-31T23:59:59Z",
        eligibilityListId: "elist-1",
        allowWeightedVoting: false,
        allowRankedChoice: false,
        createdAt: "2026-08-22T00:00:00Z",
        options: [
          { id: "opt-1", ballotId: "ballot-123", text: "Yes" },
          { id: "opt-2", ballotId: "ballot-123", text: "No" },
        ],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new AnonVoteClient(validConfig);
      const result = await client.createBallot(
        "Test Ballot",
        "Description",
        ["Yes", "No"],
        "2026-12-31T23:59:59Z",
      );

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/ballots",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("throws ValidationError for empty title", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(
        client.createBallot("", "Description", ["Yes", "No"], "2026-12-31"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for fewer than 2 options", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(
        client.createBallot("Title", "Description", ["Yes"], "2026-12-31"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws AuthError on 401", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ message: "Invalid token" }),
      });

      const client = new AnonVoteClient(validConfig);
      await expect(
        client.createBallot("Title", "Desc", ["A", "B"], "2026-12-31"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("uploadVoters", () => {
    it("uploads voters successfully", async () => {
      const mockResponse = {
        added: 2,
        skipped: 0,
        eligibilityListId: "elist-1",
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new AnonVoteClient(validConfig);
      const result = await client.uploadVoters("ballot-123", [
        "alice@example.com",
        "bob@example.com",
      ]);

      expect(result).toEqual(mockResponse);
    });

    it("throws ValidationError for empty ballotId", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(client.uploadVoters("", ["alice@example.com"])).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws ValidationError for empty voters array", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(client.uploadVoters("ballot-123", [])).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws BallotNotFoundError on 404", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Ballot not found" }),
      });

      const client = new AnonVoteClient(validConfig);
      await expect(
        client.uploadVoters("ballot-999", ["alice@example.com"]),
      ).rejects.toThrow(BallotNotFoundError);
    });
  });

  describe("issueBallotTokens", () => {
    it("issues tokens successfully", async () => {
      const mockResponse = {
        issued: 2,
        tokens: ["token1", "token2"],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new AnonVoteClient(validConfig);
      const result = await client.issueBallotTokens("ballot-123");

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/ballots/ballot-123/tokens",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("throws ValidationError for empty ballotId", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(client.issueBallotTokens("")).rejects.toThrow(ValidationError);
    });
  });

  describe("submitVote", () => {
    it("submits vote successfully", async () => {
      const mockResponse = {
        voteId: "vote-123",
        ballotId: "ballot-123",
        submittedAt: "2026-08-22T12:00:00Z",
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new AnonVoteClient(validConfig);
      const result = await client.submitVote("ballot-123", "token-abc", "Yes");

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/ballots/ballot-123/votes",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("encryptedPayload"),
        }),
      );
    });

    it("throws ValidationError for empty token", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(client.submitVote("ballot-123", "", "Yes")).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws ValidationError for empty option", async () => {
      const client = new AnonVoteClient(validConfig);
      await expect(
        client.submitVote("ballot-123", "token-abc", ""),
      ).rejects.toThrow(ValidationError);
    });

    it("throws InvalidTokenError on 422", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ message: "Token already used" }),
      });

      const client = new AnonVoteClient(validConfig);
      await expect(
        client.submitVote("ballot-123", "token-abc", "Yes"),
      ).rejects.toThrow(InvalidTokenError);
    });

    it("throws BallotClosedError on 410", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 410,
        statusText: "Gone",
        json: async () => ({ message: "Ballot is closed" }),
      });

      const client = new AnonVoteClient(validConfig);
      await expect(
        client.submitVote("ballot-123", "token-abc", "Yes"),
      ).rejects.toThrow(BallotClosedError);
    });
  });

  describe("getBallotResults", () => {
    it("retrieves results successfully", async () => {
      const mockResponse = {
        ballotId: "ballot-123",
        totalVotes: 100,
        options: [
          { optionId: "opt-1", text: "Yes", votes: 60, percentage: 60 },
          { optionId: "opt-2", text: "No", votes: 40, percentage: 40 },
        ],
        publishedAt: "2026-08-22T12:00:00Z",
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new AnonVoteClient(validConfig);
      const result = await client.getBallotResults("ballot-123");

      expect(result).toEqual(mockResponse);
    });
  });

  describe("verifyResults", () => {
    it("verifies results successfully", async () => {
      const mockResponse = {
        ballotId: "ballot-123",
        isConsistent: true,
        totalVotes: 100,
        checkedAt: "2026-08-22T12:00:00Z",
        stellarTxId: "stellar-tx-123",
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new AnonVoteClient(validConfig);
      const result = await client.verifyResults("ballot-123");

      expect(result).toEqual(mockResponse);
    });
  });

  describe("retry logic", () => {
    it("retries on 500 error", async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({ message: "Server error" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ballotId: "ballot-123" }),
        });

      const client = new AnonVoteClient(validConfig);
      
      // Start the request
      const promise = client.getBallotResults("ballot-123");
      
      // Fast-forward through retry delays
      await jest.runAllTimersAsync();
      
      const result = await promise;
      expect(result.ballotId).toBe("ballot-123");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 400 error", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ message: "Invalid request" }),
      });

      const client = new AnonVoteClient(validConfig);
      await expect(client.getBallotResults("ballot-123")).rejects.toThrow(
        HttpError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout handling", () => {
    it("throws TimeoutError when request exceeds timeout", async () => {
      (fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 100);
          }),
      );

      const client = new AnonVoteClient({
        ...validConfig,
        timeoutMs: 50,
      });

      const promise = client.getBallotResults("ballot-123");
      
      await jest.runAllTimersAsync();
      
      await expect(promise).rejects.toThrow(TimeoutError);
    });
  });

  describe("error message extraction", () => {
    it("extracts message from response body", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Custom error message" }),
      });

      const client = new AnonVoteClient(validConfig);
      await expect(client.getBallotResults("ballot-123")).rejects.toThrow(
        "Custom error message",
      );
    });

    it("falls back to statusText when body parse fails", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => {
          throw new Error("Parse error");
        },
      });

      const client = new AnonVoteClient(validConfig);
      await expect(client.getBallotResults("ballot-123")).rejects.toThrow(
        BallotNotFoundError,
      );
    });
  });
});
