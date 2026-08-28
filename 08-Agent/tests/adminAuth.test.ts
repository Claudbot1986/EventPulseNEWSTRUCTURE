/**
 * Tests for the Bearer-token admin auth middleware.
 *
 * Cover:
 *   - Missing Authorization header → 401 + WWW-Authenticate challenge.
 *   - Wrong scheme (not Bearer) → 401.
 *   - Wrong token → 401.
 *   - Correct token → next() runs and the route responds.
 *   - Unset AGENT_ADMIN_TOKEN → 503 (fail-closed).
 *   - Empty token passed via opts throws at construction.
 *   - getAdminToken helper reads the env or throws.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import express, { type Request, type Response } from 'express';
import { createAdminAuth, getAdminToken } from '../middleware/adminAuth';

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
        const res = await fetch(`http://127.0.0.1:${addr.port}/admin`, {
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

describe('createAdminAuth', () => {
  const TOKEN = 's3cret-token-abc123';
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.AGENT_ADMIN_TOKEN;
    process.env.AGENT_ADMIN_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env.AGENT_ADMIN_TOKEN;
    } else {
      process.env.AGENT_ADMIN_TOKEN = savedToken;
    }
  });

  function buildApp(): express.Express {
    const app = express();
    app.use(createAdminAuth());
    app.get('/admin', (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('rejects requests with no Authorization header (401)', async () => {
    const r = await callApp(buildApp());
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('unauthorized');
    expect(r.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it('rejects requests with a non-Bearer scheme (401)', async () => {
    const r = await callApp(buildApp(), {
      authorization: 'Basic ' + Buffer.from('user:pass').toString('base64'),
    });
    expect(r.status).toBe(401);
  });

  it('rejects requests with the wrong Bearer token (401)', async () => {
    const r = await callApp(buildApp(), { authorization: 'Bearer not-the-right-one' });
    expect(r.status).toBe(401);
  });

  it('accepts the correct Bearer token and runs the route', async () => {
    const r = await callApp(buildApp(), { authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('treats the Bearer scheme case-insensitively', async () => {
    const r = await callApp(buildApp(), { authorization: `bearer ${TOKEN}` });
    expect(r.status).toBe(200);
  });

  it('returns 503 when AGENT_ADMIN_TOKEN is unset (fail-closed)', async () => {
    delete process.env.AGENT_ADMIN_TOKEN;
    const r = await callApp(buildApp());
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('admin_disabled');
  });

  it('uses the explicit token from opts when provided', async () => {
    delete process.env.AGENT_ADMIN_TOKEN;
    const app = express();
    app.use(createAdminAuth({ token: 'override-token' }));
    app.get('/admin', (_req: Request, res: Response) => res.json({ ok: true }));
    const denied = await callApp(app, { authorization: 'Bearer wrong' });
    expect(denied.status).toBe(401);
    const ok = await callApp(app, { authorization: 'Bearer override-token' });
    expect(ok.status).toBe(200);
  });

  it('throws at construction if an explicit empty token is provided', () => {
    expect(() => createAdminAuth({ token: '' })).toThrow(/must not be empty/);
  });

  it('getAdminToken throws when the env var is unset', () => {
    delete process.env.AGENT_ADMIN_TOKEN;
    expect(() => getAdminToken()).toThrow(/not configured/);
  });

  it('getAdminToken returns the configured value', () => {
    process.env.AGENT_ADMIN_TOKEN = 'tok-xyz';
    expect(getAdminToken()).toBe('tok-xyz');
  });
});
