/**
 * Soroban Smart Contract Service — LOW-LEVEL RPC PRIMITIVES (issue #77).
 *
 * This module talks to the deployed AnonVote Soroban contract. It throws
 * typed `SorobanError`s on failure; retry/backoff/circuit-breaking lives in
 * sorobanResilient.ts, batching in voteSubmissionBatcher.ts, and state
 * reconciliation in contractStateManager.ts.
 *
 * Contract methods consumed (contracts/anonvote/src/lib.rs):
 *   record_ballot(ballot_id_hash)
 *   record_token(ballot_id_hash)
 *   record_vote(ballot_id_hash, vote_id_hash)          — rejects duplicates (#5)
 *   batch_record_votes(Vec<(ballot_id_hash, vote_id_hash)>) — atomic batch
 *   record_result(ballot_id_hash, result_hash)
 *   get_tokens_issued / get_votes_cast / is_consistent / has_vote
 *
 * CORRECT SDK USAGE (stellar-sdk v12):
 * - RPC server:     new StellarSdk.SorobanRpc.Server(rpcUrl)
 * - Simulate tx:    server.simulateTransaction(tx)
 * - Assemble tx:    StellarSdk.SorobanRpc.assembleTransaction(tx, simulation)
 * - Submit tx:      server.sendTransaction(tx)
 * - Convert values: StellarSdk.nativeToScVal(value, { type }) / scValToNative(scVal)
 */

import * as StellarSdk from "stellar-sdk";
import crypto from "crypto";
import { config } from "../config";
import { prisma } from "../prisma/client";
import {
  SorobanError,
  classifySorobanError,
} from "./sorobanErrors";
import {
  withSorobanResilience,
  ResilienceOptions,
} from "./sorobanResilient";
import { logger } from "../utils/logger";

const SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const SOROBAN_RPC_MAINNET = "https://rpc.stellar.org";

function getRpcUrl(): string {
  if (config.sorobanServerUrl) return config.sorobanServerUrl;
  return config.stellarNetwork === "mainnet"
    ? SOROBAN_RPC_MAINNET
    : SOROBAN_RPC_TESTNET;
}

function getNetworkPassphrase(): string {
  return config.stellarNetwork === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

function getRpcServer(): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(getRpcUrl(), {
    allowHttp: false,
  });
}

export interface SorobanInvokeResult {
  txHash: string;
  /** Present for compatibility; invokeContract now THROWS on failure instead. */
  success: boolean;
  returnValue?: unknown;
}

/** Result of an atomic multi-vote batch submission. */
export interface SorobanBatchResult {
  txHash: string;
  votesRecorded: number;
}

const MOCK_TEST_TX_HASH = "0xmocked_soroban_tx_hash";

function isTestMode(): boolean {
  return process.env.NODE_ENV === "test";
}

/** True when the backend has a deployed contract configured. */
export function isSorobanConfigured(): boolean {
  return Boolean(config.sorobanContractId && config.stellarSecretKey);
}

/** Shared resilience defaults for write ops; overridable per call. */
function resilient(opts?: Partial<ResilienceOptions>): ResilienceOptions {
  return { op: "soroban_call", ...(opts || {}) };
}

/**
 * Invoke a method on the deployed Soroban smart contract.
 *
 * THROWS a typed `SorobanError` on any failure (simulation rejection, send
 * error, transaction failure, network problem) — callers that want legacy
 * fire-and-forget behaviour should use `safeInvokeContract` or the resilient
 * helpers below.
 *
 * @param contractId - The deployed contract ID (C... address)
 * @param method     - The contract function name to call
 * @param args       - Arguments as native JS values (converted via nativeToScVal)
 */
