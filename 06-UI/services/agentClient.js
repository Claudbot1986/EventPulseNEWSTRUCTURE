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
import { markOnline as notifyNetworkOnline } from './networkContext';

/** Never let connectivity bookkeeping fail a successful fetch. */
function markOnline() {
  if (typeof notifyNetworkOnline === 'function') {
    notifyNetworkOnline();
  }
}

const AGENT_BASE_URL = process.env.EXPO_PUBLIC_AGENT_URL;
const AGENT_LAN_URL = process.env.EXPO_PUBLIC_AGENT_URL_LAN;

function agentBaseUrls() {
  const urls = [];
  for (const raw of [AGENT_BASE_URL, AGENT_LAN_URL]) {
    if (typeof raw === 'string' && raw.trim()) {
      const u = raw.replace(/\/+$/, '');
      if (!urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

/** Last health-check winner so Tailscale and LAN can both work. */
let cachedAgentBase = null;

function requireAgentBaseUrl() {
  if (cachedAgentBase) return cachedAgentBase;
  const urls = agentBaseUrls();
  if (urls.length === 0) {
    const err = new Error('EXPO_PUBLIC_AGENT_URL is not set. The agent API base URL must be configured before the app can send requests.');
    err.code = 'AGENT_URL_MISSING';
    throw err;
  }
  return urls[0];
}

async function pickReachableAgentBase(timeoutMs = 2500) {
  if (cachedAgentBase) return cachedAgentBase;
  const urls = agentBaseUrls();
  if (urls.length === 0) {
    const err = new Error('EXPO_PUBLIC_AGENT_URL is not set. The agent API base URL must be configured before the app can send requests.');
    err.code = 'AGENT_URL_MISSING';
    throw err;
  }
  for (const base of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${base}/agent/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        cachedAgentBase = base;
        return base;
      }
    } catch {
      // try next candidate (Tailscale, then LAN)
    }
  }
  cachedAgentBase = urls[0];
  return cachedAgentBase;
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
  markOnline();
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
    const baseUrl = await pickReachableAgentBase();
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

/**
 * T0082 / MVP-gap §77: mark a saved event as attended.
 *
 * Best-effort: never throws. The server returns 202 with a warning if the
 * write is rejected (e.g. unknown interaction). We swallow that to keep the
 * UI flow uninterrupted — the rating step right after is the user-visible
 * signal that "we got your feedback".
 *
 * @param {{ eventId: string, signal?: AbortSignal, timeoutMs?: number }} input
 * @returns {Promise<{ ok: boolean, warning?: string }>}
 */
export async function recordAttendance({ eventId, signal, timeoutMs = 4_000 }) {
  if (!eventId || typeof eventId !== 'string') {
    return { ok: false, warning: 'missing eventId' };
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
    const response = await fetch(`${baseUrl}/agent/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id, event_id: eventId }),
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
 * T0082 / MVP-gap §77: submit a 1–5 star rating plus an optional short note.
 *
 * The server caps `note` at 140 chars and validates `rating` is an integer
 * in [1, 5]. The client trims and re-validates before sending so the user
 * gets instant feedback rather than waiting for the round-trip. No PII
 * scrubbing is performed server-side — the UI is responsible for hinting
 * the user (input placeholder "Hur var det? Inga personuppgifter tack.")
 * and the policy lives in the readme / onboarding copy.
 *
 * Best-effort: never throws.
 *
 * @param {{ eventId: string, rating: number, note?: string, signal?: AbortSignal, timeoutMs?: number }} input
 * @returns {Promise<{ ok: boolean, warning?: string }>}
 */
export async function recordRating({ eventId, rating, note, signal, timeoutMs = 4_000 }) {
  if (!eventId || typeof eventId !== 'string') {
    return { ok: false, warning: 'missing eventId' };
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, warning: 'rating must be 1..5' };
  }
  // Server caps at 140 chars; trim ahead of time so the UI shows the
  // count down to 140 honestly (the input maxLength already enforces it
  // but defensive trim protects against programmatic callers).
  const trimmedNote = typeof note === 'string' ? note.trim().slice(0, 140) : undefined;
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
    const response = await fetch(`${baseUrl}/agent/rating`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_user_id,
        event_id: eventId,
        rating,
        note: trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined,
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
 * Step A smoketest — fetch the AI-generated image library (T-AI-IMG).
 *
 * GET /agent/feed-ai-images?limit=<int>
 *
 * Returns up to `limit` events whose images have been AI-generated
 * (gpt-image-1) and watermarked per EU AI Act Article 50. The agent
 * server serves this only when AI_SMOKETEST_ENABLED=1; otherwise the
 * endpoint returns 404 and we treat it as an empty result so the
 * HomeScreen section silently hides itself.
 *
 * Wire shape mirrors the existing EventCard (legacy) format so the
 * existing card renderer can be reused — only the image URL is
 * overwritten to point at the static handler.
 */
export async function fetchAiImageSmoketest({
  limit = 10,
  provider = null,
  signal,
  timeoutMs = 8_000,
} = {}) {
  let baseUrl;
  try {
    baseUrl = await pickReachableAgentBase();
  } catch (_err) {
    return { events: [], warnings: ['config'] };
  }

  const url = new URL(`${baseUrl}/agent/feed-ai-images`);
  url.searchParams.set('limit', String(limit));
  if (provider) url.searchParams.set('provider', String(provider));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } catch (_err) {
    clearTimeout(timer);
    return { events: [], warnings: ['network'] };
  }
  clearTimeout(timer);

  // 404 = smoketest disabled on the server side. Treat as empty so the
  // HomeScreen section hides silently — same pattern as fetchLiveEvents.
  if (response.status === 404) {
    return { events: [], warnings: ['disabled'] };
  }
  if (!response.ok) {
    return { events: [], warnings: [`agent ${response.status}`] };
  }

  let data;
  try {
    data = await response.json();
  } catch (_err) {
    return { events: [], warnings: ['parse'] };
  }

  const rawEvents = Array.isArray(data?.events) ? data.events : [];
  const pad = (n) => String(n).padStart(2, '0');
  const events = rawEvents.slice(0, limit).map((e) => {
    const start = e.start_time ? new Date(e.start_time) : null;
    const date = start && !Number.isNaN(start.getTime())
      ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
      : null;
    const time = start && !Number.isNaN(start.getTime())
      ? `${pad(start.getHours())}:${pad(start.getMinutes())}`
      : null;
    // The server returns relative path `/agent/ai-image/<id>.png`. We
    // prefix with the chosen baseUrl so the app can hit either Tailscale
    // or LAN as usual — pickReachableAgentBase already chose the right
    // base.
    const relativeImage = typeof e.image_url === 'string' ? e.image_url : '';
    const imageUrl = relativeImage.startsWith('http')
      ? relativeImage
      : `${baseUrl}${relativeImage}`;
    return {
      id: e.id,
      title: e.title || 'Untitled',
      start_time: e.start_time,
      venue_name: e.venue_name || '',
      venue: e.venue_name || '',
      date,
      time,
      image_url: imageUrl,
      imageUrl,
      source: 'eventpulse-ai',
      prompt_hash: e.prompt_hash,
      generated_at: e.generated_at,
      model: e.model || 'unknown',
      watermark: 'AI-genererad',
      hasExternalLink: false,
    };
  });

  return { events, warnings: Array.isArray(data?.warnings) ? data.warnings : [] };
}

/**
 * Build the absolute URL for an AI-generated image — exposed so the
 * smoketest section can reuse it for individual events that arrived via
 * the regular /agent/feed (the agent server also serves /agent/ai-image/
 * for any eventId that was generated).
 */
export function buildAiImageUrl(eventId) {
  if (typeof eventId !== 'string' || eventId.length === 0) return null;
  const baseUrl = cachedAgentBase || (agentBaseUrls()[0] ?? null);
  if (!baseUrl) return null;
  return `${baseUrl}/agent/ai-image/${encodeURIComponent(eventId)}.png`;
}

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
  const baseUrl = await pickReachableAgentBase();
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
  markOnline();
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
      // AI image rollout (Utforska, 2026-08-26) — useAiImageUrl-hook reads these
      // to decide between pre-baked / lazy / original / empty box.
      image_ai_generated: e.image_ai_generated ?? false,
      image_ai_optout: e.image_ai_optout ?? false,
      image_generation_status: e.image_generation_status || null,
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
    // Canonical count of all future events from `from` onward, independent of
    // the local page. The HomeScreen header binds this so the displayed count
    // tracks Supabase, not the locally-paginated window. Defaults to the page
    // length so older agents (pre-2026-08-22) still render a sane number.
    total: typeof data.total === 'number' ? data.total : events.length,
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
  const client_user_id = await getOrCreateAnonUserId();
  url.searchParams.set('client_user_id', client_user_id);
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
  markOnline();
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
      // image_generation_status forwarded så UI kan visa "no credits BFL
      // - recharge" när AI-workern har slut på BFL-kredit. User request
      // 2026-08-25.
      image_generation_status: e.image_generation_status || null,
      image_ai_generated: e.image_ai_generated ?? false,
      image_ai_optout: e.image_ai_optout ?? false,
      source: e.source || 'agent',
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
    };
  });

  return { events };
}

/**
 * T0083 / MVP-gap §77 (Phase 1 retention): "Happening now" surface.
 *
 * GET /agent/live-now?limit=<1..3>
 *
 * Returns up to 3 events currently in progress
 * (start_time <= now <= end_time, with a 30-min grace past end_time),
 * sorted by start_time ASC. The HomeScreen top strip renders these as
 * LIVE cards with a pulsing red dot.
 *
 * Best-effort: network/5xx returns `{events: []}` so the section hides
 * itself silently. Never throws.
 *
 * Mapping is identical to fetchFeed/fetchRecommendedEvents so the existing
 * EventCard renderer stays uniform across sections.
 *
 * @param {{ limit?: number, signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ events: Array<LegacyEvent>, computed_at: string|null, grace_minutes: number }>}
 */
export async function fetchLiveEvents({
  limit = 3,
  signal,
  timeoutMs = 8_000,
} = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { events: [], computed_at: null, grace_minutes: 0 };
  }
  const url = new URL(`${baseUrl}/agent/live-now`);
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
  } catch (_err) {
    clearTimeout(timer);
    return { events: [], computed_at: null, grace_minutes: 0 };
  }
  clearTimeout(timer);

  if (!response.ok) {
    return { events: [], computed_at: null, grace_minutes: 0 };
  }

  const data = await response.json();
  markOnline();
  const rawEvents = Array.isArray(data.events) ? data.events : [];

  // Identical EventCard -> legacy shape mapping as fetchFeed for card uniformity.
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
      end_time: e.end_time || null,
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
      // image_generation_status forwarded så UI kan visa "no credits BFL
      // - recharge" när AI-workern har slut på BFL-kredit. User request
      // 2026-08-25.
      image_generation_status: e.image_generation_status || null,
      image_ai_generated: e.image_ai_generated ?? false,
      image_ai_optout: e.image_ai_optout ?? false,
      source: e.source || 'agent',
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
    };
  });

  return {
    events,
    computed_at: typeof data.computed_at === 'string' ? data.computed_at : null,
    grace_minutes: typeof data.grace_minutes === 'number' ? data.grace_minutes : 0,
  };
}

/**
 * T0061 / MVP-gap §78 — share a session as a short-hash deep-link.
 *
 * Calls POST /agent/share, returning a `eventpulse://s/{hash}` URL that
 * the caller feeds to React Native's `Share.share()`.
 *
 * @param {{ query: string, sessionId?: string, eventIds?: string[], ttlHours?: number, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: true, id: string, url: string, expires_at: string } | { ok: false, warning: string }>}
 */
export async function shareSession({
  query,
  sessionId,
  eventIds,
  ttlHours,
  signal,
  timeoutMs = 6_000,
} = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const body = {
    client_user_id,
    query: typeof query === 'string' ? query : '',
  };
  if (sessionId) body.session_id = sessionId;
  if (Array.isArray(eventIds)) body.event_ids = eventIds;
  if (typeof ttlHours === 'number') body.ttl_hours = ttlHours;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/agent/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (_err) {
    clearTimeout(timer);
    return { ok: false, warning: 'network' };
  }
  clearTimeout(timer);

  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch (_e) { /* fall through */ }
    return {
      ok: false,
      warning: payload?.error ?? `share ${response.status}: ${response.statusText}`,
    };
  }

  const data = await response.json();
  return {
    ok: true,
    id: data.id,
    url: data.url,
    expires_at: data.expires_at,
  };
}

/**
 * T0061 — fetch a shared session by hash (the public GET /s/:hash endpoint).
 *
 * Returns `{ok: true, query, eventIds, createdAt, viewCount}` on success
 * and `{ok: false, warning}` on network/404/5xx. 404 = "not found or
 * expired" — soft failure (recipient hit a typo'd or stale share).
 */
export async function fetchSharedSession({ hash, signal, timeoutMs = 6_000 } = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const cleanHash = String(hash ?? '').toLowerCase();
  if (!/^[0-9a-z]{6,12}$/.test(cleanHash)) {
    return { ok: false, warning: 'invalid hash' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/s/${cleanHash}`, { signal: controller.signal });
  } catch (_err) {
    clearTimeout(timer);
    return { ok: false, warning: 'network' };
  }
  clearTimeout(timer);

  if (response.status === 404) {
    return { ok: false, warning: 'not found or expired' };
  }
  if (!response.ok) {
    return { ok: false, warning: `share ${response.status}` };
  }

  const data = await response.json();
  return {
    ok: true,
    query: data.query ?? '',
    eventIds: Array.isArray(data.event_ids) ? data.event_ids : [],
    createdAt: data.created_at ?? null,
    viewCount: data.view_count ?? 0,
  };
}

/**
 * T0061 — extract the hash from an eventpulse://s/{hash} URL.
 * Returns the lowercased hash string or null if the URL doesn't match.
 */
export function parseShareHashFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/^eventpulse:\/\/s\/([0-9a-z]{6,12})/i);
  return m ? m[1].toLowerCase() : null;
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
 * Persist the Expo push token and follow-push opt-in flag — T0059.
 *
 * POST /agent/push-token
 *   body: { client_user_id, push_token?: string | null,
 *           follow_push_enabled?: boolean }
 *
 * Backend (08-Agent/server.ts) writes to
 * `user_preferences.preferences.{push_token,follow_push_enabled}` via
 * read-modify-write, preserving existing keys like `categories` and
 * `followed_venue_ids`. Phase 1 = storage only (NotificationsScreen polls
 * `/agent/notifications` on next open). Phase 2 will add an Expo Push API
 * fan-out from the server side.
 *
 * Best-effort: never throws. Returns { ok: boolean, warning?: string } so
 * the ProfileScreen toggle can stay silent on transient errors.
 *
 * `pushToken` may be:
 *   - string (the Expo push token to store, or `''`/whitespace to clear)
 *   - null  (explicit clear)
 *   - undefined (omit; leaves prior value untouched)
 */
export async function registerPushToken({
  pushToken,
  followPushEnabled,
  signal,
  timeoutMs = 4_000,
} = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { ok: false, warning: 'config' };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const body = { client_user_id };
  if (pushToken !== undefined) {
    body.push_token =
      pushToken === null || (typeof pushToken === 'string' && pushToken.trim() === '')
        ? null
        : String(pushToken);
  }
  if (typeof followPushEnabled === 'boolean') {
    body.follow_push_enabled = followPushEnabled;
  }
  if (!('push_token' in body) && !('follow_push_enabled' in body)) {
    return { ok: false, warning: 'no fields' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${baseUrl}/agent/push-token`, {
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
 * T0087 — Per-entity notification granularity.
 *
 * Stores notification_prefs JSONB on user_preferences:
 *   { "venue:<id>": "all"|"new_only"|"off", "artist:<slug>": "all"|"new_only"|"off" }
 *
 * @param {{ entityType: 'venue'|'artist', entityId: string, level: 'all'|'new_only'|'off', signal?, timeoutMs?: number }} opts
 * Returns { ok: boolean, warning?: string }
 */
export async function setNotificationPrefs({
  entityType,
  entityId,
  level,
  signal,
  timeoutMs = 4_000,
}) {
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
    const response = await fetch(`${baseUrl}/agent/notification-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id, entity_type: entityType, entity_id: entityId, level }),
      signal: controller.signal,
    });
    if (!response.ok) {
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
 * T0087 — Fetch current notification_prefs from the server.
 * @returns {{ notification_prefs: Record<string, 'all'|'new_only'|'off'> }}
 */
export async function getNotificationPrefs({ signal, timeoutMs = 4_000 } = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { notification_prefs: {} };
  }
  const client_user_id = await getOrCreateAnonUserId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(
      `${baseUrl}/agent/notification-prefs?client_user_id=${encodeURIComponent(client_user_id)}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      return { notification_prefs: {} };
    }
    return await response.json().catch(() => ({ notification_prefs: {} }));
  } catch (_err) {
    return { notification_prefs: {} };
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Fetch pre-rendered agent intent slots for the HomeScreen "Förslag från din
 * agent" section — T0060 / Phase 1 retention.
 *
 * GET /agent/cached-recommendations?client_user_id=<uuid>&limit=<int>
 *
 * Returns up to `limit` slots, each pre-resolved with up to 2 EventCards:
 *   {
 *     slots: [{ title, card_1: EventCard|null, card_2: EventCard|null }, ...],
 *     generated_at: string|null
 *   }
 *
 * The slot title is rendered verbatim (Swedish, server-generated). Cards reuse
 * the same EventCard → legacy-shape mapping as fetchFeed so the existing card
 * renderer stays uniform across sections.
 *
 * 404 from the server (no cached data yet for this user — new/anon users) is
 * treated as an empty result so the section can simply hide itself without
 * surfacing an error.
 *
 * @param {{ limit?: number, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ slots: Array<{ title: string, cards: Array<LegacyEvent> }>, generated_at: string|null }>}
 */
export async function fetchCachedRecommendations({
  limit = 3,
  signal,
  timeoutMs = 12_000,
} = {}) {
  const { getOrCreateAnonUserId } = await import('./storage');
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/cached-recommendations`);
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
  } catch (_err) {
    clearTimeout(timer);
    // Network error → return empty so the section hides itself.
    return { slots: [], generated_at: null };
  }
  clearTimeout(timer);

  // 404 = no cached data for this user. Treat as "empty" so the section hides.
  if (response.status === 404) {
    return { slots: [], generated_at: null };
  }
  if (!response.ok) {
    throw new Error(`cached-recommendations ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const rawSlots = Array.isArray(data.slots) ? data.slots : [];

  // EventCard → legacy shape mapping (mirrors fetchFeed/fetchRecommendedEvents).
  const mapCard = (e) => {
    if (!e) return null;
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
      // image_generation_status forwarded så UI kan visa "no credits BFL
      // - recharge" när AI-workern har slut på BFL-kredit. User request
      // 2026-08-25.
      image_generation_status: e.image_generation_status || null,
      image_ai_generated: e.image_ai_generated ?? false,
      image_ai_optout: e.image_ai_optout ?? false,
      source: e.source || 'agent',
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
    };
  };

  const slots = rawSlots
    .slice(0, limit)
    .map((s) => {
      const title = typeof s?.title === 'string' && s.title.length > 0 ? s.title : '';
      const cards = [mapCard(s?.card_1), mapCard(s?.card_2)].filter(Boolean);
      return { title, cards };
    })
    // Drop slots with no title AND no cards — they're useless.
    .filter((s) => s.title.length > 0 || s.cards.length > 0);

  return { slots, generated_at: typeof data.generated_at === 'string' ? data.generated_at : null };
}

/**
 * Fetch the hand-curated editorial "Kuratorens val" lists — T0084 / MVP-gap §77.
 *
 * GET /agent/curated-collections?locale=sv|en&limit=<int>
 *
 * Returns 2–3 collections like "Klassiskt ikväll" / "Gratis på lördag" /
 * "Metal under 200 kr" with their prompt text + up to 3 example event ids.
 * The user-facing chip text comes from the catalog on the server side; the
 * client just renders what arrives.
 *
 * Best-effort: network / 5xx / parse failure returns an empty collection
 * list so HomeScreen can hide the section silently. This is the same
 * fetchRecentQueries pattern.
 *
 * @returns {Promise<{
 *   collections: Array<{
 *     id: string,
 *     name: string,
 *     reason: string,
 *     prompt_text: string,
 *     category_slug?: string,
 *     time_of_day?: 'morning'|'afternoon'|'evening'|'night',
 *     budget?: 'free'|'low'|'medium'|'high'|'any',
 *     day_filter?: 'weekday'|'friday'|'weekend'|'saturday'|'sunday'|'today',
 *     locale: 'sv'|'en',
 *     event_ids: string[],
 *   }>,
 *   generated_at: string|null,
 *   warnings: string[],
 * }>}
 */
export async function fetchCuratedCollections({
  locale = 'sv',
  limit = 3,
  signal,
  timeoutMs = 12_000,
} = {}) {
  let baseUrl;
  try {
    baseUrl = requireAgentBaseUrl();
  } catch (_err) {
    return { collections: [], generated_at: null, warnings: ['config'] };
  }

  const url = new URL(`${baseUrl}/agent/curated-collections`);
  url.searchParams.set('locale', locale);
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
  } catch (_err) {
    clearTimeout(timer);
    return { collections: [], generated_at: null, warnings: ['network'] };
  }
  clearTimeout(timer);

  if (!response.ok) {
    return { collections: [], generated_at: null, warnings: [`agent ${response.status}`] };
  }

  let data;
  try {
    data = await response.json();
  } catch (_err) {
    return { collections: [], generated_at: null, warnings: ['parse'] };
  }

  const rawList = Array.isArray(data?.collections) ? data.collections : [];
  const collections = rawList.map((c) => ({
    id: typeof c?.id === 'string' ? c.id : '',
    name: typeof c?.name === 'string' ? c.name : '',
    reason: typeof c?.reason === 'string' ? c.reason : '',
    prompt_text: typeof c?.prompt_text === 'string' ? c.prompt_text : '',
    ...(typeof c?.category_slug === 'string' ? { category_slug: c.category_slug } : {}),
    ...(typeof c?.time_of_day === 'string' ? { time_of_day: c.time_of_day } : {}),
    ...(typeof c?.budget === 'string' ? { budget: c.budget } : {}),
    ...(typeof c?.day_filter === 'string' ? { day_filter: c.day_filter } : {}),
    locale: c?.locale === 'en' ? 'en' : 'sv',
    event_ids: Array.isArray(c?.event_ids) ? c.event_ids.filter((id) => typeof id === 'string') : [],
  }));

  return {
    collections,
    generated_at: typeof data?.generated_at === 'string' ? data.generated_at : null,
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}

/**
 * Fetch the user's distinct recent chat queries — T0071 / Phase 1 retention.
 *
 * GET /agent/recent-queries?client_user_id=<uuid>&limit=<int>
 *
 * Returns an array of { id, query_text, last_used_at } for the "Dina senaste
 * sökningar" section on HomeScreen. Mirrors the fetchCachedRecommendations
 * pattern: 404 / network error → empty array so the section hides itself.
 *
 * @returns {Promise<{ queries: Array<{ id: string, query_text: string, last_used_at: string }> }>}
 */
export async function fetchRecentQueries({
  limit = 5,
  signal,
  timeoutMs = 12_000,
} = {}) {
  const { getOrCreateAnonUserId } = await import('./storage');
  const baseUrl = requireAgentBaseUrl();
  const url = new URL(`${baseUrl}/agent/recent-queries`);
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
  } catch (_err) {
    clearTimeout(timer);
    // Network error → return empty so the section hides itself.
    return { queries: [] };
  }
  clearTimeout(timer);

  // 404 = no chat history for this user yet. Treat as empty.
  if (response.status === 404) {
    return { queries: [] };
  }
  if (!response.ok) {
    throw new Error(`recent-queries ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const queries = Array.isArray(data.queries) ? data.queries : [];

  return { queries };
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
  const client_user_id = await getOrCreateAnonUserId();
  url.searchParams.set('client_user_id', client_user_id);
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
  markOnline();
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
      // image_generation_status forwarded så UI kan visa "no credits BFL
      // - recharge" när AI-workern har slut på BFL-kredit. User request
      // 2026-08-25.
      image_generation_status: e.image_generation_status || null,
      image_ai_generated: e.image_ai_generated ?? false,
      image_ai_optout: e.image_ai_optout ?? false,
      source: e.source || 'agent',
      hasExternalLink: Boolean(ticketUrl),
      externalLinkChipLabel: ticketUrl ? 'Extern länk' : undefined,
      externalLinkLabel: ticketUrl ? 'Läs mer' : undefined,
    };
  });

  return { events };
}
