/**
 * follow_drops — T0059 / MVP-gap §77.
 *
 * For every user that follows one or more venues, find events from those
 * venues that were *first-seen* within the recent window (default 30 min)
 * and persist a follow_drop notification per (user, event) tuple.
 *
 * Why this exists:
 *   T0050 ships the follow_venue surface (POST /agent/follow) and a ranker
 *   lift when a followed venue matches. But following a venue does nothing
 *   on its own — without a push trigger, the user opens the app weeks
 *   later and forgets why they hit "Följ". Bandsintown's core mechanic is
 *   "new event from a followed artist → notify within minutes". This is
 *   the venue half of that pattern.
 *
 * Idempotency:
 *   We use a deterministic notification id (FNV-1a hash of
 *   (client_user_id | venue_id | event_id | 'follow_drop')) so re-runs of
 *   the same logical drop are no-ops via the notifications.id primary key.
 *   The freshness_at column on events_public is the source of truth for
 *   "first seen" — once an event is processed, subsequent cron passes
 *   skip it (we read freshness_at >= now - WINDOW_MS, not >= every restart).
 *
 * Artist follow → push is intentionally deferred (Phase 2). The
 * event_artists join table is empty and the artists table has no rows,
 * so we can't build the artist-side match without schema work that's out
 * of scope for T0059. The notifications.kind enum already includes
 * 'artist_drop' so a Phase 2 implementation only needs to add the
 * matching tool — no migration.
 *
 * Best-effort: never throws. Returns ok:false + warning on errors so the
 * cron supervisor can graph metrics without crashing on a transient hiccup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isUuid,
  type NotificationRow,
} from './notification_center';

/** Default window — 30 minutes per the T0059 task brief. Long enough to
 *  catch events missed by one pass, short enough to fire within the same
 *  hour a venue publishes. Tests can override via opts.windowMs. */
export const FOLLOW_DROP_WINDOW_MS = 30 * 60 * 1000;

/** Hard upper bound on how many follow_drop notifications a single user
 *  can receive per run. Mirrors generateRemindersForUser.maxRows = 20.
 *  Prevents a venue that bulk-imports 200 events from flooding the feed. */
export const MAX_FOLLOW_DROP_ROWS_PER_USER = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure helper: deterministic notification id for a (user, venue, event)
 *  follow-drop tuple. Same inputs always produce the same id so a re-run
 *  within the freshness window is a no-op via the notifications PK.
 *  Format: 32-char FNV-1a hex padded to UUID shape (matches the
 *  reminderNotificationId pattern in notification_center.ts). */
