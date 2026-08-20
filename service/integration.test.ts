import { beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "crypto";
import { mockRpc, resetMockRpc, simulationError, simulationSuccess, txSuccess } from "./test-helpers/mockStellarSdk";
import { FakeLedger } from "./test-helpers/fakeLedger";

vi.mock("stellar-sdk", async () => {
  const { createStellarSdkMock } = await import("./test-helpers/mockStellarSdk");
  return createStellarSdkMock();
});

import {
  BallotState,
  sorobanRecordBallot,
  sorobanRecordToken,
  sorobanRecordVote,
  sorobanRecordResult,
  sorobanExpireBallot,
  sorobanIsBallotExpired,
  sorobanGetBallotState,
  sorobanGetAuditCounts,
  sorobanResultExists,
  sorobanGetAuditReport,
  sorobanVerifyResultProof,
  sorobanRotateAdmin,
  sorobanGetRotationHistory,
  sorobanGetBallotMetadata,
  sorobanGetBallotStats,
  sorobanGetAllBallots,
  sorobanBallotIsActive,
  sorobanIsBallotFinalized,
  SorobanErrorCode,
  SorobanServiceError,
  SorobanServiceErrorCode,
  type SorobanConfig,
} from "./sorobanService";
import * as StellarSdk from "stellar-sdk";

const ADMIN_SECRET_KEY = "S" + "B".repeat(55);
const OTHER_ADMIN_SECRET_KEY = "S" + "C".repeat(55);
const CONTRACT_ID = "C" + "D".repeat(55);

function makeConfig(secretKey = ADMIN_SECRET_KEY): SorobanConfig {
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: CONTRACT_ID,
    sourceKeypair: StellarSdk.Keypair.fromSecret(secretKey),
  };
}

let ledger: FakeLedger;

beforeEach(() => {
  resetMockRpc();
  ledger = new FakeLedger();

  // Wire the fake RPC to the in-memory ledger: every invokeContract/readContract
  // call ends up here as a single operation on the built transaction.
  mockRpc.simulateTransaction.mockImplementation(async (tx: any) => {
    const op = tx.operations[0];
    const outcome = ledger.call(op.method, op.args);
    if (!outcome.ok) {
      return simulationError(`Error(Contract, #${outcome.contractErrorCode})`);
    }
    (mockRpc as any)._lastValue = outcome.value;
    return simulationSuccess(outcome.value);
  });
  mockRpc.sendTransaction.mockImplementation(async () => ({
    status: "PENDING",
    hash: "tx-" + Math.random().toString(36).slice(2),
  }));
  mockRpc.getTransaction.mockImplementation(async () => txSuccess((mockRpc as any)._lastValue));

  // Seed FakeLedger admin so rotate_admin can validate the caller.
  ledger.setAdmin(StellarSdk.Keypair.fromSecret(ADMIN_SECRET_KEY).publicKey());
});

