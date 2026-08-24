/**
 * AnonVote Soroban Service
 *
 * TypeScript service for invoking the AnonVote Soroban smart contract from
 * the AnonVote/core backend.
 *
 * STATUS: Contract written (contracts/anonvote/src/lib.rs) — needs deployment.
 * The manageData-based stellarService is the active blockchain layer.
 * This service is ready to wire once the Soroban contract is deployed.
 *
 * TO ACTIVATE:
 * 1. Build the contract:
 *      cd contracts/anonvote && cargo build --target wasm32-unknown-unknown --release
 * 2. Deploy to testnet:
 *      stellar contract deploy --wasm target/wasm32-unknown-unknown/release/anonvote.wasm --network testnet
 * 3. Initialize:
 *      stellar contract invoke --id <CONTRACT_ID> --network testnet -- initialize --admin <PUBLIC_KEY>
 * 4. Set SOROBAN_CONTRACT_ID=<CONTRACT_ID> in backend/.env
 * 5. Call the helpers below from ballotEngine, identityManager, privacyEngine, resultEngine
 */

import * as StellarSdk from "stellar-sdk";
import { createHash } from "crypto";

// ── SorobanServiceError — throwable typed error for callers ──────────────────

/**
 * Error codes for the throwable SorobanServiceError.
 * Distinct from SorobanErrorCode (which mirrors on-chain contract codes) —
 * these four codes represent the service-level failure categories callers
 * need to distinguish for retry/alerting decisions.
 *
 * Retryability:
 *   NETWORK_ERROR        → true  (transient — network glitch, DNS, TCP reset)
 *   SIMULATION_FAILED    → true  (transient — RPC timeout, overloaded node)
 *   TRANSACTION_FAILED   → false (requires investigation; may be idempotent)
 *   CONTRACT_ERROR       → false (logic error in the call; retry is wrong)
 */
export enum SorobanServiceErrorCode {
  NETWORK_ERROR      = "NETWORK_ERROR",
  CONTRACT_ERROR     = "CONTRACT_ERROR",
  SIMULATION_FAILED  = "SIMULATION_FAILED",
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
}

/**
 * Retryable flag per service error code.
 * Network errors and simulation timeouts are transient — callers should retry
 * them (with backoff). Contract logic errors and transaction failures are
 * deterministic — retrying them will produce the same result.
 */
export const SOROBAN_SERVICE_ERROR_RETRYABLE: Record<SorobanServiceErrorCode, boolean> = {
  [SorobanServiceErrorCode.NETWORK_ERROR]:      true,
  [SorobanServiceErrorCode.SIMULATION_FAILED]:  true,
  [SorobanServiceErrorCode.TRANSACTION_FAILED]: false,
  [SorobanServiceErrorCode.CONTRACT_ERROR]:     false,
};

/**
 * Typed throwable error surfaced by all AnonVote Soroban service helpers.
 *
 * `code`      — service-level failure category (see SorobanServiceErrorCode)
 * `retryable` — true when the failure is transient and retrying with backoff
 *               is safe; false when retrying would produce the same result
 * `contractErrorCode` — the underlying on-chain contract error code when
 *               `code === CONTRACT_ERROR`, undefined otherwise; intended for
 *               internal logging only — do not surface in API responses
 *
 * @example
 * ```ts
 * try {
 *   await sorobanRecordBallot(config, ballotIdHash);
 * } catch (err) {
 *   if (err instanceof SorobanServiceError && err.retryable) {
 *     // enqueue for retry
 *   }
 * }
 * ```
 */
export class SorobanServiceError extends Error {
  readonly code: SorobanServiceErrorCode;
  readonly retryable: boolean;
  /** On-chain contract error code — for internal logging only. */
  readonly contractErrorCode?: SorobanErrorCode;

  constructor(
    code: SorobanServiceErrorCode,
    message: string,
    contractErrorCode?: SorobanErrorCode,
  ) {
    super(message);
    this.name = "SorobanServiceError";
    this.code = code;
    this.retryable = SOROBAN_SERVICE_ERROR_RETRYABLE[code];
    this.contractErrorCode = contractErrorCode;
    // Ensure instanceof works correctly when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Map a failed SorobanInvokeResult onto a SorobanServiceError and throw it.
 * Called by all public helpers after a non-success result from invokeContract.
 * Logs full internal details before throwing — callers should NOT log these
 * details in API responses.
 */
function throwFromInvokeResult(method: string, result: SorobanInvokeResult): never {
  const { errorCode, errorMessage } = result;
  // Internal log — full details are safe here, not exposed to clients
  console.error(
    `[Soroban] ${method} threw SorobanServiceError — code: ${errorCode !== undefined ? SorobanErrorCode[errorCode] : "unknown"}, message: ${errorMessage ?? "(none)"}`,
  );

  if (errorCode === SorobanErrorCode.NetworkError) {
    throw new SorobanServiceError(
      SorobanServiceErrorCode.NETWORK_ERROR,
      "Stellar network or RPC endpoint is unavailable",
    );
  }
  if (errorCode === SorobanErrorCode.SimulationFailed) {
    throw new SorobanServiceError(
      SorobanServiceErrorCode.SIMULATION_FAILED,
      "Transaction simulation failed — the RPC node may be overloaded",
    );
  }
  if (errorCode === SorobanErrorCode.TransactionFailed) {
    throw new SorobanServiceError(
      SorobanServiceErrorCode.TRANSACTION_FAILED,
      "Transaction submission or confirmation failed",
    );
  }
  // All other codes (contract logic errors: BallotNotFound, BallotAlreadyExists, etc.)
  throw new SorobanServiceError(
    SorobanServiceErrorCode.CONTRACT_ERROR,
    errorMessage ?? "Contract call failed",
    errorCode,
  );
}

// ── Error codes matching ContractError enum in lib.rs ─────────────────────────

export enum SorobanErrorCode {
  AdminUnauthorized      = 1,
  AlreadyInitialized     = 2,
  NotInitialized         = 3,
  BallotNotFound         = 4,
  BallotAlreadyExists    = 5,
  ResultAlreadyPublished = 6,
  CounterOverflow        = 7,
  InvalidBallotHash      = 8,
  UpgradeAlreadyScheduled = 9,
  NoUpgradeScheduled    = 10,
  TimeLockNotExpired      = 11,
  BallotExpired           = 12,
  ContractPaused          = 13,
  LimitExceeded           = 14,
  InvalidApprovalConfig   = 15,
  DuplicateApprover       = 16,
  ApproverUnauthorized    = 17,
  OperationNotFound       = 18,
  OperationAlreadyApproved = 19,
  OperationNotPending     = 20,
  OperationExpired        = 21,
  SameAdmin               = 22,
  // Non-contract errors
  SimulationFailed       = 100,
  TransactionFailed      = 101,
  NetworkError           = 102,
  NotConfigured          = 103,
}

const ERROR_MESSAGES: Record<SorobanErrorCode, string> = {
  [SorobanErrorCode.AdminUnauthorized]:      "Caller is not the contract admin",
  [SorobanErrorCode.AlreadyInitialized]:     "Contract already initialized",
  [SorobanErrorCode.NotInitialized]:         "Contract not initialized",
  [SorobanErrorCode.BallotNotFound]:         "Ballot does not exist on-chain",
  [SorobanErrorCode.BallotAlreadyExists]:    "Ballot already recorded by a different admin",
  [SorobanErrorCode.ResultAlreadyPublished]: "A different result hash is already published for this ballot",
  [SorobanErrorCode.CounterOverflow]:        "Counter has reached u32::MAX",
  [SorobanErrorCode.InvalidBallotHash]:      "Ballot hash must not be empty",
  [SorobanErrorCode.UpgradeAlreadyScheduled]: "An upgrade is already scheduled",
  [SorobanErrorCode.NoUpgradeScheduled]:    "No upgrade is currently scheduled",
  [SorobanErrorCode.TimeLockNotExpired]:      "Time lock has not yet expired for the scheduled upgrade",
  [SorobanErrorCode.BallotExpired]:          "Ballot has expired",
  [SorobanErrorCode.ContractPaused]:         "Contract is currently paused",
  [SorobanErrorCode.LimitExceeded]:          "Ballot token or vote limit exceeded",
  [SorobanErrorCode.InvalidApprovalConfig]:  "Invalid M-of-N approval configuration",
  [SorobanErrorCode.DuplicateApprover]:      "Duplicate address in approver list",
  [SorobanErrorCode.ApproverUnauthorized]:   "Caller is not a configured approver for this operation",
  [SorobanErrorCode.OperationNotFound]:      "Operation not found",
  [SorobanErrorCode.OperationAlreadyApproved]: "Approver has already approved this operation",
  [SorobanErrorCode.OperationNotPending]:    "Operation is not in pending status",
  [SorobanErrorCode.OperationExpired]:       "Operation approval window has expired",
  [SorobanErrorCode.SameAdmin]:              "New admin must be different from the current admin",
  [SorobanErrorCode.SimulationFailed]:       "Transaction simulation failed",
  [SorobanErrorCode.TransactionFailed]:      "Transaction submission failed",
  [SorobanErrorCode.NetworkError]:           "Network or RPC error",
  [SorobanErrorCode.NotConfigured]:          "Contract ID or secret key not configured",
};

// ── Public interfaces ─────────────────────────────────────────────────────────

/**
 * Retry/backoff policy for the transaction-confirmation polling loop in
 * invokeContract. Defaults match Stellar's ~5-6s block time closely enough
 * for quick polls while still backing off under load (see DEFAULT_RETRY_POLICY).
 */
export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 10,
  initialDelayMs: 1500,
  backoffMultiplier: 1.5,
};

/**
 * Retry/backoff policy for backend-level RPC operations. This wraps the full
 * contract invocation and is separate from the transaction-confirmation polling
 * loop above.
 */
export interface RpcRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RPC_RETRY_POLICY: RpcRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 250,
  backoffMultiplier: 2,
};

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_POLICY: CircuitBreakerPolicy = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
};

