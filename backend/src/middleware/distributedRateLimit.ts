import { Request, Response, NextFunction } from "express";
import { createClient, RedisClientType } from "redis";

export interface DistributedLimitBucket { name: string; limit: number; windowSeconds: number; }
export interface DistributedLimitResult { allowed: boolean; retryAfterSeconds: number; current: number; limit: number; bucket?: string; }

const buckets: DistributedLimitBucket[] = [
  { name: "second", limit: Number(process.env.VOTE_RATE_LIMIT_PER_SECOND || 5), windowSeconds: 1 },
  { name: "minute", limit: Number(process.env.VOTE_RATE_LIMIT_PER_IP || 10), windowSeconds: 60 },
  { name: "hour", limit: Number(process.env.VOTE_RATE_LIMIT_PER_HOUR || 100), windowSeconds: 3600 },
];
const localCounters = new Map<string, { count: number; expiresAt: number }>();
let redis: RedisClientType | undefined;
let redisPromise: Promise<RedisClientType | undefined> | undefined;

async function getRedis(): Promise<RedisClientType | undefined> {
  if (!process.env.REDIS_URL) return undefined;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 2000), connectTimeout: 1000 } });
        client.on("error", (error) => console.warn("[RateLimit] Redis error", error.message));
        await client.connect();
        redis = client as RedisClientType;
        return redis;
      } catch (error) {
        console.warn("[RateLimit] Redis unavailable; using local fallback", error instanceof Error ? error.message : error);
        redisPromise = undefined;
        return undefined;
      }
    })();
  }
  return redisPromise;
}

async function increment(key: string, windowSeconds: number): Promise<number> {
  const client = await getRedis();
  if (client) {
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
    return Number(await client.eval(script, { keys: [key], arguments: [String(windowSeconds)] }));
  }
  const now = Date.now();
  const existing = localCounters.get(key);
  const value = !existing || existing.expiresAt <= now ? { count: 1, expiresAt: now + windowSeconds * 1000 } : { count: existing.count + 1, expiresAt: existing.expiresAt };
  localCounters.set(key, value);
  return value.count;
}

export async function checkDistributedVoteLimit(ip: string, ballotId: string): Promise<DistributedLimitResult> {
  const identity = `${ip}:${ballotId}`;
  for (const bucket of buckets) {
    const current = await increment(`ratelimit:votes:${bucket.name}:${identity}`, bucket.windowSeconds);
    if (current > bucket.limit) return { allowed: false, current, limit: bucket.limit, bucket: bucket.name, retryAfterSeconds: bucket.windowSeconds };
  }
  return { allowed: true, current: 0, limit: buckets[0].limit, retryAfterSeconds: 0 };
}

export function distributedRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const ballotId = String(req.body?.ballotId || req.body?.ballot_id || "unknown");
  checkDistributedVoteLimit(ip, ballotId).then((result) => {
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({ error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many vote submissions. Please retry later." }, retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    next();
  }).catch((error) => next(error));
}

export function resetDistributedRateLimitForTests(): void { localCounters.clear(); }
export async function closeDistributedRateLimit(): Promise<void> { if (redis?.isOpen) await redis.quit(); redis = undefined; redisPromise = undefined; }

export { buckets as distributedRateLimitBuckets };
