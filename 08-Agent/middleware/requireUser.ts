/**
 * Bearer-JWT user auth middleware for the 08-Agent user-scoped endpoints.
 *
 * Why:
 *   `/agent/chat` and the user-scoped siblings (saved, recommended,
 *   notifications, follow, attendance, preferences, share, push-token,
 *   outbound, feedback) must only run for a verified user. The previous
 *   anon-UUID contract (Phase 0) treated `client_user_id` as opaque —
 *   fine for self-dogfood, but `docs/DEPLOY.md §8` lists it as the
 *   pre-public-user blocker. Supabase Auth magic-link (Phase 1) gives us
 *   a verified `auth.uid()` per request without us running mail infra.
 *
 * Design:
 *   - Reads `Authorization: Bearer <jwt>` (case-insensitive scheme,
 *     mirroring adminAuth.ts).
 *   - Verifies the JWT via Supabase `auth.getUser(token)`. Supabase
 *     service-role keys can verify any user's access token; that is the
 *     cheap path. If verification fails (expired, malformed, revoked) we
 *     return 401.
 *   - On success, attaches `req.user = { id, email }` (Express request
 *     augmentation via a global module declaration below).
 *   - Test injection: `createRequireUser({ verify })` accepts a custom
 *     verifier so tests can skip real Supabase calls — same pattern as
 *     `buildApp({ supabase })`.
 *   - Standard `WWW-Authenticate: Bearer` challenge on 401 per RFC 6750.
 *
 * Out of scope:
 *   - Token refresh (caller handles 401 → refresh on the client side).
 *   - Rate-limiting the verify call (adminAuth and rateLimit middleware
 *     handle that per-route).
 *   - Permission scopes beyond "is this an authenticated user".
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Identity attached to a request after successful JWT verification. */
export interface AuthenticatedUser {
  /** Supabase auth.users.id (UUID). */
  id: string;
  /** Email from the verified JWT, may be null for phone-only accounts. */
  email: string | null;
}

/**
 * Module augmentation so `req.user` is well-typed inside route handlers
 * once `requireUser` has run.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Successful verification result. */
interface VerifiedUser {
  id: string;
  email: string | null;
}

/**
 * Verifier contract — accepts a JWT and returns either the resolved user
 * or null (token invalid / expired / revoked). Service-role Supabase
 * fulfills this; tests can inject a stub.
 */
export type TokenVerifier = (token: string) => Promise<VerifiedUser | null>;

export interface RequireUserOptions {
  /**
   * Custom token verifier. When omitted, the middleware uses the
   * Supabase client passed in `supabase` (or, if that is also omitted,
   * the lazily-initialized singleton in `getSupabase`).
   *
   * The verifier MUST return `null` (not throw) on invalid/expired
   * tokens so the middleware can produce a consistent 401.
   */
  verify?: TokenVerifier;
  /**
   * Supabase client used when no `verify` is provided. Mirrors the
   * `buildApp({ supabase })` dependency-injection pattern so tests can
   * inject a fake.
   */
  supabase?: SupabaseClient;
}

/**
 * Build a default verifier that calls Supabase `auth.getUser(token)`.
 * Service-role keys can resolve any access token issued by the project,
 * which is what we want at the API edge.
 */
function buildDefaultVerifier(supabase: SupabaseClient): TokenVerifier {
  return async (token: string): Promise<VerifiedUser | null> => {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      return {
        id: data.user.id,
        email: data.user.email ?? null,
      };
    } catch {
      return null;
    }
  };
}

/**
 * Build a Bearer-JWT user guard.
 *
 * Usage in server.ts:
 *   const requireUser = createRequireUser();
 *   app.post('/agent/chat', chatLimiter.middleware, requireUser, async (req, res) => { ... });
 *
 * Tests inject a verifier:
 *   const requireUser = createRequireUser({
 *     verify: async (token) => token === 'good' ? { id: 'u', email: 'x@y' } : null,
 *   });
 */
export function createRequireUser(opts: RequireUserOptions = {}): RequestHandler {
  const verify = opts.verify ?? (opts.supabase ? buildDefaultVerifier(opts.supabase) : null);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Defer env-driven Supabase init to request time so tests that omit
    // `verify`/`supabase` AND lack env vars get a clear error rather than
    // a boot-time crash.
    if (!verify) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-user"');
      res.status(503).json({
        error: 'user_auth_misconfigured',
        message: 'No token verifier configured (pass `verify` or `supabase` to createRequireUser)',
      });
      return;
    }

    const header = req.header('authorization');
    if (!header) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-user"');
      res.status(401).json({ error: 'unauthorized', message: 'missing Authorization header' });
      return;
    }
    const m = /^Bearer\s+(.*)$/i.exec(header.trim());
    if (!m) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-user"');
      res.status(401).json({ error: 'unauthorized', message: 'Authorization must be Bearer <token>' });
      return;
    }
    const presented = m[1].trim();
    if (presented.length === 0) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-user"');
      res.status(401).json({ error: 'unauthorized', message: 'empty Bearer token' });
      return;
    }

    let verified: VerifiedUser | null;
    try {
      verified = await verify(presented);
    } catch {
      // Verifier must not throw — but if it does, treat as auth failure
      // rather than 500 so callers don't see spurious server errors on
      // bad tokens.
      verified = null;
    }

    if (!verified) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="agent-user"');
      res.status(401).json({ error: 'unauthorized', message: 'invalid or expired token' });
      return;
    }

    req.user = { id: verified.id, email: verified.email };
    next();
  };
}