export interface SorobanConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  sourceKeypair: StellarSdk.Keypair;
  /** Optional override for the transaction-confirmation retry/backoff strategy. */
  retryPolicy?: RetryPolicy;
  /** Optional override for full RPC operation retries. */
  rpcRetryPolicy?: RpcRetryPolicy;
  /** Optional override for circuit-breaker behavior. */
  circuitBreakerPolicy?: CircuitBreakerPolicy;
}

export enum BallotState {
  Active          = "Active",
  Expired         = "Expired",
  ResultPublished = "ResultPublished",
  Archived        = "Archived",
}

export interface BallotMetadata {
  created_at: number;
  admin: string;
  is_active: boolean;
}

export interface BallotStats {
  tokens_issued: number;
  votes_cast: number;
  result_hash: string | null;
}

export interface BallotStateSnapshot {
  tokens_issued: number;
  votes_cast: number;
  result_hash: string | null;
  created_at: number;
  admin: string;
  state: BallotState;
  state_updated_at: number;
}

export interface BallotAuditReport {
  admin: string;
  created_at: number;
  expiration_time: number;
  is_consistent: boolean;
  result_hash: string | null;
  state: BallotState;
  tokens_issued: number;
  votes_cast: number;
}

/**
 * Result of a post-finalization consistency check between the on-chain
 * AnonVote contract and the backend database.
 *
 * `consistent` reflects the contract's own `is_consistent` view
 * (tokens_issued == votes_cast on-chain). When `databaseVoteCount` is
 * supplied, the report additionally flags `databaseMatchesChain` so a
 * caller can distinguish "contract counters agree with each other" from
 * "the database tally agrees with the chain" — the two are independent
 * checks and either can fail on its own.
 */
export interface BallotConsistencyReport {
  ballotIdHash: string;
  /** True if the contract's tokens_issued == votes_cast, per is_consistent. */
  consistent: boolean;
  tokensIssuedOnChain: number | null;
  votesCastOnChain: number | null;
  /** Vote count from the backend database, if provided by the caller. */
  votesCastInDatabase: number | null;
  /** True if votesCastInDatabase matches votesCastOnChain; null if not compared. */
  databaseMatchesChain: boolean | null;
  /** Unix seconds when the check was performed. */
  checkedAt: number;
  /** Set when the contract could not be reached or the config is invalid. */
  error?: string;
}

export interface MerkleProof {
  vote_hash: string;
  path: string[];
  index: number;
}

export interface SorobanInvokeResult {
  txHash: string;
  success: boolean;
  returnValue?: unknown;
  errorCode?: SorobanErrorCode;
  errorMessage?: string;
}

export interface EncryptedVote {
  ciphertext: string;
  nonce?: string;
  tag?: string;
  algorithm?: string;
  proof?: unknown;
  voteHash?: string;
}

export interface RecordVoteResult {
  ballotIdHash: string;
  encryptedVote: EncryptedVote;
  txHash: string;
  sorobanTxId: string;
  confirmed: true;
}

export interface TallyResultPayload {
  [key: string]: unknown;
}

export interface TallyResult {
  ballotIdHash: string;
  localResult: TallyResultPayload;
  resultHash: string;
  txHash: string;
  sorobanTxId: string;
  isConsistent: boolean;
}

export interface VoteDatabaseRecord extends RecordVoteResult {
  soroban_tx_id: string;
  storedAt: number;
}

export interface PersistedTallyResult extends TallyResult {
  soroban_tx_id: string;
  is_consistent: boolean;
  storedAt: number;
}

export interface VoteRepository {
  createVote(record: VoteDatabaseRecord): Promise<VoteDatabaseRecord>;
}

export interface TallyRepository {
  createTallyResult(record: PersistedTallyResult): Promise<PersistedTallyResult>;
}

export interface VoteSubmissionInput {
  ballotIdHash: string;
  encryptedVote: EncryptedVote;
}

export interface TallySubmissionInput {
  ballotIdHash: string;
  localResult: TallyResultPayload;
  resultHash?: string;
}

export interface BackendFlowOptions {
  rpcRetryPolicy?: RpcRetryPolicy;
}

export const ANONVOTE_CONTRACT_METHODS = {
  recordVote: "record_vote",
  recordResult: "record_result",
  isConsistent: "is_consistent",
  expireBallot: "expire_ballot",
  getBallotState: "get_ballot_state",
} as const;

export interface SorobanDomainError {
  code: SorobanServiceErrorCode | "UNKNOWN_ERROR";
  message: string;
  retryable: boolean;
  httpStatus: number;
}

export function toSorobanDomainError(err: unknown): SorobanDomainError {
  if (err instanceof SorobanServiceError) {
    const httpStatus = err.retryable
      ? 503
      : err.code === SorobanServiceErrorCode.CONTRACT_ERROR
        ? 409
        : 502;

    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      httpStatus,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Unexpected Soroban service failure",
    retryable: false,
    httpStatus: 500,
  };
}

export type SorobanAuditEventType =
  | "ballot_created"
  | "token_issued"
  | "vote_cast"
  | "result_published"
  | "counter_overflow"
  | "admin_rotated"
  | "upgrade_scheduled"
  | "upgrade_canceled"
  | "upgrade_executed"
  | "state_transition";

export interface SorobanEventFilter {
  eventType?: SorobanAuditEventType | string;
  ballotIdHash?: string;
  startTime?: number;
  endTime?: number;
}

export interface SorobanEventData {
  id: string;
  pagingToken?: string | undefined;
  ledger: number;
  ledgerClosedAt?: string | undefined;
  timestamp?: number | undefined;
  contractId?: string | undefined;
  eventType: SorobanAuditEventType | string;
  ballotIdHash?: string | undefined;
  count?: number | undefined;
  createdAt?: number | undefined;
  admin?: string | undefined;
  previousAdmin?: string | undefined;
  newAdmin?: string | undefined;
  resultHash?: string | undefined;
  newWasmHash?: string | undefined;
  scheduledAt?: number | undefined;
  executableAt?: number | undefined;
  newState?: string | undefined;
  transitionedAt?: number | undefined;
  topics: unknown[];
  value: unknown;
}
// ── Config validation ──────────────────────────────────────────────────────

export interface ConfigError {
  field: "sourceKeypair" | "contractId";
  message: string;
}

export function validateContractId(
  contractId: string,
): { valid: true } | { valid: false; error: ConfigError } {
  const isValid = StellarSdk.StrKey.isValidContract
    ? StellarSdk.StrKey.isValidContract(contractId)
    : (StellarSdk.StrKey as any).isValidContractId(contractId);
  if (!isValid) {
    return {
      valid: false,
      error: {
        field: "contractId",
        message: "Invalid contract ID format",
      },
    };
  }
  return { valid: true };
}

export function validateSorobanConfig(
  config: SorobanConfig,
): { valid: true } | { valid: false; error: ConfigError } {
  if (!config.sourceKeypair || !config.sourceKeypair.publicKey()) {
    return {
      valid: false,
      error: {
        field: "sourceKeypair",
        message: "Invalid sourceKeypair — must be a valid Keypair instance",
      },
    };
  }
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) {
    return contractCheck;
  }
  return { valid: true };
}

