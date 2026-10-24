/**
 * Teater Galeasen adapter — galeasen.se, Skeppsholmen, Stockholm.
 *
 * Site-specific pattern (verified 2026-10-24 against the real site):
 *
 * - WordPress (theme "galeasen"), men custom post-typen `forestallningar`
 *   är INTE exponerad i WP REST API (/wp-json/wp/v2/forestallningar →
 *   404 `rest_no_route`) och sidorna har ingen JSON-LD. Varken universell
 *   JSON-LD-väg eller REST-vägen fungerar.
 * - Den enda sidan på galeasen.se med en maskinell lista är pressrummet
 *   `https://galeasen.se/pressrum/forestallningar/`.
 *   Den äldre `https://galeasen.se/forestallningar/` redirectar dit, och
 *   `?page_id=58` renderar samma sida.
 * - Markup: `ul.forestallningar > li > a` där
 *     - första `div` i ankaret = uppsättningens titel
 *       ("Vernon Subutex", "En grav för två - Antigone i Kolonos"),
 *     - tredje `div` innehåller `h6` med premiärdatum
 *       ("Premiär 5 oktober 2026", "Urpremiär 4 mars 2024",
 *        "Nypremiär 7 mars &nbsp;2017"),
 *     - ankaret pekar på en WordPress-query-URL
 *       (`https://galeasen.se/?post_type=forestallningar&p=5024`) som
 *       redirectar till den kanoniska pretty-URL:en
 *       (`https://galeasen.se/forestallningar/vernon-subutex/`).
 * - En rad ("Personer på teatern") saknar datum och hoppas över — den
 *   kan inte överleva importens datumvakt.
 * - Startsidan har ingen lista, bara en rubrik med den aktuella
 *   uppsättningen:
 *   `<h1><span>VERNON SUBUTEX</span>Urpremiär 5 oktober 2026!</h1>`.
 *   Hanteras som fallback så att källan ger sin aktuella uppsättning även
 *   när gaten renderar rot-URL:en.
 *
 * Mätning 2026-10-24: presslistan ger 22 rader, 21 med datum.
 * ALLA premiärdatum är i det förflutna (senaste: 5 oktober 2026) — sidan
 * publicerar inga speldatum.
 *
 * Speldagen (den faktiska föreställningslistan) finns i stället hos
 * biljettsystemet nordic (Dagny), där Teater Galeasen har organizer-id 2703:
 *   `https://www.nortic.se/dagny/ajax/organizer/calendar/shows/2703?from=YYYY-MM-01&to=YYYY-MM-<sista>`
 * Endpointen kräVER from/to (annars HTTP 500) och är ren HTML — ingen JS
 * behövs. Markup per föreställning:
 *   <div class="show-listing-show pointer sd2026-10-05 numbered-show"
 *        data-showid="350916" data-eventname="vernon subutex"
 *        data-tags="teatergaleasen,vernonsubutex"
 *        data-ticketurl="/ticket/show/350916">
 *     <div class="col ... large-screen-date">Monday<br/>18:00</div>
 *     <div class="bold show-name">Vernon Subutex</div>
 *     <div class="... price-range">från 150 SEK</div>
 *     <span>Teater Galeasen<br/><span class="bold">Stockholm</span></span>
 *   </div>
 * Datumet ligger i klassen `sdYYYY-MM-DD`, tiden i `.large-screen-date`,
 * titeln i `.show-name`, priset i `.price-range` och biljetten i
 * `data-ticketurl`. Mätning 2026-10-24 (from=2026-10-01&to=2026-11-30):
 * 28 föreställningar 2026-10-05 → 2026-11-22.
 *
 * Per CLAUDE.md Generalization Protection Rule: adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST galeasen.se + nordic-organizer 2703.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'teater-galeasen';
const VENUE = 'Teater Galeasen';
const CITY = 'Stockholm';
/** Adress enligt sidfoten på /footer/ och /om-galeasen/: "Slupskjulsvägen 30-32 · 111 49 Stockholm". */
const ADDRESS = 'Slupskjulsvägen 30-32, 111 49 Stockholm';
const BASE = 'https://galeasen.se';

/** Biljettsystemet nordic (Dagny) — Teater Galeasens organizer-id är 2703. */
const NORTIC_BASE = 'https://www.nortic.se';
/**
 * Endast Teater Galeasens egen organisatorkalender får matcha — nordic.se
 * delar plattform med många andra arrangörer.
 */
