/**
 * Contract State Manager (issue #77 — Phase 1).
 *
 * Keeps backend database state and on-chain contract state honest about each
 * other:
 *   - `runContractStateSync()` compares, for every non-draft ballot, the
 *     contract's audit counters (`get_tokens_issued`, `get_votes_cast`,
 *     `is_consistent`) against raw DB row counts. On-chain counters are raw
 *     call counts — they are compared to row COUNTS, never weighted sums.
 *   - Divergences raise an ALERT-level structured log
 *     (`soroban_state_divergence`), bump the `divergencesDetectedTotal`
 *     metric, and are retained in-memory for the admin observability endpoint.
 *   - `startContractStateSync()` runs the above every minute in the background
 *     (tunable via CONTRACT_STATE_SYNC_INTERVAL_MS).
 *
 * All data access is injectable so tests stay hermetic (no DB / no RPC).
 */

import { prisma } from "../prisma/client";
import { config } from "../config";
import { hashIdentifier } from "../utils/crypto";
import { logger } from "../utils/logger";
import { sorobanGetAuditCounts } from "./sorobanService";
import { recordDivergence } from "./sorobanMetrics";

export interface AuditCounts {
  tokensIssued: number;
  votesCast: number;
  isConsistent: boolean;
}

export interface ContractStateDeps {
  /** Read audit counters from the chain (defaults to sorobanGetAuditCounts). */
  fetchAuditCounts: (ballotIdHash: string) => Promise<AuditCounts | null>;
  listBallots: () => Promise<Array<{ id: string }>>;
  countTokensIssued: (ballotId: string) => Promise<number>;
  countVotesCast: (ballotId: string) => Promise<number>;
}

export const defaultContractStateDeps: ContractStateDeps = {
  fetchAuditCounts: sorobanGetAuditCounts,
  listBallots: () =>
    prisma.ballot.findMany({
      where: { status: { not: "DRAFT" }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  countTokensIssued: (ballotId) =>
    prisma.voterToken.count({ where: { ballotId } }),
  countVotesCast: (ballotId) => prisma.vote.count({ where: { ballotId } }),
};

export interface BallotStateReport {
  ballotId: string;
  /** "match" | "diverged" | "chain_unavailable" | "error" */
  outcome: "match" | "diverged" | "chain_unavailable" | "error";
  chain?: AuditCounts;
  db?: { tokensIssued: number; votesCast: number };
  detail?: string;
}

export interface ContractSyncSummary {
  ranAt: string;
  checked: number;
  matched: number;
  diverged: number;
  unavailable: number;
  errored: number;
  reports: BallotStateReport[];
}

const MAX_RETAINED_DIVERGENCES = 100;
let recentDivergences: BallotStateReport[] = [];

/** Compare one ballot's DB counters against the chain. */
export async function syncBallotState(
  ballotId: string,
  deps: ContractStateDeps = defaultContractStateDeps,
): Promise<BallotStateReport> {
  const [dbTokens, dbVotes] = await Promise.all([
    deps.countTokensIssued(ballotId),
    deps.countVotesCast(ballotId),
  ]);
  const ballotIdHash = hashIdentifier(ballotId);

  let chain: AuditCounts | null;
  try {
    chain = await deps.fetchAuditCounts(ballotIdHash);
  } catch (err) {
    return {
      ballotId,
      outcome: "error",
      db: { tokensIssued: dbTokens, votesCast: dbVotes },
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!chain) {
    return {
      ballotId,
      outcome: "chain_unavailable",
      db: { tokensIssued: dbTokens, votesCast: dbVotes },
    };
  }

  const matches =
    chain.tokensIssued === dbTokens &&
    chain.votesCast === dbVotes &&
    chain.isConsistent;

  return {
    ballotId,
    outcome: matches ? "match" : "diverged",
    chain,
    db: { tokensIssued: dbTokens, votesCast: dbVotes },
  };
}

function handleDivergence(report: BallotStateReport): void {
  recentDivergences.unshift(report);
  recentDivergences = recentDivergences.slice(0, MAX_RETAINED_DIVERGENCES);
  recordDivergence();
  // ALERT: backend state diverges from contract state
  logger.error("soroban_state_divergence", {
    alert: "CONTRACT_STATE_DIVERGENCE",
    ballotId: report.ballotId,
    chain: report.chain,
    db: report.db,
    message:
      "Contract state does not match database state — investigate before publishing results.",
  });
}

/** Sync every active/recent ballot; returns an aggregate summary. */
export async function runContractStateSync(
  deps: ContractStateDeps = defaultContractStateDeps,
): Promise<ContractSyncSummary> {
  const summary: ContractSyncSummary = {
    ranAt: new Date().toISOString(),
    checked: 0,
    matched: 0,
    diverged: 0,
    unavailable: 0,
    errored: 0,
    reports: [],
  };

  let ballots: Array<{ id: string }>;
  try {
    ballots = await deps.listBallots();
  } catch (err) {
    logger.error("contract_state_sync_list_failed", {
      error: err instanceof Error ? err.message : err,
    });
    return summary;
  }

  for (const { id } of ballots) {
    const report = await syncBallotState(id, deps);
    summary.checked += 1;
    summary.reports.push(report);
    switch (report.outcome) {
      case "match":
        summary.matched += 1;
        break;
      case "diverged":
        summary.diverged += 1;
        handleDivergence(report);
        break;
      case "chain_unavailable":
        summary.unavailable += 1;
        break;
      case "error":
        summary.errored += 1;
        break;
    }
  }

  if (summary.checked > 0 || summary.errored > 0) {
    logger.info("contract_state_sync_completed", {
      checked: summary.checked,
      matched: summary.matched,
      diverged: summary.diverged,
      unavailable: summary.unavailable,
      errored: summary.errored,
    });
  }

  return summary;
}

// ── Background job lifecycle ──────────────────────────────────────────────────

let syncTimer: NodeJS.Timeout | null = null;

export function startContractStateSync(intervalMs?: number): void {
  if (syncTimer) return;
  const interval = intervalMs ?? config.contractStateSyncIntervalMs;
  logger.info("contract_state_sync_started", { intervalMs: interval });
  syncTimer = setInterval(() => {
    runContractStateSync().catch((err) =>
      logger.error("contract_state_sync_unhandled_error", { error: err }),
    );
  }, interval);
  // Don't hold the process open just for the sync loop.
  syncTimer.unref?.();
}

export function stopContractStateSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    logger.info("contract_state_sync_stopped");
  }
}

/** Recent divergence reports for GET /api/admin/soroban/metrics. */
export function getRecentDivergences(): BallotStateReport[] {
  return [...recentDivergences];
}

/** Test helper. */
export function clearRecentDivergences(): void {
  recentDivergences = [];
}