export interface BallotLimits {
  maxTokens: number;
  maxVotes: number;
}

function makeError(code: SorobanErrorCode): Pick<SorobanInvokeResult, "errorCode" | "errorMessage"> {
  return { errorCode: code, errorMessage: ERROR_MESSAGES[code] };
}

type CircuitBreakerState = {
  failures: number;
  openedAt: number | null;
};

const circuitBreakers = new Map<string, CircuitBreakerState>();

function circuitBreakerKey(config: SorobanConfig): string {
  return `${config.rpcUrl}|${config.contractId}`;
}

function getCircuitBreakerState(config: SorobanConfig): CircuitBreakerState {
  const key = circuitBreakerKey(config);
  const existing = circuitBreakers.get(key);
  if (existing) return existing;
  const state: CircuitBreakerState = { failures: 0, openedAt: null };
  circuitBreakers.set(key, state);
  return state;
}

function assertCircuitClosed(config: SorobanConfig, operation: string): void {
  const policy = config.circuitBreakerPolicy ?? DEFAULT_CIRCUIT_BREAKER_POLICY;
  const state = getCircuitBreakerState(config);
  if (state.openedAt === null) return;

  const elapsedMs = Date.now() - state.openedAt;
  if (elapsedMs >= policy.resetTimeoutMs) {
    state.openedAt = null;
    state.failures = 0;
    console.warn(`[Soroban] ${operation}: circuit breaker half-open after ${elapsedMs}ms`);
    return;
  }

  throw new SorobanServiceError(
    SorobanServiceErrorCode.NETWORK_ERROR,
    "Soroban RPC circuit breaker is open; retry later",
  );
}

function recordCircuitSuccess(config: SorobanConfig): void {
  const state = getCircuitBreakerState(config);
  state.failures = 0;
  state.openedAt = null;
}

function recordCircuitFailure(config: SorobanConfig, operation: string, err: SorobanServiceError): void {
  if (!err.retryable) return;
  const policy = config.circuitBreakerPolicy ?? DEFAULT_CIRCUIT_BREAKER_POLICY;
  const state = getCircuitBreakerState(config);
  state.failures++;
  if (state.failures >= policy.failureThreshold && state.openedAt === null) {
    state.openedAt = Date.now();
    console.error(
      `[Soroban] ${operation}: circuit breaker opened after ${state.failures} retryable failures for ${config.rpcUrl}`,
    );
  }
}

