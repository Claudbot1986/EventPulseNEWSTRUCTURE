/**
 * Stockholm Jazz Festival (stockholmjazz.se) adapter — jazzfestival i Stockholm.
 *
 * Site-specifict mönster (verifierat 2026-10-24):
 *
 * - DOMEN ÄR `stockholmjazz.se`. `stockholmjazz.com` är en KAPAD/squatad
 *   domän ("Insights on WoW Raid Carry", WordPress-spam) som innehåller NOLL
 *   jazz — den får inte hanteras som festivalen. Se `matches()` nedan.
 * - Sajten är en SvelteKit-app: `/program` är en 8 kB JS-shell utan JSON-LD
 *   och utan konsertkort. Efter JS-rendering finns 331 konsertkort:
 *
 *     <a aria-label="Augusta Swing Band, 9 oktober 16:00, Källarbyn"
 *        href="/program/augusta-swing-band-2026-10-09-1784235123930"
 *        class="block">…</a>
 *
 *   `aria-label` = "{titel}, {D} {månad} {HH:MM}, {scen}" — 331/331 går att
 *   tolka med ett ankare REGEX (titelns kommor bryter inte parsingen).
 * - Datumet ligger i URL-sluggen: `...-YYYY-MM-DD` eller `...-YYYY-MM-DD-<id>`.
 *   Sluggar utan datum (t.ex. "en-mall-publicera-inte-kopia-1784230390369")
 *   får datumet från `aria-label` + festivalåret som härleds ur sidans sluggar.
 * - Varje enskild konsertsida (`/program/<slug>`) har JSON-LD `MusicEvent` med
 *   `startDate` (ISO med offset), `location.name` (scen),
 *   `location.address.streetAddress` och `description`.
 * - JSON-LD `ItemList` på programsidan innehåller BARA url:er (inga datum) —
 *   kan inte användas för att härleda datum.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST stockholmjazz.se.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'stockholm-jazz-festival';
const BASE = 'https://www.stockholmjazz.se';
const CITY = 'Stockholm';

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    // Endast festivalens riktiga domän. stockholmjazz.com är en annan
    // (skräp-)webbplats och ska inte matchas.
    return u.hostname === 'stockholmjazz.se' || u.hostname === 'www.stockholmjazz.se';
  } catch {
    return false;
  }
}

const SWE_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** `/program/<slug>` eller `/en/program/<slug>` (engelska dubbletter). */
const PROGRAM_PATH_RX = /^\/(?:en\/)?program\/([^/?#]+)\/?$/;
/** Datum i sluggen: `...-2026-10-09` eller `...-2026-10-09-1784235123930`. */
const SLUG_DATE_RX = /(\d{4})-(\d{2})-(\d{2})(?=-|$)/;
/**
 * `aria-label` = "{titel}, {D} {månad} {HH:MM}, {scen}".
 * Prefixen är GREEDY så att ett komma i titeln inte bryter parsningen;
 * datumdelen hittas alltså först närmast slutet.
 */
const LABEL_RX = /^(.*),\s*(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{1,2}:\d{2}))?,\s*(.+)$/i;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 2000 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** ISO-start ("2026-10-09T16:00:00+02:00") → { date, time }. */
function parseIsoStart(iso: string): { date: string; time?: string } | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isValidYmd(y, mo, d)) return null;
  return {
    date: formatYmd(y, mo, d),
    time: m[4] !== undefined ? `${pad(Number(m[4]))}:${m[5]}` : undefined,
  };
}

interface JsonLdEventLike {
  '@type'?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  image?: string | string[];
  url?: string;
  location?: {
    name?: string;
    address?: { streetAddress?: string; addressLocality?: string };
  };
}

/**
 * Endast "konsert"-typer. `Festival` (startsidans JSON-LD, "Stockholm Jazz
 * Festival 2026", 9–18 okt) är festivalen i stort, inte en konsert, och
 * skulle maskera de 48 riktiga konsertlänkarna på startsidan.
 */
const EVENT_TYPES = new Set([
  'event',
  'musicevent',
  'theaterevent',
  'danceevent',
  'comedyevent',
  'screeningevent',
]);

function typeOf(node: { '@type'?: string | string[] }): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t.toLowerCase()];
  if (Array.isArray(t)) return t.map((x) => String(x).toLowerCase());
  return [];
}

function isEventNode(node: JsonLdEventLike): boolean {
  return typeOf(node).some((t) => EVENT_TYPES.has(t));
}

/** Plockar ut alla JSON-LD-noder (inkl. @graph) ur en LD-block. */
function collectJsonLdNodes(raw: string): JsonLdEventLike[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: JsonLdEventLike[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as JsonLdEventLike & { '@graph'?: unknown };
    if (isEventNode(obj)) out.push(obj);
    if (obj['@graph']) walk(obj['@graph']);
  };
  walk(parsed);
  return out;
}

/** Alla JSON-LD Event-noder i HTML:en. */
export function findJsonLdEvents(html: string): JsonLdEventLike[] {
  const out: JsonLdEventLike[] = [];
  const rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(rx)) out.push(...collectJsonLdNodes(m[1]));
  return out;
}

/** En rad från den renderade programsidan. */
export interface JazzRow {
  title: string | null;
  date: string | null;
  time: string | null;
  venue: string | null;
  url: string;
}

/**
 * År för ett "D månad"-datum.
 *
 * Har sidan ett festivalår (flest sluggar) används det. Annars gissas
 * året utifrån dagens datum: ett datum som redan varit (mer än 45 dagar
 * sedan) antas tillhöra nästa år.
 */
