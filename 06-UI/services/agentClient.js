/**
 * EventPulse Agent Client (Phase 0)
 *
 * Replaces the anon-key /supabase-events direct path with a private /agent/chat
 * call. The Expo app no longer needs the Supabase service key or even the anon
 * key for browsing — the agent API is the only entry point.
 *
 * Wire format (mirrors 08-Agent/types.ts):
 *   request:  { client_user_id, session_id?, message, origin? }
 *   response: { session_id, reply, cards: EventCard[], warnings: string[] }
 *
 * EventCard shape used by AgentScreen:
 *   { id, title, start_time, end_time, venue_name, city,
 *     category_slug, price_min_sek, price_max_sek, is_free,
 *     ticket_url, image_url }
 *
 * Identity (Phase 1 §18 D4): `client_user_id` is loaded from AsyncStorage via
 * ./storage so it survives cold restarts. Reads are awaited so the same
 * identity is used on the first request, not raced.
 *
 * Base URL (Phase 1 §18 D4): comes exclusively from `EXPO_PUBLIC_AGENT_URL`.
 * No localhost fallback — unset means a loud configuration error rather than
 * a silent "looks like it works" loopback.
 */

import { getOrCreateAnonUserId } from './storage';

const AGENT_BASE_URL = process.env.EXPO_PUBLIC_AGENT_URL;

function requireAgentBaseUrl() {
  if (!AGENT_BASE_URL || typeof AGENT_BASE_URL !== 'string' || AGENT_BASE_URL.trim() === '') {
    const err = new Error('EXPO_PUBLIC_AGENT_URL is not set. The agent API base URL must be configured before the app can send requests.');
    err.code = 'AGENT_URL_MISSING';
    throw err;
  }
  return AGENT_BASE_URL.replace(/\/+$/, '');
}

const DEFAULT_TIMEOUT_MS = 12_000;

export async function chatWithAgent({ message, sessionId, origin, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!message || typeof message !== 'string') {
    throw new Error('message is required');
  }
  const baseUrl = requireAgentBaseUrl();
  const client_user_id = await getOrCreateAnonUserId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = signal ?? null;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id,
        session_id: sessionId,
        message,
        origin: origin ?? 'expo',
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`agent ${response.status}: ${text || response.statusText}`);
    err.code = 'AGENT_SERVER_ERROR';
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return {
    sessionId: data.session_id ?? sessionId ?? null,
    reply: data.reply ?? '',
    cards: Array.isArray(data.cards) ? data.cards : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    clarifyingQuestions: Array.isArray(data.clarifying_questions)
      ? data.clarifying_questions
      : [],
  };
}

export async function getAgentHealth() {
  try {
    const baseUrl = requireAgentBaseUrl();
    const response = await fetch(`${baseUrl}/agent/health`);
    return response.ok;
  } catch (_err) {
    return false;
  }
}

/**
 * Record a user interaction for one event card (Phase 1 success tracking).
 *
 * Best-effort: never throws. The server returns 202 with a warning if the
 * write is rejected (e.g. unknown interaction). We swallow that to keep the
 * UI flow uninterrupted.
 */
export async function recordEventInteraction({
  eventId,
  interaction, // 'click' | 'outbound' | 'save' | 'dismiss' | 'feedback_positive' | 'feedback_negative'
  sessionId,
  queryText,
  timeoutMs = 4_000,
}) {
  if (!eventId || !interaction) return { ok: false, warning: 'missing fields' };
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/agent/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id,
        session_id: sessionId,
        event_id: eventId,
        interaction,
        query_text: queryText,
      }),
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 202) {
      return { ok: false, warning: `agent ${response.status}` };
    }
    return await response.json().catch(() => ({ ok: true }));
  } catch (_err) {
    return { ok: false, warning: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// Re-exported for callers that want to await identity without poking storage directly.
export { getOrCreateAnonUserId };

/**
 * Browse feed: GET /agent/feed?from=YYYY-MM-DD&days=7
 *
 * Returns the events_public slice in [from, from+days), sorted ascending by
 * start_time. Used by the default browse-first UI; pagination advances
 * `from` by 7 days per scroll-end.
 *
 * Maps EventCard → the legacy shape App.js expects (date/time split out
 * from start_time, url aliased to ticket_url, etc.) so the existing UI
 * code doesn't need to change.
 */
export async function fetchFeed({ from, days = 7, signal, timeoutMs = 12_000 } = {}) {
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/feed`);
  url.searchParams.set('from', from);
  url.searchParams.set('days', String(days));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`feed ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const rawEvents = Array.isArray(data.events) ? data.events : [];

  // EventCard → legacy shape so App.js HomeScreen keeps working.
  // Use local-time date/time components, not UTC slices, so Stockholm
  // events display at their local clock time (not UTC).
  const events = rawEvents.map((e) => {
    const start = e.start_time ? new Date(e.start_time) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const date = start && !Number.isNaN(start.getTime())
      ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
      : null;
    const time = start && !Number.isNaN(start.getTime())
      ? `${pad(start.getHours())}:${pad(start.getMinutes())}`
      : null;
    return {
      id: e.id,
      title: e.title || 'Untitled',
      date,
      time,
      start_time: e.start_time,
      venue: e.venue_name || '',
      venue_name: e.venue_name || '',
      area: e.city || 'Stockholm',
      city: e.city || 'Stockholm',
      category: e.category_slug || '',
      category_slug: e.category_slug || '',
      isFree: !!e.is_free,
      is_free: !!e.is_free,
      priceMin: e.price_min_sek ?? null,
      price_min_sek: e.price_min_sek ?? null,
      priceMax: e.price_max_sek ?? null,
      price_max_sek: e.price_max_sek ?? null,
      url: e.ticket_url || null,
      ticket_url: e.ticket_url || null,
      imageUrl: e.image_url || null,
      image_url: e.image_url || null,
      source: 'agent',
    };
  });

  return {
    events,
    from: data.from,
    to: data.to,
    has_more: !!data.has_more,
    next_from: data.next_from,
  };
}

/** YYYY-MM-DD `days` days after `from` (UTC, mirrors server-side addDays). */
export function addDays(from, days) {
  const d = new Date(`${from}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return from;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
