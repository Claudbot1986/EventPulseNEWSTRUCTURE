/**
 * live_now — read-only tool that lists events currently in progress.
 *
 * T0083 / MVP-gap §77 (Phase 1 retention): "Happening now" surface.
 *
 * A "live" event is one whose:
 *   - start_time <= now          (it has started)
 *   - end_time   >= now - grace  (it has not ended, with a 30-min grace)
 *
 * Why 30min grace: organizers often don't update end_time exactly when a
 * show actually finishes. The grace keeps events visible a little after
 * their nominal end_time so the user doesn't see them flip out of LIVE
 * mid-conversation. 30 minutes matches the Stockholm-event-night
 * observation in 23-Active-Task-Queue.md (T0083 spec).
 *
 * Sorting: start_time ASC (the event that started earliest is the most
 * "settled" live event; latest-starting is the most "just started"). This
 * matches the ranker convention and the existing EventCard ordering.
 *
 * Cap: 3 events. Matches the HomeScreen "top strip" surface — the user
 * sees up to 3 LIVE cards with a pulsing red dot. Anything beyond 3 would
 * be visual noise on a 360x640 phone screen.
 *
 * Source: events_public (anon-readable). Same RLS posture as
 * search_events — service_role on 08-Agent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventCard } from '../types';

export interface LiveNowInput {
  /**
   * Override the "now" clock for tests. Defaults to `Date.now()`. Exported
   * so the unit tests can pin the clock without monkey-patching.
   */
  now?: Date;
  /**
   * Override the grace window (minutes). Defaults to LIVE_NOW_GRACE_MINUTES.
   * Kept as an input so future tuning can be A/B-tested without code changes.
   */
  graceMinutes?: number;
  /**
   * Override the max-returned-events cap. Defaults to LIVE_NOW_MAX_EVENTS.
   * The HomeScreen top strip shows up to 3 cards; a smaller cap (1, 2)
   * is supported for future surfaces (push notifications, etc.).
   */
  limit?: number;
}

export interface LiveNowResult {
  events: EventCard[];
  warnings: string[];
  /**
   * The exact "now" the tool computed against. Surfaced for the client so
   * it can compare against a future re-fetch and explain why an event
   * disappeared from LIVE (e.g. "ended at 23:15").
   */
  computed_at: string;
  /**
   * Grace window in minutes actually applied to this call. Echoed for
   * debugging — clients can show it in dev builds if needed.
   */
  grace_minutes: number;
}

export const LIVE_NOW_TABLE: 'events_public' = 'events_public';
export const LIVE_NOW_GRACE_MINUTES = 30;
export const LIVE_NOW_MAX_EVENTS = 3;
export const LIVE_NOW_DEFAULT_LIMIT = LIVE_NOW_MAX_EVENTS;

/** Columns the live_now select pulls. Mirrors feed_events.ts shape so the
 *  EventCard mapping below is consistent across tools. */
const LIVE_NOW_SELECT_COLUMNS =
  'id, title_sv, title_en, start_time, end_time, venue_id, ' +
  'category_slug, is_free, price_min_sek, price_max_sek, ticket_url, image_url, ' +
  'source, ' +
  'venues:venue_id(name, city)';

interface LiveRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  start_time: string;
  end_time: string | null;
  venue_id: string | null;
  category_slug: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  price_max_sek: number | null;
  ticket_url: string | null;
  image_url: string | null;
  image_license: string | null;
  image_attribution: string | null;
  image_source_url: string | null;
  source: string | null;
  venues: { name: string; city: string | null } | null;
}

/**
 * Filter rows to those "live" at `now`. Pure: no IO.
 *
 * Rule (per spec):
 *   - event.start_time <= now                                 (has started)
 *   - event.end_time IS NULL OR end_time + grace >= now       (hasnt ended)
 *
 * Events with a NULL end_time are treated as still-live for the grace
 * window — this matches the ranker's existing convention (see rank_events.ts
 * where missing end_time means "treat as future-only" but for LIVE we
 * instead treat as "in progress until grace elapses"). An event with a
 * NULL start_time is impossible by schema, but the filter still drops it
 * defensively.
 *
 * Exported for tests so the time-window logic can be exercised without
 * touching Supabase.
 */
