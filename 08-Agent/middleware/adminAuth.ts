/**
 * Bearer-token admin auth middleware for the 08-Agent operator endpoints.
 *
 * Why:
 *   /agent/metrics and /agent/experiments/personalization expose
 *   internal counters (impressions, outbounds, CTR) that are useful for
 *   operators but NOT for the public Expo app. Without a gate, any
 *   anonymous caller can scrape these and infer our traffic.
 *
 * Design:
 *   - Reads `AGENT_ADMIN_TOKEN` from the environment.
 *   - Accepts `Authorization: Bearer <token>` (case-insensitive scheme).
 *   - Constant-time comparison via HMAC-SHA256 + `timingSafeEqual` to
 *     prevent timing side-channels from leaking the token one byte at a
 *     time. Both inputs are hashed against a fixed pepper so the
 *     timing-safe compare runs on a fixed-length buffer.
 *   - If `AGENT_ADMIN_TOKEN` is unset, the middleware fails closed —
 *     every request gets 503. We refuse to operate an admin endpoint
 *     without a configured credential.
 *
 * Standard `WWW-Authenticate: Bearer` challenge on 401 per RFC 6750.
 */

import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface AdminAuthOptions {
  /** Optional override for the token (mostly for tests). */
  token?: string;
  /**
   * Optional override for the env-var name. Default `AGENT_ADMIN_TOKEN`.
   * Kept configurable so a future "per-endpoint" token can plug in
   * without copy-paste.
   */
  envVar?: string;
}

/**
 * Read the admin token from the environment. Throws a descriptive error
 * when unset so misconfiguration is caught at boot, not at first request.
 */
export function getAdminToken(envVar: string = 'AGENT_ADMIN_TOKEN'): string {
  const v = process.env[envVar];
  if (!v || v.length === 0) {
    throw new Error(`${envVar} not configured`);
  }
  return v;
}

/**
 * Constant-time string compare via HMAC-SHA256 + timingSafeEqual.
 * Hashing against a fixed pepper normalizes both inputs to a 32-byte
 * digest, so the timing-safe compare never short-circuits on length.
 */
function safeEqual(a: string, b: string): boolean {
  const PEPPER = 'eventpulse-admin-auth-v1';
  const ha = createHmac('sha256', PEPPER).update(a).digest();
  const hb = createHmac('sha256', PEPPER).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Build a Bearer-token guard.
 *
 * Usage in server.ts:
 *   const requireAdmin = createAdminAuth();
 *   app.get('/agent/metrics', requireAdmin, async (req, res) => { ... });
 *
 * If `AGENT_ADMIN_TOKEN` is unset at request time, the guard returns
 * 503 (refuse to operate). The constructor throws only when an explicit
 * token is provided AND empty.
 */
export function createAdminAuth(opts: AdminAuthOptions = {}): RequestHandler {
  const envVar = opts.envVar ?? 'AGENT_ADMIN_TOKEN';
  const provided = opts.token;
  if (provided !== undefined && provided.length === 0) {
    throw new Error(`${envVar} must not be empty`);
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const configured = provided ?? process.env[envVar];
    if (!configured) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-admin"');
      res.status(503).json({
        error: 'admin_disabled',
        message: `${envVar} is not configured on the server`,
      });
      return;
    }

    const header = req.header('authorization');
    if (!header) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-admin"');
      res.status(401).json({ error: 'unauthorized', message: 'missing Authorization header' });
      return;
    }
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-admin"');
      res.status(401).json({ error: 'unauthorized', message: 'Authorization must be Bearer <token>' });
      return;
    }
    const presented = m[1].trim();
    if (!safeEqual(presented, configured)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-admin"');
      res.status(401).json({ error: 'unauthorized', message: 'invalid token' });
      return;
    }
    next();
  };
}