export async function invokeContract(
  contractId: string,
  method: string,
  args: { value: unknown; type: string }[],
): Promise<SorobanInvokeResult> {
  if (!config.stellarSecretKey) {
    throw new SorobanError(
      "CONFIG_ERROR",
      "[Soroban] No secret key configured",
    );
  }

  if (!contractId) {
    throw new SorobanError(
      "CONFIG_ERROR",
      "[Soroban] No contract ID provided",
    );
  }

  try {
    const keypair = StellarSdk.Keypair.fromSecret(config.stellarSecretKey);
    const server = getRpcServer();

    // Load account from Soroban RPC
    const account = await server.getAccount(keypair.publicKey());

    // Convert JS args to Soroban ScVal types
    const scArgs = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    // Build the invokeHostFunction operation
    const contract = new StellarSdk.Contract(contractId);
    const operation = contract.call(method, ...scArgs);

    // Build transaction
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate to get footprint and resource fees
    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      logger.error("soroban_simulation_failed", {
        method,
        error: simulation.error,
      });
      throw classifySorobanError(
        new SorobanError(
          "SIMULATION_FAILED",
          `Simulation failed for ${method}`,
          { cause: simulation.error },
        ),
      );
    }

    // Assemble the transaction with simulation results (adds soroban data + fees)
    const preparedTx = StellarSdk.SorobanRpc.assembleTransaction(
      tx,
      simulation,
    ).build();

    // Sign and submit
    preparedTx.sign(keypair);
    const sendResult = await server.sendTransaction(preparedTx);

    if (sendResult.status === "ERROR") {
      logger.error("soroban_send_failed", {
        method,
        error: sendResult.errorResult,
      });
      throw classifySorobanError(
        new SorobanError("RPC_ERROR", `Send failed for ${method}`, {
          cause: sendResult.errorResult,
        }),
      );
    }

    // Poll for transaction completion
    const txHash = sendResult.hash;
    let getResult = await server.getTransaction(txHash);
    let attempts = 0;

    while (
      getResult.status ===
        StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 10
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      getResult = await server.getTransaction(txHash);
      attempts++;
    }

    if (
      getResult.status ===
      StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS
    ) {
      const returnValue = getResult.returnValue
        ? StellarSdk.scValToNative(getResult.returnValue)
        : undefined;

      console.log(`[Soroban] ${method} succeeded — tx: ${txHash}`);
      return { txHash, success: true, returnValue };
    }

    if (
      getResult.status ===
      StellarSdk.SorobanRpc.Api.GetTransactionStatus.FAILED
    ) {
      // On-chain execution reverted — permanent for this invocation.
      throw classifySorobanError(
        new SorobanError("CONTRACT_ERROR", `Transaction failed for ${method}`, {
          cause: getResult.resultXdr ? getResult.resultXdr.toXDR("base64") : undefined,
        }),
      );
    }

    // Timed out waiting for inclusion — treat as retryable network fault.
    throw new SorobanError(
      "NETWORK_ERROR",
      `Timed out polling transaction ${txHash} for ${method}`,
    );
  } catch (err) {
    if (err instanceof SorobanError) throw err;
    throw classifySorobanError(err);
  }
}

/**
 * Read contract data without submitting a transaction (view call / simulation only).
 *
 * @param contractId - The deployed contract ID
 * @param method     - The read-only contract function name
 * @param args       - Arguments as native JS values
 *
 * @returns The return value from the contract, or null on failure
 */
export async function readContract(
  contractId: string,
  method: string,
  args: { value: unknown; type: string }[],
): Promise<unknown | null> {
  if (!contractId) {
    console.warn("[Soroban] No contract ID provided, skipping read");
    return null;
  }

  try {
    const keypair = config.stellarSecretKey
      ? StellarSdk.Keypair.fromSecret(config.stellarSecretKey)
      : StellarSdk.Keypair.random();

    const server = getRpcServer();
    const account = await server.getAccount(keypair.publicKey());

    const scArgs = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    const contract = new StellarSdk.Contract(contractId);
    const operation = contract.call(method, ...scArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate only — no submission
    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      console.error("[Soroban] Read simulation failed:", simulation.error);
      return null;
    }

    if (
      StellarSdk.SorobanRpc.Api.isSimulationSuccess(simulation) &&
      simulation.result?.retval
    ) {
      return StellarSdk.scValToNative(simulation.result.retval);
    }

    return null;
  } catch (err) {
    console.error("[Soroban] readContract error:", err);
    return null;
  }
}