export function resetSorobanCircuitBreakers(): void {
  circuitBreakers.clear();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSorobanRpcResilience<T>(
  config: SorobanConfig,
  operation: string,
  fn: () => Promise<T>,
  overridePolicy?: RpcRetryPolicy,
): Promise<T> {
  const retryPolicy = overridePolicy ?? config.rpcRetryPolicy ?? DEFAULT_RPC_RETRY_POLICY;
  let attempt = 0;
  let delayMs = retryPolicy.initialDelayMs;

  while (attempt < retryPolicy.maxAttempts) {
    assertCircuitClosed(config, operation);
    attempt++;

    try {
      const result = await fn();
      recordCircuitSuccess(config);
      return result;
    } catch (err) {
      if (!(err instanceof SorobanServiceError)) throw err;

      console.error(
        `[Soroban] ${operation}: attempt ${attempt}/${retryPolicy.maxAttempts} failed — code=${err.code}, retryable=${err.retryable}, contractError=${err.contractErrorCode ?? "none"}`,
      );
      recordCircuitFailure(config, operation, err);

      if (!err.retryable || attempt >= retryPolicy.maxAttempts) {
        throw err;
      }

      await delay(delayMs);
      delayMs = Math.round(delayMs * retryPolicy.backoffMultiplier);
    }
  }

  throw new SorobanServiceError(
    SorobanServiceErrorCode.NETWORK_ERROR,
    "Soroban RPC operation failed after retries",
  );
}

async function readContractOrThrow(
  config: SorobanConfig,
  method: string,
  args: { value: unknown; type: string }[],
  txHash = "",
): Promise<unknown | null> {
  const read = await readContract(config, method, args);
  if (read.errorCode !== undefined) {
    throwFromInvokeResult(method, {
      txHash,
      success: false,
      errorCode: read.errorCode,
      errorMessage: read.errorMessage,
    });
  }
  return read.value;
}

/**
 * Parse a Soroban contract error code out of a simulation error string.
 * Contract errors are surfaced as "Error(Contract, #N)" in the XDR diagnostics.
 */
function parseContractErrorCode(errorText: string): SorobanErrorCode | undefined {
  // Soroban encodes contract errors as "Error(Contract, #<code>)"
  const match = errorText.match(/Error\(Contract,\s*#(\d+)\)/);
  if (match && match[1] !== undefined) {
    const code = parseInt(match[1], 10);
    if (code in SorobanErrorCode) return code as SorobanErrorCode;
  }
  return undefined;
}

const EVENT_SYMBOL_TO_TYPE: Record<string, SorobanAuditEventType> = {
  blt_crtd: "ballot_created",
  ballot_created: "ballot_created",
  tok_issd: "token_issued",
  token_issued: "token_issued",
  vote_cast: "vote_cast",
  res_pub: "result_published",
  result_published: "result_published",
  cnt_ovflw: "counter_overflow",
  counter_overflow: "counter_overflow",
  adm_rotd: "admin_rotated",
  rotated: "admin_rotated",
  admin_rotated: "admin_rotated",
  upg_schd: "upgrade_scheduled",
  upgrade_scheduled: "upgrade_scheduled",
  upg_cncl: "upgrade_canceled",
  upgrade_canceled: "upgrade_canceled",
  upg_excd: "upgrade_executed",
  upgrade_executed: "upgrade_executed",
  stt_chng: "state_transition",
  state_transition: "state_transition",
};

const EVENT_TYPE_TO_SYMBOL: Record<SorobanAuditEventType, string> = {
  ballot_created: "blt_crtd",
  token_issued: "tok_issd",
  vote_cast: "vote_cast",
  result_published: "res_pub",
  counter_overflow: "cnt_ovflw",
  admin_rotated: "rotated",
  upgrade_scheduled: "upg_schd",
  upgrade_canceled: "upg_cncl",
  upgrade_executed: "upg_excd",
  state_transition: "stt_chng",
};

const SOROBAN_EVENT_PAGE_LIMIT = 100;
const SOROBAN_EVENT_MAX_PAGES = 25;

function normalizeEventType(eventType: unknown): SorobanAuditEventType | string {
  const key = String(eventType ?? "").trim();
  return EVENT_SYMBOL_TO_TYPE[key] ?? key;
}

function parseLedgerClosedAt(ledgerClosedAt: unknown): number | undefined {
  if (!ledgerClosedAt) return undefined;
  const parsed = Date.parse(String(ledgerClosedAt));
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

function normalizeTimeFilter(timestamp: number): number {
  return timestamp > 9999999999 ? Math.floor(timestamp / 1000) : timestamp;
}

function scValToNativeSafe(value: unknown): unknown {
  if (!value) return value;
  try {
    return StellarSdk.scValToNative(value as any);
  } catch {
    return value;
  }
}

function getEventTopics(event: any): unknown[] {
  const topics = event.topic ?? event.topics ?? [];
  return Array.isArray(topics) ? topics.map(scValToNativeSafe) : [];
}

function getEventValue(event: any): unknown {
  return scValToNativeSafe(event.value);
}

function getEventTypeFromTopics(topics: unknown[]): SorobanAuditEventType | string {
  // Filter out known namespace prefixes ("audit", "govern", "admin") then
  // look up the remaining topic symbol in the event type map.
  const NAMESPACE_PREFIXES = new Set(["audit", "govern", "admin"]);
  const eventTopic = topics.find((topic) => {
    const value = String(topic ?? "");
    return !NAMESPACE_PREFIXES.has(value) && EVENT_SYMBOL_TO_TYPE[value] !== undefined;
  });
  return normalizeEventType(eventTopic ?? "");
}

function getTupleValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

export function parseSorobanEvent(event: unknown): SorobanEventData {
  const raw = event as any;
  const topics = getEventTopics(raw);
  const value = getEventValue(raw);
  const tuple = getTupleValue(value);
  const eventType = getEventTypeFromTopics(topics);
  const timestamp = parseLedgerClosedAt(raw.ledgerClosedAt);

  const parsed: SorobanEventData = {
    id: String(raw.id ?? raw.pagingToken ?? `${raw.ledger ?? ""}:${topics.join(":")}`),
    pagingToken: raw.pagingToken,
    ledger: Number(raw.ledger ?? 0),
    ledgerClosedAt: raw.ledgerClosedAt,
    timestamp,
    contractId: raw.contractId,
    eventType,
    topics,
    value,
  };

  switch (eventType) {
    case "ballot_created":
      parsed.ballotIdHash = String(tuple[0] ?? "");
      parsed.createdAt = Number(tuple[1] ?? 0);
      parsed.admin = tuple[2] !== undefined ? String(tuple[2]) : undefined;
      break;
    case "token_issued":
    case "vote_cast":
      parsed.ballotIdHash = String(tuple[0] ?? "");
      parsed.count = Number(tuple[1] ?? 0);
      break;
    case "result_published":
      parsed.ballotIdHash = String(tuple[0] ?? "");
      parsed.resultHash = String(tuple[1] ?? "");
      break;
    case "counter_overflow":
      parsed.ballotIdHash = String(tuple[0] ?? "");
      break;
    case "admin_rotated":
      parsed.previousAdmin = tuple[0] !== undefined ? String(tuple[0]) : undefined;
      parsed.newAdmin = tuple[1] !== undefined ? String(tuple[1]) : undefined;
      parsed.transitionedAt = tuple[2] !== undefined ? Number(tuple[2]) : undefined;
      break;
    case "upgrade_scheduled":
      parsed.admin = tuple[0] !== undefined ? String(tuple[0]) : undefined;
      parsed.newWasmHash = tuple[1] !== undefined ? String(tuple[1]) : undefined;
      parsed.scheduledAt = tuple[2] !== undefined ? Number(tuple[2]) : undefined;
      parsed.executableAt = tuple[3] !== undefined ? Number(tuple[3]) : undefined;
      break;
    case "upgrade_canceled":
      parsed.admin = tuple[0] !== undefined ? String(tuple[0]) : undefined;
      parsed.newWasmHash = tuple[1] !== undefined ? String(tuple[1]) : undefined;
      break;
    case "upgrade_executed":
      parsed.newWasmHash = tuple[0] !== undefined ? String(tuple[0]) : undefined;
      break;
    case "state_transition":
      parsed.ballotIdHash = String(tuple[0] ?? "");
      parsed.newState = tuple[1] !== undefined ? String(tuple[1]) : undefined;
      parsed.transitionedAt = tuple[2] !== undefined ? Number(tuple[2]) : undefined;
      break;
  }

  return parsed;
}

function matchesEventFilter(event: SorobanEventData, filter: SorobanEventFilter): boolean {
  if (filter.eventType && event.eventType !== normalizeEventType(filter.eventType)) {
    return false;
  }
  if (filter.ballotIdHash && event.ballotIdHash !== filter.ballotIdHash) {
    return false;
  }
  if (
    filter.startTime !== undefined &&
    event.timestamp !== undefined &&
    event.timestamp < normalizeTimeFilter(filter.startTime)
  ) {
    return false;
  }
  if (
    filter.endTime !== undefined &&
    event.timestamp !== undefined &&
    event.timestamp > normalizeTimeFilter(filter.endTime)
  ) {
    return false;
  }
  return true;
}

function buildTopicFilter(eventType?: string): string[][] | undefined {
  if (!eventType) return undefined;
  const normalized = normalizeEventType(eventType);
  const symbol = EVENT_TYPE_TO_SYMBOL[normalized as SorobanAuditEventType] ?? eventType;

  try {
    const auditTopic = StellarSdk.nativeToScVal("audit", { type: "symbol" as any }).toXDR("base64");
    const eventTopic = StellarSdk.nativeToScVal(symbol, { type: "symbol" as any }).toXDR("base64");
    return [[auditTopic], [eventTopic]];
  } catch {
    return undefined;
  }
}

// ── Core invoke / read ────────────────────────────────────────────────────────

/**
 * Invoke a method on the deployed AnonVote Soroban contract.
 * Parses contract error codes from simulation and surfaces them in the result.
 */
export async function invokeContract(
  config: SorobanConfig,
  method: string,
  args: { value: unknown; type: string }[],
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] ${method}: invalid config — ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }

  try {
    const keypair = config.sourceKeypair;
    const server   = new StellarSdk.SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
    const account  = await server.getAccount(keypair.publicKey());

    const scArgs   = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    const contract  = new StellarSdk.Contract(config.contractId);
    const operation = contract.call(method, ...scArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      // Defensive: isSimulationError type-guards `.error` as present, but RPC
      // responses are not guaranteed to honor that — fall back to a generic
      // message rather than interpolating `undefined` into logs/errorMessage.
      const errorText    = simulation.error || "Unknown simulation error (no detail provided by RPC)";
      const contractCode = parseContractErrorCode(errorText);
      const code    = contractCode ?? SorobanErrorCode.SimulationFailed;
      const message = contractCode
        ? ERROR_MESSAGES[contractCode]
        : errorText;
      console.error(`[Soroban] ${method} simulation failed — code ${code}: ${message}`);
      return { txHash: "", success: false, errorCode: code, errorMessage: message };
    }

    const preparedTx = StellarSdk.SorobanRpc.assembleTransaction(
      tx,
      simulation,
    ).build();

    preparedTx.sign(keypair);
    const sendResult = await server.sendTransaction(preparedTx);

    if (sendResult.status === "ERROR") {
      console.error(`[Soroban] ${method} send failed:`, sendResult.errorResult);
      return { txHash: "", success: false, ...makeError(SorobanErrorCode.TransactionFailed) };
    }

    const txHash      = sendResult.hash;
    const retryPolicy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;

    let getResult = await server.getTransaction(txHash);
    let attempts  = 0;
    let delayMs   = retryPolicy.initialDelayMs;

    while (
      getResult.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < retryPolicy.maxAttempts
    ) {
      console.log(
        `[Soroban] ${method}: tx ${txHash} not yet confirmed — retry ${attempts + 1}/${retryPolicy.maxAttempts} in ${delayMs}ms`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
      getResult = await server.getTransaction(txHash);
      attempts++;
      delayMs = Math.round(delayMs * retryPolicy.backoffMultiplier);
    }

    if (getResult.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      const returnValue = getResult.returnValue
        ? StellarSdk.scValToNative(getResult.returnValue)
        : undefined;
      console.log(`[Soroban] ${method} succeeded — tx: ${txHash}`);
      return { txHash, success: true, returnValue };
    }

    console.error(`[Soroban] ${method} transaction failed:`, getResult);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.TransactionFailed) };
  } catch (err) {
    console.error(`[Soroban] ${method} network error:`, err);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NetworkError) };
  }
}

/**
 * Read contract data without submitting a transaction (view call / simulation only).
 * Returns { value, errorCode, errorMessage } so callers can distinguish "not found"
 * from "network error".
 */
