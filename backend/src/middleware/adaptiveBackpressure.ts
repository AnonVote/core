import { Request, Response, NextFunction } from "express";

interface Waiter { priority: number; resolve: () => void; createdAt: number; }
const maxConcurrent = Number(process.env.VOTE_QUEUE_MAX_CONCURRENCY || 100);
const maxDepth = Number(process.env.VOTE_QUEUE_MAX_DEPTH || 1000);
let active = 0;
const waiting: Waiter[] = [];
let rejected = 0;

function priority(req: Request): number {
  const user = (req as Request & { user?: { role?: string } }).user;
  if (!user) return 0;
  return user.role === "admin" ? 1 : 2;
}
function drain(): void {
  while (active < maxConcurrent && waiting.length) {
    waiting.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    active++;
    waiting.shift()!.resolve();
  }
}
export function adaptiveBackpressureMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test") { next(); return; }
  if (active < maxConcurrent) {
    active++;
    res.once("finish", release);
    next();
    return;
  }
  if (waiting.length >= maxDepth) {
    rejected++;
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(waiting.length / maxConcurrent))));
    res.setHeader("X-Vote-Queue-Depth", String(waiting.length));
    res.status(429).json({ error: { code: "VOTE_QUEUE_FULL", message: "Vote submissions are temporarily at capacity." }, queueDepth: waiting.length });
    return;
  }
  const waiter: Waiter = { priority: priority(req), createdAt: Date.now(), resolve: () => { res.once("finish", release); next(); } };
  waiting.push(waiter);
  res.setHeader("X-Vote-Queue-Depth", String(waiting.length));
}
function release(): void { if (active > 0) active--; drain(); }
export function getVoteBackpressureMetrics() { return { active, queued: waiting.length, rejected, maxConcurrent, maxDepth }; }
export function resetVoteBackpressureForTests(): void { active = 0; waiting.length = 0; rejected = 0; }
