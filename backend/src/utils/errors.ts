export class AppError extends Error {
  statusCode: number;
  error: string;

  constructor(message: string, statusCode: number, error: string) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function badRequest(message: string): AppError {
  return new AppError(message, 400, "BadRequest");
}

export function unauthorized(message: string = "Unauthorized"): AppError {
  return new AppError(message, 401, "Unauthorized");
}

export function forbidden(message: string = "Forbidden"): AppError {
  return new AppError(message, 403, "Forbidden");
}

export function notFound(message: string = "Not found"): AppError {
  return new AppError(message, 404, "NotFound");
}

export function alreadyVoted(message: string): AppError {
  return new AppError(message, 409, "AlreadyVoted");
}

export function rateLimitExceeded(retryAfterSeconds: number): AppError {
  const err = new AppError(
    "Rate limit exceeded. Please try again later.",
    429,
    "RATE_LIMIT_EXCEEDED",
  );
  (err as any).retryAfter = retryAfterSeconds;
  return err;
}

export function tokenAlreadyIssued(message: string): AppError {
  return new AppError(message, 409, "TokenAlreadyIssued");
}
