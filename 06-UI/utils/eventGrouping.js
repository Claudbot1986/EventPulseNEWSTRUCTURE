/**
 * eventGrouping.js — gruppera events som har samma "själ" (multi-date).
 *
 * BAKGRUND (2026-10-18):
 * Spec: "Ett event som körs flera datum = samma event, bara datum/tider
 * skiljer. I listor ska det visas ett kort per datum/tid. När användaren
 * öppnar ett event ska ALLA datum visas."
 *
 * canonical_event_id finns redan i events-tabellen (migration
 * 20260818-0001) men täcker bara 99 / 11 618 events (<1%) — den är
 * primärt avsedd för cross-source dedup (samma konsert listad i 3
 * scrape-källor). För samma-source-recurring events (t.ex. "Chicago - the
 * Musical" med 7 föreställningar i samma livespot-stockholm-payload)
 * finns den oftast inte satt.
 *
 * Denna modul ger en klient-side fallback: gruppera på
 * canonical_event_id (om satt) ELLER på (normaliserad titel + venue_id,
 * eller title + venue_full_name om venue_id saknas).
 *
 * Ren helper — no React, no fetch, no Date.now() hidden inside. Pure
 * functions ger reproducibility och gör vitest-testning trivial.
 *
 * Användning:
 *   import { groupOccurrences, extraOccurrencesCount } from './eventGrouping';
 *   const groups = groupOccurrences(events);
 *   const cardCount = extraOccurrencesCount(currentEvent, groups); // 0 om single
 *   // Visa "+(cardCount) andra datum" på kortet om cardCount > 0.
 */

/**
 * Normalisera en titel för jämförelse.
 *
 * - trim + collapse whitespace
 * - lowercase
 * - tar bort vanliga suffix som "(lördag)", "[Familj]" etc. (försiktigt)
 * - tar bort interpunktion i slutet
 *
 * @param {string|null|undefined} title
 * @returns {string}
 */
export function normalizeEventTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (accents)
    .replace(/\s+/g, ' ')
    .trim()
    // Strip common suffixes in parens/brackets (case-insensitive)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/[.!?:;,]+$/, '')
    .trim();
}

/**
 * Beräkna gruppnyckel för en event-rad. Två rader med samma nyckel
 * antas vara samma event med olika datum.
 *
 * Prioritering:
 *   1. canonical_event_id om satt
 *   2. normalizeEventTitle(title_sv || title_en) + venue_id
 *   3. normalizeEventTitle + venue_full_name
 *   4. normalizeEventTitle ensam (sista utväg — kan ge falska positiva)
 *
 * Returnerar null om eventet inte kan grupperas (saknar helt titel).
 *
 * @param {object} event  en events_public-rad
 * @returns {string|null}
 */
export function occurrenceGroupKey(event) {
  if (!event) return null;
  if (event.canonical_event_id) return `can:${event.canonical_event_id}`;

  const title = normalizeEventTitle(event.title_sv || event.title_en);
  if (!title) return null;

  if (event.venue_id) return `ttl:${title}|vid:${event.venue_id}`;
  if (event.venue_full_name && typeof event.venue_full_name === 'string') {
    return `ttl:${title}|vfn:${event.venue_full_name.toLowerCase().trim()}`;
  }
  return `ttl:${title}|venue:unknown`;
}

/**
 * Gruppera en lista events efter occurrenceGroupKey.
 *
 * @param {Array<object>} events
 * @returns {Map<string, Array<object>>}  map: group_key → events
 */
export function groupOccurrences(events) {
  const map = new Map();
  if (!Array.isArray(events)) return map;
  for (const event of events) {
    const key = occurrenceGroupKey(event);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }
  return map;
}

/**
 * Returnera antal andra förekomster i samma grupp (currentEvent ej
 * räknad). 0 om enskild.
 *
 * @param {object} currentEvent
 * @param {Map<string, Array<object>>} groups  utdata från groupOccurrences
 * @returns {number}
 */
export function extraOccurrencesCount(currentEvent, groups) {
  if (!currentEvent || !groups) return 0;
  const key = occurrenceGroupKey(currentEvent);
  if (!key) return 0;
  const peers = groups.get(key);
  if (!peers) return 0;
  // Räkna peers som har olika id (säkerhetsåtgärd även om en event råkar
  // ligga i listan två gånger).
  const otherIds = new Set(peers.filter((p) => p.id !== currentEvent.id).map((p) => p.id));
  return otherIds.size;
}

/**
 * Hämta alla andra förekomster (exkl. current) i samma grupp, sorterade
 * på start_time. Används av DetailsScreen för att visa "Fler datum".
 *
 * @param {object} currentEvent
 * @param {Map<string, Array<object>>} groups
 * @returns {Array<object>}
 */
export function otherOccurrences(currentEvent, groups) {
  if (!currentEvent || !groups) return [];
  const key = occurrenceGroupKey(currentEvent);
  if (!key) return [];
  const peers = groups.get(key);
  if (!peers) return [];
  return peers
    .filter((p) => p.id !== currentEvent.id)
    .slice()
    .sort((a, b) => {
      const ta = a.start_time || '';
      const tb = b.start_time || '';
      return ta.localeCompare(tb);
    });
}
