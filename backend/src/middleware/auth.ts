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

    let payload: { sessionId: string };
    try {
      payload = jwt.verify(token, config.jwtSecret) as { sessionId: string };
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
