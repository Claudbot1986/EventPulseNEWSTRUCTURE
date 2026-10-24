/**
 * Pingst (pingst.se) adapter — Pingst – fria församlingar i samverkan.
 *
 * Site-specifict mönster (verifierat 2026-10-24):
 *
 * - WordPress med Divi-tema + MEC (Modern Events Calendar Lite).
 * - Det finns INGEN samlad "kalender"-sida med framtida gudstjänster:
 *   `/events/` (MEC-arkivet) svarar "Inget evenemang hittades!" och
 *   `/program` redirectar till `/program-2024/` = "Program – Pingst Pastor
 *   konferens 2024" (en KONFERENSPROGRAM-sida, inte en församlingskalender).
 * - Konferensprogram-sidorna (Divi `et_pb_text`) är det enda listformat som
 *   bär riktiga kalenderrader:
 *
 *     <h1>Tisdag</h1>
 *     <p><strong>10.00 – 11.00 Incheckning och fika</strong></p>
 *     <p><strong>11.00-12.30 Storsamling med välkomnande av nya pastorer –</strong>
 *        Predikan av <em>Mats Särnholm</em></p>
 *
 *   Varianten på `/pingst-pastor-konferens/konferensprogram/` har i stället
 *   `<h1>DAG 1</h1>` + `<p>10 januari</p>` och tiderna "09.00–11.00".
 * - Dagarna är INTE alltid numrerade, ibland är de veckodagar
 *   ("Tisdag", "Onsdag", "Torsdag"). Datumet kommer då från ingressen:
 *   "mellan 9–11 januari 2024" → rätt veckodag per dag.
 * - Året saknas ofta i dagtexten ("10 januari"). Det härleds då från sidans
 *   egen publiceringsdatum (`article:published_time`): konferensen är i
 *   januari, så en sida publicerad i oktober 2022 gäller januari 2023.
 * - Enskilda MEC-eventsidor (`/events/<slug>/`) har JSON-LD `Event` med
 *   `startDate`/`endDate` och `name` — men `location.name` är TOM.
 *
 * Viktigt: nyhetsartiklar, videor och sidfoten är INTE evenemang. En rad
 * måste ligga i ett dag-block (h1 "DAG n" eller veckodag) och ha en tid,
 * annars hoppas den över.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST pingst.se.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'pingstkyrkan';
const BASE = 'https://www.pingst.se';
const CITY = 'Stockholm';

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'pingst.se' || u.hostname === 'www.pingst.se';
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

/** JS-veckodag: 0 = söndag, 1 = måndag … 6 = lördag. */
const WEEKDAYS: Record<string, number> = {
  söndag: 0,
  måndag: 1,
  tisdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lördag: 6,
};

