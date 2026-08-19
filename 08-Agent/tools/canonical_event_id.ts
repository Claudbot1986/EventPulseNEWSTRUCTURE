/**
 * canonical_event_id — entity resolution across sources.
 *
 * Two events from different sources are "the same real-world event"
 * when their (title, day, venue) triple agrees after canonical
 * normalization. This module computes a stable `canonical_event_id`
 * for any event row, suitable for the partial-unique index on
 * `events.canonical_event_id` (migration 20260818-0001, line 29).
 *
 * ─── Research basis (2026-08-19) ────────────────────────────────────────────
 *
 * Record linkage (Fellegi & Sunter 1969): the canonical decision-theory
 * framing — given two records, classify the pair as a match, non-match,
 * or "possible match requiring manual review". For v1 we ship the
 * conservative exact-match variant (matches only) — false positives
 * cause user-visible errors (collapsing two real events into one) so
 * we err strict.
 *
 * Adaptive similarity (Bilenko & Mooney 2003): learned similarity
 * metrics can adapt to a corpus. v2 may add Jaro-Winkler title
 * similarity above a threshold, gated by the same day + same venue
 * blocking key (Christen 2012 §4.3, "blocking").
 *
 * Blocking (Whang & Garcia-Molina 2012): to keep matching O(n) instead
 * of O(n²), partition records by a cheap key. Here: same day + same
 * venue_id form the blocking bucket — within a bucket we then compare
 * titles for similarity. v1 doesn't need a separate index because
 * our scale is small (target ~10K future events); v2 may add a
 * `(start_day, venue_id)` derived index.
 *
 * Unicode normalization (Unicode 15.0 §3.7): NFC vs NFD. We use NFD
 * followed by stripping combining marks (U+0300–U+036F) so "Söder"
 * and "Soder" both normalize to "soder" — without that, the same
 * venue title in two sources with inconsistent diacritics would never
 * match. This is the "aggressive normalization" pattern from
 * Christen 2012 §5.2.
 *
 * ─── Why this design ────────────────────────────────────────────────────────
 *
 * - Conservative: exact match on (title + day + venue). No fuzzy
 *   threshold = no false positives. We accept leaving some true
 *   duplicates unresolved for v1 — better than merging wrong rows.
 * - Stockholm timezone: events published in Swedish local time, but
 *   stored as UTC. A concert starting "2026-08-19T22:00:00Z" is on
 *   August 20 in Stockholm (CEST = UTC+2). Day bucketing by UTC
 *   would mis-cluster late-evening events.
 * - venue_id over venue_name: the DB already has a venue resolution
 *   pipeline (04-Normalizer/venue-matching). Reusing venue_id gives
 *   a stable, deduplicated signal; falling back to "no_venue" for
 *   events that haven't been venue-resolved yet.
 * - No new dependencies: built-ins only (Intl.DateTimeFormat for
 *   timezone, String.prototype.normalize for Unicode).
 *
 * Out of scope (v1):
 *  - Title similarity above a threshold (Jaro-Winkler / Levenshtein).
 *  - Cross-lingual matching (Swedish title ↔ English title for the
 *    same event). v2 can address by picking a canonical title_sv
 *    preference upstream.
 *  - Probabilistic match scoring (Fellegi-Sunter u/v probabilities).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Canonical-normalize a free-text title. Strips diacritics, lowercases,
 * removes non-alphanumeric (keeps digits and spaces), collapses
 * whitespace. Idempotent: normalizeTitle(normalizeTitle(x)) === normalizeTitle(x).
 *
 *   "Jazz på Söder"   → "jazz pa soder"
 *   "CONCERT #5!"     → "concert 5"
 *   "  Konsert  Live" → "konsert live"
 *   ""                → ""
 *
 * Why this is the right level of aggression:
 *  - Diacritic stripping catches "Söder"/"Soder" mismatch (Fellegi-Sunter
 *    in practice: titles from Swedish/English-language sources vary).
 *  - Punctuation stripping catches "Concert: Live!" vs "Concert Live"
 *    mismatch (a common source-side variation in venue listings).
 *  - We do NOT strip stopwords ("the", "a", "och") — that would risk
 *    merging "Concert A" with "Concert B" (both become "concert").
 */