const NORTIC_CALENDAR_PATH = /^\/dagny\/ajax\/organizer\/calendar\/shows\/2703(\/|$)/;

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'galeasen.se' || host === 'www.galeasen.se') return true;
    if (host === 'nortic.se' || host === 'www.nortic.se') {
      return NORTIC_CALENDAR_PATH.test(u.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const SWEDISH_MONTHS: Readonly<Record<string, number>> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2,
  mars: 3, mar: 3,
  april: 4, apr: 4,
  maj: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  augusti: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clean(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Giltigt YYYY-MM-DD, eller null (t.ex. "31 februari"). */
function formatDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCDate() !== day || probe.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * "Premiär 5 oktober 2026" / "Urpremiär 4 mars 2024" → "2026-10-05".
 *
 * Utan år tolkas datumet som nästa förekomst: ett datum som redan varit i
 * år räknas som nästa år (mätning 2026-10-24).
 */
export function parseSwedishDate(
  text: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!text) return null;
  const normalized = clean(text);

  const withYear = normalized.match(/(\d{1,2})\s+([A-Za-zåäöÅÄÖ]+)\.?\s+(\d{4})/);
  if (withYear) {
    const month = SWEDISH_MONTHS[withYear[2].toLowerCase()];
    if (!month) return null;
    return formatDate(Number(withYear[3]), month, Number(withYear[1]));
  }

  const withoutYear = normalized.match(/(\d{1,2})\s+([A-Za-zåäöÅÄÖ]+)/);
  if (!withoutYear) return null;
  const month = SWEDISH_MONTHS[withoutYear[2].toLowerCase()];
  if (!month) return null;
  const day = Number(withoutYear[1]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const candidate = new Date(today.getFullYear(), month - 1, day);
  if (candidate.getTime() < today.getTime()) candidate.setFullYear(candidate.getFullYear() + 1);
  return formatDate(candidate.getFullYear(), month, day);
}

/** En uppsättning, rått extraherad ur HTML:en. */
export interface RawShow {
  title: string | null;
  dateText: string | null;
  href: string | null;
}

/** Tar bort datumfrasen ur en rubrik ("Urpremiär 5 oktober 2026!"). */
function stripDatePhrase(text: string): string {
  return clean(
    text
      .replace(/\d{1,2}\s+[A-Za-zåäöÅÄÖ]+\.?\s+\d{4}\s*!?/g, '')
      .replace(/\b(Urpremiär|Premiär|Nypremiär)\b/gi, '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[^\p{L}\p{N}]+$/u, ''),
  );
}

/**
 * Läser uppsättningarna. Primär källa är presslistans
 * `ul.forestallningar > li`; fallback är startsidans `h1` med aktuell
 * uppsättning.
 */
export function parseShows(html: string): RawShow[] {
  const $ = cheerio.load(html);
  const shows: RawShow[] = [];

  $('ul.forestallningar > li').each((_, li) => {
    const title = clean($(li).find('div').first().text());
    if (!title) return;
    const dateText = clean($(li).find('h6').first().text());
    shows.push({
      title,
      dateText: dateText || null,
      href: $(li).find('a').first().attr('href') ?? null,
    });
  });

  if (shows.length > 0) return shows;

  $('h1').each((_, el) => {
    const text = clean($(el).text());
    if (!parseSwedishDate(text)) return;
    const title = clean($(el).find('span').first().text()) || stripDatePhrase(text);
    if (!title) return;
    shows.push({ title, dateText: text, href: null });
  });

  return shows;
}

function absoluteUrl(href: string): string {
  try {
    const u = new URL(href, BASE);
    if (u.protocol === 'http:') u.protocol = 'https:';
    return u.toString();
  } catch {
    return BASE;
  }
}

/** En föreställning ur nordics kalenderlista, rått extraherad. */
export interface RawShowListing {
  title: string | null;
  date: string | null;
  time: string | null;
  priceText: string | null;
  ticketPath: string | null;
  tags: string | null;
}

/**
 * Läser nordics föreställningslista.
 *
 * Datumet ligger i elementets klass (`sd2026-10-05`), tiden i
 * `.large-screen-date` ("Monday 18:00"), titeln i `.show-name`, priset i
 * `.price-range` ("från 150 SEK") och biljetten i `data-ticketurl`.
 */
export function parseShowListings(html: string): RawShowListing[] {
  const $ = cheerio.load(html);
  const listings: RawShowListing[] = [];

  $('.show-listing-show').each((_, el) => {
    const $el = $(el);
    const classAttr = $el.attr('class') ?? '';
    const dateMatch = classAttr.match(/\bsd(\d{4}-\d{2}-\d{2})\b/);

    const title =
      clean($el.find('.show-name').first().text()) ||
      clean($el.attr('data-eventname') ?? '');

    const timeText =
      clean($el.find('.large-screen-date').first().text()) ||
      clean($el.find('.show-info-small').first().text());
    const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);

    listings.push({
      title: title || null,
      date: dateMatch ? dateMatch[1] : null,
      time: timeMatch ? `${pad(Number(timeMatch[1]))}:${timeMatch[2]}` : null,
      priceText: clean($el.find('.price-range').first().text()) || null,
      ticketPath: $el.attr('data-ticketurl') ?? null,
      tags: $el.attr('data-tags') ?? null,
    });
  });

  return listings;
}

/** Normaliserar en tagg-sträng så att "teatergaleasen" matchas stabilt. */
function normalizeTag(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "från 150 SEK" → { priceMin: 150 }. "150-250 SEK" → min + max. */
export function parseNordicPrice(
  text: string | null | undefined,
): { priceMin?: number; priceMax?: number; isFree?: boolean } {
  if (!text) return {};
  const lower = text.toLowerCase();
  if (lower.includes('gratis') || lower.includes('free')) return { isFree: true };
  const amounts = (lower.match(/\d+/g) ?? []).map((n) => Number(n));
  if (amounts.length === 0) return {};
  const [min, max] = amounts;
  return max !== undefined && max > min ? { priceMin: min, priceMax: max } : { priceMin: min };
}

function absoluteNorticUrl(path: string): string {
  try {
    return new URL(path, NORTIC_BASE).toString();
  } catch {
    return NORTIC_BASE;
  }
}

export interface GaleasenExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'galeasen-listing' | 'galeasen-nortic-shows' | 'none';
}

/**
 * Speldagar från nordics kalenderlista (Teater Galeasen, organizer 2703).
 */
function extractNorticShows(
  html: string,
  url: string,
  source: string,
): GaleasenExtractResult {
  const listings = parseShowListings(html);
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  for (const listing of listings) {
    if (!listing.title || !listing.date) continue;
    // Skydd: endast rader som nordic taggat som Teater Galeasen.
    if (!normalizeTag(listing.tags).includes('teatergaleasen')) continue;

    const key = `${listing.title}|${listing.date}|${listing.time ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ticketUrl = listing.ticketPath ? absoluteNorticUrl(listing.ticketPath) : url;
    const price = parseNordicPrice(listing.priceText);

    try {
      const evt = ParsedEventSchema.parse({
        title: listing.title,
        date: listing.date,
        time: listing.time ?? undefined,
        venue: VENUE,
        address: ADDRESS,
        city: CITY,
        url: ticketUrl,
        ticketUrl,
        category: 'theatre-drama',
        source,
        sourceUrl: url,
        priceMin: price.priceMin,
        priceMax: price.priceMax,
        isFree: price.isFree,
        confidence: {
          score: 0.9,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: true,
          signals: ['galeasen-nortic-show', 'venue:teatergaleasen', `date:${listing.date}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [], events, method: 'galeasen-nortic-shows' };
}

export function extract(html: string, url: string, source = SOURCE_ID): GaleasenExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const host = hostnameOf(url);

  // Biljettsystemet nordic — den faktiska speldagslistan.
  if (host === 'nortic.se' || host === 'www.nortic.se') {
    return extractNorticShows(html, url, source);
  }

  const shows = parseShows(html);
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  const showUrls = new Set<string>();

  for (const show of shows) {
    if (!show.title) continue;

    // Utan datum kan raden inte överleva importens datumvakt — hoppa över.
    const date = parseSwedishDate(show.dateText);
    if (!date) continue;

    const eventUrl = show.href ? absoluteUrl(show.href) : url;
    const key = `${show.title}|${date}|${eventUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    showUrls.add(eventUrl);

    try {
      const evt = ParsedEventSchema.parse({
        title: show.title,
        date,
        venue: VENUE,
        address: ADDRESS,
        city: CITY,
        url: eventUrl,
        ticketUrl: eventUrl,
        category: 'theatre-drama',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.8,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: Boolean(show.href),
          hasDescription: false,
          hasTicketInfo: false,
          signals: ['galeasen-forestallningar-list', `premiere:${date}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'galeasen-listing' };
}