export function filterLiveRows(
  rows: ReadonlyArray<LiveRow>,
  now: Date,
  graceMinutes: number,
): LiveRow[] {
  const nowMs = now.getTime();
  const graceMs = graceMinutes * 60 * 1000;
  return rows.filter((r) => {
    const startMs = new Date(r.start_time).getTime();
    if (Number.isNaN(startMs)) return false;
    if (startMs > nowMs) return false;
    if (r.end_time === null || r.end_time === undefined) return true;
    const endMs = new Date(r.end_time).getTime();
    if (Number.isNaN(endMs)) return true; // defensive: bad end_time -> treat as live
    return endMs + graceMs >= nowMs;
  });
}

/**
 * Sort live events by start_time ASC (earliest started first).
 * Pure. Exported for tests.
 */
export function sortLiveRows(rows: ReadonlyArray<LiveRow>): LiveRow[] {
  return [...rows].sort((a, b) => {
    const aMs = new Date(a.start_time).getTime();
    const bMs = new Date(b.start_time).getTime();
    return aMs - bMs;
  });
}

/** Map a LiveRow to an EventCard. Mirrors feed_events.ts shape. Pure. */
function rowToCard(r: LiveRow): EventCard {
  return {
    id: r.id,
    title: r.title_sv || r.title_en || 'Untitled',
    start_time: r.start_time,
    end_time: r.end_time ?? null,
    venue_name: r.venues?.name ?? '',
    venue_id: r.venue_id ?? null,
    city: r.venues?.city ?? 'Stockholm',
    category_slug: r.category_slug ?? '',
    price_min_sek: r.price_min_sek ?? null,
    price_max_sek: r.price_max_sek ?? null,
    is_free: !!r.is_free,
    ticket_url: r.ticket_url ?? null,
    image_url: r.image_url ?? null,
    image_license: r.image_license ?? null,
    image_attribution: r.image_attribution ?? null,
    image_source_url: r.image_source_url ?? null,
    source: r.source ?? null,
  };
}

/**
 * Fetch events currently in progress. Best-effort: Supabase errors return
 * an empty list with a warning; never throws.
 *
 * Implementation notes:
 *  - We pull rows whose start_time is in [now - 12h, now]. 12h is the
 *    hard upper bound on what could possibly be "live" given a 30-min
 *    grace (no Stockholm event lasts 12h). Keeping the window bounded
 *    keeps the query cheap.
 *  - Time-window predicates are evaluated server-side; the grace filter
 *    runs client-side because PostgreSQL timestamptz arithmetic with a
 *    JS-defined constant is cleaner this side, and rows are already
 *    bounded to start within 12h.
 */
export async function liveEvents(
  supabase: SupabaseClient,
  input: LiveNowInput = {},
): Promise<LiveNowResult> {
  const now = input.now ?? new Date();
  const graceMinutes = Math.max(input.graceMinutes ?? LIVE_NOW_GRACE_MINUTES, 0);
  const limit = Math.min(
    Math.max(input.limit ?? LIVE_NOW_DEFAULT_LIMIT, 1),
    LIVE_NOW_MAX_EVENTS,
  );

  const warnings: string[] = [];

  // Over-fetch so the post-sort slice has enough candidates. 5x limit is
  // a reasonable cap: if 15+ events are live simultaneously, the
  // start_time ASC sort still picks the 3 most "settled" ones.
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const fetchLimit = Math.max(limit * 5, 15);

  const { data, error } = await supabase
    .from(LIVE_NOW_TABLE)
    .select(LIVE_NOW_SELECT_COLUMNS)
    .gte('start_time', twelveHoursAgo)
    .lte('start_time', now.toISOString())
    .order('start_time', { ascending: true })
    .limit(fetchLimit);

  if (error) {
    return {
      events: [],
      warnings: [`live_now error: ${error.message}`],
      computed_at: now.toISOString(),
      grace_minutes: graceMinutes,
    };
  }

  const rows = (data ?? []) as unknown as LiveRow[];
  const live = filterLiveRows(rows, now, graceMinutes);
  const sorted = sortLiveRows(live);
  const sliced = sorted.slice(0, limit);
  const events = sliced.map(rowToCard);

  return {
    events,
    warnings,
    computed_at: now.toISOString(),
    grace_minutes: graceMinutes,
  };
}