// ── AnonVote contract helpers ─────────────────────────────────────────────────
// Resilient write helpers used by the engines. Each returns the tx hash on
// success or "" when the call was skipped (unconfigured / test mode) — they
// never throw. Retry/backoff/circuit-breaking is applied via
// withSorobanResilience; exhausted retries surface as a logged error and "".

const CONTRACT_ID = config.sorobanContractId;

/** Shared guard for fire-and-forget write helpers. */
function skipReason(): "test" | "unconfigured" | null {
  if (isTestMode()) return "test";
  if (!CONTRACT_ID) return "unconfigured";
  return null;
}

function runResilientWrite(
  method: string,
  args: { value: unknown; type: string }[],
  resilience?: Partial<ResilienceOptions>,
): Promise<string> {
  const skipped = skipReason();
  if (skipped === "test") return Promise.resolve(MOCK_TEST_TX_HASH);
  if (skipped === "unconfigured") return Promise.resolve("");

  return withSorobanResilience(
    () => invokeContract(CONTRACT_ID!, method, args),
    resilient({ op: method, ...resilience }),
  )
    .then((r) => r.txHash)
    .catch((err) => {
      // Exhausted retries or circuit open — caller treats "" as not anchored.
      logger.error("soroban_write_failed", {
        op: method,
        kind: err instanceof SorobanError ? err.kind : "UNKNOWN",
        retryable: err instanceof SorobanError ? err.retryable : false,
        error: err instanceof Error ? err.message : err,
      });
      return "";
    });
}

/**
 * Legacy-shaped wrapper: resolves to {txHash:"", success:false} instead of
 * throwing. Used by admin endpoints that predate the typed-error refactor.
 */
export async function safeInvokeContract(
  contractId: string,
  method: string,
  args: { value: unknown; type: string }[],
  resilience?: Partial<ResilienceOptions>,
): Promise<SorobanInvokeResult> {
  if (isTestMode()) {
    return { txHash: MOCK_TEST_TX_HASH, success: true };
  }
  try {
    return await withSorobanResilience(
      () => invokeContract(contractId, method, args),
      resilient({ op: method, ...resilience }),
    );
  } catch (err) {
    logger.error("soroban_invoke_exhausted", {
      op: method,
      kind: err instanceof SorobanError ? err.kind : "UNKNOWN",
      error: err instanceof Error ? err.message : err,
    });
    return { txHash: "", success: false };
  }
}

/**
 * Record a ballot creation on-chain.
 * Call from ballotEngine.createBallot() after the ballot is saved to DB.
 */
export async function sorobanRecordBallot(
  ballotIdHash: string,
): Promise<string> {
  return runResilientWrite("record_ballot", [
    { value: ballotIdHash, type: "string" },
  ]);
}

/**
 * Record a token issuance on-chain.
 * Call from identityManager.issueToken() after the token is issued.
 */
export async function sorobanRecordToken(
  ballotIdHash: string,
): Promise<string> {
  return runResilientWrite("record_token", [
    { value: ballotIdHash, type: "string" },
  ]);
}

/**
 * Record a single vote cast on-chain (idempotent).
 *
 * @param ballotIdHash - SHA-256 of the database ballot ID
 * @param voteIdHash   - Deterministic per-vote idempotency key; the contract
 *                       rejects duplicates with Error::DuplicateVote (#5).
 */
export async function sorobanRecordVote(
  ballotIdHash: string,
  voteIdHash: string,
): Promise<string> {
  return runResilientWrite(
    "record_vote",
    [
      { value: ballotIdHash, type: "string" },
      { value: voteIdHash, type: "string" },
    ],
    // A duplicate rejection is permanent for this invocation — the batcher
    // interprets it as "already anchored" rather than retrying.
    { maxAttempts: 1 },
  );
}

/**
 * Record a batch of votes in ONE atomic Soroban transaction via the
 * contract's `batch_record_votes` — one fee instead of N. The contract
 * validates every entry before applying any, so a duplicate vote id reverts
 * the whole batch with Error::DuplicateVote (#5); callers should dedupe
 * beforehand and fall back to individual idempotent submits on that error.
 *
 * @returns tx hash + number of votes recorded, or txHash:"" on failure
 */
