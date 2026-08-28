/**
 * auth.ts — bearer token middleware for the analytics service.
 *
 * Mirrors the model used by 09-MobileControl and 09-ScrapingSupervisor:
 * a single bearer token from env, mandatory for all admin endpoints.
 * Public endpoints (POST /api/events, GDPR endpoints) accept only
 * device_id_hash — no token required.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';

const DEFAULT_TOKEN_ENV = 'ANALYTICS_TOKEN';

let cachedToken: string | null = null;

/**
 * Returns the operational bearer token. Reads from env on first call,
 * generates a random one if absent, and caches the result. The printed
 * token is the only way to access admin endpoints — losing it requires
 * a server restart.
 */
export function getToken(): string {
  if (cachedToken) return cachedToken;
  const envToken = process.env[DEFAULT_TOKEN_ENV];
  if (envToken && envToken.trim().length >= 16) {
    cachedToken = envToken.trim();
  } else {
    cachedToken = randomBytes(24).toString('hex');
    console.warn(
      `[analytics] no ${DEFAULT_TOKEN_ENV} set — generated ephemeral token: ${cachedToken}`,
    );
  }
  return cachedToken;
}

/**
 * requireBearer — middleware that rejects requests without a valid
 * `Authorization: Bearer <token>` header. Apply to admin endpoints.
 */
export const requireBearer: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers['authorization'] || '';
  const match = /^Bearer\s+(\S+)$/.exec(auth);
  const token = match?.[1];
  if (!token || token !== getToken()) {
    res.status(401).json({ error: 'unauthorized', hint: 'Authorization: Bearer <ANALYTICS_TOKEN>' });
    return;
  }
  next();
};
