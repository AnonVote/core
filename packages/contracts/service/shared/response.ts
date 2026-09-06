export enum SorokitErrorCode {
  CONTRACT_INVOKE_FAILED = "CONTRACT_INVOKE_FAILED",
  CONTRACT_READ_FAILED = "CONTRACT_READ_FAILED",
  NETWORK_ERROR = "NETWORK_ERROR",
}

export interface SorokitError {
  code: SorokitErrorCode | string;
  message: string;
  cause?: unknown;
}

export type SorokitResult<T> =
  | { status: "ok"; data: T; error?: never }
  | { status: "error"; data: null; error: SorokitError };

export function ok<T>(data: T): SorokitResult<T> {
  return { status: "ok", data };
}

export function err<T = never>(
  codeOrError: SorokitErrorCode | string | SorokitError,
  message?: string,
  cause?: unknown,
): SorokitResult<T> {
  const error =
    typeof codeOrError === "object"
      ? codeOrError
      : { code: codeOrError, message: message ?? "Sorokit operation failed", cause };

  return { status: "error", data: null, error };
}