export async function readContract(
  config: SorobanConfig,
  method: string,
  args: { value: unknown; type: string }[],
): Promise<{ value: unknown | null; errorCode?: SorobanErrorCode; errorMessage?: string }> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) {
    console.warn(`[Soroban] ${method}: invalid config — ${contractCheck.error.message}`);
    return { value: null, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  if (!config.sourceKeypair) {
    console.warn(`[Soroban] ${method}: invalid sourceKeypair — must be a valid Keypair instance`);
    return { value: null, ...makeError(SorobanErrorCode.NotConfigured) };
  }

  try {
    const keypair = config.sourceKeypair;
    const server  = new StellarSdk.SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
    const account = await server.getAccount(keypair.publicKey());

    const scArgs  = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    const contract  = new StellarSdk.Contract(config.contractId);
    const operation = contract.call(method, ...scArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      const errorText     = simulation.error || "Unknown simulation error (no detail provided by RPC)";
      const contractCode  = parseContractErrorCode(errorText);
      const code    = contractCode ?? SorobanErrorCode.SimulationFailed;
      const message = contractCode ? ERROR_MESSAGES[contractCode] : errorText;
      console.error(`[Soroban] ${method} read failed — code ${code}: ${message}`);
      return { value: null, errorCode: code, errorMessage: message };
    }

    if (
      StellarSdk.SorobanRpc.Api.isSimulationSuccess(simulation) &&
      simulation.result?.retval
    ) {
      return { value: StellarSdk.scValToNative(simulation.result.retval) };
    }

    return { value: null };
  } catch (err) {
    console.error(`[Soroban] ${method} read error:`, err);
    return { value: null, ...makeError(SorobanErrorCode.NetworkError) };
  }
}

/**
 * Query Soroban RPC contract events and return structured audit events.
 *
 * RPC is narrowed to this contract and, when possible, the requested audit
 * event topic. Ballot and time range filters are then applied client-side so
 * callers can combine filters without manual iteration.
 */
export async function sorobanFilterEvents(
  config: SorobanConfig,
  filter: SorobanEventFilter = {},
): Promise<SorobanEventData[]> {
  if (!config.contractId) {
    console.warn("[Soroban] sorobanFilterEvents: no contract ID, skipping event query");
    return [];
  }

  try {
    const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
    const events: SorobanEventData[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const eventFilter: any = {
        type: "contract",
        contractIds: [config.contractId],
      };
      const topics = buildTopicFilter(filter.eventType);
      if (topics) eventFilter.topics = topics;

      const response = await (server as any).getEvents({
        startLedger: cursor ? undefined : 0,
        filters: [eventFilter],
        pagination: {
          cursor,
          limit: SOROBAN_EVENT_PAGE_LIMIT,
        },
      });

      const pageEvents = Array.isArray(response.events) ? response.events : [];
      for (const rawEvent of pageEvents) {
        const parsed = parseSorobanEvent(rawEvent);
        if (matchesEventFilter(parsed, filter)) {
          events.push(parsed);
        }
      }

      const lastEvent = pageEvents[pageEvents.length - 1];
      const nextCursor = response.cursor
        ?? (pageEvents.length === SOROBAN_EVENT_PAGE_LIMIT ? lastEvent?.pagingToken : undefined);
      cursor = nextCursor && nextCursor !== cursor ? nextCursor : undefined;
      pages++;
    } while (cursor && pages < SOROBAN_EVENT_MAX_PAGES);

    return events;
  } catch (err) {
    console.error("[Soroban] sorobanFilterEvents query failed:", err);
    return [];
  }
}

// ── AnonVote contract helpers ─────────────────────────────────────────────────

/**
 * Record a ballot creation on-chain.
 * Idempotent: if the same ballot was already recorded by this admin, the
 * contract returns success without a state change.
 *
 * Returns the full SorobanInvokeResult (not just txHash) so callers can
 * distinguish "not configured" from "ballot already exists under a
 * different admin" from "network error" — see SorobanErrorCode.
 */
export async function sorobanRecordBallot(
  config: SorobanConfig,
  ballotIdHash: string,
  limits?: BallotLimits,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanRecordBallot: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const ballotLimits = limits ?? { maxTokens: 10000, maxVotes: 10000 };
  const result = await invokeContract(config, "record_ballot", [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
    {
      value: { max_tokens: ballotLimits.maxTokens, max_votes: ballotLimits.maxVotes },
      type: "map",
    },
  ]);
  if (!result.success) {
    throwFromInvokeResult("sorobanRecordBallot", result);
  }
  return result;
}

/**
 * Record a batch of ballots atomically in a single transaction.
 *
 * The contract validates every ballot before writing any of them, so the
 * batch either fully succeeds or fully fails (all-or-nothing semantics).
 *
 * On success, `returnValue` is the array of ballot ID hashes that were
 * recorded, in the same order they were supplied.
 *
 * @param ballots - Array of `{ ballotIdHash, limits }` entries to record.
 *                  Defaults to `{ maxTokens: 10000, maxVotes: 10000 }` when
 *                  `limits` is omitted for a given entry.
 */
export async function sorobanRecordBallotsBatch(
  config: SorobanConfig,
  ballots: Array<{ ballotIdHash: string; limits?: BallotLimits }>,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanRecordBallotsBatch: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }

  const caller = config.sourceKeypair.publicKey();

  // Build the Vec<(String, BallotLimits)> argument expected by record_ballots_batch.
  // Each element is a 2-tuple encoded as a map with the Soroban SDK.
  const ballotsArg = ballots.map(({ ballotIdHash, limits: l }) => {
    const ballotLimits = l ?? { maxTokens: 10000, maxVotes: 10000 };
    return [
      ballotIdHash,
      { max_tokens: ballotLimits.maxTokens, max_votes: ballotLimits.maxVotes },
    ];
  });

  const result = await invokeContract(config, "record_ballots_batch", [
    { value: caller, type: "address" },
    { value: ballotsArg, type: "vec" },
  ]);

  if (!result.success) {
    throwFromInvokeResult("sorobanRecordBallotsBatch", result);
  }

  return result;
}

/**
 * Record a token issuance on-chain.
 * Returns the full SorobanInvokeResult — see sorobanRecordBallot doc.
 */
export async function sorobanRecordToken(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanRecordToken: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, "record_token", [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
  ]);
  if (!result.success) {
    throwFromInvokeResult("sorobanRecordToken", result);
  }
  return result;
}

/**
 * Record a vote cast on-chain.
 * Returns the full SorobanInvokeResult — see sorobanRecordBallot doc.
 */
export async function sorobanRecordVote(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanRecordVote: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, ANONVOTE_CONTRACT_METHODS.recordVote, [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
  ]);
  if (!result.success) {
    throwFromInvokeResult("sorobanRecordVote", result);
  }
  return result;
}

/**
 * Record a result publication on-chain.
 * Handles ResultAlreadyPublished idempotency: if the same hash is already
 * published, treats the call as success (txHash: "" since no new tx was sent).
 * Returns the full SorobanInvokeResult — see sorobanRecordBallot doc.
 */
export async function sorobanRecordResult(
  config: SorobanConfig,
  ballotIdHash: string,
  resultHash: string,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanRecordResult: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, ANONVOTE_CONTRACT_METHODS.recordResult, [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
    { value: resultHash, type: "string" },
  ]);

  if (!result.success && result.errorCode === SorobanErrorCode.ResultAlreadyPublished) {
    // Check if the on-chain hash matches ours (idempotent re-record)
    const { value: onChainHash } = await readContract(config, "get_result_hash", [
      { value: ballotIdHash, type: "string" },
    ]);
    if (onChainHash === resultHash) {
      console.log(
        `[Soroban] sorobanRecordResult: result already published with matching hash — treating as success`,
      );
      return { txHash: "", success: true, returnValue: onChainHash };
    }
    // Conflicting result — not retryable, log internally and throw
    console.error(
      `[Soroban] sorobanRecordResult: conflicting result already published for ballot ${ballotIdHash}`,
    );
    throwFromInvokeResult("sorobanRecordResult", result);
  }

  if (!result.success) {
    throwFromInvokeResult("sorobanRecordResult", result);
  }
  return result;
}

/**
 * Expire a ballot on-chain (admin only).
 *
 * This is the single authoritative expiration transition: the contract
 * atomically moves `BallotState` from `Active` to `Expired` and every
 * subsequent `record_vote` / `record_token` call for this ballot is
 * rejected with `BallotExpired`. Calling this on a ballot that is already
 * `Expired` or `ResultPublished` returns `BallotExpired` rather than
 * silently succeeding, so the transition can never be re-applied.
 *
 * The backend MUST call this (rather than only updating its own database
 * row) to expire a ballot, and should treat the contract's state — read via
 * `sorobanGetBallotState` / `sorobanIsBallotExpired` — as the source of
 * truth, syncing its own status field to match rather than diverging from it.
 */
