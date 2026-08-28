/**
 * auth.ts — bearer token middleware.
 *
 * The mobile control panel must NOT be exposed without authentication.
 * Token comes from MOBILE_CONTROL_TOKEN env var. If unset, server refuses
 * to start (fail-closed, not fail-open).
 *
 * Token is sent by the phone in Authorization: Bearer <token> header OR as
 * ?token=<token> query param (for SSE which can't easily set headers in
 * browser EventSource). Both are accepted.
 *
 * Security notes:
 *   - No public ports. Bind to Tailscale interface (default 100.64.0.0/10) or
 *     localhost. Mobile control panel should run behind Tailscale, not on a
 *     public IP.
 *   - No password storage. Token is a high-entropy random string generated
 *     at install time, stored in env (or .env which is gitignored).
 *   - HTTPS is provided by Tailscale (TLS by default). The control server
 *     itself only speaks plain HTTP behind that tunnel.
 */

import type { Request, Response, NextFunction } from 'express';

export const TOKEN_HEADER = 'authorization';
export const TOKEN_QUERY = 'token';

export function getToken(): string {
  const t = process.env.MOBILE_CONTROL_TOKEN;
  if (!t || t.length < 16) {
    throw new Error(
      'MOBILE_CONTROL_TOKEN env var must be set to a high-entropy string (>=16 chars). ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
  return t;
}

function extractToken(req: Request): string | null {
  const auth = req.header(TOKEN_HEADER);
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const q = req.query[TOKEN_QUERY];
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

/**
 * Strict middleware: returns 401 if token missing or mismatched.
 */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  const expected = getToken();
  const got = extractToken(req);
  if (!got || got !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

/**
 * Soft middleware: attaches req.token = extracted token but doesn't 401.
 * Useful for the dashboard HTML root so we can show "no token" UI.
 */
export function attachToken(req: Request, _res: Response, next: NextFunction): void {
  const got = extractToken(req);
  (req as Request & { token?: string }).token = got ?? null;
  next();
}