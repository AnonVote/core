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

const SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const SOROBAN_RPC_MAINNET = "https://rpc.stellar.org";

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

export interface SorobanConfig {
  stellarSecretKey: string;
  stellarNetwork: "testnet" | "mainnet";
  contractId: string;
  rpcServer?: Pick<StellarSdk.SorobanRpc.Server, "getEvents"> | undefined;
  /** Optional override for the transaction-confirmation retry/backoff strategy. */
  retryPolicy?: RetryPolicy;
}

export enum BallotState {
  Active          = "Active",
  ResultPublished = "ResultPublished",
  Archived        = "Archived",
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
  field: "stellarSecretKey" | "contractId";
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
  if (!config.stellarSecretKey || !StellarSdk.StrKey.isValidEd25519SecretSeed(config.stellarSecretKey)) {
    return {
      valid: false,
      error: {
        field: "stellarSecretKey",
        message: "Invalid stellarSecretKey format",
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

function getRpcUrl(network: string): string {
  return network === "mainnet" ? SOROBAN_RPC_MAINNET : SOROBAN_RPC_TESTNET;
}

function getNetworkPassphrase(network: string): string {
  return network === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

function getRpcServer(network: string): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(getRpcUrl(network), {
    allowHttp: false,
  });
}

function makeError(code: SorobanErrorCode): Pick<SorobanInvokeResult, "errorCode" | "errorMessage"> {
  return { errorCode: code, errorMessage: ERROR_MESSAGES[code] };
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
    const keypair = StellarSdk.Keypair.fromSecret(config.stellarSecretKey);
    const server   = getRpcServer(config.stellarNetwork);
    const account  = await server.getAccount(keypair.publicKey());

    const scArgs   = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    const contract  = new StellarSdk.Contract(config.contractId);
    const operation = contract.call(method, ...scArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(config.stellarNetwork),
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
  if (config.stellarSecretKey && !StellarSdk.StrKey.isValidEd25519SecretSeed(config.stellarSecretKey)) {
    console.warn(`[Soroban] ${method}: invalid stellarSecretKey format`);
    return { value: null, ...makeError(SorobanErrorCode.NotConfigured) };
  }

  try {
    const keypair = config.stellarSecretKey
      ? StellarSdk.Keypair.fromSecret(config.stellarSecretKey)
      : StellarSdk.Keypair.random();

    const server  = getRpcServer(config.stellarNetwork);
    const account = await server.getAccount(keypair.publicKey());

    const scArgs  = args.map(({ value, type }) =>
      StellarSdk.nativeToScVal(value, { type: type as any }),
    );

    const contract  = new StellarSdk.Contract(config.contractId);
    const operation = contract.call(method, ...scArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(config.stellarNetwork),
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
    const server = config.rpcServer ?? getRpcServer(config.stellarNetwork);
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
  const ballotLimits = limits ?? { maxTokens: 10000, maxVotes: 10000 };
  const result = await invokeContract(config, "record_ballot", [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
    {
      value: { max_tokens: ballotLimits.maxTokens, max_votes: ballotLimits.maxVotes },
      type: "map",
    },
  ]);
  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanRecordBallot failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
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

  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();

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

  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanRecordBallotsBatch failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
  const result = await invokeContract(config, "record_token", [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
  ]);
  if (!result.success) {
    if (result.errorCode === SorobanErrorCode.BallotNotFound) {
      console.error(
        `[Soroban] sorobanRecordToken: ballot ${ballotIdHash} not found on-chain — BallotNotFound`,
      );
    } else if (result.errorCode !== undefined) {
      console.error(
        `[Soroban] sorobanRecordToken failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
      );
    }
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
  const result = await invokeContract(config, "record_vote", [
    { value: caller, type: "address" },
    { value: ballotIdHash, type: "string" },
  ]);
  if (!result.success) {
    if (result.errorCode === SorobanErrorCode.BallotNotFound) {
      console.error(
        `[Soroban] sorobanRecordVote: ballot ${ballotIdHash} not found on-chain — BallotNotFound`,
      );
    } else if (result.errorCode !== undefined) {
      console.error(
        `[Soroban] sorobanRecordVote failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
      );
    }
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
  const result = await invokeContract(config, "record_result", [
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
    console.error(
      `[Soroban] sorobanRecordResult: conflicting result already published for ballot ${ballotIdHash}`,
    );
    return result;
  }

  if (!result.success && result.errorCode !== undefined) {
    console.error(
      `[Soroban] sorobanRecordResult failed — ${SorobanErrorCode[result.errorCode]}: ${result.errorMessage}`,
    );
  }
  return result;
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
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
  const { value } = await readContract(config, "get_ballot_state", [
    { value: ballotIdHash, type: "string" },
  ]);
  return value as BallotStateSnapshot | null;
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
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
  const caller = StellarSdk.Keypair.fromSecret(config.stellarSecretKey).publicKey();
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