export async function sorobanExpireBallot(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanExpireBallot: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, ANONVOTE_CONTRACT_METHODS.expireBallot, [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
  ]);
  if (!result.success) {
    throwFromInvokeResult("sorobanExpireBallot", result);
  }
  return result;
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeForHash((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Compute a deterministic SHA-256 hash of a local tally result.
 *
 * Object keys are sorted recursively before serialization so the hash is
 * stable regardless of the property insertion order in the payload. This
 * canonical hash is the value passed to `sorobanRecordResult` / `tally` and
 * stored alongside the ballot record so the published on-chain commitment can
 * be re-verified independently at any time.
 *
 * @param localResult - The tally result payload to hash.
 * @returns Lowercase hex SHA-256 digest (64 characters).
 *
 * @example
 * ```ts
 * const resultHash = hashTallyResult({ yesVotes: 42, noVotes: 8, abstain: 0 });
 * await sorobanRecordResult(config, ballotIdHash, resultHash);
 * ```
 */
export function hashTallyResult(localResult: TallyResultPayload): string {
  const canonical = JSON.stringify(normalizeForHash(localResult));
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Backend-facing vote submission hook.
 *
 * This waits for Soroban confirmation and returns the Stellar tx hash that the
 * backend must persist as `soroban_tx_id` with the encrypted vote row.
 */
export async function recordVote(
  config: SorobanConfig,
  ballotIdHash: string,
  encryptedVote: EncryptedVote,
  options: BackendFlowOptions = {},
): Promise<RecordVoteResult> {
  const result = await withSorobanRpcResilience(
    config,
    "recordVote",
    () => sorobanRecordVote(config, ballotIdHash),
    options.rpcRetryPolicy,
  );

  return {
    ballotIdHash,
    encryptedVote,
    txHash: result.txHash,
    sorobanTxId: result.txHash,
    confirmed: true,
  };
}

/**
 * Backend-facing tally hook.
 *
 * The current deployed contract names result publication `record_result`
 * rather than `tally_vote`; this function wires the tally flow to that real
 * contract method and then reads `is_consistent` from Soroban.
 */
export async function tally(
  config: SorobanConfig,
  ballotIdHash: string,
  localResult: TallyResultPayload,
  options: BackendFlowOptions & { resultHash?: string } = {},
): Promise<TallyResult> {
  const resultHash = options.resultHash ?? hashTallyResult(localResult);

  const publishResult = await withSorobanRpcResilience(
    config,
    "tally",
    () => sorobanRecordResult(config, ballotIdHash, resultHash),
    options.rpcRetryPolicy,
  );

  const isConsistent = await withSorobanRpcResilience(
    config,
    "tally.is_consistent",
    () =>
      readContractOrThrow(
        config,
        ANONVOTE_CONTRACT_METHODS.isConsistent,
        [{ value: ballotIdHash, type: "string" }],
        publishResult.txHash,
      ),
    options.rpcRetryPolicy,
  );

  return {
    ballotIdHash,
    localResult,
    resultHash,
    txHash: publishResult.txHash,
    sorobanTxId: publishResult.txHash,
    isConsistent: isConsistent === true,
  };
}

/**
 * Submit a vote using the required ordering: validate/encrypt upstream, record
 * the vote on Soroban, wait for confirmation, then persist the database row
 * with `soroban_tx_id`.
 *
 * Expiration is enforced atomically by the contract's `record_vote` itself
 * (it rejects with `BallotExpired` once `BallotState` is `Expired`), so an
 * expired ballot never reaches `repository.createVote` — the on-chain call
 * throws first via `recordVote` -> `throwFromInvokeResult`. Callers that
 * want to keep their own database status in sync with the contract (e.g. to
 * avoid even attempting a submission, or to reconcile after an admin calls
 * `sorobanExpireBallot`) should poll `sorobanIsBallotExpired` /
 * `sorobanGetBallotState` independently — the contract state is always the
 * source of truth.
 */
export async function submitVoteOnChainFirst(
  config: SorobanConfig,
  repository: VoteRepository,
  input: VoteSubmissionInput,
  options: BackendFlowOptions = {},
): Promise<VoteDatabaseRecord> {
  const onChain = await recordVote(
    config,
    input.ballotIdHash,
    input.encryptedVote,
    options,
  );

  return repository.createVote({
    ...onChain,
    soroban_tx_id: onChain.sorobanTxId,
    storedAt: Date.now(),
  });
}

/**
 * Publish a local tally on-chain and persist both the Soroban tx hash and the
 * contract consistency verdict in the TallyResult store.
 */
export async function publishTallyOnChain(
  config: SorobanConfig,
  repository: TallyRepository,
  input: TallySubmissionInput,
  options: BackendFlowOptions = {},
): Promise<PersistedTallyResult> {
  const onChain = await tally(config, input.ballotIdHash, input.localResult, {
    ...options,
    resultHash: input.resultHash,
  });

  return repository.createTallyResult({
    ...onChain,
    soroban_tx_id: onChain.sorobanTxId,
    is_consistent: onChain.isConsistent,
    storedAt: Date.now(),
  });
}

/**
 * Rotate the contract admin via M-of-N governance (creates a pending operation).
 * Must be called by the current admin. Rejects if new_admin equals current admin (SameAdmin).
 * Returns the operation ID wrapped in SorobanInvokeResult.returnValue on success.
 */
export async function sorobanRotateAdmin(
  config: SorobanConfig,
  newAdminPublicKey: string,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanRotateAdmin: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, "rotate_admin", [
    { value: caller, type: "address" },
    { value: newAdminPublicKey, type: "address" },
  ]);
  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanRotateAdmin failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
  }
  return result;
}

/**
 * Read the on-chain admin rotation history (view call — no transaction).
 * Returns records in chronological order (oldest first).
 * Returns null if config is invalid or the query fails.
 */
export async function sorobanGetRotationHistory(
  config: SorobanConfig,
): Promise<Array<{ oldAdmin: string; newAdmin: string; rotatedAt: number }> | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "get_rotation_history", []);
  if (errorCode !== undefined) return null;
  const raw = value as Array<{ old_admin: string; new_admin: string; rotated_at: number }> | null;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    oldAdmin: String(r.old_admin ?? ""),
    newAdmin: String(r.new_admin ?? ""),
    rotatedAt: Number(r.rotated_at ?? 0),
  }));
}

/**
 * Transition a ballot's lifecycle state on-chain (admin only).
 * Allowed transitions: Active → ResultPublished → Archived.
 * Returns InvalidStateTransition for any other transition, including backward moves.
 */
export async function sorobanTransitionBallotState(
  config: SorobanConfig,
  ballotIdHash: string,
  newState: BallotState,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanTransitionBallotState: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, "transition_ballot_state", [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
    { value: newState, type: "symbol" },
  ]);
  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanTransitionBallotState failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
  }
  return result;
}

/**
 * Read on-chain audit counts for a ballot (view call — no transaction).
 *
 * get_tokens_issued / get_votes_cast return Option<u32> on the contract side.
 * Soroban encodes None as ScVal::Void, which scValToNative decodes to
 * `undefined` — not `null` — so we normalize that here to a single documented
 * "missing" sentinel (null) rather than leaking the undefined/null mismatch
 * to callers.
 */
export async function sorobanGetAuditCounts(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<{
  tokensIssued: number | null;
  votesCast: number | null;
  isConsistent: boolean;
} | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const [tokensRes, votesRes, consistentRes] = await Promise.all([
    readContract(config, "get_tokens_issued", [{ value: ballotIdHash, type: "string" }]),
    readContract(config, "get_votes_cast",    [{ value: ballotIdHash, type: "string" }]),
    readContract(config, "is_consistent",     [{ value: ballotIdHash, type: "string" }]),
  ]);
  return {
    tokensIssued: (tokensRes.value ?? null) as number | null,
    votesCast:    (votesRes.value  ?? null) as number | null,
    isConsistent: (consistentRes.value as boolean) ?? false,
  };
}

/**
 * Verify that a ballot's on-chain vote count is consistent, calling the
 * contract's `is_consistent` view function (tokens_issued == votes_cast).
 *
 * This is a read-only, on-demand check intended to run as a post-finalization
 * step (e.g. right after a tally is written to the database) — it never
 * submits a transaction and never throws. If the contract is unreachable or
 * misconfigured, `error` is set and `consistent` defaults to `false` so a
 * caller cannot mistake "couldn't check" for "verified consistent".
 *
 * Pass `databaseVoteCount` (the vote count the backend tallied) to also get
 * an independent `databaseMatchesChain` comparison against the on-chain
 * vote count, logged alongside the on-chain result for transparency.
 *
 * Verification failures (or unreachable contracts) are logged as warnings/
 * errors but never throw — callers should treat this as informational and
 * must not fail tally finalization on a `false` or errored result.
 */
