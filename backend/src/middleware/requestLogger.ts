import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  anonymize,
  sanitizeHeaders,
  sanitizePath,
  sanitizeQuery,
} from "../utils/sanitizer";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      startTime?: number;
    }
  }
}

const SKIPPED_PATHS = new Set(
  String(config.logSkipPaths || "/health,/healthz,/api/health")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean),
);

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  const startTime = Date.now();
  req.id = requestId;
  req.startTime = startTime;

  if (SKIPPED_PATHS.has(req.path)) {
    next();
    return;
  }

  const method = req.method;
  const path = req.path;
  const query = sanitizeQuery(req.query);
  const headers = sanitizeHeaders(req.headers);

  res.on("finish", () => {
    logger.info("http_request", {
      requestId,
      method,
      path: sanitizePath(path, query),
      query,
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
      userAgent: headers["user-agent"],
      userId: req.organization ? anonymize(req.organization.id) : undefined,
    });
  });

  next();
}