export async function sorobanRecordVotesBatch(
  entries: { ballotIdHash: string; voteIdHash: string }[],
): Promise<SorobanBatchResult> {
  const skipped = skipReason();
  if (skipped === "test") {
    return { txHash: MOCK_TEST_TX_HASH, votesRecorded: entries.length };
  }
  if (skipped === "unconfigured") {
    return { txHash: "", votesRecorded: 0 };
  }

  try {
    const result = await withSorobanResilience(
      () =>
        invokeContract(CONTRACT_ID!, "batch_record_votes", [
          {
            // Native array-of-pairs with type "vec" → nativeToScVal converts
            // recursively into the expected `Vec<(String, String)>` shape.
            value: entries.map(
              (e) => [e.ballotIdHash, e.voteIdHash] as [string, string],
            ),
            type: "vec" as any,
          },
        ]),
      resilient({ op: "batch_record_votes" }),
    );
    return { txHash: result.txHash, votesRecorded: entries.length };
  } catch (err) {
    logger.error("soroban_batch_failed", {
      op: "batch_record_votes",
      size: entries.length,
      kind: err instanceof SorobanError ? err.kind : "UNKNOWN",
      error: err instanceof Error ? err.message : err,
    });
    return { txHash: "", votesRecorded: 0 };
  }
}

/**
 * On-chain existence check for a vote id (view call). Used to disambiguate a
 * failed batch submission: entries already on-chain are marked ANCHORED while
 * the rest are retried. Returns null when the chain cannot be consulted.
 */
export async function sorobanHasVote(
  voteIdHash: string,
): Promise<boolean | null> {
  if (!CONTRACT_ID || isTestMode()) return null;
  const result = await readContract(CONTRACT_ID, "has_vote", [
    { value: voteIdHash, type: "string" },
  ]);
  if (result === null || result === undefined) return null;
  return Boolean(result);
}

/**
 * Record a result publication on-chain.
 * Call from resultEngine.tallyBallot() after the result is saved to DB.
 * resultHash: SHA-256 of the tally JSON string.
 */
export async function sorobanRecordResult(
  ballotIdHash: string,
  resultHash: string,
): Promise<string> {
  return runResilientWrite("record_result", [
    { value: ballotIdHash, type: "string" },
    { value: resultHash, type: "string" },
  ]);
}

/**
 * Record a ballot's content commitment on-chain (Issue #86).
 * Call at DRAFT → ACTIVE, when the ballot content is frozen.
 *
 * The contract rejects a second write for the same ballot — write-once is the
 * whole point of a commitment.
 */
export async function sorobanRecordBallotCommitment(
  ballotIdHash: string,
  commitment: string,
): Promise<string> {
  // Routed through the issue #77 resilience layer: retries, circuit breaking and
  // metrics, returning "" rather than throwing when the write does not land.
  // The caller treats "" as "not anchored" and leaves it for
  // `retryPendingCommitmentAnchors` to pick up.
  return runResilientWrite("record_ballot_commitment", [
    { value: ballotIdHash, type: "string" },
    { value: commitment, type: "string" },
  ]);
}

/**
 * Read a ballot's on-chain commitment (view call — no transaction).
 * Returns null when the contract is not deployed or the ballot is unknown.
 */