export function normalizeTitle(title: string): string {
  if (!title) return '';
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (U+0300–U+036F)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format an ISO-8601 timestamp as YYYY-MM-DD in Europe/Stockholm.
 *
 *   "2026-08-19T22:00:00.000Z" → "2026-08-20"   (CEST, 00:00 local next day)
 *   "2026-08-19T10:00:00.000Z" → "2026-08-19"   (12:00 local)
 *   "2026-01-15T23:00:00.000Z" → "2026-01-16"   (CET, 00:00 local next day)
 *   "2026-03-29T01:30:00.000Z" → "2026-03-29"   (DST jump day, Europe/Stockholm)
 *
 * Built on Intl.DateTimeFormat with the 'en-CA' locale which renders
 * YYYY-MM-DD by default. No external date-fns or luxon dependency.
 */
export function stockholmDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    // Bad input — throw so the downstream UPDATE fails loudly rather
    // than silently clustering on "Invalid Date".
    throw new Error(`stockholmDay: invalid ISO timestamp: ${JSON.stringify(iso)}`);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Choose the best title from a row's title_sv / title_en pair.
 *
 * Preference: title_sv if non-empty (Stockholm product is Swedish-first).
 * Fall back to title_en. Empty string if both empty.
 */
export function pickTitle(input: { title_sv?: string | null; title_en?: string | null }): string {
  const sv = (input.title_sv ?? '').trim();
  if (sv) return sv;
  return (input.title_en ?? '').trim();
}

/**
 * Compute the canonical_event_id for one event.
 *
 *   canonical_event_id = normalizeTitle(title) + "|" + stockholmDay(start_time) + "|" + venue_id
 *
 * Idempotent: f(f(input)) === f(input). Pure: no side effects.
 *
 * venue_id is required by the masterplan formula. When missing (the
 * event hasn't been venue-resolved yet), we use the sentinel "no_venue"
 * so that:
 *   (a) the formula always produces a string (callers can index safely)
 *   (b) events with no venue cluster together instead of polluting
 *       other rows' canonical ids
 *   (c) it's obvious in DB inspection which rows lack venue linkage
 */
export function computeCanonicalEventId(input: {
  title: string;
  start_time: string;
  venue_id?: string | null;
}): string {
  const titlePart = normalizeTitle(input.title);
  const dayPart = stockholmDay(input.start_time);
  const venuePart = input.venue_id ?? 'no_venue';
  return `${titlePart}|${dayPart}|${venuePart}`;
}

// ─── Backfill worker ────────────────────────────────────────────────────────

export interface BackfillResult {
  /** Rows whose canonical_event_id was successfully assigned. */
  updated: number;
  /** Rows skipped due to unique-index conflicts (same canonical_id
   *  already exists for another event row). */
  collisions: number;
  /** Rows skipped because of invalid input (missing title or
   *  unparseable start_time). */
  skipped: number;
}

export interface BackfillOptions {
  /** How many rows to fetch per batch. Default 500. */
  batchSize?: number;
  /** Maximum rows to process in this run. Default unlimited. */
  maxRows?: number;
}

/**
 * Backfill canonical_event_id for events that don't have one yet.
 *
 * Selects batches of events where canonical_event_id IS NULL, computes
 * the canonical id for each, and UPDATEs. Conflict handling: the
 * partial unique index `idx_events_canonical_event_id` will reject
 * duplicate canonical_ids — we count those as collisions and move on.
 *
 * Best-effort by design: a unique-violation for one row does not
 * abort the batch. The worker keeps going.
 *
 * Not invoked automatically — caller (cron / one-shot script) decides
 * when to run. We do NOT add this to the chat path: it's a
 * non-interactive, server-side maintenance operation.
 */
export async function backfillCanonicalEventIds(
  supabase: SupabaseClient,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxRows = opts.maxRows ?? Infinity;

  let updated = 0;
  let collisions = 0;
  let skipped = 0;
  let processed = 0;

  while (processed < maxRows) {
    // Cap the fetch at the smaller of batchSize or remaining budget so
    // we never over-fetch (and never process a row past maxRows).
    const fetchLimit = Math.min(batchSize, maxRows - processed);
    const { data: rows, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, start_time, venue_id')
      .is('canonical_event_id', null)
      .limit(fetchLimit);
    if (error) throw new Error(`backfill: select failed: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      if (processed >= maxRows) break;
      const title = pickTitle(row);
      if (!title || !row.start_time) { skipped++; processed++; continue; }
      let canonical: string;
      try {
        canonical = computeCanonicalEventId({
          title,
          start_time: row.start_time,
          venue_id: row.venue_id ?? null,
        });
      } catch {
        skipped++;
        processed++;
        continue;
      }
      const { error: upErr } = await supabase
        .from('events')
        .update({ canonical_event_id: canonical })
        .eq('id', row.id);
      if (upErr) {
        // Postgres unique-violation code 23505 → already assigned to
        // another row; that's expected (not a bug). Anything else is
        // an actual error.
        if (upErr.code === '23505') collisions++;
        else throw new Error(`backfill: update ${row.id} failed: ${upErr.message}`);
      } else {
        updated++;
      }
      processed++;
    }
    // If the batch came back smaller than the fetch limit, we've
    // reached the end of the NULL set.
    if (rows.length < fetchLimit) break;
  }

  return { updated, collisions, skipped };
}