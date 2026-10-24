/**
 * eventExtraction — rena extraheringsfunktioner för HTML → event.
 *
 * Utdrag ur `scripts/ingest-sitemap-discovery.mjs` så att extraktionslagen
 * kan enhetstestas (och så att orsaksanalysen är spårbar i kod, inte bara
 * i ett antecknande).
 *
 * TVÅ mätta fel som modulen rättar:
 *
 * 1. EVENT-SUBTYPER. `@type === 'Event'` missade alla schema.org-subtyper.
 *    Mätt på de 189 spårade källorna: MusicEvent (concerts50.com — 33
 *    framtida events), VisualArtsEvent (konstkalendern.com),
 *    ExhibitionEvent (stockholm.fotografiska.com). Repo-kanoniska
 *    extractorn har redan accepterat subtyper sedan 2026-10-02
 *    (`02-Ingestion/F-eventExtraction/extractor.ts`, där motiveringen var
 *    spelning.se + sodrateatern). Listan speglas här — skriptet måste kunna
 *    köras med ren `node`, så den får inte importera en .ts-fil.
 *    `parity.test.ts` håller listorna i synk.
 *
 * 2. KÄLLANS EGEN URL. Sitemap-vägen hämtade bara URL:er från sitemapsen.
 *    En källa som pekar rakt på en event-sida (t.ex.
 *    `nalen.com/sv/konsert/kleerup`) har ingen listing att hitta, men
 *    sidan själv bär JSON-LD om eventet. Mätt: 124 framtida events ligger
 *    på källans egen URL. Samma utgångspunkt som C-gaten använder.
 *
 * Generalization Protection: General — subtyp-fixen är speglad från
 * repo-kanoniska extractorn (begrundad på spelning.se + sodrateatern),
 * subtyp-förekomsten mätt på 3 orelaterade domäner, och
 * källans-URL-regeln är inte sajt-specifik utan gäller alla källor.
 */

import * as cheerio from 'cheerio';

/**
 * Schema.org Event-subtyper — speglar `EVENT_SUBTYPES` i
 * `02-Ingestion/F-eventExtraction/extractor.ts`.
 */
export const EVENT_SUBTYPES = new Set([
  'Event',
  'MusicEvent',
  'BusinessEvent',
  'EducationEvent',
  'SportsEvent',
  'TheaterEvent',
  'Festival',
  'LiteraryEvent',
  'SaleEvent',
  'SocialEvent',
  'VisualArtsEvent',
  'ExhibitionEvent',
  'FoodEvent',
  'ChildrensEvent',
  'DanceEvent',
  'ComedyEvent',
  'CourseInstance',
  'ScreeningEvent',
]);

/**
 * Är `@type` en event-typ? Accepterar `Event` och alla dess subtyper.
 * Avvisar `EventSeries`, `WebSite`, `WebPage`, `Organization`,
 * `BreadcrumbList`, `Article` m.fl.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function isEventType(type) {
  return typeof type === 'string' && EVENT_SUBTYPES.has(type);
}

/**
 * Är `@type`-fältet (sträng eller lista) en event-typ?
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function hasEventType(type) {
  if (Array.isArray(type)) return type.some(isEventType);
  return isEventType(type);
}

/**
 * Plocka JSON-LD-event ur en HTML-sida.
 *
 * @param {string} html
 * @returns {Array<{name: string|null, startDate: string|null, endDate: string|null,
 *   url: string|null, venue: string|null, address: string|null,
 *   lat: number|null, lng: number|null}>}
 */
export function extractJsonLdEvents(html) {
  const events = [];
  const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const arr = Array.isArray(data) ? data : [data];
    for (const d of arr) {
      if (!d || typeof d !== 'object') continue;
      // Direct Event (inkl. schema.org-subtyper: MusicEvent, ExhibitionEvent, …)
      if (hasEventType(d['@type'])) {
        events.push(toEvent(d));
      }
      // ItemList med events
      if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
        for (const li of d.itemListElement) {
          const ev = li?.item ?? li;
          if (ev && typeof ev === 'object' && hasEventType(ev['@type'])) {
            events.push(toEvent(ev));
          }
        }
      }
    }
  }
  return events;
}