export async function verifyBallotConsistency(
  config: SorobanConfig,
  ballotIdHash: string,
  databaseVoteCount?: number,
): Promise<BallotConsistencyReport> {
  const checkedAt = Math.floor(Date.now() / 1000);

  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) {
    console.warn(
      `[Soroban] verifyBallotConsistency: ${contractCheck.error.message} (ballot ${ballotIdHash})`,
    );
    return {
      ballotIdHash,
      consistent: false,
      tokensIssuedOnChain: null,
      votesCastOnChain: null,
      votesCastInDatabase: databaseVoteCount ?? null,
      databaseMatchesChain: null,
      checkedAt,
      error: contractCheck.error.message,
    };
  }

  const [tokensRes, votesRes, consistentRes] = await Promise.all([
    readContract(config, "get_tokens_issued", [{ value: ballotIdHash, type: "string" }]),
    readContract(config, "get_votes_cast", [{ value: ballotIdHash, type: "string" }]),
    readContract(config, "is_consistent", [{ value: ballotIdHash, type: "string" }]),
  ]);

  const failedRead = [tokensRes, votesRes, consistentRes].find(
    (r) => r.errorCode !== undefined,
  );
  if (failedRead) {
    console.error(
      `[Soroban] verifyBallotConsistency: contract unreachable for ballot ${ballotIdHash} — ${failedRead.errorMessage}`,
    );
    return {
      ballotIdHash,
      consistent: false,
      tokensIssuedOnChain: null,
      votesCastOnChain: null,
      votesCastInDatabase: databaseVoteCount ?? null,
      databaseMatchesChain: null,
      checkedAt,
      error: failedRead.errorMessage ?? "Contract read failed",
    };
  }

  const tokensIssuedOnChain = (tokensRes.value ?? null) as number | null;
  const votesCastOnChain = (votesRes.value ?? null) as number | null;
  const consistent = (consistentRes.value as boolean) ?? false;

  const databaseMatchesChain =
    databaseVoteCount === undefined || votesCastOnChain === null
      ? null
      : databaseVoteCount === votesCastOnChain;

  const summary =
    `tokens_issued(chain)=${tokensIssuedOnChain}, votes_cast(chain)=${votesCastOnChain}` +
    (databaseVoteCount !== undefined ? `, votes_cast(db)=${databaseVoteCount}` : "");

  if (consistent) {
    console.log(
      `[Soroban] verifyBallotConsistency: ballot ${ballotIdHash} is consistent on-chain — ${summary}`,
    );
  } else {
    console.warn(
      `[Soroban] verifyBallotConsistency: ballot ${ballotIdHash} is INCONSISTENT on-chain — ${summary}`,
    );
  }

  if (databaseMatchesChain === false) {
    console.warn(
      `[Soroban] verifyBallotConsistency: database vote count (${databaseVoteCount}) does not match on-chain vote count (${votesCastOnChain}) for ballot ${ballotIdHash}`,
    );
  }

  return {
    ballotIdHash,
    consistent,
    tokensIssuedOnChain,
    votesCastOnChain,
    votesCastInDatabase: databaseVoteCount ?? null,
    databaseMatchesChain,
    checkedAt,
  };
}

/**
 * Check whether a result has already been published for a ballot (read-only).
 * Use this to query finality before calling sorobanRecordResult.
 * Returns true if a result hash exists on-chain, false if not yet published.
 * Returns null if the config is invalid or the query fails.
 */
export async function sorobanResultExists(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<boolean | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "result_exists", [
    { value: ballotIdHash, type: "string" },
  ]);
  if (errorCode !== undefined) return null;
  return (value as boolean) ?? false;
}

/**
 * Get complete ballot state snapshot (single read call).
 */
export async function sorobanGetBallotState(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<BallotStateSnapshot | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value } = await readContract(config, ANONVOTE_CONTRACT_METHODS.getBallotState, [
    { value: ballotIdHash, type: "string" },
  ]);
  return value as BallotStateSnapshot | null;
}

/**
 * Read-only check of whether a ballot is `Expired` on-chain.
 *
 * The backend should call this (or inspect `sorobanGetBallotState`) before
 * accepting a vote submission, rather than relying solely on its own
 * database status — the contract's `BallotState` is the single source of
 * truth for expiration. Returns `null` if the config is invalid, the query
 * fails, or the ballot does not exist (an unknown ballot is never
 * "expired" — it is simply not found, which callers should handle
 * separately via `BallotNotFound`).
 */
export async function sorobanIsBallotExpired(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<boolean | null> {
  const snapshot = await sorobanGetBallotState(config, ballotIdHash);
  if (snapshot === null) return null;
  return snapshot.state === BallotState.Expired;
}

/**
 * Returns the ledger timestamp (Unix seconds) captured when the ballot was
 * first recorded on-chain via record_ballot().
 *
 * The value is immutable — it is set exactly once and never updated by
 * subsequent operations (token issuance, votes, result publication, etc.).
 * Returns null if the ballot does not exist or the config / RPC call fails.
 *
 * Stellar block times are ~5-6 seconds, so timestamps have that granularity.
 */
export async function sorobanGetBallotCreatedAt(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<number | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "get_ballot_created_at", [
    { value: ballotIdHash, type: "string" },
  ]);
  if (errorCode !== undefined) return null;
  // Contract returns Option<u64>: None → undefined/null, Some(ts) → number
  if (value === null || value === undefined) return null;
  return Number(value);
}

/**
 * Get complete ballot consistency audit report (single read call).
 */
export async function sorobanGetAuditReport(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<BallotAuditReport | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value } = await readContract(config, "get_audit_report", [
    { value: ballotIdHash, type: "string" },
  ]);
  return value as BallotAuditReport | null;
}

/**
 * Verify a Merkle proof of a vote against the published result hash.
 */
export async function sorobanVerifyResultProof(
  config: SorobanConfig,
  ballotIdHash: string,
  voteMerkleProof: MerkleProof,
  resultHash: string,
): Promise<boolean | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;

  const voteMerkleProofSc = {
    index: voteMerkleProof.index,
    path: voteMerkleProof.path.map(p => Buffer.from(p, "hex")),
    vote_hash: Buffer.from(voteMerkleProof.vote_hash, "hex"),
  };

  const { value } = await readContract(config, "verify_result_proof", [
    { value: ballotIdHash, type: "string" },
    { value: voteMerkleProofSc, type: "map" },
    { value: resultHash, type: "string" },
  ]);
  return value as boolean | null;
}

/**
 * Get full ballot metadata (created_at, admin, is_active).
 * Returns null if the config is invalid or the query fails.
 */
export async function sorobanGetBallotMetadata(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<BallotMetadata | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "get_ballot_metadata", [
    { value: ballotIdHash, type: "string" },
  ]);
  if (errorCode !== undefined) return null;
  const raw = value as { created_at: number; admin: string; is_active: boolean } | null;
  if (!raw) return null;
  return {
    created_at: Number(raw.created_at ?? 0),
    admin: String(raw.admin ?? ""),
    is_active: raw.is_active === true,
  };
}

/**
 * Get the semantic version embedded in the deployed contract.
 * Returns null if the config is invalid or the query fails.
 */
export async function sorobanGetVersion(
  config: SorobanConfig,
): Promise<string | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "get_version", []);
  if (errorCode !== undefined || value === null || value === undefined) return null;
  return String(value);
}

/**
 * Get ballot statistics (tokens_issued, votes_cast, result_hash).
 * Returns null if the config is invalid or the query fails.
 */
export async function sorobanGetBallotStats(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<BallotStats | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "get_ballot_stats", [
    { value: ballotIdHash, type: "string" },
  ]);
  if (errorCode !== undefined) return null;
  const raw = value as { tokens_issued: number; votes_cast: number; result_hash: string | null } | null;
  if (!raw) return null;
  return {
    tokens_issued: Number(raw.tokens_issued ?? 0),
    votes_cast: Number(raw.votes_cast ?? 0),
    result_hash: raw.result_hash ?? null,
  };
}

/**
 * Get the list of all ballot ID hashes recorded on-chain.
 * Returns an empty array if no ballots exist or config is invalid.
 */
export async function sorobanGetAllBallots(
  config: SorobanConfig,
): Promise<string[]> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return [];
  const { value, errorCode } = await readContract(config, "get_all_ballots", []);
  if (errorCode !== undefined) return [];
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * Quick check: returns true if the ballot exists and is active.
 * Returns null if the config is invalid or the query fails.
 */
export async function sorobanBallotIsActive(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<boolean | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "ballot_is_active", [
    { value: ballotIdHash, type: "string" },
  ]);
  if (errorCode !== undefined) return null;
  return (value as boolean) ?? false;
}

/**
 * Check if a result has been published (ballot is finalized).
 * Returns null if the config is invalid or the query fails.
 */
export async function sorobanIsBallotFinalized(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<boolean | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value, errorCode } = await readContract(config, "is_ballot_finalized", [
    { value: ballotIdHash, type: "string" },
  ]);
  if (errorCode !== undefined) return null;
  return (value as boolean) ?? false;
}

/**
 * Get complete ballot expiration (single read call).
 */
export async function sorobanGetBallotExpiration(
  config: SorobanConfig,
  ballotIdHash: string,
): Promise<boolean | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value } = await readContract(config, "get_ballot_expiration", [
    { value: ballotIdHash, type: "string" },
  ]);
  return value as boolean | null;
}

// ── Upgrade helpers ──────────────────────────────────────────────────────────

/**
 * Schedule a contract upgrade (admin only).
 */
export async function sorobanScheduleUpgrade(
  config: SorobanConfig,
  newWasmHash: string,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanScheduleUpgrade: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, "schedule_upgrade", [
    { value: caller, type: "address" },
    { value: newWasmHash, type: "bytes" },
  ]);
  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanScheduleUpgrade failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
  }
  return result;
}

