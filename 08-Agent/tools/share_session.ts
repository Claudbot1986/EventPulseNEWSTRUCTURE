/**
 * 08-Agent/tools/share_session — short-hash generation + shared_sessions CRUD.
 *
 * T0061 / MVP-gap §78: "Share plan" deep-link mechanism.
 *
 * Why a separate module (not inline in server.ts):
 *   - Pure functions (hash, validate, buildInsert) are testable in isolation.
 *   - Keeps server.ts a routing layer, not a business-logic layer.
 *   - Mirrors the pattern set by get_saved_events.ts, follow_drops.ts etc.
 *
 * Hash algorithm:
 *   SHA-1 of (session_id || query || event_ids || ts), take 6 bytes → 48
 *   bits, mask to 30 bits, encode as base32 0-9a-z. Why not base36/62:
 *   - Base32 alphanumeric is URL-safe without escaping.
 *   - 6 chars × 5 bits = 30 bits; collision chance in 10K rows ~10⁻⁷.
 *   - 6 chars are readable in share-screen previews (vs. 36 for uuids).
 */

import { createHash } from 'node:crypto';

export const HASH_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const HASH_LEN = 6;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Generate a 6-char base32 hash deterministically from input parts.
 *  Uses SHA-1 (crypto module) so it's deterministic across Node versions
 *  and resists the same collision risk as the prior FNV-1a draft.
 *  - `ts` defaults to 0 so call sites are reproducible in tests; pass
 *    a fresh number when you actually want a unique hash. */
export function generateShortHash(parts: Array<string | number>, ts: number = 0): string {
  const h = createHash('sha1');
  for (const p of parts) h.update(String(p));
  h.update(String(ts));

  const digest = h.digest();
  // First 6 bytes = 48 bits. Mask to 30 bits (5 bits per char × 6 chars).
  let num = 0n;
  for (let i = 0; i < 6; i++) num = (num << 8n) | BigInt(digest[i]);
  const mask = (1n << 30n) - 1n;
  num = num & mask;

  let out = '';
  for (let i = 0; i < HASH_LEN; i++) {
    const idx = Number(num & 31n);
    out = HASH_ALPHABET[idx] + out;
    num = num >> 5n;
  }
  return out;
}

export const DEFAULT_TTL_HOURS = 24 * 30; // 30 days
export const MIN_TTL_HOURS = 1;
export const MAX_TTL_HOURS = 24 * 90; // 90 days
export const MAX_QUERY_LENGTH = 500;
export const MAX_EVENT_IDS_PER_SHARE = 12;

export interface ShareRow {
  id: string;
  query: string;
  event_ids: string[];
  expires_at: string; // ISO 8601 UTC
  created_at: string; // ISO 8601 UTC
  view_count: number;
}

export interface ShareInsert {
  id: string;
  session_id: string | null;
  query: string;
  event_ids: string[];
  expires_at: string; // ISO 8601 UTC
}

export type ShareBuildResult =
  | { ok: true; row: ShareInsert }
  | { ok: false; warning: string };

/** Build the JSONB-shaped payload for an INSERT into shared_sessions.
 *  Validates: non-empty trimmed query; event_ids is UUIDs or empty;
 *  ttl_hours within bounds. */
export function buildShareInsert({
  sessionId,
  query,
  eventIds,
  ttlHours,
  now,
}: {
  sessionId?: string;
  query: string;
  eventIds: string[];
  ttlHours?: number;
  now?: Date;
}): ShareBuildResult {
  const trimmed = (query ?? '').trim();
  if (trimmed.length === 0) return { ok: false, warning: 'query must not be empty' };
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { ok: false, warning: `query must be ≤ ${MAX_QUERY_LENGTH} chars` };
  }

  const ids = (eventIds ?? []).slice(0, MAX_EVENT_IDS_PER_SHARE);
  for (const id of ids) {
    if (!UUID_RE.test(id)) return { ok: false, warning: `event_id not a uuid: ${id}` };
  }

  const ttl = clampTtl(ttlHours ?? DEFAULT_TTL_HOURS);
  const base = now ?? new Date();
  const expiresAt = new Date(base.getTime() + ttl * 3600 * 1000);

  // Hash keyed off the request's precise timestamp; this gives uniqueness
  // across requests without a separate nonce column.
  const id = generateShortHash(
    [sessionId ?? 'anon', trimmed, ids.join(',')],
    Math.floor(base.getTime() / 1000)
  );

  return {
    ok: true,
    row: {
      id,
      session_id: sessionId ?? null,
      query: trimmed,
      event_ids: ids,
      expires_at: expiresAt.toISOString(),
    },
  };
}

/** Clamp ttl_hours to the [MIN, MAX] range. Out-of-range → MIN. */
export function clampTtl(hours: number): number {
  if (!Number.isFinite(hours)) return MIN_TTL_HOURS;
  if (hours < MIN_TTL_HOURS) return MIN_TTL_HOURS;
  if (hours > MAX_TTL_HOURS) return MAX_TTL_HOURS;
  return Math.round(hours);
}
