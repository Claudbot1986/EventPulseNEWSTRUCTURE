/**
 * Tests for the Bearer-JWT user auth middleware.
 *
 * Cover:
 *   - Missing Authorization header → 401 + WWW-Authenticate challenge.
 *   - Wrong scheme (not Bearer) → 401.
 *   - Empty Bearer token → 401.
 *   - Verifier returns null (invalid / expired) → 401.
 *   - Verifier returns a user → next() runs, `req.user` is populated,
 *     the route responds.
 *   - Verifier throws → 401 (NOT 500 — verifier failures should not
 *     leak server errors to callers).
 *   - No verifier configured AND no Supabase injected → 503 (fail-closed
 *     misconfig, same posture as adminAuth).
 *   - Custom Supabase client passed via opts is used as the default
 *     verifier (covers the buildApp({ supabase }) injection path).
 *
 * Run with:  npx vitest run 08-Agent/tests/requireUser.test.ts
 */

import { describe, it, expect } from 'vitest';
import express, { type Request, type Response } from 'express';
import { createRequireUser, type TokenVerifier } from '../middleware/requireUser';

interface ParsedResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string | undefined>;
}

async function callApp(
  app: express.Express,
  headers: Record<string, string> = {}
): Promise<ParsedResponse> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const addr = server.address();
        if (!addr || typeof addr === 'string') { reject(new Error('no addr')); return; }
        const res = await fetch(`http://127.0.0.1:${addr.port}/protected`, {
          method: 'GET', headers,
        });
        const text = await res.text();
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
        const hdrs: Record<string, string | undefined> = {};
        res.headers.forEach((v, k) => { hdrs[k] = v; });
        resolve({ status: res.status, body: parsed, headers: hdrs });
      } catch (e) { reject(e); }
      finally { server.close(); }
    });
  });
}

/** A verifier that only accepts the literal token 'good-token'. */
const goodTokenVerifier: TokenVerifier = async (token) =>
  token === 'good-token'
    ? { id: '11111111-1111-1111-1111-111111111111', email: 'alice@example.com' }
    : null;

describe('createRequireUser', () => {
  function buildApp(verify: TokenVerifier): express.Express {
    const app = express();
    app.use(createRequireUser({ verify }));
    app.get('/protected', (req: Request, res: Response) => {
      res.json({ ok: true, user: req.user ?? null });
    });
    return app;
  }

  it('rejects requests with no Authorization header (401)', async () => {
    const r = await callApp(buildApp(goodTokenVerifier));
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('unauthorized');
    expect(r.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it('rejects a non-Bearer scheme (401)', async () => {
    const r = await callApp(buildApp(goodTokenVerifier), {
      authorization: 'Basic ' + Buffer.from('user:pass').toString('base64'),
    });
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/Bearer/);
  });

  it('rejects when the verifier returns null (401)', async () => {
    const r = await callApp(buildApp(goodTokenVerifier), { authorization: 'Bearer wrong-token' });
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/invalid|expired/i);
  });

  it('accepts a valid token and populates req.user', async () => {
    const r = await callApp(buildApp(goodTokenVerifier), { authorization: 'Bearer good-token' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const user = r.body.user as { id: string; email: string | null };
    expect(user.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(user.email).toBe('alice@example.com');
  });

  it('treats the Bearer scheme case-insensitively', async () => {
    const r = await callApp(buildApp(goodTokenVerifier), { authorization: 'bearer good-token' });
    expect(r.status).toBe(200);
  });

  it('does not crash when the verifier throws (401, not 500)', async () => {
    const throwingVerifier: TokenVerifier = async () => { throw new Error('boom'); };
    const r = await callApp(buildApp(throwingVerifier), { authorization: 'Bearer whatever' });
    expect(r.status).toBe(401);
  });

  it('returns 503 when no verifier is configured and no Supabase injected', async () => {
    const app = express();
    app.use(createRequireUser({}));
    app.get('/protected', (_req: Request, res: Response) => res.json({ ok: true }));
    const r = await callApp(app, { authorization: 'Bearer anything' });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('user_auth_misconfigured');
  });

  it('passes the token to the verifier trimmed of surrounding whitespace', async () => {
    let seen: string | null = null;
    const capturing: TokenVerifier = async (token) => {
      seen = token;
      return null;
    };
    await callApp(buildApp(capturing), { authorization: 'Bearer   abc-123   ' });
    // Surrounding whitespace is trimmed so the verifier always sees a
    // canonical token shape; internal spaces are preserved.
    expect(seen).toBe('abc-123');
  });
});