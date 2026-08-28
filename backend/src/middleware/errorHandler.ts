import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.error,
      message: err.message,
    });
    return;
  }

  // body-parser reports malformed/oversized bodies as errors carrying their own
  // 4xx status and a `type` (e.g. "entity.parse.failed"). Without this they fall
  // through to the generic 500 below, misreporting a client error as a server fault.
  const bodyParserStatus =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (
    typeof (err as { type?: string }).type === "string" &&
    typeof bodyParserStatus === "number" &&
    bodyParserStatus >= 400 &&
    bodyParserStatus < 500
  ) {
    res.status(bodyParserStatus).json({
      error: "ValidationError",
      message: "Malformed or unreadable request body",
    });
    return;
  }

  logger.error("unhandled_error", {
    requestId: req.id,
    error: err,
  });
  res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
  });
}
