/**
 * deepLinkRouter — single source of truth for "is this URL one we should
 * handle, and which surface owns it?".
 *
 * Why a separate module:
 *   The Expo app has two deep-link surfaces:
 *     - AppShell owns auth: eventpulse://auth/callback?...
 *     - App.js owns shares: eventpulse://s/<hash>
 *   Both register a Linking listener, and both must be safe to receive
 *   any URL. A shared classifier keeps the rules in one place instead of
 *   two parallel regex checks that drift apart over time.
 *
 * Behaviour:
 *   - isAuthDeepLink(url)  : true iff url is an auth callback
 *   - isShareDeepLink(url) : true iff url is a /s/<hash> share
 *   - isEventPulseUrl(url) : true iff url belongs to the eventpulse:// scheme
 *
 * All checks are pure (no I/O, no side effects) so they can be unit
 * tested without React rendering.
 */

import { AUTH_DEEP_LINK_PATH } from './supabaseAuthClient';

/** Same shape as parseShareHashFromUrl in agentClient.js, kept here so
 *  the routing layer doesn't need to know about agentClient's parsing. */
const SHARE_PATH_RE = /^eventpulse:\/\/s\/([0-9a-z]{6,12})/i;
const AUTH_URL_PREFIX = `eventpulse://${AUTH_DEEP_LINK_PATH}`;
/** Expo Go dev form: iOS never routes the custom eventpulse:// scheme into
 *  Expo Go, so dev email links use the documented exp://<host>/--/<path>
 *  convention. Params arrive as ?query or #fragment — both accepted. */
const EXPO_GO_AUTH_RE = /^exp:\/\/[^/]+\/--\/auth\/callback(?:[?#].*)?$/i;

/** S6 (2026-09-20): weekly Din helg push payload → data.url. Routes to the
 *  home tab where the Din helg section sits at the top. Trailing
 *  ?query/#fragment allowed so future tracking params don't break the match. */
const DIN_HELG_PATH_RE = /^eventpulse:\/\/home\/din-helg(?:[?#].*)?$/i;

export function isEventPulseUrl(url) {
  return typeof url === 'string' && url.startsWith('eventpulse://');
}

export function isAuthDeepLink(url) {
  if (typeof url !== 'string') return false;
  if (url.startsWith(AUTH_URL_PREFIX)) return true;
  return EXPO_GO_AUTH_RE.test(url);
}

export function isShareDeepLink(url) {
  return typeof url === 'string' && SHARE_PATH_RE.test(url);
}

export function isDinHelgDeepLink(url) {
  return typeof url === 'string' && DIN_HELG_PATH_RE.test(url);
}

export const DEEP_LINK_PATHS = Object.freeze({
  AUTH: AUTH_DEEP_LINK_PATH,
  SHARE: 's',
  DIN_HELG: 'home/din-helg',
});

export { AUTH_URL_PREFIX };