/**
 * Cancel a pending upgrade (admin only).
 */
export async function sorobanCancelUpgrade(
  config: SorobanConfig,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanCancelUpgrade: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const caller = config.sourceKeypair.publicKey();
  const result = await invokeContract(config, "cancel_upgrade", [
    { value: caller, type: "address" },
  ]);
  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanCancelUpgrade failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
  }
  return result;
}

/**
 * Execute a scheduled upgrade (anyone can call, after time lock).
 */
export async function sorobanExecuteUpgrade(
  config: SorobanConfig,
): Promise<SorobanInvokeResult> {
  const configCheck = validateSorobanConfig(config);
  if (!configCheck.valid) {
    console.warn(`[Soroban] sorobanExecuteUpgrade: ${configCheck.error.message}`);
    return { txHash: "", success: false, ...makeError(SorobanErrorCode.NotConfigured) };
  }
  const result = await invokeContract(config, "execute_upgrade", []);
  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanExecuteUpgrade failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
  }
  return result;
}

/**
 * Get pending upgrade info (if any).
 */
export async function sorobanGetPendingUpgrade(
  config: SorobanConfig,
): Promise<{ newWasmHash: string; scheduledAt: number; executableAt: number } | null> {
  const contractCheck = validateContractId(config.contractId);
  if (!contractCheck.valid) return null;
  const { value } = await readContract(config, "get_pending_upgrade", []);
  return value as { newWasmHash: string; scheduledAt: number; executableAt: number } | null;
}

// ── Config helpers ────────────────────────────────────────────────────────────

/**
 * Create a SorobanConfig pre-configured for Stellar testnet with sensible
 * defaults. Callers can override any field after creation.
 *
 * @example
 * ```ts
 * const config = createDefaultTestnetConfig({
 *   contractId: "CCX…",
 *   sourceKeypair: Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!),
 * });
 * ```
 */
export function createDefaultTestnetConfig(params: {
  contractId: string;
  sourceKeypair: StellarSdk.Keypair;
  retryPolicy?: RetryPolicy;
}): SorobanConfig {
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: StellarSdk.Networks.TESTNET,
    contractId: params.contractId,
    sourceKeypair: params.sourceKeypair,
    retryPolicy: params.retryPolicy,
  };
}

/**
 * Create a SorobanConfig pre-configured for Stellar mainnet with sensible
 * defaults. Callers can override any field after creation.
 *
 * @example
 * ```ts
 * const config = createDefaultMainnetConfig({
 *   contractId: "CCX…",
 *   sourceKeypair: Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!),
 * });
 * ```
 */
export function createDefaultMainnetConfig(params: {
  contractId: string;
  sourceKeypair: StellarSdk.Keypair;
  retryPolicy?: RetryPolicy;
}): SorobanConfig {
  return {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: StellarSdk.Networks.PUBLIC,
    contractId: params.contractId,
    sourceKeypair: params.sourceKeypair,
    retryPolicy: params.retryPolicy,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a Soroban service instance bound to a specific config.
 *
 * All returned functions are pre-bound to `config` so callers don't need to
 * pass it on every invocation.
 *
 * @example
 * ```ts
 * import { createSorobanService, createDefaultTestnetConfig } from "./sorobanService";
 * import { Keypair } from "stellar-sdk";
 *
 * const sourceKeypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!);
 * const config = createDefaultTestnetConfig({
 *   contractId: process.env.SOROBAN_CONTRACT_ID!,
 *   sourceKeypair,
 * });
 * const service = createSorobanService(config);
 *
 * await service.sorobanRecordBallot("hash123");
 * ```
 */
export function createSorobanService(config: SorobanConfig) {
  return {
    invokeContract: (method: string, args: { value: unknown; type: string }[]) =>
      invokeContract(config, method, args),

    readContract: (method: string, args: { value: unknown; type: string }[]) =>
      readContract(config, method, args),

    sorobanRecordBallot: (ballotIdHash: string, limits?: BallotLimits) =>
      sorobanRecordBallot(config, ballotIdHash, limits),

    sorobanRecordBallotsBatch: (
      ballots: Array<{ ballotIdHash: string; limits?: BallotLimits }>,
    ) => sorobanRecordBallotsBatch(config, ballots),

    sorobanRecordToken: (ballotIdHash: string) =>
      sorobanRecordToken(config, ballotIdHash),

    sorobanRecordVote: (ballotIdHash: string) =>
      sorobanRecordVote(config, ballotIdHash),

    recordVote: (ballotIdHash: string, encryptedVote: EncryptedVote, options?: BackendFlowOptions) =>
      recordVote(config, ballotIdHash, encryptedVote, options),

    sorobanRecordResult: (ballotIdHash: string, resultHash: string) =>
      sorobanRecordResult(config, ballotIdHash, resultHash),

    sorobanExpireBallot: (ballotIdHash: string) =>
      sorobanExpireBallot(config, ballotIdHash),

    sorobanIsBallotExpired: (ballotIdHash: string) =>
      sorobanIsBallotExpired(config, ballotIdHash),

    tally: (
      ballotIdHash: string,
      localResult: TallyResultPayload,
      options?: BackendFlowOptions & { resultHash?: string },
    ) => tally(config, ballotIdHash, localResult, options),

    submitVoteOnChainFirst: (
      repository: VoteRepository,
      input: VoteSubmissionInput,
      options?: BackendFlowOptions,
    ) => submitVoteOnChainFirst(config, repository, input, options),

    publishTallyOnChain: (
      repository: TallyRepository,
      input: TallySubmissionInput,
      options?: BackendFlowOptions,
    ) => publishTallyOnChain(config, repository, input, options),

    sorobanFilterEvents: (filter?: SorobanEventFilter) =>
      sorobanFilterEvents(config, filter),

    sorobanRotateAdmin: (newAdminPublicKey: string) =>
      sorobanRotateAdmin(config, newAdminPublicKey),

    sorobanGetRotationHistory: () =>
      sorobanGetRotationHistory(config),

    sorobanTransitionBallotState: (ballotIdHash: string, newState: BallotState) =>
      sorobanTransitionBallotState(config, ballotIdHash, newState),

    sorobanGetAuditCounts: (ballotIdHash: string) =>
      sorobanGetAuditCounts(config, ballotIdHash),

    sorobanResultExists: (ballotIdHash: string) =>
      sorobanResultExists(config, ballotIdHash),

    sorobanGetBallotState: (ballotIdHash: string) =>
      sorobanGetBallotState(config, ballotIdHash),

    sorobanGetBallotCreatedAt: (ballotIdHash: string) =>
      sorobanGetBallotCreatedAt(config, ballotIdHash),

    sorobanGetAuditReport: (ballotIdHash: string) =>
      sorobanGetAuditReport(config, ballotIdHash),

    sorobanVerifyResultProof: (
      ballotIdHash: string,
      voteMerkleProof: MerkleProof,
      resultHash: string,
    ) => sorobanVerifyResultProof(config, ballotIdHash, voteMerkleProof, resultHash),

    sorobanGetBallotMetadata: (ballotIdHash: string) =>
      sorobanGetBallotMetadata(config, ballotIdHash),

    sorobanGetBallotStats: (ballotIdHash: string) =>
      sorobanGetBallotStats(config, ballotIdHash),

    sorobanGetAllBallots: () =>
      sorobanGetAllBallots(config),

    sorobanBallotIsActive: (ballotIdHash: string) =>
      sorobanBallotIsActive(config, ballotIdHash),

    sorobanIsBallotFinalized: (ballotIdHash: string) =>
      sorobanIsBallotFinalized(config, ballotIdHash),

    sorobanGetBallotExpiration: (ballotIdHash: string) =>
      sorobanGetBallotExpiration(config, ballotIdHash),

    sorobanScheduleUpgrade: (newWasmHash: string) =>
      sorobanScheduleUpgrade(config, newWasmHash),

    sorobanCancelUpgrade: () =>
      sorobanCancelUpgrade(config),

    sorobanExecuteUpgrade: () =>
      sorobanExecuteUpgrade(config),

    sorobanGetPendingUpgrade: () =>
      sorobanGetPendingUpgrade(config),

    sorobanGetVersion: () =>
      sorobanGetVersion(config),

    verifyBallotConsistency: (ballotIdHash: string, databaseVoteCount?: number) =>
      verifyBallotConsistency(config, ballotIdHash, databaseVoteCount),

    hashTallyResult: (localResult: TallyResultPayload) =>
      hashTallyResult(localResult),
  };
}
