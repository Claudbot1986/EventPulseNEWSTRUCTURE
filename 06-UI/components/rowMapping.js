// rowMapping (2026-09-27): mappar en agent-feed event (legacy shape från
// agentClient.js:792-840) till UtforskaSection EventRow-shape. Ren helper
// — inga React-hooks, ingen fetch. Bor i components/ eftersom den är
// 06-UI-specifik och inte hör hemma i utils/ (där vi håller
// domän-neutrala helpers).

import { dateNamesFor } from '../i18n/dateNames';

// decodeHtmlEntities (2026-09-27): samma mönster som 02-Ingestion/F-eventExtraction/
// adapters/folkoperan.ts:71 — agent-flödet returnerar ibland rå HTML-entity
// i titlar (t.ex. "Sverige &#8211; Polen" istället för "Sverige – Polen").
// UI-lagret dekoder vid mappning så vi inte behöver jaga varje källadapter.
// Täcker numeriska (&#NNN; / &#xHH;) + de vanligaste namngivna entiteterna.
function decodeHtmlEntities(s) {
  if (!s || typeof s !== 'string') return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&middot;/g, '·');
}

/**
 * Format YYYY-MM-DD + language → "LÖR 26 sep" (sv) / "SAT 26 Sep" (en).
 *
 * Parsar datumet som noon-UTC för att undvika TZ-rollover (samma mönster
 * som browseFilters.filterEventsByTime använder för `new Date(iso + 'T' + time)`).
 *
 * @param {string|null|undefined} dateIso  YYYY-MM-DD
 * @param {string} language               i18n language tag
 * @returns {string|null}                 null om input saknas/ogiltig
 */
export function formatSwedishDayPrefix(dateIso, language) {
  if (!dateIso || typeof dateIso !== 'string') return null;
  const d = new Date(dateIso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const names = dateNamesFor(language);
  const weekday = names.daysShort[d.getUTCDay()].toUpperCase();
  const month = names.monthsShort[d.getUTCMonth()];
  return `${weekday} ${d.getUTCDate()} ${month}`;
}

/**
 * Mappar en agent-feed event (legacy shape från agentClient.js EventCard→
 * legacy-mappern) till UtforskaSection EventRow-shape.
 *
 *   id, title, badge, subtitleParts (array),
 *   imageUrl, hasTickets, venueName, artistName, category, saved
 *
 * Fält som inte finns i nuvarande wire shape (artistName, saved) blir
 * null/false — EventRow:en hanterar dem saknas.
 *
 * @param {object} event     agent-feed event (legacy shape)
 * @param {string} language  i18n language tag
 * @returns {object}         UtforskaSection row-shape
 */
export function mapAgentEventToRow(event, language) {
  if (!event || !event.id) return null;
  // 2026-09-29: agent-flödet använder `start_time` (ISO datetime) — det
  // finns inget separat `date`-fält. Härled YYYY-MM-DD från start_time så
  // både subtitle-prefix ("LÖR 26 sep") OCH tileRoutes-helg-filtret
  // (filter på helg → lör/sön) kan konsumera samma rad-shape.
  const dateOnly = event.start_time ? event.start_time.slice(0, 10) : null;
  const datePrefix = formatSwedishDayPrefix(dateOnly, language);
  // 2026-10-01: DetailsScreen-fält (url, time, source, description,
  // image_url, image_ai_*, is_free, hasExternalLink) behövs så att en
  // rad-tap i Utforska-flödet öppnar samma eventkort som Hem använder —
  // inte ett avskalat subset. Hem-flödet skickar hela Supabase-raden
  // via toDetailsScreenEvent; här bär vi samma fält på rad-objektet så
  // onEventPress kan skicka tillbaka hela nyttolasten utan en andra
  // server-roundtrip.
  const ticketUrl = event.ticket_url || event.url || null;
  // 2026-10-03: description-sanering. Spelning.se-exporter kommer in med
  // raw <p>...</p>-taggar (Robert Wells m.fl.). stripHtmlHtml tar bort
  // taggarna men bevarar paragrafer-brytningar och avkodar HTML-entiteter.
  const { stripHtml } = require('../utils/stripHtml.js');
  const desc = event.description || event.description_sv || event.description_en || null;
  const cleanedDesc = stripHtml(desc);
  return {
    id: event.id,
    title: decodeHtmlEntities(event.title) || 'Untitled',
    badge: event.is_online
      ? 'ONLINE'
      : (event.category ? String(event.category).toUpperCase().slice(0, 12) : null),
    subtitleParts: [
      datePrefix,
      decodeHtmlEntities(event.time) || null,
      decodeHtmlEntities(event.venue_name || event.venue) || null,
      decodeHtmlEntities(event.area) || null,
    ].filter(Boolean),
    // imageUrl från feed är en HTTP URL — RN:s <Image source={{ uri }}>
    // hanterar det direkt (samma path som MOCK:ens require-resultat).
    imageUrl: event.imageUrl || event.image_url || null,
    hasTickets: Boolean(ticketUrl || event.hasExternalLink),
    venueName: event.venue_name || event.venue || null,
    // artistName/saved kräver separata queries (/agent/event/:id + saved-list).
    // Lämnas null/false tills den integrationen landar.
    artistName: null,
    category: event.category_slug || event.category || null,
    saved: false,
    // 2026-09-29: YYYY-MM-DD härlett från start_time. Används av
    // helg-clientFilter (lör/sön-matchning) i tileRoutes.
    date: dateOnly,
    // 2026-10-01: DetailsScreen-fält — samma shape som toDetailsScreenEvent
    // i HomeScreen.js producerar för Hem-flödet. url pekar på
    // ticket_url om den finns (annars null); hasExternalLink speglar
    // samma truthiness så CTA-knappen visar/döljs identiskt.
    url: ticketUrl,
    hasExternalLink: Boolean(ticketUrl || event.hasExternalLink),
    time: event.time || null,
    source: event.source || null,
    description: cleanedDesc,
    image_url: event.image_url || event.imageUrl || null,
    image_ai_generated: event.image_ai_generated === true,
    image_ai_optout: event.image_ai_optout === true,
    image_generation_status: event.image_generation_status || null,
    is_free: event.is_free === true,
  };
}