describe("AnonVote ballot lifecycle (mocked contract, no live network)", () => {
  it("runs create -> tokens -> votes -> result and reflects correct audit counts throughout", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-hash-001";

    const ballotResult = await sorobanRecordBallot(config, ballotIdHash);
    expect(ballotResult.success).toBe(true);

    await sorobanRecordToken(config, ballotIdHash);
    await sorobanRecordToken(config, ballotIdHash);
    const tokenResult = await sorobanRecordToken(config, ballotIdHash);
    expect(tokenResult.success).toBe(true);

    let counts = await sorobanGetAuditCounts(config, ballotIdHash);
    expect(counts).toEqual({ tokensIssued: 3, votesCast: 0, isConsistent: false });

    await sorobanRecordVote(config, ballotIdHash);
    await sorobanRecordVote(config, ballotIdHash);
    const voteResult = await sorobanRecordVote(config, ballotIdHash);
    expect(voteResult.success).toBe(true);

    counts = await sorobanGetAuditCounts(config, ballotIdHash);
    expect(counts).toEqual({ tokensIssued: 3, votesCast: 3, isConsistent: true });

    const resultResult = await sorobanRecordResult(config, ballotIdHash, "result-hash-aaa");
    expect(resultResult.success).toBe(true);
  });

  it("view functions return accurate data throughout the ballot lifecycle", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-view-001";

    const meta0 = await sorobanGetBallotMetadata(config, ballotIdHash);
    // Contract returns default values for non-existent ballots
    expect(meta0).not.toBeNull();
    expect(meta0!.created_at).toBe(0);
    expect(meta0!.is_active).toBe(false);

    const stats0 = await sorobanGetBallotStats(config, ballotIdHash);
    expect(stats0).not.toBeNull();
    expect(stats0!.tokens_issued).toBe(0);
    expect(stats0!.votes_cast).toBe(0);
    expect(stats0!.result_hash).toBeNull();

    await sorobanRecordBallot(config, ballotIdHash);

    const meta1 = await sorobanGetBallotMetadata(config, ballotIdHash);
    expect(meta1).not.toBeNull();
    expect(meta1!.admin).toBe(StellarSdk.Keypair.fromSecret(ADMIN_SECRET_KEY).publicKey());
    expect(meta1!.created_at).toBeGreaterThan(0);
    expect(meta1!.is_active).toBe(true);

    const active1 = await sorobanBallotIsActive(config, ballotIdHash);
    expect(active1).toBe(true);

    const finalized1 = await sorobanIsBallotFinalized(config, ballotIdHash);
    expect(finalized1).toBe(false);

    await sorobanRecordToken(config, ballotIdHash);
    await sorobanRecordToken(config, ballotIdHash);
    await sorobanRecordVote(config, ballotIdHash);

    const stats1 = await sorobanGetBallotStats(config, ballotIdHash);
    expect(stats1).not.toBeNull();
    expect(stats1!.tokens_issued).toBe(2);
    expect(stats1!.votes_cast).toBe(1);
    expect(stats1!.result_hash).toBeNull();

    await sorobanRecordResult(config, ballotIdHash, "result-view-hash");

    const meta2 = await sorobanGetBallotMetadata(config, ballotIdHash);
    expect(meta2!.is_active).toBe(false);

    const active2 = await sorobanBallotIsActive(config, ballotIdHash);
    expect(active2).toBe(false);

    const finalized2 = await sorobanIsBallotFinalized(config, ballotIdHash);
    expect(finalized2).toBe(true);

    const stats2 = await sorobanGetBallotStats(config, ballotIdHash);
    expect(stats2!.result_hash).toBe("result-view-hash");

    const allBallots = await sorobanGetAllBallots(config);
    expect(allBallots).toContain(ballotIdHash);
  });

  it("treats re-recording the same result hash as an idempotent success", async () => {
    // Per lib.rs, record_result returns Ok(()) directly when the same hash is
    // re-recorded (it never raises ResultAlreadyPublished for a matching
    // hash), so this resolves through the normal success path with a real
    // txHash — not through sorobanRecordResult's defensive
    // ResultAlreadyPublished-recovery branch, which only triggers when the
    // on-chain hash genuinely differs from a *different* candidate hash.
    const config = makeConfig();
    const ballotIdHash = "ballot-hash-002";

    await sorobanRecordBallot(config, ballotIdHash);
    await sorobanRecordResult(config, ballotIdHash, "result-hash-bbb");
    const secondCall = await sorobanRecordResult(config, ballotIdHash, "result-hash-bbb");

    expect(secondCall.success).toBe(true);
  });

  it("rejects a conflicting result hash with ResultAlreadyPublished", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-hash-003";

    await sorobanRecordBallot(config, ballotIdHash);
    await sorobanRecordResult(config, ballotIdHash, "result-hash-ccc");

    await expect(
      sorobanRecordResult(config, ballotIdHash, "result-hash-DIFFERENT"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.ResultAlreadyPublished,
    );
  });

  it("returns BallotNotFound when recording a token against a ballot that was never created", async () => {
    const config = makeConfig();
    await expect(sorobanRecordToken(config, "never-created")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
  });

  it("treats re-recording the same ballot by the same admin as idempotent, but a different admin as a conflict", async () => {
    const ballotIdHash = "ballot-hash-004";
    const adminConfig = makeConfig(ADMIN_SECRET_KEY);
    const otherAdminConfig = makeConfig(OTHER_ADMIN_SECRET_KEY);

    const first = await sorobanRecordBallot(adminConfig, ballotIdHash);
    expect(first.success).toBe(true);

    const sameAdminAgain = await sorobanRecordBallot(adminConfig, ballotIdHash);
    expect(sameAdminAgain.success).toBe(true);

    await expect(sorobanRecordBallot(otherAdminConfig, ballotIdHash)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotAlreadyExists,
    );
  });

  it("every helper returns NotConfigured rather than throwing when config validation fails", async () => {
    const badConfig = { ...makeConfig(), sourceKeypair: undefined as any };
    const ballotIdHash = "ballot-hash-005";

    const results = await Promise.all([
      sorobanRecordBallot(badConfig, ballotIdHash),
      sorobanRecordToken(badConfig, ballotIdHash),
      sorobanRecordVote(badConfig, ballotIdHash),
      sorobanRecordResult(badConfig, ballotIdHash, "x"),
    ]);

    for (const r of results) {
      expect(r.success).toBe(false);
      expect(r.errorCode).toBe(SorobanErrorCode.NotConfigured);
    }
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("TypeScript enforces error-field access only on the failure branch (compile-time check)", async () => {
    const config = makeConfig();

    // sorobanRecordToken now throws on failure — verify the throw carries the
    // correct contractErrorCode so callers can distinguish failure kinds.
    const err = await sorobanRecordToken(config, "never-created-either").catch((e) => e);
    expect(err).toBeInstanceOf(SorobanServiceError);
    expect((err as SorobanServiceError).contractErrorCode).toBe(SorobanErrorCode.BallotNotFound);
    expect((err as SorobanServiceError).retryable).toBe(false);
  });

  it("sorobanResultExists returns false before publication and true after", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-hash-006";

    await sorobanRecordBallot(config, ballotIdHash);

    const beforeResult = await sorobanResultExists(config, ballotIdHash);
    expect(beforeResult).toBe(false);

    await sorobanRecordResult(config, ballotIdHash, "result-hash-ddd");

    const afterResult = await sorobanResultExists(config, ballotIdHash);
    expect(afterResult).toBe(true);
  });

  it("view functions return sensible defaults for non-existent ballots", async () => {
    const config = makeConfig();
    const unknownBallot = "does-not-exist";

    const meta = await sorobanGetBallotMetadata(config, unknownBallot);
    // Contract returns zero-value defaults, not an error
    expect(meta).not.toBeNull();
    expect(meta!.created_at).toBe(0);
    expect(meta!.is_active).toBe(false);

    const stats = await sorobanGetBallotStats(config, unknownBallot);
    expect(stats).not.toBeNull();
    expect(stats!.tokens_issued).toBe(0);
    expect(stats!.votes_cast).toBe(0);

    const active = await sorobanBallotIsActive(config, unknownBallot);
    expect(active).toBe(false);

    const finalized = await sorobanIsBallotFinalized(config, unknownBallot);
    expect(finalized).toBe(false);

    const allBallots = await sorobanGetAllBallots(config);
    expect(allBallots).toEqual(expect.any(Array));
  });

  it("view functions do not mutate state", async () => {
    const config = makeConfig();
    const ballotIdHash = "view-no-mutate";

    await sorobanRecordBallot(config, ballotIdHash);
    await sorobanRecordToken(config, ballotIdHash);

    const tokensBefore = (await sorobanGetAuditCounts(config, ballotIdHash))!.tokensIssued;

    await sorobanGetBallotMetadata(config, ballotIdHash);
    await sorobanGetBallotStats(config, ballotIdHash);
    await sorobanGetAllBallots(config);
    await sorobanBallotIsActive(config, ballotIdHash);
    await sorobanIsBallotFinalized(config, ballotIdHash);

    const tokensAfter = (await sorobanGetAuditCounts(config, ballotIdHash))!.tokensIssued;
    expect(tokensAfter).toBe(tokensBefore);
  });

  it("sorobanGetAuditReport returns full report matching individual reads and verifies immutability", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-hash-audit";

    // Non-existent report should return null
    const nonExistentReport = await sorobanGetAuditReport(config, "non-existent");
    expect(nonExistentReport).toBeNull();

    // Create ballot
    await sorobanRecordBallot(config, ballotIdHash);

    // Get report
    const report1 = await sorobanGetAuditReport(config, ballotIdHash);
    expect(report1).not.toBeNull();
    
    // Verify all required fields
    const expectedAdmin = config.sourceKeypair.publicKey();
    expect(report1!.admin).toBe(expectedAdmin);
    expect(report1!.created_at).toBe(1718880000); // Fixed in FakeLedger
    expect(report1!.expiration_time).toBe(0);
    expect(report1!.is_consistent).toBe(true);
    expect(report1!.result_hash).toBeNull();
    expect(report1!.state).toBe("Active");
    expect(report1!.tokens_issued).toBe(0);
    expect(report1!.votes_cast).toBe(0);

    // Record token & vote and verify report matches individual reads
    await sorobanRecordToken(config, ballotIdHash);
    await sorobanRecordVote(config, ballotIdHash);

    const counts = await sorobanGetAuditCounts(config, ballotIdHash);
    expect(counts).not.toBeNull();
    const report2 = await sorobanGetAuditReport(config, ballotIdHash);
    expect(report2!.tokens_issued).toBe(counts!.tokensIssued);
    expect(report2!.votes_cast).toBe(counts!.votesCast);
    expect(report2!.is_consistent).toBe(counts!.isConsistent);
    expect(report2!.is_consistent).toBe(true);

    // Make inconsistent (another token) and verify
    await sorobanRecordToken(config, ballotIdHash);
    const report3 = await sorobanGetAuditReport(config, ballotIdHash);
    expect(report3!.tokens_issued).toBe(2);
    expect(report3!.votes_cast).toBe(1);
    expect(report3!.is_consistent).toBe(false);

    // Record result and verify state & result_hash transitions
    await sorobanRecordResult(config, ballotIdHash, "election-result-hash");
    const report4 = await sorobanGetAuditReport(config, ballotIdHash);
    expect(report4!.state).toBe("ResultPublished");
    expect(report4!.result_hash).toBe("election-result-hash");
  });

  it("sorobanVerifyResultProof verifies merkle proof workflow", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-hash-merkle";

    // 1. Create ballot
    await sorobanRecordBallot(config, ballotIdHash);

    // Prepare Merkle Tree data (2 leaves)
    const leaf0 = crypto.createHash("sha256").update("vote-0").digest("hex");
    const leaf1 = crypto.createHash("sha256").update("vote-1").digest("hex");

    const leaf0Buf = Buffer.from(leaf0, "hex");
    const leaf1Buf = Buffer.from(leaf1, "hex");
    const parentBuf = Buffer.concat([leaf0Buf, leaf1Buf]);
    const root = crypto.createHash("sha256").update(parentBuf).digest("hex");

    const proof0 = {
      vote_hash: leaf0,
      path: [leaf1],
      index: 0,
    };

    // 2. Before publication, verification should return null (ballot result not published)
    const earlyVerify = await sorobanVerifyResultProof(config, ballotIdHash, proof0, root);
    expect(earlyVerify).toBeNull();

    // 3. Publish result
    await sorobanRecordResult(config, ballotIdHash, root);

    // 4. Verify valid proof for leaf 0
    const verify0 = await sorobanVerifyResultProof(config, ballotIdHash, proof0, root);
    expect(verify0).toBe(true);

    // 5. Verify valid proof for leaf 1
    const proof1 = {
      vote_hash: leaf1,
      path: [leaf0],
      index: 1,
    };
    const verify1 = await sorobanVerifyResultProof(config, ballotIdHash, proof1, root);
    expect(verify1).toBe(true);

    // 6. Verify invalid proof (invalid vote hash)
    const invalidVoteProof = {
      vote_hash: "00".repeat(32),
      path: [leaf1],
      index: 0,
    };
    const verifyInvalidVote = await sorobanVerifyResultProof(config, ballotIdHash, invalidVoteProof, root);
    expect(verifyInvalidVote).toBe(false);

    // 7. Verify invalid proof (invalid sibling path)
    const invalidPathProof = {
      vote_hash: leaf0,
      path: ["00".repeat(32)],
      index: 0,
    };
    const verifyInvalidPath = await sorobanVerifyResultProof(config, ballotIdHash, invalidPathProof, root);
    expect(verifyInvalidPath).toBe(false);

    // 8. Verify invalid proof (wrong index)
    const invalidIndexProof = {
      vote_hash: leaf0,
      path: [leaf1],
      index: 1,
    };
    const verifyInvalidIndex = await sorobanVerifyResultProof(config, ballotIdHash, invalidIndexProof, root);
    expect(verifyInvalidIndex).toBe(false);

    // 9. Verify with incorrect root parameter
    const verifyWrongRoot = await sorobanVerifyResultProof(config, ballotIdHash, proof0, "wrong-root-hex");
    expect(verifyWrongRoot).toBe(false);
  });
});

