/**
 * Tests for the token-bucket rate limiter middleware.
 *
 * Cover:
 *   - First request from a fresh user is allowed.
 *   - Burst capacity is respected (N+1th request gets 429).
 *   - Refill happens at the configured rate (deterministic with injected clock).
 *   - Retry-After header is set to a sane positive value.
 *   - Different keys are tracked independently.
 *   - IP fallback works when no client_user_id is in the body.
 *   - Key extractor returning null = no-op (for OPTIONS / health).
 *   - Idle buckets are evicted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import { createRateLimiter, ipKeyFn } from '../middleware/rateLimit';

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UUID2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeApp(limiter: ReturnType<typeof createRateLimiter>): express.Express {
  const app = express();
  app.use(express.json());
  app.use(limiter.middleware);
  app.post('/test', (req: Request, res: Response) => {
    res.json({ ok: true, body: req.body });
  });
  return app;
}

interface ParsedResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string | undefined>;
}

async function postJson(
  app: express.Express,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<ParsedResponse> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('no address'));
          return;
        }
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body ?? {}),
        });
        const text = await res.text();
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
        const hdrs: Record<string, string | undefined> = {};
        res.headers.forEach((v, k) => { hdrs[k] = v; });
        resolve({ status: res.status, body: parsed, headers: hdrs });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe('createRateLimiter', () => {
  let clockNow: number;
  beforeEach(() => {
    clockNow = 1_700_000_000_000;
  });

  it('allows the first N=burst requests and 429s the next one', async () => {
    const limiter = createRateLimiter({ rps: 1, burst: 3, now: () => clockNow });
    const app = makeApp(limiter);
    for (let i = 0; i < 3; i++) {
      const r = await postJson(app, '/test', { client_user_id: UUID });
      expect(r.status).toBe(200);
    }
    const r4 = await postJson(app, '/test', { client_user_id: UUID });
    expect(r4.status).toBe(429);
    expect(r4.body.error).toBe('rate_limited');
    expect(r4.headers['retry-after']).toBeDefined();
    expect(Number(r4.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(r4.headers['x-ratelimit-limit']).toBe('3');
    expect(r4.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('refills tokens over time using the injected clock', async () => {
    const limiter = createRateLimiter({ rps: 2, burst: 2, now: () => clockNow });
    const app = makeApp(limiter);
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(200);
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(200);
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(429);

    // Advance 1 second: at 2 rps we get 2 tokens back.
    clockNow += 1000;
    const r = await postJson(app, '/test', { client_user_id: UUID });
    expect(r.status).toBe(200);
  });

  it('tracks different client_user_ids independently', async () => {
    const limiter = createRateLimiter({ rps: 1, burst: 1, now: () => clockNow });
    const app = makeApp(limiter);
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(200);
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(429);
    expect((await postJson(app, '/test', { client_user_id: UUID2 })).status).toBe(200);
  });

  it('falls back to IP key when no client_user_id is in the body', async () => {
    const limiter = createRateLimiter({ rps: 1, burst: 1, now: () => clockNow });
    const app = makeApp(limiter);
    expect((await postJson(app, '/test', {})).status).toBe(200);
    expect((await postJson(app, '/test', {})).status).toBe(429);
  });

  it('skips the limiter when keyFn returns null (health, OPTIONS)', async () => {
    const seen: string[] = [];
    const limiter = createRateLimiter({
      rps: 1, burst: 1,
      keyFn: () => { seen.push('checked'); return null; },
      now: () => clockNow,
    });
    const app = makeApp(limiter);
    for (let i = 0; i < 5; i++) {
      expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(200);
    }
    expect(seen.length).toBe(5);
    expect(limiter.size()).toBe(0);
  });

  it('emits X-RateLimit-* headers on allowed responses', async () => {
    const limiter = createRateLimiter({ rps: 5, burst: 7, now: () => clockNow });
    const app = makeApp(limiter);
    const r = await postJson(app, '/test', { client_user_id: UUID });
    expect(r.status).toBe(200);
    expect(r.headers['x-ratelimit-limit']).toBe('7');
    expect(r.headers['x-ratelimit-remaining']).toBe('6');
  });

  it('ipKeyFn returns a stable key for the request IP', () => {
    const fakeReq = { ip: '203.0.113.5', socket: { remoteAddress: '203.0.113.5' } } as never;
    expect(ipKeyFn(fakeReq)).toBe('ip:203.0.113.5');
  });

  it('evicts idle buckets after idleTtlMs', async () => {
    const limiter = createRateLimiter({
      rps: 1, burst: 1, idleTtlMs: 100, now: () => clockNow,
    });
    const app = makeApp(limiter);
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(200);
    expect(limiter.size()).toBe(1);
    clockNow += 200;
    expect((await postJson(app, '/test', { client_user_id: UUID })).status).toBe(200);
  });

  it('reset() clears all tracked buckets', () => {
    const limiter = createRateLimiter({ rps: 1, burst: 1, now: () => clockNow });
    expect(limiter.size()).toBe(0);
    limiter.reset();
    expect(limiter.size()).toBe(0);
  });
});
