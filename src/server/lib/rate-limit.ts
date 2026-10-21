// In-memory sliding-window rate limiter. The app runs as a single instance (see
// docs/ARQUITECTURA.md); if it is ever scaled out this must move to Postgres or Redis.
import type { Context, MiddlewareHandler } from "hono";
import { clientIp } from "./request";
import { tooMany } from "./errors";

type Bucket = number[];
const buckets = new Map<string, Bucket>();

/** Returns true when the call is allowed (and records it). */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const from = now - windowMs;
  const list = (buckets.get(key) ?? []).filter((t) => t > from);
  if (list.length >= limit) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}

// Periodic cleanup so the map does not grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of buckets) {
    const fresh = list.filter((t) => t > now - 60 * 60_000);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}, 5 * 60_000).unref();

/** Middleware: `limit` requests per `windowMs` per client IP for this route group. */
export function rateLimit(name: string, limit: number, windowMs: number, keyFn?: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const key = `${name}:${keyFn ? keyFn(c) : clientIp(c)}`;
    if (!hit(key, limit, windowMs)) {
      c.header("Retry-After", String(Math.ceil(windowMs / 1000)));
      throw tooMany();
    }
    await next();
  };
}
