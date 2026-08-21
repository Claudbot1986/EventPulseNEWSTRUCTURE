/**
 * notification_center — derives per-user notification rows from real data.
 *
 * T0048 / MVP-gap §77: produce reminder notifications 2h before saved events
 * start. Reads `user_interactions` (interaction='save') joined with
 * `events_public` (start_time) and emits NotificationRow entries that the
 * NotificationsScreen renders as "Påminnelse" cards.
 *
 * Design constraints:
 *   - All inputs are real DB rows. No synthetic / placeholder reminders —
 *     matches the "no fake data as proof" rule in CLAUDE.md.
 *   - The window is dynamic: any saved event whose `start_time` is in
 *     `[now, now + WINDOW_MS]` and that has NOT yet been reminded about.
 *   - Idempotency is per-(user, event, start_time) so a re-run within
 *     the same window does NOT produce a duplicate row. We persist the
 *     notification itself to `notifications` (see 05-Supabase migration),
 *     so subsequent reads see only newly-eligible events.
 *
 * This module is also the source-of-truth factory for the `notification`
 * shape consumed by the UI (via /agent/notifications). Keep the type
 * alignment tight with notificationsClient.js so the wire format cannot
 * drift from the on-disk shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Default 2h window — matches the user-facing copy ("påminnelser 2 timmar
 *  innan"). Tests can override via the optional `windowMs` parameter. */
export const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Status of a notification from the user's perspective. */
export type NotificationStatus = 'unread' | 'read';

/** Notification kinds surfaced in the UI. Keep in sync with the docstring
 *  on NotificationsScreen.js and the grouping logic there. */
export type NotificationKind = 'reminder' | 'match' | 'response';

/** Persisted + serialized notification row. */
export interface NotificationRow {
  id: string;
  client_user_id: string;
  /** Stable kind label — drives the UI grouping ("Påminnelse" / "Ny matchning"
   *  / "Svar"). The shape is intentionally narrow; deep-link payload lives
   *  on `event_id` so the client can build the route itself. */
  kind: NotificationKind;
  /** Human-readable title (Swedish; UI i18n comes later). */
  title: string;
  /** Optional body / subline. Empty string when there is nothing useful to
   *  say — saves the UI a null check. */
  body: string;
  /** Reference to the event this notification is about. null when not
   *  tied to a single event (kept on the type for future "agent reply"
   *  notifications). */
  event_id: string | null;
  /** ISO timestamp at which the notification was generated. */
  created_at: string;
  status: NotificationStatus;
}

/** Raw row returned by Supabase from the saved-events join.
 *  events_public exposes `id` (not `event_id`); the join key is implicit
 *  via the `.in('id', eventIds)` filter. */
interface SavedEventRow {
  id: string;
  start_time: string;
  title_sv: string | null;
  title_en: string | null;
  venue_name: string | null;
  venue_city: string | null;
}

/** Pure helper: turn a (user, event, start_time) tuple into a stable
 *  notification id. Same inputs always produce the same id, so we can
 *  deduplicate without an extra table lookup. */
