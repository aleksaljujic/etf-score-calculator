import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface Limiter { (key: string): Promise<number | null> }

/** Best-effort in-memory sliding window (per function instance only). */
export function memoryLimiter(limit: number, windowMs: number, now = () => Date.now()): Limiter {
  const hits = new Map<string, number[]>();
  return async (key) => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= limit) {
      hits.set(key, list);
      return (windowMs - (t - list[0])) / 1000;
    }
    list.push(t);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return null;
  };
}

/** Upstash Redis limiter when configured, otherwise the in-memory fallback. */
export function createLimiter(env: NodeJS.ProcessEnv): Limiter {
  const limit = Number(env.RATE_LIMIT_REQUESTS) || 5;
  const windowSec = Number(env.RATE_LIMIT_WINDOW_SECONDS) || 600;
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) {
    const rl = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "etf-score",
    });
    return async (key) => {
      const res = await rl.limit(key);
      return res.success ? null : Math.max(1, (res.reset - Date.now()) / 1000);
    };
  }
  console.warn("[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set; using in-memory limiter (per instance only).");
  return memoryLimiter(limit, windowSec * 1000);
}
