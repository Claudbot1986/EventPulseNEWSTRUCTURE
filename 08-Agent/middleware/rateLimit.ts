/**
 * Token-bucket rate limiter middleware for the 08-Agent Express server.
 *
 * Why:
 *   The /agent/chat endpoint is Anthropic-backed (Phase 1+). A hostile or
 *   buggy client could otherwise run up real LLM costs or overwhelm the
 *   Supabase read path. Per docs/DEPLOY.md §8 (MVP Hardening 2026-08-20,
 *   Workstream E), this is shipped as part of the deploy hardening pass.
 *
 * Design:
 *   - Per-key token bucket with continuous refill.
 *   - Bucket key: prefers `client_user_id` from the parsed body (so the
 *     limiter tracks *users*, not transient IPs/NATs). Falls back to the
 *     remote IP for endpoints without a body (e.g. /agent/feed GET).
 *   - In-memory only — sufficient for a single Fly machine. Multi-instance
 *     scale-out would need a shared store (Redis/Upstash); that is out of
 *     scope for Phase 0 and explicitly listed in docs/DEPLOY.md §8.
 *   - Buckets older than IDLE_TTL_MS are evicted to bound memory.
 *   - Standard `429 Too Many Requests` with `Retry-After` (seconds).
 *
 * Determinism for tests:
 *   - `createRateLimiter({ now })` accepts an injected clock so tests can
 *     fast-forward without `setTimeout`.
 *
 * Non-goals:
 *   - No distributed lock; the in-memory map is per-process.
 *   - No leaky-bucket variant; token bucket matches the public Cloudflare /
 *     GitHub-style semantics that callers expect from `X-RateLimit-*`
 *     headers (which we emit for transparency).
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Sustained refill rate, in tokens per second. Default 5. */
  rps?: number;
  /** Maximum bucket size (the "burst"). Default 20. */
  burst?: number;
  /**
   * Custom key extractor. Default prefers `req.body.client_user_id`, else
   * falls back to `req.ip`. Returning `null` makes the middleware a no-op
   * for that request (used for health checks, OPTIONS preflight).
   */
  keyFn?: (req: Request) => string | null;
  /** Injected clock for tests. Default `Date.now`. */
  now?: () => number;
  /**
   * Idle bucket TTL — buckets unseen for this long are evicted. Default
   * 10 minutes. Set to 0 to disable.
   */
  idleTtlMs?: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  lastSeen: number;
}

const DEFAULT_RPS = 5;
const DEFAULT_BURST = 20;
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;

export interface RateLimiter {
  middleware: RequestHandler;
  /** Test helper: number of tracked buckets. */
  size: () => number;
  /** Test helper: clear all buckets. */
  reset: () => void;
}

/**
 * Create a rate limiter middleware.
 *
 * The returned `middleware` reads `req.body` (which means it MUST be
 * installed after `express.json()`). When the body parser has not yet
 * run, `req.body` is `{}` and the limiter falls back to the IP key.
 */
export function createRateLimiter(opts: RateLimitOptions = {}): RateLimiter {
  const rps = opts.rps ?? DEFAULT_RPS;
  const burst = opts.burst ?? DEFAULT_BURST;
  const idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  const now = opts.now ?? Date.now;
  const keyFn =
    opts.keyFn ??
    ((req: Request): string | null => {
      const body = (req.body ?? {}) as { client_user_id?: unknown };
      if (typeof body.client_user_id === 'string' && body.client_user_id.length > 0) {
        return `user:${body.client_user_id}`;
      }
      const ip = req.ip ?? req.socket?.remoteAddress;
      return ip ? `ip:${ip}` : null;
    });

  const buckets = new Map<string, Bucket>();

  function refill(bucket: Bucket, t: number): void {
    const elapsedSec = (t - bucket.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * rps);
    bucket.lastRefill = t;
  }

  function evictIdle(t: number): void {
    if (idleTtlMs <= 0) return;
    for (const [key, bucket] of buckets) {
      if (t - bucket.lastSeen > idleTtlMs) buckets.delete(key);
    }
  }

  const middleware: RequestHandler = (req, res, next) => {
    const key = keyFn(req);
    if (key === null) {
      next();
      return;
    }
    const t = now();
    evictIdle(t);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, lastRefill: t, lastSeen: t };
      buckets.set(key, bucket);
    } else {
      refill(bucket, t);
      bucket.lastSeen = t;
    }

    if (bucket.tokens < 1) {
      // How long until the bucket has ≥1 token?
      const deficit = 1 - bucket.tokens;
      const retryAfterSec = Math.max(1, Math.ceil(deficit / rps));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(burst));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Retry after the time indicated.',
        retry_after_seconds: retryAfterSec,
      });
      return;
    }

    bucket.tokens -= 1;
    res.setHeader('X-RateLimit-Limit', String(burst));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.floor(bucket.tokens))
    );
    next();
  };

  return {
    middleware,
    size: () => buckets.size,
    reset: () => buckets.clear(),
  };
}

/**
 * Compose a key extractor that ALWAYS falls back to IP. Useful for the
 * metrics/experiments admin endpoints, where there's no `client_user_id`
 * in the body.
 */
export function ipKeyFn(req: Request): string | null {
  const ip = req.ip ?? req.socket?.remoteAddress;
  return ip ? `ip:${ip}` : null;
}
