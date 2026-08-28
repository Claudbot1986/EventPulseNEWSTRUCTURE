/**
 * EventPulse Notifications Client
 *
 * T0048 / MVP-gap §77: thin client around `GET /agent/notifications` and
 * `POST /agent/notifications/read` so the NotificationsScreen can render
 * real per-user notifications (Phase 1: app-open notification center;
 * Phase 2 will add expo-notifications push on top).
 *
 * Wire shape (mirrors `08-Agent/tools/notification_center.ts`):
 *   GET  /agent/notifications?client_user_id=<uuid>&limit=<int>
 *        → { notifications: NotificationRow[] }
 *   POST /agent/notifications/read { client_user_id, notification_id }
 *        → { ok: true } | 202 { ok: false, warning }
 *
 * NotificationRow shape:
 *   {
 *     id, kind: 'reminder' | 'match' | 'response',
 *     title, body, event_id,
 *     created_at (ISO 8601), status: 'unread' | 'read'
 *   }
 *
 * Polling (Phase 1): no WebSocket yet — the screen calls `fetchNotifications`
 * on mount + on focus. A 60s soft TTL avoids hammering the server when
 * the screen is left open. WebSocket push is deferred to Phase 2 (push).
 *
 * Identity: same anon UUID pattern as `agentClient.js` — read once via
 * `getOrCreateAnonUserId`, cached for the lifetime of the screen.
 *
 * Best-effort: every function swallows network errors and returns a
 * safe default. The screen degrades to its empty-state copy on failure.
 */

import { getOrCreateAnonUserId } from './storage';

const AGENT_BASE_URL = process.env.EXPO_PUBLIC_AGENT_URL;

function requireAgentBaseUrl() {
  if (!AGENT_BASE_URL || typeof AGENT_BASE_URL !== 'string' || AGENT_BASE_URL.trim() === '') {
    const err = new Error('EXPO_PUBLIC_AGENT_URL is not set. The agent API base URL must be configured before the app can request notifications.');
    err.code = 'AGENT_URL_MISSING';
    throw err;
  }
  return AGENT_BASE_URL.replace(/\/+$/, '');
}

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Validate one parsed row. Defensive — bad rows are dropped silently so a
 *  schema drift on the server side never breaks the screen render. */
function sanitize(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  const kind = row.kind;
  if (kind !== 'reminder' && kind !== 'match' && kind !== 'response') return null;
  return {
    id: row.id,
    kind,
    title: typeof row.title === 'string' ? row.title : '',
    body: typeof row.body === 'string' ? row.body : '',
    event_id: typeof row.event_id === 'string' ? row.event_id : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    status: row.status === 'read' ? 'read' : 'unread',
  };
}

/**
 * GET /agent/notifications
 *
 * @param {{ limit?: number, signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: true, notifications: Array } | { ok: false, warning: string }>}
 */
export async function fetchNotifications({ limit = DEFAULT_LIMIT, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const client_user_id = await getOrCreateAnonUserId();

  const url = new URL(`${baseUrl}/agent/notifications`);
  url.searchParams.set('client_user_id', client_user_id);
  url.searchParams.set('limit', String(safeLimit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, warning: `agent ${response.status}` };
    }
    const data = await response.json();
    const raw = Array.isArray(data.notifications) ? data.notifications : [];
    const notifications = raw.map(sanitize).filter(Boolean);
    return { ok: true, notifications };
  } catch (_err) {
    return { ok: false, warning: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /agent/notifications/read
 *
 * Best-effort: never throws. The UI uses this so the unread badge can
 * flip without re-fetching the entire list.
 *
 * @param {{ notificationId: string, signal?: AbortSignal, timeoutMs?: number }} input
 * @returns {Promise<{ ok: boolean, warning?: string }>}
 */
export async function markNotificationRead({ notificationId, signal, timeoutMs = 4_000 }) {
  if (!notificationId || typeof notificationId !== 'string') {
    return { ok: false, warning: 'missing notificationId' };
  }
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const client_user_id = await getOrCreateAnonUserId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${baseUrl}/agent/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id, notification_id: notificationId }),
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 202) {
      return { ok: false, warning: `agent ${response.status}` };
    }
    const data = await response.json().catch(() => ({ ok: true }));
    return { ok: !!data.ok, warning: data.warning };
  } catch (_err) {
    return { ok: false, warning: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Group notifications into the three buckets the screen renders. Pure —
 * no I/O, so it's safe to call from a useMemo without dependency churn.
 *
 * Order within each bucket: newest first. Order across buckets:
 *   1. Påminnelser (reminders)
 *   2. Nya matchningar (matches)
 *   3. Svar (responses)
 *
 * @param {Array} notifications
 * @returns {{ reminders: Array, matches: Array, responses: Array, total: number }}
 */
export function groupNotifications(notifications) {
  const groups = { reminders: [], matches: [], responses: [] };
  if (!Array.isArray(notifications)) return { ...groups, total: 0 };
  for (const n of notifications) {
    if (n.kind === 'reminder') groups.reminders.push(n);
    else if (n.kind === 'match') groups.matches.push(n);
    else if (n.kind === 'response') groups.responses.push(n);
  }
  // Sort each bucket by created_at desc. Defensive against bad inputs.
  const byCreatedDesc = (a, b) => {
    const ta = Date.parse(a.created_at) || 0;
    const tb = Date.parse(b.created_at) || 0;
    return tb - ta;
  };
  groups.reminders.sort(byCreatedDesc);
  groups.matches.sort(byCreatedDesc);
  groups.responses.sort(byCreatedDesc);
  return { ...groups, total: notifications.length };
}

/** Compose the deep-link target from a notification row. Mirrors the
 *  App.js / HomeScreen deep-link convention so a single source of truth
 *  drives "Öppna" navigation. */
export function deepLinkFor(notification) {
  if (!notification) return null;
  if (notification.event_id) {
    return { screen: 'EventDetail', params: { id: notification.event_id } };
  }
  return null;
}

/**
 * GET /agent/attendance — T0082.
 *
 * Returns past saved events that the user has not yet rated. The UI
 * renders these in the "Attended" section of NotificationsScreen so the
 * user can leave feedback even if the attendance_prompt cron has not
 * fired yet.
 *
 * Wire: `{ events: Array<{ id, title, venue_name, start_time }> }`
 *
 * Best-effort: never throws. Returns `{ ok: false, warning: 'config' }`
 * if the agent URL is missing, or `'network'` on a network error.
 *
 * @param {{ limit?: number, signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: true, events: Array } | { ok: false, warning: string }>}
 */
export async function fetchUnratedSavedEvents({ limit = DEFAULT_LIMIT, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const client_user_id = await getOrCreateAnonUserId();

  const url = new URL(`${baseUrl}/agent/attendance`);
  url.searchParams.set('client_user_id', client_user_id);
  url.searchParams.set('limit', String(safeLimit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, warning: `agent ${response.status}` };
    }
    const data = await response.json();
    const raw = Array.isArray(data.events) ? data.events : [];
    // Defensive sanitize — drop rows missing required fields.
    const events = raw
      .filter((row) => row && typeof row === 'object' && typeof row.id === 'string' && row.id.length > 0)
      .map((row) => ({
        id: row.id,
        title: typeof row.title === 'string' ? row.title : 'Sparat event',
        venue_name: typeof row.venue_name === 'string' ? row.venue_name : null,
        start_time: typeof row.start_time === 'string' ? row.start_time : '',
      }));
    return { ok: true, events };
  } catch (_err) {
    return { ok: false, warning: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
