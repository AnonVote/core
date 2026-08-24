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

  logger.error("unhandled_error", {
    requestId: req.id,
    error: err,
  });
  res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
  });
}