export async function sorobanGetBallotCommitment(
  ballotIdHash: string,
): Promise<string | null> {
  if (!CONTRACT_ID) return null;
  const value = await readContract(CONTRACT_ID, "get_ballot_commitment", [
    { value: ballotIdHash, type: "string" },
  ]);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read on-chain audit counts for a ballot (view call — no transaction).
 */
export async function sorobanGetAuditCounts(ballotIdHash: string): Promise<{
  tokensIssued: number;
  votesCast: number;
  isConsistent: boolean;
} | null> {
  if (!CONTRACT_ID) return null;
  const [tokens, votes, consistent] = await Promise.all([
    readContract(CONTRACT_ID, "get_tokens_issued", [
      { value: ballotIdHash, type: "string" },
    ]),
    readContract(CONTRACT_ID, "get_votes_cast", [
      { value: ballotIdHash, type: "string" },
    ]),
    readContract(CONTRACT_ID, "is_consistent", [
      { value: ballotIdHash, type: "string" },
    ]),
  ]);
  return {
    tokensIssued: (tokens as number) ?? 0,
    votesCast: (votes as number) ?? 0,
    isConsistent: (consistent as boolean) ?? false,
  };
}

/**
 * Verify that a ballot's on-chain audit counters (Soroban `is_consistent`,
 * `get_tokens_issued`, `get_votes_cast`) agree with the database.
 *
 * NOTE: `record_token`/`record_vote` are invoked once per token issued / vote
 * cast regardless of vote *weight*, so the on-chain counters are raw counts —
 * they must be compared against raw DB row counts, not the weighted vote sum
 * used elsewhere for tallying. Comparing against the weighted sum would
 * false-positive-fail on any ballot using weighted voting.
 *
 * This is a post-finalisation transparency check, not a safety gate: it never
 * throws. On any failure (contract not configured, unreachable, or a genuine
 * mismatch) it logs details and resolves to `false`; the caller decides what,
 * if anything, to do with that.
 *
 * @param ballotId - The database ballot ID (will be hashed the same way as
 *                   when it was originally recorded on-chain).
 * @param opts.fetchAuditCounts - Injectable in tests to avoid a live RPC call;
 *                   defaults to `sorobanGetAuditCounts`.
 */
export async function verifyBallotConsistency(
  ballotId: string,
  opts: { fetchAuditCounts?: typeof sorobanGetAuditCounts } = {},
): Promise<boolean> {
  const fetchAuditCounts = opts.fetchAuditCounts ?? sorobanGetAuditCounts;
  const ballotIdHash = crypto
    .createHash("sha256")
    .update(ballotId)
    .digest("hex");

  const [dbTokensIssued, dbVotesCast] = await Promise.all([
    prisma.voterToken.count({ where: { ballotId } }),
    prisma.vote.count({ where: { ballotId } }),
  ]);

  let audit: Awaited<ReturnType<typeof sorobanGetAuditCounts>>;
  try {
    audit = await fetchAuditCounts(ballotIdHash);
  } catch (err) {
    console.error(
      `[Soroban] verifyBallotConsistency error for ballot ${ballotId} ` +
        `(hash ${ballotIdHash}) — db(tokensIssued=${dbTokensIssued}, votesCast=${dbVotesCast}):`,
      err,
    );
    return false;
  }

  if (!audit) {
    console.warn(
      `[Soroban] verifyBallotConsistency skipped for ballot ${ballotId} ` +
        `(hash ${ballotIdHash}) — contract not configured or unreachable. ` +
        `db(tokensIssued=${dbTokensIssued}, votesCast=${dbVotesCast})`,
    );
    return false;
  }

  const matchesDb =
    audit.tokensIssued === dbTokensIssued && audit.votesCast === dbVotesCast;
  const verified = audit.isConsistent && matchesDb;

  const summary =
    `chain(tokensIssued=${audit.tokensIssued}, votesCast=${audit.votesCast}, ` +
    `isConsistent=${audit.isConsistent}) db(tokensIssued=${dbTokensIssued}, votesCast=${dbVotesCast})`;

  if (verified) {
    console.log(
      `[Soroban] verifyBallotConsistency PASSED for ballot ${ballotId} (hash ${ballotIdHash}) — ${summary}`,
    );
  } else {
    console.warn(
      `[Soroban] verifyBallotConsistency FAILED for ballot ${ballotId} (hash ${ballotIdHash}) — ${summary}`,
    );
  }

  return verified;
}

/**
 * Rotate admin key on-chain.
 * Call from POST /api/admin/rotate-key.
 * Uses the safe wrapper so contract/network errors surface as
 * {txHash:"", success:false} rather than a 500 from the admin route.
 */
export async function sorobanRotateAdminKey(
  callerPublicKey: string,
  newAdminPublicKey: string,
): Promise<SorobanInvokeResult> {
  if (!CONTRACT_ID) {
    return { txHash: "", success: false };
  }
  return safeInvokeContract(CONTRACT_ID, "rotate_admin_key", [
    { value: callerPublicKey, type: "string" },
    { value: newAdminPublicKey, type: "string" },
  ]);
}