describe("Ballot expiration (mocked contract, no live network)", () => {
  it("record_token and record_vote succeed while Active, then reject once Expired", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-expiry-lifecycle";

    await sorobanRecordBallot(config, ballotIdHash);
    await sorobanRecordToken(config, ballotIdHash);
    await sorobanRecordVote(config, ballotIdHash);

    expect(await sorobanIsBallotExpired(config, ballotIdHash)).toBe(false);

    await sorobanExpireBallot(config, ballotIdHash);

    expect(await sorobanIsBallotExpired(config, ballotIdHash)).toBe(true);

    await expect(sorobanRecordToken(config, ballotIdHash)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotExpired,
    );
    await expect(sorobanRecordVote(config, ballotIdHash)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotExpired,
    );

    // Counts recorded before expiration are untouched.
    const counts = await sorobanGetAuditCounts(config, ballotIdHash);
    expect(counts).toMatchObject({ tokensIssued: 1, votesCast: 1 });
  });

  it("the on-chain state transition is authoritative — get_ballot_state reflects Expired", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-expiry-state";
    await sorobanRecordBallot(config, ballotIdHash);

    const before = await sorobanGetBallotState(config, ballotIdHash);
    expect(before?.state).toBe(BallotState.Active);

    await sorobanExpireBallot(config, ballotIdHash);

    const after = await sorobanGetBallotState(config, ballotIdHash);
    expect(after?.state).toBe(BallotState.Expired);
  });

  it("an already-expired ballot cannot be expired again", async () => {
    const config = makeConfig();
    const ballotIdHash = "ballot-expiry-idempotency";
    await sorobanRecordBallot(config, ballotIdHash);
    await sorobanExpireBallot(config, ballotIdHash);

    await expect(sorobanExpireBallot(config, ballotIdHash)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotExpired,
    );
  });

  it("expiring an unknown ballot returns BallotNotFound", async () => {
    const config = makeConfig();
    await expect(sorobanExpireBallot(config, "never-recorded-ballot")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SorobanServiceError &&
        err.code === SorobanServiceErrorCode.CONTRACT_ERROR &&
        err.contractErrorCode === SorobanErrorCode.BallotNotFound,
    );
  });

  it("sorobanIsBallotExpired returns null for a ballot that does not exist", async () => {
    const config = makeConfig();
    expect(await sorobanIsBallotExpired(config, "phantom-ballot")).toBe(null);
  });
});

