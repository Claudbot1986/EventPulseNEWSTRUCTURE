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
 *
 * `rejectReason` is forwarded for the `reject` (and `dismiss` /
 * `feedback_negative`) interactions so the personalization layer can
 * bucket venues by *why* the user rejected, not just *that* they did.
 * The server defaults it to 'not_interested' when omitted.
 */
export async function recordEventInteraction({
  eventId,
  interaction, // 'click' | 'outbound' | 'save' | 'reject' | 'dismiss' | 'feedback_positive' | 'feedback_negative'
  sessionId,
  queryText,
  rejectReason,
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
        reject_reason: rejectReason,
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

/**
 * Persist the user's category preferences to the agent backend.
 * Called after onboarding (or when user updates preferences in Profile).
 * Best-effort: never throws. Silences errors so onboarding cannot block.
 *
 * @param {{ categories: string[] }} preferences — object with `categories` key
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean }>}
 */
export async function savePreferencesToServer({ categories }, { signal, timeoutMs = 5000 } = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = () => clearTimeout(timer);
  if (signal) {
    if (signal.aborted) { controller.abort(); }
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${baseUrl}/agent/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id, categories }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    return { ok: true };
  } catch (_err) {
    return { ok: false };
  } finally {
    cleanup();
  }
}

// Re-exported for callers that want to await identity without poking storage directly.
export { getOrCreateAnonUserId };

/**
 * Follow or unfollow an entity (venue or artist) — T0050 / MVP-gap §77.
 *
 * Body shape (POST /agent/follow):
 *   { client_user_id, entity_type: 'venue' | 'artist',
 *     entity_id, action: 'follow' | 'unfollow' }
 *
 * The backend persists to `user_preferences.preferences.followed_venue_ids`
 * (uuid[]) or `followed_artist_slugs` (text[]). The chat handler reads these
 * lists and applies a `followed_venue_match` (20) / `followed_artist_match`
 * ranker boost, so the action also re-shapes the next chat turn's results.
 *
 * Back-compat: callers that only send `venue_id` (no entity_type) still work
 * — the backend defaults `entity_type = 'venue'` when `artist_slug` is unset.
 *
 * Best-effort: never throws. Returns { ok, warning } so the UI's long-press
 * action sheet can auto-dismiss on either path.
 */
export async function followEntity({
  entityType,
  entityId,
  action,
  venueId,
  artistSlug,
  signal,
  timeoutMs = 4_000,
}) {
  if (!entityId && !venueId && !artistSlug) {
    return { ok: false, warning: 'entity_id (or venue_id/artist_slug) is required' };
  }
  if (action !== 'follow' && action !== 'unfollow') {
    return { ok: false, warning: "action must be 'follow' or 'unfollow'" };
  }
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const body = {
    client_user_id,
    entity_type: entityType,
    action,
  };
  if (entityId) body.entity_id = entityId;
  else if (venueId) body.venue_id = venueId;
  else if (artistSlug) body.artist_slug = artistSlug;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${baseUrl}/agent/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

/**
 * Read the user's currently-followed venues and artists — T0050.
 *
 * GET /agent/follow?client_user_id=<uuid>
 *
 * Response shape:
 *   {
 *     ok: true,
 *     venue_ids: string[],
 *     artist_slugs: string[],
 *     counts: { venues, artists, total }
 *   }
 *
 * Best-effort: never throws. A failure returns an empty list so the long-
 * press action sheet shows the optimistic "Följ" default. The caller can
 * inspect `warning` to surface a transient error banner if desired.
 */
export async function getFollowedEntities({ signal, timeoutMs = 4_000 } = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, venueIds: [], artistSlugs: [], count: 0, warning: 'config' };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const url = new URL(`${baseUrl}/agent/follow`);
  url.searchParams.set('client_user_id', client_user_id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, venueIds: [], artistSlugs: [], count: 0, warning: `agent ${response.status}` };
    }
    const data = await response.json();
    const venueIds = Array.isArray(data.venue_ids) ? data.venue_ids : [];
    const artistSlugs = Array.isArray(data.artist_slugs) ? data.artist_slugs : [];
    return {
      ok: true,
      venueIds,
      artistSlugs,
      count: venueIds.length + artistSlugs.length,
    };
  } catch (_err) {
    return { ok: false, venueIds: [], artistSlugs: [], count: 0, warning: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

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
    // The agent API already enforces "specific event URL only" upstream
    // (see 02-Ingestion/F-eventExtraction/extractor.ts pickEventUrl), so
    // any non-null ticket_url here is safe to surface as an external link.
    const ticketUrl = e.ticket_url || null;
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
      url: ticketUrl,
      ticket_url: ticketUrl,
      imageUrl: e.image_url || null,
      image_url: e.image_url || null,
      // Surface the actual upstream source (ticketmaster, kulturhuset, …)
      // instead of the hardcoded "agent" so App.js getCtaText(source)
      // can pick a venue-specific CTA like "Köp biljett via Ticketmaster".
      // Falls back to 'agent' when the upstream omits it.
      source: e.source || 'agent',
      // Drive the UI's external-link affordances. Without these flags the
      // card chip ("Extern länk") and the details-screen CTA ("Läs mer")
      // are hidden even when a valid ticket_url is present, which is the
      // "events saknar klickbara länkar" bug.
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
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

/**
 * Fetch AI-recommended events for the HomeScreen "Rekommenderat" section — T0056.
 *
 * GET /agent/recommended?client_user_id=<uuid>&limit=<int>
 *
 * Returns EventCard[] ranked by the user's personalization signals (followed
 * venues, followed artists, onboarding categories, recency), with rank reasons.
 * Reuses the same EventCard → legacy-shape mapping as fetchFeed so the
 * HomeScreen card renderer stays uniform.
 */
export async function fetchRecommendedEvents({ limit = 10, signal, timeoutMs = 12_000 } = {}) {
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/recommended`);
  url.searchParams.set('limit', String(limit));

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
    throw new Error(`recommended ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const rawEvents = Array.isArray(data.events) ? data.events : [];

  // Identical EventCard → legacy shape mapping as fetchFeed for card uniformity.
  const events = rawEvents.map((e) => {
    const start = e.start_time ? new Date(e.start_time) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const date = start && !Number.isNaN(start.getTime())
      ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
      : null;
    const time = start && !Number.isNaN(start.getTime())
      ? `${pad(start.getHours())}:${pad(start.getMinutes())}`
      : null;
    const ticketUrl = e.ticket_url || null;
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
      url: ticketUrl,
      ticket_url: ticketUrl,
      imageUrl: e.image_url || null,
      image_url: e.image_url || null,
      source: e.source || 'agent',
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
    };
  });

  return { events };
}

/** YYYY-MM-DD `days` days after `from` (UTC, mirrors server-side addDays). */
export function addDays(from, days) {
  const d = new Date(`${from}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return from;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch time-aware suggested prompt chips — T0057 / Phase 1 retention.
 *
 * GET /agent/suggested-prompts?client_user_id=<uuid>
 *
 * Returns 3–5 contextual prompt chips:
 *   { prompts: [{ id, prompt_text, reason, category? }] }
 *
 * Chips are generated server-side from time-of-day, weekend flag, stated
 * onboarding categories, and followed artists/venues. The client renders
 * the chips verbatim — no transformation needed.
 *
 * @param {{ limit?: number, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ prompts: SuggestedPrompt[] }>}
 */
export async function fetchSuggestedPrompts({
  limit = 5,
  signal,
  timeoutMs = 12_000,
} = {}) {
  const { getOrCreateAnonUserId } = await import('./storage');
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/suggested-prompts`);
  const clientUserId = await getOrCreateAnonUserId();
  url.searchParams.set('client_user_id', clientUserId);
  url.searchParams.set('limit', String(limit));

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
    throw new Error(`suggested-prompts ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const rawPrompts = Array.isArray(data.prompts) ? data.prompts : [];
  const prompts = rawPrompts
    .filter((p) => p && typeof p.prompt_text === 'string' && p.prompt_text.length > 0)
    .slice(0, limit)
    .map((p) => ({
      id: String(p.id ?? p.prompt_text),
      prompt_text: p.prompt_text,
      reason: typeof p.reason === 'string' ? p.reason : '',
      category: typeof p.category === 'string' && p.category.length > 0 ? p.category : undefined,
    }));

  return { prompts };
}

/**
 * Build the URL for an event's RFC-5545 calendar export — T0058 / Phase 1 retention.
 *
 * GET /agent/events/:id/calendar.ics?client_user_id=<uuid>
 *
 * Returns the URL the caller should pass to Linking.openURL. We deliberately
 * do NOT fetch the .ics body here — iOS/Android handle the URL directly,
 * which avoids loading the full .ics text into the JS bundle. Apple Wallet
 * .pkpass is deferred to T0066 (needs signing certs).
 *
 * @param {string} eventId
 * @param {string} clientUserId
 * @returns {{ url: string }}
 */
export function fetchEventIcs(eventId, clientUserId) {
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return Promise.reject(new Error('eventId is required'));
  }
  if (typeof clientUserId !== 'string' || clientUserId.length === 0) {
    return Promise.reject(new Error('clientUserId is required'));
  }
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/events/${encodeURIComponent(eventId)}/calendar.ics`);
  url.searchParams.set('client_user_id', clientUserId);
  return Promise.resolve({ url: url.toString() });
}

/**
 * Fetch the user's saved events — T0054 / Phase 1 retention.
 *
 * GET /agent/saved?client_user_id=<uuid>&limit=<int>
 *
 * Returns EventCard[] sorted by saved_at DESC (most recently saved first).
 * Reuses the same EventCard → legacy-shape mapping as fetchFeed so the
 * HomeScreen card renderer stays uniform across sections.
 */
export async function fetchSavedEvents({ limit = 50, signal, timeoutMs = 12_000 } = {}) {
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/saved`);
  url.searchParams.set('limit', String(limit));

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
    throw new Error(`saved ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const rawEvents = Array.isArray(data.events) ? data.events : [];

  // Identical EventCard → legacy shape mapping as fetchFeed for card uniformity.
  const events = rawEvents.map((e) => {
    const start = e.start_time ? new Date(e.start_time) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const date = start && !Number.isNaN(start.getTime())
      ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
      : null;
    const time = start && !Number.isNaN(start.getTime())
      ? `${pad(start.getHours())}:${pad(start.getMinutes())}`
      : null;
    const ticketUrl = e.ticket_url || null;
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
      url: ticketUrl,
      ticket_url: ticketUrl,
      imageUrl: e.image_url || null,
      image_url: e.image_url || null,
      source: e.source || 'agent',
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
    };
  });

  return { events };
}