function toEvent(d) {
  const addr = d.location?.address;
  return {
    name: d.name ?? null,
    startDate: d.startDate ?? null,
    endDate: d.endDate ?? null,
    url: d.url ?? null,
    venue: d.location?.name ?? null,
    address: addr
      ? [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ')
      : null,
    lat: d.location?.geo?.latitude != null ? parseFloat(d.location.geo.latitude) : null,
    lng: d.location?.geo?.longitude != null ? parseFloat(d.location.geo.longitude) : null,
  };
}

/**
 * Plocka microdata-event (itemtype="…schema.org/Event") ur en HTML-sida.
 *
 * @param {string} html
 * @param {(el: unknown) => string} text — läser texten ur ett cheerio-element
 * @param {(el: unknown, attr: string) => string|null} attr — läser ett attribut
 * @returns {Array<{name: string, startDate: string, endDate: string|null,
 *   url: string|null, venue: string|null, address: null, lat: null, lng: null}>}
 */
export function extractMicrodataEvents(html, $, text, attr) {
  const events = [];
  $('[itemtype="https://schema.org/Event"], [itemtype*="schema.org/Event"]').each((_, el) => {
    const name = text($(el).find('[itemprop="name"]').first()).trim();
    const start = attr($(el).find('[itemprop="startDate"]').first(), 'datetime')
      || text($(el).find('[itemprop="startDate"]').first()).trim();
    const end = attr($(el).find('[itemprop="endDate"]').first(), 'datetime')
      || text($(el).find('[itemprop="endDate"]').first()).trim();
    const url = attr($(el).find('[itemprop="url"]').first(), 'href') || null;
    const venue = text($(el).find('[itemprop="location"] [itemprop="name"]').first()).trim() || null;
    if (name && start) {
      events.push({ name, startDate: start, endDate: end || null, url, venue, address: null, lat: null, lng: null });
    }
  });
  return events;
}

/**
 * HTML-heuristik: `<time datetime>` med en rubrik i samma container.
 *
 * @param {string} html
 * @param {string} sourceUrl
 * @param {(el: unknown) => string} text
 * @param {(el: unknown, attr: string) => string|null} attr
 * @returns {Array<{name: string, startDate: string, endDate: null, url: string|null,
 *   venue: null, address: null, lat: null, lng: null}>}
 */
export function extractHtmlEvents(html, sourceUrl, $, text, attr) {
  const events = [];
  $('time[datetime]').each((_, timeEl) => {
    const dt = attr(timeEl, 'datetime');
    if (!dt) return;
    const ts = new Date(dt).getTime();
    if (isNaN(ts)) return;
    const container = $(timeEl).closest('article, .event, .event-card, .event-item, [class*="event"], section, li, div').first();
    const titleEl = container.find('h1, h2, h3, h4, .title, [class*="title"]').first();
    const title = text(titleEl).trim().slice(0, 200)
      || text($(timeEl).parent().find('a').first()).trim();
    if (!title || title.length < 3) return;
    const link = attr(container.find('a').first(), 'href') || null;
    const fullUrl = link ? (link.startsWith('http') ? link : new URL(link, sourceUrl).href) : sourceUrl;
    events.push({
      name: title,
      startDate: dt,
      endDate: null,
      url: fullUrl,
      venue: null, address: null, lat: null, lng: null,
    });
  });
  return events;
}

/**
 * Alla extraktionsvägar, dedupade på (namn, startdatum) inom sidan.
 *
 * @param {string} html
 * @param {string} sourceUrl
 * @returns {Array<object>}
 */
export function extractAllEvents(html, sourceUrl) {
  const jsonLd = extractJsonLdEvents(html);
  const microdata = [];
  const htmlEvents = [];
  try {
    const $ = cheerio.load(html);
    const text = (el) => el?.text?.() ?? '';
    const attr = (el, name) => el?.attr?.(name) ?? null;
    microdata.push(...extractMicrodataEvents(html, $, text, attr));
    htmlEvents.push(...extractHtmlEvents(html, sourceUrl, $, text, attr));
  } catch {
    // HTML var inte parsbar — JSON-LD-vägen är fortfarande giltig.
  }
  const seen = new Set();
  const all = [];
  for (const ev of [...jsonLd, ...microdata, ...htmlEvents]) {
    const key = `${ev.name}|${ev.startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(ev);
  }
  return all;
}