const TIME_ROW_RX = /^(\d{1,2})[.:](\d{2})\s*(?:[–—-]\s*(\d{1,2})[.:](\d{2}))?\s+(.+)$/;
const DATE_LINE_RX = /^(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?$/i;
const DAY_HEADING_RX = /^DAG\s*(\d+)$/i;
const RANGE_RX = /(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?/i;
const VENUE_RX = /\bpå\s+([A-ZÅÄÖ][^.,;]{2,60}?)\s+i\s+([A-ZÅÄÖ][^.,;]{2,40})/;

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

function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

interface ProgrammeDay {
  kind: 'dag' | 'weekday';
  index?: number;
  weekday?: number;
  explicitDate?: { day: number; month: number; year?: number };
  rows: ProgrammeRow[];
}

interface ProgrammeRow {
  start: string;
  end?: string;
  title: string;
}

/** Ett programrad-par (dag + rader) från en program-sida. */
export interface ProgrammeDayResult {
  date: string | null;
  rows: ProgrammeRow[];
}

/** Texten i ett element fram till första <br> (då slipper man "Medverkande:"). */
function textUntilBreak($: cheerio.CheerioAPI, el: cheerio.Element): string {
  const html = $(el).html() ?? '';
  const idx = html.search(/<br\s*\/?>/i);
  const part = idx >= 0 ? html.slice(0, idx) : html;
  return $('<div>').html(part).text().replace(/\s+/g, ' ').trim();
}

/** Året sidan publicerades (article:published_time / datePublished). */
export function publishedYearFromHtml(html: string): { year: number; month: number } | null {
  const stamps = [
    ...html.matchAll(/<meta[^>]+property=["']article:published_time["'][^>]+content=["'](\d{4})-(\d{2})/gi),
    ...html.matchAll(/"datePublished"\s*:\s*"(\d{4})-(\d{2})/gi),
  ].map((m) => ({ year: Number(m[1]), month: Number(m[2]) }));
  if (stamps.length === 0) return null;
  // Äldsta publiceringsdatum används: programmet skrivs före evenemanget.
  stamps.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return stamps[0];
}

/**
 * Året för ett "D månad"-datum.
 *
 * Utan egen årsangivelse används sidans publiceringsår: ett evenemang i
 * januari på en sida publicerad i oktober 2022 håller till i januari 2023.
 */
export function resolveEventYear(
  month: number,
  published: { year: number; month: number } | null,
  today = new Date()
): number {
  if (published) {
    return month < published.month ? published.year + 1 : published.year;
  }
  const candidate = new Date(Date.UTC(today.getFullYear(), month - 1, 1));
  const ageDays = Math.round((today.getTime() - candidate.getTime()) / 86_400_000);
  return ageDays > 45 ? today.getFullYear() + 1 : today.getFullYear();
}

/** Datumintervallet i ingressen, t.ex. "mellan 9–11 januari 2024". */
export function findDateRange(text: string): { start: number; end: number; month: number; year?: number } | null {
  const m = text.match(RANGE_RX);
  if (!m) return null;
  const month = SWE_MONTHS[m[3].toLowerCase()];
  if (!month) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    month,
    year: m[4] ? Number(m[4]) : undefined,
  };
}

/** Plockar ut dag-blocken och deras tidsrader ur en program-sida. */
export function parseProgrammeDays(html: string): ProgrammeDay[] {
  const $ = cheerio.load(html);
  const container = $('#main-content').first().length ? $('#main-content').first() : $('body');
  const days: ProgrammeDay[] = [];
  let current: ProgrammeDay | null = null;

  container.find('h1, h2, h3, h4, h5, h6, p').each((_, el) => {
    const tag = el.tagName?.toLowerCase() ?? '';
    const isHeading = /^h[1-6]$/.test(tag);
    const text = isHeading ? $(el).text().replace(/\s+/g, ' ').trim() : textUntilBreak($, el);

    if (isHeading) {
      const dag = text.match(DAY_HEADING_RX);
      if (dag) {
        current = { kind: 'dag', index: Number(dag[1]), rows: [] };
        days.push(current);
        return;
      }
      const weekday = WEEKDAYS[text.toLowerCase()];
      if (weekday !== undefined) {
        current = { kind: 'weekday', weekday, rows: [] };
        days.push(current);
        return;
      }
      return;
    }

    if (!current) return;

    const dateLine = text.match(DATE_LINE_RX);
    if (dateLine && !current.explicitDate) {
      const month = SWE_MONTHS[dateLine[2].toLowerCase()];
      if (month) {
        current.explicitDate = {
          day: Number(dateLine[1]),
          month,
          year: dateLine[3] ? Number(dateLine[3]) : undefined,
        };
        return;
      }
    }

    const timeRow = text.match(TIME_ROW_RX);
    if (timeRow) {
      const title = timeRow[5].replace(/\s+/g, ' ').trim();
      if (!title) return;
      current.rows.push({
        start: `${pad(Number(timeRow[1]))}:${timeRow[2]}`,
        end: timeRow[3] !== undefined ? `${pad(Number(timeRow[3]))}:${timeRow[4]}` : undefined,
        title,
      });
    }
  });

  return days;
}

/** Löser datumet för varje dag-block. */
export function resolveProgrammeDates(
  days: ProgrammeDay[],
  html: string,
  published: { year: number; month: number } | null
): ProgrammeDayResult[] {
  const $ = cheerio.load(html);
  const container = $('#main-content').first().length ? $('#main-content').first() : $('body');
  const introText = container.text().replace(/\s+/g, ' ');
  const range = findDateRange(introText);

  // Explicita datum i andra block kan också ge ett veckodagsdatum.
  const explicitDates: Array<{ day: number; month: number; year?: number }> = [];
  for (const d of days) if (d.explicitDate) explicitDates.push(d.explicitDate);

  return days.map((d) => {
    if (d.explicitDate) {
      const month = d.explicitDate.month;
      const year =
        d.explicitDate.year ?? resolveEventYear(month, published);
      if (!isValidYmd(year, month, d.explicitDate.day)) return { date: null, rows: d.rows };
      return { date: formatYmd(year, month, d.explicitDate.day), rows: d.rows };
    }

    if (d.kind === 'weekday' && d.weekday !== undefined) {
      // 1) Datumintervall i ingressen ("mellan 9–11 januari 2024").
      if (range) {
        const year = range.year ?? resolveEventYear(range.month, published);
        for (let day = range.start; day <= range.end; day += 1) {
          if (!isValidYmd(year, range.month, day)) continue;
          if (weekdayOf(year, range.month, day) === d.weekday) {
            return { date: formatYmd(year, range.month, day), rows: d.rows };
          }
        }
      }
      // 2) Annars: ett explicit datum i samma veckodag.
      for (const ex of explicitDates) {
        const year = ex.year ?? resolveEventYear(ex.month, published);
        if (!isValidYmd(year, ex.month, ex.day)) continue;
        if (weekdayOf(year, ex.month, ex.day) === d.weekday) {
          return { date: formatYmd(year, ex.month, ex.day), rows: d.rows };
        }
      }
    }

    return { date: null, rows: d.rows };
  });
}

/** JSON-LD Event-noder (MEC-eventsidor). */
export interface PingstJsonLdEvent {
  name?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  image?: string | string[];
  url?: string;
  location?: { name?: string; address?: string | { streetAddress?: string; addressLocality?: string } };
}

export function findJsonLdEvents(html: string): PingstJsonLdEvent[] {
  const out: PingstJsonLdEvent[] = [];
  const rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as PingstJsonLdEvent & { '@type'?: string | string[]; '@graph'?: unknown };
    const types = Array.isArray(obj['@type'])
      ? obj['@type'].map((t) => String(t).toLowerCase())
      : [String(obj['@type'] ?? '').toLowerCase()];
    if (types.includes('event') && obj.startDate) out.push(obj);
    if (obj['@graph']) walk(obj['@graph']);
  };
  for (const m of html.matchAll(rx)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* ogiltig JSON-LD hoppas över */
    }
  }
  return out;
}

