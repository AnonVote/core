import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";

export function errorHandler(
  err: Error,
  _req: Request,
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

  console.error("[Unhandled Error]", err);
  res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
  });
}
