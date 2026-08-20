/**
 * Source ID → homepage URL mapping.
 *
 * Purpose: when a card has a `source` slug (e.g. "spelning-se") we can deep-link
 * the user to the source's homepage so they can:
 *   - find a photo (manual fallback until og:image is filled in for everyone)
 *   - read the original event listing
 *   - see other same-source events
 *
 * Two layers:
 *   1. EXACT map — the slug we know definitively.
 *   2. PATTERN map — substrings; if a slug starts with "eventbrite-sthlm-" we
 *      fall back to https://www.eventbrite.com/d/sweden--stockholm/.
 *
 * Anything that doesn't match either returns null and the caller falls back to
 * `card.ticket_url` (if any) or hides the source row entirely.
 *
 * The exact map is intentionally small — keep it tight. The pattern map
 * covers the major aggregators and a few high-yield sources. New sources
 * land in the pattern map first, then get promoted to exact map when a
 * canonical homepage is verified.
 *
 * This is a UI-only file — no backend dependency. The backend exposes
 * `source` already (see 08-Agent/types.ts EventCard.source).
 */

// ─── Exact source-map (verified homepage URLs) ────────────────────────────
const SOURCE_URLS = {
  sthlmlist: 'https://sthlmlist.se/',
  'thatsup-stockholm-events': 'https://thatsup.se/stockholm/events/',
  kulturhuset: 'https://kulturhuset.se/',
  berwaldhallen: 'https://berwaldhallen.se/',
  debaser: 'https://debaser.se/',
  ticketmaster: 'https://ticketmaster.se/',
  'kultur-stockholm-calendar': 'https://kultur.stockholm/kalendarium/',
  liljevalchs: 'https://liljevalchs.se/',
  'stockholm-live': 'https://aviciiarena.se/evenemang/',
};

// ─── Pattern map (substr → URL) — checked in order, first match wins ──────
const SOURCE_PATTERNS = [
  // Stockholm / Sweden aggregators
  { match: 'eventbrite-sthlm', url: 'https://www.eventbrite.com/d/sweden--stockholm/' },
  { match: 'eventbrite-stockholm', url: 'https://www.eventbrite.com/d/sweden--stockholm/' },
  { match: 'eventbrite-uppsala', url: 'https://www.eventbrite.com/d/sweden--uppsala/' },
  { match: 'eventbrite-sweden', url: 'https://www.eventbrite.com/d/sweden/' },
  { match: 'eventbrite', url: 'https://www.eventbrite.com/' },
  { match: 'meetup-sthlm', url: 'https://www.meetup.com/find/?location=se--Stockholm' },
  { match: 'meetup', url: 'https://www.meetup.com/' },
  { match: 'ticketmaster', url: 'https://www.ticketmaster.se/' },
  { match: 'songkick-stockholm', url: 'https://www.songkick.com/metro-areas/28945-sweden-stockholm' },
  { match: 'songkick', url: 'https://www.songkick.com/' },
  { match: 'evensos-stockholm', url: 'https://evensos.com/location/stockholm' },
  { match: 'evensos', url: 'https://evensos.com/' },
  { match: 'spelning-se', url: 'https://spelning.se/' },
  { match: 'thatsup-stockholm-articles', url: 'https://thatsup.se/stockholm/' },
  { match: 'thatsup', url: 'https://thatsup.se/' },
  { match: 'allevents-in', url: 'https://allevents.in/stockholm' },
  { match: 'kultur-stockholm', url: 'https://kultur.stockholm/' },
  { match: 'gratisistockholm', url: 'https://gratisistockholm.se/' },
  { match: 'visitstockholm', url: 'https://www.visitstockholm.se/' },
  { match: 'tele2arena', url: 'https://www.tele2arena.se/' },
  { match: 'aviciiarena', url: 'https://aviciiarena.se/' },
  { match: '3arena', url: 'https://www.3arena.se/' },
  { match: 'stockholmsmassan', url: 'https://www.stockholmsmassan.se/' },
  { match: 'storateatern-sthlm', url: 'https://www.storateatern.se/' },
  { match: 'sodrateatern', url: 'https://sodrateatern.com/' },
  { match: 'biorio', url: 'https://biorio.se/' },
  { match: 'sprakmuseet', url: 'https://www.sprakmuseet.se/' },
  { match: 'debaser', url: 'https://debaser.se/' },
  { match: 'china-teatern', url: 'https://www.chinateatern.se/' },
  { match: 'folkoperan', url: 'https://www.folkoperan.se/' },
  { match: 'intiman', url: 'https://www.intiman.se/' },
  { match: 'arkdes', url: 'https://arkdes.se/' },
  { match: 'berwaldhallen', url: 'https://berwaldhallen.se/' },
  { match: 'kulturhuset', url: 'https://kulturhuset.se/' },
  { match: 'liljevalchs', url: 'https://liljevalchs.se/' },
  { match: 'sthlmlist', url: 'https://sthlmlist.se/' },
];

/**
 * Resolve a source slug to its homepage URL.
 * Returns null if no match.
 *
 * @param {string|null|undefined} source  e.g. "spelning-se"
 * @returns {string|null}
 */
export function resolveSourceUrl(source) {
  if (!source || typeof source !== 'string') return null;
  if (SOURCE_URLS[source]) return SOURCE_URLS[source];
  for (const p of SOURCE_PATTERNS) {
    if (source.includes(p.match)) return p.url;
  }
  return null;
}

/**
 * Pick the best URL to open for a card. Order:
 *   1. resolved source homepage (if known)
 *   2. ticket_url (the event's own URL)
 *   3. null (no link to open)
 */
export function cardLink(card) {
  if (!card) return null;
  const sourceUrl = resolveSourceUrl(card.source);
  if (sourceUrl) return sourceUrl;
  if (card.ticket_url) return card.ticket_url;
  return null;
}

/**
 * Display label for the source row. Falls back to "Öppna event" if no source
 * slug is available.
 */
export function cardLinkLabel(card) {
  if (card && card.source) return `via ${card.source}`;
  return 'Öppna event';
}
