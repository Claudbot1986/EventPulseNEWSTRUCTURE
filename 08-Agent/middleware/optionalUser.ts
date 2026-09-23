/**
 * Optional Bearer-JWT user auth middleware (Fas C, 2026-09-23).
 *
 * Why:
 *   `/agent/feed` is the default-browse surface: anonymous users must get
 *   the exact same chronological page they get today. But a signed-in user
 *   in the PERSONALIZATION_PRIORS treatment group gets a taste-ranked page.
 *   That requires identity WITHOUT a gate — the opposite of requireUser.
 *
 * Design (mirrors requireUser.ts deliberately):
 *   - Reads `Authorization: Bearer <jwt>` when present.
 *   - Verifies it via the same `TokenVerifier` contract. Test injection
 *     via `createOptionalUser({ verify })` / `{ supabase }` — same pattern
 *     as `buildApp({ supabase, verify })`.
 *   - Valid token → `req.user = { id, email }`, next().
 *   - Missing, malformed, or invalid token → NO req.user, next(). Never
 *     401/403 — the endpoint stays fully usable anonymously. An expired
 *     token is indistinguishable from no token on this path.
 *
 * Out of scope:
 *   - Response headers (no WWW-Authenticate: we are not a challenge).
 *   - Refresh signaling (the client's user-scoped calls handle 401s on
 *     their own endpoints).
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TokenVerifier,
  type AuthenticatedUser,
  type VerifiedUser,
} from './requireUser';

export interface OptionalUserOptions {
  /** Custom token verifier — same contract as requireUser. */
  verify?: TokenVerifier;
  /** Supabase client used when no `verify` is provided (tests inject fakes). */
  supabase?: SupabaseClient;
}

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
 * Build an optional Bearer-JWT identity resolver.
 *
 * Usage in server.ts:
 *   const optionalUser = createOptionalUser({ verify });
 *   app.get('/agent/feed', generalLimiter.middleware, optionalUser, handler);
 *
 * `req.user` is set ONLY for a valid Bearer token; every other case calls
 * next() with no identity attached.
 */
export function createOptionalUser(opts: OptionalUserOptions = {}): RequestHandler {
  const verify = opts.verify ?? (opts.supabase ? buildDefaultVerifier(opts.supabase) : null);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // No verifier configured → stay anonymous (never break the endpoint).
    if (!verify) {
      next();
      return;
    }

    const header = req.header('authorization');
    if (!header) {
      next();
      return;
    }
    const m = /^Bearer\s+(.*)$/i.exec(header.trim());
    const presented = m ? m[1].trim() : '';
    if (presented.length === 0) {
      next();
      return;
    }

    let verified: VerifiedUser | null;
    try {
      verified = await verify(presented);
    } catch {
      verified = null;
    }
    if (verified) {
      const user: AuthenticatedUser = { id: verified.id, email: verified.email };
      req.user = user;
    }
    // Invalid/expired token: anonymous — the browse page must still work.
    next();
  };
}