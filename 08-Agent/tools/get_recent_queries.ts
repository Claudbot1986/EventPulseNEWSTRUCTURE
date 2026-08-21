/**
 * get_recent_queries — distinct recent user queries for HomeScreen.
 *
 * T0071 / MVP-gap §79 (Phase 1 retention): "Dina senaste sökningar"
 * section. The agent currently has no in-memory notion of what the user
 * asked for last session — every cold start begins with zero context.
 * Surfacing the actual queries the user has run in the last 7 days
 * gives them a single tap to resume where they left off.
 *
 * Why query_text on `impression` rows:
 *   The agent server writes `query_text` to user_interactions whenever
 *   it logs an impression row (see server.ts chat handler — `query_text:
 *   body.message`). It is the ONLY field on user_interactions that
 *   captures the raw user query verbatim. There is no dedicated
 *   `chat_message` interaction type in the schema (the CHECK constraint
 *   is limited to first-class funnel rows: impression / click / outbound
 *   / save / reject / dismiss / feedback_* / dwell).
 *
 * Dedupe strategy:
 *   1. Server-side: read rows from `user_interactions` where
 *      `interaction = 'impression'` AND `query_text IS NOT NULL` AND
 *      `query_text <> ''` AND `created_at >= now() - 7d`.
 *   2. Order by `created_at DESC` so most recent first.
 *   3. Pull up to `limit * 4` rows so post-dedupe we still surface at
 *      least `limit` unique queries (cap to keep memory bounded).
 *   4. Client-side: dedupe on trimmed / lowercased text. The first
 *      occurrence wins (it is the most recent by construction).
 *   5. Trim whitespace, drop empties. Drop exact duplicates case-insensitive.
 *
 * Response shape:
 *   { queries: Array<{ id: string, query_text: string, last_used_at: string }> }
 *
 *   id          — stable per query (lowercase + dash) for React keys
 *   query_text  — original (unmodified) user text, NOT lowercased
 *   last_used_at — ISO timestamp of the most recent impression row that
 *                  carried this query
 *
 * Best-effort: never throws. Returns { queries: [], warning } on DB error
 * so the HomeScreen section can hide itself cleanly (mirrors the
 * /agent/suggested-prompts and /agent/cached-recommendations patterns).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default number of recent queries returned. Matches the HomeScreen
 *  chip cap ("max 5 chips" per T0071). */
export const GET_RECENT_QUERIES_DEFAULT_LIMIT = 5;

/** Hard cap; prevents runaway reads when the user has chatted a lot. */
export const GET_RECENT_QUERIES_MAX_LIMIT = 20;

/** How many days back to scan. T0071 spec: 7d. */
const LOOKBACK_DAYS = 7;

/** Multiplier applied to the requested limit before reading rows, so
 *  post-dedupe we still have enough unique queries. 4× is empirically
 *  generous (most users rephrase, not repeat verbatim). */
const FETCH_MULTIPLIER = 4;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecentQuery {
  /** Stable key derived from query_text (lowercase, non-alnum → '-'). */
  id: string;
  /** Original user query text, untrimmed. UI displays this verbatim. */
  query_text: string;
  /** ISO timestamp of the most recent matching row. */
  last_used_at: string;
}

export interface RecentQueriesResult {
  queries: RecentQuery[];
  /** Populated when the DB read failed; UI uses this to hide the section. */
  warning?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize a query into a stable React key. Lowercase, replace any
 *  non-alphanumeric run with a single dash, trim leading/trailing dashes,
 *  transliterate Swedish chars so "Gratis åäö" doesn't produce a weird key.
 *  Always returns at least 'q' so the React key never collides with an
 *  empty string. */
function makeQueryId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[åäöé]/g, (m) => ({ å: 'a', ä: 'a', ö: 'o', é: 'e' })[m] ?? m)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'q';
}

/** Trim and collapse whitespace. Empty string → null (caller drops). */
function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

// ─── Main exported function ─────────────────────────────────────────────────

export interface GetRecentQueriesOptions {
  supabase: SupabaseClient;
  client_user_id: string;
  /** Override the current time for testing (defaults to `new Date()`). */
  now?: Date;
  /** Override the default limit (1..MAX_LIMIT). Defaults to
   *  GET_RECENT_QUERIES_DEFAULT_LIMIT (5). */
  limit?: number;
}

/**
 * Read the user's distinct recent queries from `user_interactions`.
 *
 * Best-effort: never throws. Returns `{ queries: [], warning: '…' }`
 * on DB error so the HomeScreen section can simply hide itself.
 */
export async function getRecentQueries({
  supabase,
  client_user_id,
  now,
  limit = GET_RECENT_QUERIES_DEFAULT_LIMIT,
}: GetRecentQueriesOptions): Promise<RecentQueriesResult> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), GET_RECENT_QUERIES_MAX_LIMIT);

  const t = now ?? new Date();
  // Lookback boundary: 7 days back from `now`. ISO timestamp.
  const since = new Date(t.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Read up to (limit × multiplier) rows ordered most-recent-first.
  // We deliberately pull a superset so dedupe still yields `limit` rows
  // even when the user has repeated queries or sent short one-word ones.
  const fetchSize = Math.min(safeLimit * FETCH_MULTIPLIER, 200);

  let rows: Array<{ query_text: unknown; created_at: unknown }> | null = null;
  let dbError: string | null = null;
  try {
    const { data, error } = await supabase
      .from('user_interactions')
      .select('query_text, created_at')
      .eq('client_user_id', client_user_id)
      .eq('interaction', 'impression')
      .not('query_text', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(fetchSize);
    if (error) {
      dbError = `recent-queries select failed: ${error.message}`;
    } else {
      rows = Array.isArray(data) ? (data as Array<{ query_text: unknown; created_at: unknown }>) : [];
    }
  } catch (err: unknown) {
    dbError = err instanceof Error ? err.message : 'unknown';
  }

  if (dbError || !rows) {
    return { queries: [], warning: dbError ?? 'unknown' };
  }

  // Dedupe on trimmed lowercased text. First occurrence wins (it is the
  // most recent because we ordered DESC upstream). Track both the cleaned
  // form (for dedupe key) and the raw form (so the UI shows what the user
  // actually typed, including original casing).
  const seen = new Set<string>();
  const out: RecentQuery[] = [];
  for (const row of rows) {
    if (out.length >= safeLimit) break;
    const cleaned = cleanQuery(row.query_text);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lastUsedAt = typeof row.created_at === 'string' ? row.created_at : t.toISOString();
    out.push({
      id: makeQueryId(cleaned),
      query_text: cleaned,
      last_used_at: lastUsedAt,
    });
  }

  return { queries: out };
}
