/**
 * examples.test.ts
 *
 * Verifies that all example files compile, execute, and produce expected output.
 * Runs entirely offline with no external service dependencies.
 */
import { main as runBasicBallot } from "../examples/basic-ballot";
import { main as runTokenWorkflow } from "../examples/token-workflow";
import { main as runErrorHandling } from "../examples/error-handling";
import { main as runClientIntegration } from "../examples/client-integration";
import { main as runZkVoteVerification } from "../examples/zk-vote-verification";

describe("examples/basic-ballot.ts", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("runs without throwing", async () => {
    await expect(runBasicBallot()).resolves.toBeUndefined();
  });

  it("logs voter identifier hash", async () => {
    await runBasicBallot();
    const hashLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Voter identifier hash"),
    );
    expect(hashLog).toBeDefined();
    expect(hashLog[0]).toContain("...");
  });

  it("logs election creation", async () => {
    await runBasicBallot();
    const electionLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Election created"),
    );
    expect(electionLog).toBeDefined();
  });

  it("passes vote verification", async () => {
    await runBasicBallot();
    const verifyLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Vote verification"),
    );
    expect(verifyLog).toBeDefined();
    expect(verifyLog[0]).toContain("PASSED");
  });

  it("confirms optionId is excluded from submission payload", async () => {
    await runBasicBallot();
    const serialLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("optionId excluded from payload"),
    );
    expect(serialLog).toBeDefined();
    expect(serialLog[0]).toContain("YES");
  });
});

describe("examples/token-workflow.ts", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("runs without throwing", () => {
    expect(() => runTokenWorkflow()).not.toThrow();
  });

  it("returns a valid TokenRecord", () => {
    const record = runTokenWorkflow();
    expect(record).toHaveProperty("tokenHash");
    expect(record).toHaveProperty("ballotId");
    expect(record).toHaveProperty("used", false);
    expect(record).toHaveProperty("issuedAt");
    expect(record.tokenHash).toHaveLength(64);
    expect(record.tokenHash).toMatch(/^[0-9a-f]+$/);
  });

  it("generates a 64-char hex token", () => {
    runTokenWorkflow();
    const tokenLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Generated token"),
    );
    expect(tokenLog).toBeDefined();
    expect(tokenLog[0]).toContain("64 chars");
  });

  it("passes hash verification", () => {
    runTokenWorkflow();
    const verifyLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Hash verification"),
    );
    expect(verifyLog).toBeDefined();
    expect(verifyLog[0]).toContain("PASSED");
  });

  it("confirms different tokens produce different hashes", () => {
    runTokenWorkflow();
    const diffLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Different tokens"),
    );
    expect(diffLog).toBeDefined();
    expect(diffLog[0]).toContain("YES");
  });

  it("confirms hashToken is case-sensitive", () => {
    runTokenWorkflow();
    const caseLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("case-sensitive"),
    );
    expect(caseLog).toBeDefined();
    expect(caseLog[0]).toContain("YES");
  });
});

describe("examples/error-handling.ts", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("runs without throwing", () => {
    expect(() => runErrorHandling()).not.toThrow();
  });

  it("catches all 5 error scenarios", () => {
    const results = runErrorHandling();
    expect(results).toHaveLength(5);
  });

  it("catches invalid key as ValidationError", () => {
    const results = runErrorHandling();
    const invalidKey = results.find((r) => r.name === "invalid-key");
    expect(invalidKey).toBeDefined();
    expect(invalidKey!.caught).toBe(true);
    expect(invalidKey!.errorType).toBe("ValidationError");
  });

  it("catches tampered ciphertext as CryptoError", () => {
    const results = runErrorHandling();
    const tampered = results.find((r) => r.name === "tampered-ciphertext");
    expect(tampered).toBeDefined();
    expect(tampered!.caught).toBe(true);
    expect(tampered!.errorType).toBe("CryptoError");
  });

  it("catches wrong key as CryptoError", () => {
    const results = runErrorHandling();
    const wrongKey = results.find((r) => r.name === "wrong-key");
    expect(wrongKey).toBeDefined();
    expect(wrongKey!.caught).toBe(true);
    expect(wrongKey!.errorType).toBe("CryptoError");
  });

  it("catches errors via AnonVoteError base class", () => {
    const results = runErrorHandling();
    const baseClass = results.find((r) => r.name === "base-class-catch");
    expect(baseClass).toBeDefined();
    expect(baseClass!.caught).toBe(true);
    expect(baseClass!.errorType).toBe("ValidationError");
  });

  it("catches client validation error for empty title", () => {
    const results = runErrorHandling();
    const clientVal = results.find((r) => r.name === "client-validation");
    expect(clientVal).toBeDefined();
    expect(clientVal!.caught).toBe(true);
    expect(clientVal!.errorType).toBe("ValidationError");
  });
});

describe("examples/client-integration.ts", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("runs without throwing", () => {
    expect(() => runClientIntegration()).not.toThrow();
  });

  it("returns a valid IntegrationResult", () => {
    const result = runClientIntegration();
    expect(result).toHaveProperty("electionId");
    expect(result).toHaveProperty("voteVerified", true);
    expect(result).toHaveProperty("serializedPayload");
    expect(result).toHaveProperty("deserializedOptionId", "");
  });

  it("logs client configuration", () => {
    runClientIntegration();
    const configLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Client configured"),
    );
    expect(configLog).toBeDefined();
  });

  it("creates an election with correct title", () => {
    runClientIntegration();
    const electionLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Q3 Budget Vote"),
    );
    expect(electionLog).toBeDefined();
  });

  it("confirms vote verification", () => {
    runClientIntegration();
    const verifyLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("CONFIRMED"),
    );
    expect(verifyLog).toBeDefined();
  });

  it("excludes optionId from serialized payload", () => {
    runClientIntegration();
    const serialLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("optionId excluded"),
    );
    expect(serialLog).toBeDefined();
    expect(serialLog[0]).toContain("YES");
  });

  it("shows API submission payload format", () => {
    runClientIntegration();
    const apiLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("POST /api/votes"),
    );
    expect(apiLog).toBeDefined();
  });
});

describe("examples/zk-vote-verification.ts", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("runs without throwing", async () => {
    await expect(runZkVoteVerification()).resolves.toBeUndefined();
  });

  it("logs key generation and public modulus", async () => {
    await runZkVoteVerification();
    const keyLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Public Modulus n"),
    );
    expect(keyLog).toBeDefined();
  });

  it("logs ballot validity verification passed", async () => {
    await runZkVoteVerification();
    const validLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("VALID (PASSED)"),
    );
    expect(validLog).toBeDefined();
  });

  it("logs Merkle inclusion confirmation", async () => {
    await runZkVoteVerification();
    const merkleLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Alice verifying inclusion"),
    );
    expect(merkleLog).toBeDefined();
    expect(merkleLog[0]).toContain("CONFIRMED");
  });

  it("logs verified and audited tally proof", async () => {
    await runZkVoteVerification();
    const tallyLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Tally Proof Verification"),
    );
    expect(tallyLog).toBeDefined();
    expect(tallyLog[0]).toContain("VERIFIED & AUDITED");
  });

  it("logs threshold decryption success", async () => {
    await runZkVoteVerification();
    const threshLog = consoleSpy.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("Threshold Decryption Status"),
    );
    expect(threshLog).toBeDefined();
    expect(threshLog[0]).toContain("SUCCESS");
  });
});