function parseIsoDate(iso: string): { date: string; time?: string } | null {
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

export interface PingstExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'pingst-jsonld' | 'pingst-program' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): PingstExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  // 1) MEC-eventsida: JSON-LD Event.
  const jsonLd = findJsonLdEvents(html);
  if (jsonLd.length > 0) {
    const events: ParsedEvent[] = [];
    const showUrls = new Set<string>();
    for (const node of jsonLd) {
      if (!node.startDate || !node.name) continue;
      const start = parseIsoDate(node.startDate);
      if (!start) continue;
      const end = node.endDate ? parseIsoDate(node.endDate) : null;
      const eventUrl = node.url ?? url;
      const address =
        typeof node.location?.address === 'object'
          ? node.location?.address?.streetAddress
          : node.location?.address;
      const locality =
        typeof node.location?.address === 'object'
          ? node.location?.address?.addressLocality
          : undefined;
      const image = Array.isArray(node.image) ? node.image[0] : node.image;
      try {
        const evt = ParsedEventSchema.parse({
          title: node.name.trim(),
          date: start.date,
          time: start.time,
          endDate: end?.date,
          venue: node.location?.name?.trim() || undefined,
          address: address?.trim() || undefined,
          city: locality?.trim() || undefined,
          description: node.description?.trim() || undefined,
          url: eventUrl,
          ticketUrl: eventUrl,
          imageUrl: image,
          source,
          sourceUrl: url,
          confidence: {
            score: 0.85,
            hasTitle: true,
            hasDate: true,
            hasVenue: Boolean(node.location?.name),
            hasUrl: true,
            hasDescription: Boolean(node.description),
            hasTicketInfo: false,
            signals: ['pingst-jsonld', 'mec-event'],
          },
        });
        events.push(evt);
        showUrls.add(eventUrl);
      } catch {
        /* skip malformed */
      }
    }
    if (events.length > 0) return { showUrls: [...showUrls], events, method: 'pingst-jsonld' };
  }

  // 2) Program-sida: dag-block med tidsrader.
  const $ = cheerio.load(html);
  const container = $('#main-content').first().length ? $('#main-content').first() : $('body');
  const introText = container.text().replace(/\s+/g, ' ');
  const venueMatch = introText.match(VENUE_RX);
  const venue = venueMatch ? venueMatch[1].trim() : undefined;
  const city = venueMatch ? venueMatch[2].trim() : CITY;

  const published = publishedYearFromHtml(html);
  const days = parseProgrammeDays(html);
  const resolved = resolveProgrammeDates(days, html, published);

  const events: ParsedEvent[] = [];
  const showUrls = new Set<string>();
  const seen = new Set<string>();

  for (const day of resolved) {
    if (!day.date) continue;
    for (const row of day.rows) {
      const key = `${day.date}|${row.start}|${row.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      showUrls.add(url);
      try {
        const evt = ParsedEventSchema.parse({
          title: row.title,
          date: day.date,
          time: row.start,
          endTime: row.end,
          venue,
          city,
          url,
          source,
          sourceUrl: url,
          confidence: {
            score: 0.8,
            hasTitle: true,
            hasDate: true,
            hasVenue: Boolean(venue),
            hasUrl: true,
            hasDescription: false,
            hasTicketInfo: false,
            signals: ['pingst-program', 'schedule-row'],
          },
        });
        events.push(evt);
      } catch {
        /* skip malformed */
      }
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'pingst-program' };
}