export function followDropNotificationId(
  client_user_id: string,
  venue_id: string,
  event_id: string
): string {
  let hash = 0x811c9dc5;
  const input = `${client_user_id}|${venue_id}|${event_id}|follow_drop`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0').repeat(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Read the user's followed venue ids, with a defensive read-modify that
 *  doesn't require importing the cache machinery from follow_entity.ts
 *  (the cron may run in a process that has cleared in-memory state). */
export async function readFollowedVenueIds(
  supabase: SupabaseClient,
  client_user_id: string
): Promise<{ ok: boolean; venueIds: string[]; warning?: string }> {
  if (!isUuid(client_user_id)) {
    return { ok: false, venueIds: [], warning: 'client_user_id must be a uuid' };
  }
  const result = await supabase
    .from('user_preferences')
    .select('preferences')
    .eq('client_user_id', client_user_id)
    .maybeSingle();
  if (result.error) {
    return { ok: false, venueIds: [], warning: `preferences read failed: ${result.error.message}` };
  }
  const prefs = (result.data?.preferences ?? null) as
    | { followed_venue_ids?: unknown }
    | null;
  if (!prefs || !Array.isArray(prefs.followed_venue_ids)) {
    return { ok: true, venueIds: [] };
  }
  const venueIds = prefs.followed_venue_ids.filter(
    (v): v is string => typeof v === 'string' && UUID_RE.test(v)
  );
  return { ok: true, venueIds };
}

/** Public input shape for `generateFollowDropsForUser`. */
export interface GenerateFollowDropsInput {
  client_user_id: string;
  /** Override the freshness window — defaults to FOLLOW_DROP_WINDOW_MS. */
  windowMs?: number;
  /** Override "now" — used by tests for deterministic replay. */
  now?: Date;
  /** Cap on rows produced per user. Default 20. */
  maxRows?: number;
}

export interface GenerateFollowDropsResult {
  ok: boolean;
  inserted: number;
  skipped: number;
  eligible: number;
  notifications: NotificationRow[];
  warning?: string;
}

/** Slim view of an event row — only the columns the cron actually needs. */
interface EventCandidate {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  venue_id: string | null;
  venue_name: string | null;
  start_time: string;
  freshness_at: string;
}

/** Build the follow_drop NotificationRow payload for a single event. The
 *  body line carries the local event date so the UI can render
 *  "Nytt på Debaser: Smash Into Pieces — 21 aug" without an extra
 *  round-trip. Title is Swedish with English fallback. */
function buildFollowDropRow(
  client_user_id: string,
  venue_id: string,
  event: EventCandidate,
  now: Date
): NotificationRow {
  const title = event.title_sv || event.title_en || 'Nytt event';
  const venueLabel = event.venue_name || 'följd venue';
  // YYYY-MM-DD in UTC — the UI reformats to local-time via the same
  // helper it uses for EventCard. ISO date-only is unambiguous.
  const startDate = event.start_time.slice(0, 10);
  return {
    id: followDropNotificationId(client_user_id, venue_id, event.id),
    client_user_id,
    kind: 'follow_drop',
    title: `Nytt på ${venueLabel}: ${title}`,
    body: `Börjar ${startDate}`,
    event_id: event.id,
    created_at: now.toISOString(),
    status: 'unread',
  };
}

/**
 * For a single user: find events from venues the user follows whose
 * `freshness_at` falls within [now - windowMs, now], and persist a
 * follow_drop notification for each one we haven't already notified
 * about.
 */
export async function generateFollowDropsForUser(
  supabase: SupabaseClient,
  input: GenerateFollowDropsInput
): Promise<GenerateFollowDropsResult> {
  if (!isUuid(input.client_user_id)) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      eligible: 0,
      notifications: [],
      warning: 'client_user_id must be a uuid',
    };
  }
  const now = input.now ?? new Date();
  const windowMs = input.windowMs ?? FOLLOW_DROP_WINDOW_MS;
  const maxRows = input.maxRows ?? MAX_FOLLOW_DROP_ROWS_PER_USER;
  const windowStart = new Date(now.getTime() - windowMs);

  // 1) Load the user's followed venue ids.
  const followsResult = await readFollowedVenueIds(supabase, input.client_user_id);
  if (!followsResult.ok) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      eligible: 0,
      notifications: [],
      warning: followsResult.warning,
    };
  }
  if (followsResult.venueIds.length === 0) {
    return { ok: true, inserted: 0, skipped: 0, eligible: 0, notifications: [] };
  }

  // 2) Find events from those venues with freshness_at in the window.
  //    .in('venue_id', venueIds) is bounded by MAX_FOLLOWED_VENUES in
  //    follow_entity.ts (200), so the query stays cheap.
  const eventsResult = await supabase
    .from('events_public')
    .select(
      'id, title_sv, title_en, venue_id, start_time, freshness_at, ' +
      'venues:venue_id(name)'
    )
    .in('venue_id', followsResult.venueIds)
    .gte('freshness_at', windowStart.toISOString())
    .lte('freshness_at', now.toISOString())
    .order('freshness_at', { ascending: false })
    .limit(maxRows * 2); // over-fetch; we filter + dedup client-side

  if (eventsResult.error) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      eligible: 0,
      notifications: [],
      warning: `events query failed: ${eventsResult.error.message}`,
    };
  }

  const rawRows = (eventsResult.data ?? []) as unknown as Array<
    Omit<EventCandidate, 'venue_name'> & { venues: { name: string | null } | null }
  >;
  const eligible: EventCandidate[] = [];
  for (const row of rawRows) {
    if (!row.venue_id) continue;
    eligible.push({
      id: row.id,
      title_sv: row.title_sv,
      title_en: row.title_en,
      venue_id: row.venue_id,
      venue_name: row.venues?.name ?? null,
      start_time: row.start_time,
      freshness_at: row.freshness_at,
    });
    if (eligible.length >= maxRows) break;
  }
  if (eligible.length === 0) {
    return { ok: true, inserted: 0, skipped: 0, eligible: 0, notifications: [] };
  }

  // 3) Build deterministic notification rows.
  const candidates: NotificationRow[] = eligible.map((e) =>
    buildFollowDropRow(input.client_user_id, e.venue_id!, e, now)
  );

  // 4) Skip ones we already wrote (read-modify-write to count actual
  //    skips so the cron can surface useful metrics).
  const existingResult = await supabase
    .from('notifications')
    .select('id')
    .in('id', candidates.map((c) => c.id));
  if (existingResult.error) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      eligible: candidates.length,
      notifications: [],
      warning: `existing notifications query failed: ${existingResult.error.message}`,
    };
  }
  const existingIds = new Set(
    ((existingResult.data ?? []) as Array<{ id: string }>).map((r) => r.id)
  );
  const fresh = candidates.filter((c) => !existingIds.has(c.id));
  if (fresh.length === 0) {
    return {
      ok: true,
      inserted: 0,
      skipped: candidates.length,
      eligible: candidates.length,
      notifications: [],
    };
  }

  // 5) Insert. PK conflict is impossible because we filtered existing,
  //    but we use plain .insert here (the deterministic-id pattern is
  //    belt-and-braces for race conditions between two cron instances).
  const insertResult = await supabase.from('notifications').insert(fresh);
  if (insertResult.error) {
    return {
      ok: false,
      inserted: 0,
      skipped: candidates.length - fresh.length,
      eligible: candidates.length,
      notifications: [],
      warning: `notifications insert failed: ${insertResult.error.message}`,
    };
  }
  return {
    ok: true,
    inserted: fresh.length,
    skipped: candidates.length - fresh.length,
    eligible: candidates.length,
    notifications: fresh,
  };
}