describe("Admin key rotation (mocked contract, no live network)", () => {
  it("full rotation flow: new admin gains privileges, old admin is locked out", async () => {
    const adminConfig = makeConfig(ADMIN_SECRET_KEY);
    const newAdminKey = "S" + "E".repeat(55);
    const newAdminConfig = makeConfig(newAdminKey);
    const newAdminPublicKey = StellarSdk.Keypair.fromSecret(newAdminKey).publicKey();

    // Rotation succeeds
    const rotateResult = await sorobanRotateAdmin(adminConfig, newAdminPublicKey);
    expect(rotateResult.success).toBe(true);

    // History has one record
    const history = await sorobanGetRotationHistory(adminConfig);
    expect(history).not.toBeNull();
    expect(history!.length).toBe(1);
    expect(history![0]!.newAdmin).toBe(newAdminPublicKey);
    expect(history![0]!.oldAdmin).toBe(StellarSdk.Keypair.fromSecret(ADMIN_SECRET_KEY).publicKey());
    expect(typeof history![0]!.rotatedAt).toBe("number");

    // Old admin can no longer rotate (AdminUnauthorized in FakeLedger)
    const rejectedRotate = await sorobanRotateAdmin(adminConfig, StellarSdk.Keypair.fromSecret(ADMIN_SECRET_KEY).publicKey());
    expect(rejectedRotate.success).toBe(false);
    expect(rejectedRotate.errorCode).toBe(SorobanErrorCode.AdminUnauthorized);

    // New admin can rotate further
    const secondRotateResult = await sorobanRotateAdmin(newAdminConfig, StellarSdk.Keypair.fromSecret(ADMIN_SECRET_KEY).publicKey());
    expect(secondRotateResult.success).toBe(true);
  });

  it("rejects rotation to the same admin address with SameAdmin", async () => {
    const adminConfig = makeConfig(ADMIN_SECRET_KEY);
    const currentAdminPublicKey = StellarSdk.Keypair.fromSecret(ADMIN_SECRET_KEY).publicKey();

    const result = await sorobanRotateAdmin(adminConfig, currentAdminPublicKey);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.SameAdmin);
  });

  it("returns NotConfigured without touching RPC when config is invalid", async () => {
    const badConfig = { ...makeConfig(), sourceKeypair: undefined as any };
    const result = await sorobanRotateAdmin(badConfig, "GSOME_ADDRESS");
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SorobanErrorCode.NotConfigured);
    expect(mockRpc.simulateTransaction).not.toHaveBeenCalled();
  });

  it("sorobanGetRotationHistory returns empty array before any rotation", async () => {
    const config = makeConfig();
    const history = await sorobanGetRotationHistory(config);
    expect(history).toEqual([]);
  });

  it("sorobanGetRotationHistory returns null for invalid contract ID", async () => {
    const history = await sorobanGetRotationHistory(
      makeConfig(ADMIN_SECRET_KEY) as any & { contractId: string },
    );
    // override contractId with invalid value
    const badConfig = { ...makeConfig(), contractId: "not-a-contract" };
    const result = await sorobanGetRotationHistory(badConfig);
    expect(result).toBeNull();
  });

  it("accumulates multiple rotation records in order", async () => {
    const keyA = ADMIN_SECRET_KEY;
    const keyB = "S" + "E".repeat(55);
    const keyC = "S" + "F".repeat(55);
    const pubA = StellarSdk.Keypair.fromSecret(keyA).publicKey();
    const pubB = StellarSdk.Keypair.fromSecret(keyB).publicKey();
    const pubC = StellarSdk.Keypair.fromSecret(keyC).publicKey();

    await sorobanRotateAdmin(makeConfig(keyA), pubB);
    await sorobanRotateAdmin(makeConfig(keyB), pubC);

    const history = await sorobanGetRotationHistory(makeConfig(keyC));
    expect(history!.length).toBe(2);
    expect(history![0]!.oldAdmin).toBe(pubA);
    expect(history![0]!.newAdmin).toBe(pubB);
    expect(history![1]!.oldAdmin).toBe(pubB);
    expect(history![1]!.newAdmin).toBe(pubC);
  });
});
