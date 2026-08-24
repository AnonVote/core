import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma/client";
import { config } from "../config";
import { Organization } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      organization?: Organization;
    }
  }
}

// 8-hour session expiry (in seconds)
const SESSION_EXPIRY_SECONDS = 8 * 60 * 60;

// Refresh window: 1 hour before expiry
const REFRESH_WINDOW_SECONDS = 60 * 60;

interface JwtPayload {
  sessionId: string;
  orgId: string;
  iat: number;
  exp: number;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.session;
    if (!token) {
      res
        .status(401)
        .json({ error: "Unauthorized", message: "No session token provided" });
      return;
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        res.status(401).json({
          error: "SESSION_EXPIRED",
          message: "Your session has expired. Please login again.",
        });
      } else {
        res.status(401).json({
          error: "Unauthorized",
          message: "Invalid session",
        });
      }
      return;
    }

    // Enforce JWT expiry — reject tokens older than 8 hours
    if (payload.iat) {
      const tokenAgeSeconds = Math.floor(Date.now() / 1000) - payload.iat;
      if (tokenAgeSeconds > SESSION_EXPIRY_SECONDS) {
        res.status(401).json({
          error: "SESSION_EXPIRED",
          message: "Your session has expired. Please login again.",
        });
        return;
      }
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { organization: true },
    });

    if (!session) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Session not found",
      });
      return;
    }

    if (session.expiresAt < new Date()) {
      res.status(401).json({
        error: "SESSION_EXPIRED",
        message: "Your session has expired. Please login again.",
      });
      return;
    }

    req.organization = session.organization;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Check if a JWT is within the refresh window (last 1 hour before expiry).
 * Returns true if the token should be refreshed.
 */
export function shouldRefreshToken(token: string): boolean {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    if (!payload.exp || !payload.iat) return false;

    const now = Math.floor(Date.now() / 1000);
    const secondsUntilExpiry = payload.exp - now;

    // Refresh if within 1 hour of expiry
    return secondsUntilExpiry <= REFRESH_WINDOW_SECONDS && secondsUntilExpiry > 0;
  } catch {
    return false;
  }
}

export { SESSION_EXPIRY_SECONDS, REFRESH_WINDOW_SECONDS };