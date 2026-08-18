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
 */

const AGENT_BASE_URL =
  process.env.EXPO_PUBLIC_AGENT_URL || 'http://localhost:8787';

const DEFAULT_TIMEOUT_MS = 12_000;

function uuidv4() {
  // RFC4122-ish. Sufficient for anon client_user_id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getOrCreateAnonUserId() {
  const KEY = 'eventpulse.anon_user_id';
  let id = null;
  try {
    // globalThis.localStorage works in Expo Web; AsyncStorage is recommended
    // for native — we accept the web fallback here for Phase 0.
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      id = globalThis.localStorage.getItem(KEY);
      if (!id) {
        id = uuidv4();
        globalThis.localStorage.setItem(KEY, id);
      }
    }
  } catch (_err) {
    // Storage unavailable — generate ephemeral id.
  }
  return id ?? uuidv4();
}

export async function chatWithAgent({ message, sessionId, origin, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!message || typeof message !== 'string') {
    throw new Error('message is required');
  }
  const client_user_id = getOrCreateAnonUserId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = signal ?? null;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(`${AGENT_BASE_URL}/agent/chat`, {
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
    throw new Error(`agent ${response.status}: ${text || response.statusText}`);
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
    const response = await fetch(`${AGENT_BASE_URL}/agent/health`);
    return response.ok;
  } catch {
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
  const client_user_id = getOrCreateAnonUserId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${AGENT_BASE_URL}/agent/feedback`, {
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

export { AGENT_BASE_URL, getOrCreateAnonUserId };

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
  const url = new URL(`${AGENT_BASE_URL}/agent/feed`);
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
