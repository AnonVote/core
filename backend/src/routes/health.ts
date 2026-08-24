import { Router, Request, Response } from "express";
import { prisma } from "../prisma/client";

export interface DatabaseCheck {
  ok: boolean;
  responseTime: number;
  error?: string;
}

/**
 * Pings the database with a trivial query (`SELECT 1`) and records how long it
 * took. Any failure (connection drop, timeout, auth error) is captured and
 * surfaced as an unhealthy check rather than thrown.
 */
export async function checkDatabase(): Promise<DatabaseCheck> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, responseTime: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database check failed";
    return { ok: false, responseTime: Date.now() - start, error: message };
  }
}

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  const payload = {
    status: db.ok ? "ok" : "error",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: db.ok ? "ok" : "error",
    checks: {
      database: {
        status: db.ok ? "ok" : "error",
        responseTime: `${db.responseTime}ms`,
        ...(db.ok ? {} : { error: db.error }),
      },
    },
  };

  if (!db.ok) {
    console.error("[Health] database check failed:", db.error);
    res.status(503).json(payload);
    return;
  }

  res.status(200).json(payload);
});

export default router;
