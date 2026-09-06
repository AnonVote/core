/**
 * Typed errors for Soroban contract interactions (issue #77).
 *
 * Every failure surfaced by the Soroban layer is normalised into a
 * `SorobanError` carrying an explicit `kind` and a `retryable` flag so the
 * retry layer can distinguish transient faults (network blips, simulation
 * resource errors, RPC 5xx) from permanent ones (contract rejections,
 * misconfiguration) and avoid burning attempts — or dead-lettering votes —
 * unnecessarily.
 */

export type SorobanErrorKind =
  /** Connection failures, DNS, timeouts talking to the RPC endpoint. */
  | "NETWORK_ERROR"
  /** Transaction simulation failed (fee/resource issues are transient; some are not). */
  | "SIMULATION_FAILED"
  /** RPC returned an error response (server-side, usually transient). */
  | "RPC_ERROR"
  /** The contract itself rejected the invocation (permanent — do not retry). */
  | "CONTRACT_ERROR"
  /** Missing configuration (contract ID / secret key). */
  | "CONFIG_ERROR";

const RETRYABLE_KINDS: ReadonlySet<SorobanErrorKind> = new Set([
  "NETWORK_ERROR",
  "RPC_ERROR",
]);

export class SorobanError extends Error {
  kind: SorobanErrorKind;
  retryable: boolean;
  /** Contract error code when kind === CONTRACT_ERROR (see anonvote lib.rs Error enum). */
  contractCode?: number;
  /** Original underlying error, when wrapping one. */
  cause?: unknown;

  constructor(
    kind: SorobanErrorKind,
    message: string,
    opts: { contractCode?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "SorobanError";
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.contractCode = opts.contractCode;
    this.cause = opts.cause;
    Object.setPrototypeOf(this, SorobanError.prototype);
  }
}

/** AnonVote contract error codes — must stay in sync with contracts/anonvote/src/lib.rs. */
export const AnonVoteContractErrorCode = {
  CounterOverflow: 1,
  BallotNotFound: 2,
  Unauthorized: 3,
  InvalidKey: 4,
  DuplicateVote: 5,
} as const;

/**
 * Best-effort extraction of a contract error code from a Soroban
 * `SorobanRpc.Api.SimulateHostFunctionResult` error or send-response payload.
 * Contract errors typically surface as strings like
 * `"Error(Contract, #5)"` inside simulation error output.
 */
function extractContractCode(raw: unknown): number | undefined {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : JSON.stringify(raw ?? "");
  const match = text.match(/#\s*(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** True when the error is the contract rejecting a duplicate vote id (#5). */
export function isDuplicateVoteError(err: unknown): boolean {
  return (
    err instanceof SorobanError &&
    err.kind === "CONTRACT_ERROR" &&
    err.contractCode === AnonVoteContractErrorCode.DuplicateVote
  );
}

/**
 * Classify an arbitrary thrown value into a SorobanError.
 * Heuristics cover the stellar-sdk v12 surface: axios-style network faults,
 * `NetworkError`, simulation error responses, and sendTransaction ERRORs.
 */
export function classifySorobanError(err: unknown): SorobanError {
  if (err instanceof SorobanError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const anyErr = err as Record<string, unknown> | null;

  // Contract rejection embedded in a simulation error payload
  if (anyErr && typeof anyErr.error === "object" && anyErr.error !== null) {
    return new SorobanError("CONTRACT_ERROR", message, {
      contractCode: extractContractCode(anyErr.error),
      cause: err,
    });
  }

  if (/duplicate/i.test(message)) {
    return new SorobanError("CONTRACT_ERROR", message, {
      contractCode: AnonVoteContractErrorCode.DuplicateVote,
      cause: err,
    });
  }

  if (
    /contract/i.test(message) ||
    /HostError|UnknownErr|VmError|Storage.*Error|WrongNonce|Auth.*Error/i.test(
      message,
    )
  ) {
    return new SorobanError("CONTRACT_ERROR", message, {
      contractCode: extractContractCode(message),
      cause: err,
    });
  }

  if (
    /simulation/i.test(message) ||
    (anyErr &&
      typeof anyErr.error === "string" &&
      /simulation/i.test(anyErr.error))
  ) {
    // Resource-exhaustion style simulation failures are frequently transient
    // (congestion); genuine contract rejections carry a contract code above.
    return new SorobanError("SIMULATION_FAILED", message, { cause: err });
  }

  if (
    /network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|timeout|aborted|fetch failed/i.test(
      message,
    ) ||
    (anyErr && anyErr.code && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/.test(String(anyErr.code)))
  ) {
    return new SorobanError("NETWORK_ERROR", message, { cause: err });
  }

  // Default: treat unknown RPC-level failures as retryable — the cost of a
  // wasted retry is far lower than dead-lettering recoverable votes.
  return new SorobanError("NETWORK_ERROR", message, { cause: err });
}