export function reminderNotificationId(
  client_user_id: string,
  event_id: string,
  start_time_iso: string
): string {
  // FNV-1a 32-bit, hex. Deterministic, no dependency on crypto.
  let hash = 0x811c9dc5;
  const input = `${client_user_id}|${event_id}|${start_time_iso}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Pad to 32 chars so it looks uuid-shaped (clients sometimes parse as uuid).
  const hex = hash.toString(16).padStart(8, '0').repeat(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate that a string is a uuid — used as the precondition for any
 *  call site that passes through user/event ids from the wire surface. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Public input shape for `generateRemindersForUser`. `now` is injectable
 *  so the cron job can be replayed deterministically in tests. */
export interface GenerateRemindersInput {
  client_user_id: string;
  /** Override the default 2h window. Defaults to REMINDER_WINDOW_MS. */
  windowMs?: number;
  /** Override "now" — used by tests. Default `new Date()`. */
  now?: Date;
  /** Cap on rows produced per user. Default 20 — enough for one weekend
   *  of saved events without flooding the feed. */
  maxRows?: number;
}

export interface GenerateRemindersResult {
  ok: boolean;
  /** Number of new reminder rows persisted. */
  inserted: number;
  /** Number of reminder rows that were already present (idempotent skip). */
  skipped: number;
  /** Total number of saved events that fell inside the reminder window
   *  (including ones that were skipped because we already notified). */
  eligible: number;
  /** The new reminder rows that were persisted (id shape only). */
  notifications: NotificationRow[];
  /** Non-fatal error message (e.g. Supabase read failure). */
  warning?: string;
}

/**
 * For a given user, find saved events whose `start_time` is within
 * [now, now + windowMs] and persist a reminder NotificationRow for each
 * one we have not yet reminded about.
 *
 * Implementation notes:
 *   - We do the join client-side to keep the Supabase query surface
 *     narrow (avoid PostgREST embedding quirks). The "save" rows are
 *     distinct(event_id) so a user who saved-and-unsaved-saved the same
 *     event only produces one reminder.
 *   - Insertions go through `.upsert(onConflict='id')` so a re-run of
 *     the same logical reminder is a no-op. The id is deterministic via
 *     reminderNotificationId so we never produce two rows for the same
 *     (user, event, start_time) tuple — and we never delete history.
 *   - Best-effort: never throws. Returns ok:false + warning on errors.
 */
export async function generateRemindersForUser(
  supabase: SupabaseClient,
  input: GenerateRemindersInput
): Promise<GenerateRemindersResult> {
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
  const windowMs = input.windowMs ?? REMINDER_WINDOW_MS;
  const maxRows = input.maxRows ?? 20;
  const windowEnd = new Date(now.getTime() + windowMs);

  // 1) Fetch distinct saved event_ids for this user.
  const savesResult = await supabase
    .from('user_interactions')
    .select('event_id')
    .eq('client_user_id', input.client_user_id)
    .eq('interaction', 'save')
    .not('event_id', 'is', null);
  if (savesResult.error) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      eligible: 0,
      notifications: [],
      warning: `saves query failed: ${savesResult.error.message}`,
    };
  }
  const eventIds = Array.from(
    new Set(
      (savesResult.data ?? [])
        .map((r: { event_id: string | null }) => r.event_id)
        .filter((id): id is string => typeof id === 'string' && isUuid(id))
    )
  );
  if (eventIds.length === 0) {
    return { ok: true, inserted: 0, skipped: 0, eligible: 0, notifications: [] };
  }

  // 2) Look up the saved events in events_public, filtered to the window.
  const eventsResult = await supabase
    .from('events_public')
    .select(
      'id, title_sv, title_en, start_time, ticket_url, ' +
      'venues:venue_id(name, city)'
    )
    .in('id', eventIds)
    .gte('start_time', now.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .order('start_time', { ascending: true })
    .limit(maxRows);
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

  const eligibleRows = (eventsResult.data ?? []) as unknown as SavedEventRow[];
  if (eligibleRows.length === 0) {
    return { ok: true, inserted: 0, skipped: 0, eligible: 0, notifications: [] };
  }

  // 3) Build the candidate reminder rows (deterministic ids).
  const candidates: NotificationRow[] = eligibleRows.map((row) => {
    const id = reminderNotificationId(input.client_user_id, row.id, row.start_time);
    const title = row.title_sv || row.title_en || 'Sparat event';
    const start = new Date(row.start_time);
    const minutes = Math.max(
      1,
      Math.round((start.getTime() - now.getTime()) / 60000)
    );
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    let when: string;
    if (hours > 0 && mins > 0) when = `om ${hours} h ${mins} min`;
    else if (hours > 0) when = `om ${hours} h`;
    else when = `om ${mins} min`;
    return {
      id,
      client_user_id: input.client_user_id,
      kind: 'reminder',
      title,
      body: `Börjar ${when}`,
      event_id: row.id,
      created_at: now.toISOString(),
      status: 'unread',
    };
  });

  // 4) Upsert into notifications — onConflict='id' makes re-runs a no-op.
  //    We SELECT first to count actual skips (read-modify-write), so we
  //    can surface useful metrics to the caller (cron logs them).
  const existingResult = await supabase
    .from('notifications')
    .select('id')
    .in(
      'id',
      candidates.map((c) => c.id)
    );
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

/** Fetch all notifications for a user, newest first. Read-only — used by
 *  /agent/notifications and by the notificationsClient on the device. */
export async function listNotifications(
  supabase: SupabaseClient,
  client_user_id: string,
  opts: { limit?: number; now?: Date } = {}
): Promise<{ ok: boolean; notifications: NotificationRow[]; warning?: string }> {
  if (!isUuid(client_user_id)) {
    return { ok: false, notifications: [], warning: 'client_user_id must be a uuid' };
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const result = await supabase
    .from('notifications')
    .select('id, client_user_id, kind, title, body, event_id, created_at, status')
    .eq('client_user_id', client_user_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (result.error) {
    return { ok: false, notifications: [], warning: `list failed: ${result.error.message}` };
  }
  const rows = (result.data ?? []) as NotificationRow[];
  // Defensive: filter out any rows whose status is not a known value.
  const normalized: NotificationRow[] = rows.map((r) => ({
    ...r,
    status: r.status === 'read' ? 'read' : 'unread',
  }));
  return { ok: true, notifications: normalized };
}

/** Mark a single notification as read. Returns false on validation failure
 *  or DB error (does not throw). */
export async function markNotificationRead(
  supabase: SupabaseClient,
  client_user_id: string,
  notification_id: string
): Promise<{ ok: boolean; warning?: string }> {
  if (!isUuid(client_user_id) || !isUuid(notification_id)) {
    return { ok: false, warning: 'ids must be uuids' };
  }
  const result = await supabase
    .from('notifications')
    .update({ status: 'read' })
    .eq('id', notification_id)
    .eq('client_user_id', client_user_id);
  if (result.error) {
    return { ok: false, warning: `mark read failed: ${result.error.message}` };
  }
  return { ok: true };
}