export function resolveYear(month: number, day: number, festivalYear: number | null): number {
  if (festivalYear) return festivalYear;
  const now = new Date();
  const current = now.getFullYear();
  const candidate = new Date(Date.UTC(current, month - 1, day));
  const ageDays = Math.round((now.getTime() - candidate.getTime()) / 86_400_000);
  return ageDays > 45 ? current + 1 : current;
}

/**
 * Plockar ut konsertrader ur den JS-renderade listan.
 *
 * `festivalYear` är året som härleds ur sidans sluggar och används för
 * rader vars slug saknar datum men vars `aria-label` har "D månad".
 */
export function parseProgramCards(html: string, festivalYear: number | null): JazzRow[] {
  const $ = cheerio.load(html);
  const rows: JazzRow[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let pathname: string;
    try {
      pathname = new URL(href, BASE).pathname;
    } catch {
      return;
    }
    const slugMatch = pathname.match(PROGRAM_PATH_RX);
    if (!slugMatch) return;
    const slug = slugMatch[1];

    const label = $(el).attr('aria-label') ?? '';
    const anchorText = $(el).text().replace(/\s+/g, ' ').trim();

    const labelMatch = label.match(LABEL_RX);
    const slugDate = slug.match(SLUG_DATE_RX);

    let title = anchorText || null;
    let date: string | null = null;
    let time: string | null = null;
    let venue: string | null = null;

    if (labelMatch) {
      title = labelMatch[1].trim() || title;
      const day = Number(labelMatch[2]);
      const month = SWE_MONTHS[labelMatch[3].toLowerCase()];
      time = labelMatch[4] ?? null;
      venue = labelMatch[5].trim() || null;
      const labelYear = month ? resolveYear(month, day, festivalYear) : 0;
      if (month && isValidYmd(labelYear, month, day)) {
        date = formatYmd(labelYear, month, day);
      }
    }

    // Slugens datum används BARA om labelns saknar datum: sluggen är
    // stale på några rader (verifierat 2026-10-24 mot konsertsidornas
    // JSON-LD, t.ex. /program/old-boy-stompers-2025-02-15 har 2026-10-15).
    if (!date && slugDate) {
      const y = Number(slugDate[1]);
      const mo = Number(slugDate[2]);
      const d = Number(slugDate[3]);
      if (isValidYmd(y, mo, d)) date = formatYmd(y, mo, d);
    }

    if (!title || !date) return;
    rows.push({ title, date, time, venue, url: `${BASE}/program/${slug}` });
  });

  return rows;
}

/** Dominant festivalår i sidans URL-sluggar (t.ex. 2026). */
export function festivalYearFromHtml(html: string): number | null {
  const years = new Map<number, number>();
  const rx = /\/program\/[^"'?\s]*?(\d{4})-(\d{2})-(\d{2})(?:-|\/|["'\s])/g;
  for (const m of html.matchAll(rx)) {
    const y = Number(m[1]);
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  if (years.size === 0) return null;
  return [...years.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export interface StockholmJazzExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'stockholmjazz-jsonld' | 'stockholmjazz-listing' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): StockholmJazzExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  // 1) Enskild konsertsida: JSON-LD MusicEvent (exakt datum + adress).
  const jsonLd = findJsonLdEvents(html);
  if (jsonLd.length > 0) {
    const events: ParsedEvent[] = [];
    const showUrls = new Set<string>();
    for (const node of jsonLd) {
      if (!node.startDate || !node.name) continue;
      const start = parseIsoStart(node.startDate);
      if (!start) continue;
      const end = node.endDate ? parseIsoStart(node.endDate) : null;
      const eventUrl = node.url ?? url;
      const venue = node.location?.name?.trim() || undefined;
      const address = node.location?.address?.streetAddress?.trim() || undefined;
      const locality = node.location?.address?.addressLocality?.trim() || undefined;
      const image = Array.isArray(node.image) ? node.image[0] : node.image;
      try {
        const evt = ParsedEventSchema.parse({
          title: node.name.trim(),
          date: start.date,
          time: start.time,
          endDate: end?.date,
          venue,
          address,
          city: locality ?? CITY,
          description: node.description?.trim() || undefined,
          url: eventUrl,
          ticketUrl: eventUrl,
          imageUrl: image,
          category: 'jazz',
          source,
          sourceUrl: url,
          confidence: {
            score: 0.92,
            hasTitle: true,
            hasDate: true,
            hasVenue: Boolean(venue),
            hasUrl: true,
            hasDescription: Boolean(node.description),
            hasTicketInfo: false,
            signals: ['stockholmjazz-jsonld', 'musicevent'],
          },
        });
        events.push(evt);
        showUrls.add(eventUrl);
      } catch {
        /* skip malformed */
      }
    }
    if (events.length > 0) {
      return { showUrls: [...showUrls], events, method: 'stockholmjazz-jsonld' };
    }
  }

  // 2) Renderad lista (/program eller startsidan): korten bär aria-label.
  const festivalYear = festivalYearFromHtml(html);
  const rows = parseProgramCards(html, festivalYear);
  const events: ParsedEvent[] = [];
  const showUrls = new Set<string>();
  const seen = new Set<string>();

  for (const row of rows) {
    const key = `${row.title}|${row.date}|${row.time ?? ''}|${row.venue ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    showUrls.add(row.url);
    try {
      const evt = ParsedEventSchema.parse({
        title: row.title,
        date: row.date,
        time: row.time ?? undefined,
        venue: row.venue ?? undefined,
        city: CITY,
        url: row.url,
        ticketUrl: row.url,
        category: 'jazz',
        source,
        sourceUrl: url,
        confidence: {
          score: row.venue ? 0.85 : 0.75,
          hasTitle: true,
          hasDate: true,
          hasVenue: Boolean(row.venue),
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: false,
          signals: ['stockholmjazz-listing', row.venue ? 'aria-label' : 'slug-link'],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'stockholmjazz-listing' };
}
