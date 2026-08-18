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

export { AGENT_BASE_URL, getOrCreateAnonUserId };
