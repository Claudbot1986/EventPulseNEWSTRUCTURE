/**
 * IFK Stockholm (ifkstockholm.se) adapter — alliansförening, Stockholm.
 *
 * Site-specifict mönster (verifierat 2026-10-24):
 *
 * - Källan `ifk-stockholm` pekar på https://www.ifkstockholm.se, som INTE är
 *   någon kalendersida. Mätt: HTTP 200, 32 263 byte, sitemap.xml har exakt
 *   tre URL:er (/, /om, /styrelse) och /matcher, /kalender, /evenemang,
 *   /nyheter svarar 404. Sidan är en portal som pekar vidare till klubbens
 *   tre avdelningar:
 *     - ifkstockholmfk.se      (fotboll) — 837 byte frameset som redirectar
 *                               till sig själv (Loopia-platshållare). Noll
 *                               evenemang.
 *     - ifkstockholmbk.se      (bowling) — spelschema med ENDAST förflutna
 *                               datum (säsongen 2025: 14 sep – 7 dec 2025),
 *                               nästa säsongs schema är inte publicerat.
 *     - ifkstockholmsimklubb.se (sim) — SportAdmin-sajt som LIGGER PÅ ETT
 *                               KALENDARIUM med framtida datum.
 * - Det enda stället i IFK-familjen med framtida daterade aktiviteter är
 *   alltså Simklubbens kalendarium:
 *   https://ifkstockholmsimklubb.se/sida/?ID=408177 (HTTP 200, 20 080 byte).
 *   Sidan är server-rendered (ingen JS behövs).
 * - Kalendariet består av två delar:
 *     1. en `<p>`-lista grupperad under rubriker "HT-2026" / "VT-2026" /
 *        "HT-2025", där rubriken ger TERMIN och ÅR:
 *          <p><strong>HT-2026</strong></p>
 *          <p>Höstläger Katrineholm, 13-15 november</p>
 *          <p>IFK Klubbmästerskap 24/11</p>
 *     2. en äldre tabell med samma innehåll i två kolumner (namn | datum),
 *        där första kolumnens rubrikrad ("VT-2026", "HT-2024") ger terminen.
 * - ÅRET står alltså INTE i datumtexten utan i terminrubriken. Utan termin
 *   kan ett datum inte tolkas → raden hoppas över (ingen gissning).
 * - En rad med FLER än ett datum ("söndag 20/12, tisdag 22/12", "22 och 24
 *   februari") är tvetydig → hoppas över. Samma sak för "vecka 32".
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST IFK Stockholm-familjens egna värdar.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'ifk-stockholm';
const PORTAL = 'https://www.ifkstockholm.se';
const SIM = 'https://ifkstockholmsimklubb.se';
const ORGANIZER = 'IFK Stockholm Simklubb';

/**
 * IFK Stockholm-familjens egna värdar (exakt hostname, aldrig substring).
 *
 * `ifkstockholmsimklubb.web.sportadmin.se` är samma Simklubb-site (det
 * domännamnet står som canonical/og:url på kalendariumsidan).
 */
const HOSTS = new Set([
  'ifkstockholm.se',
  'www.ifkstockholm.se',
  'ifkstockholmsimklubb.se',
  'www.ifkstockholmsimklubb.se',
  'ifkstockholmsimklubb.web.sportadmin.se',
]);

export function matches(url: string): boolean {
  try {
    return HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const MONTHS: Record<string, number> = {
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

/** Månadsnamn som regex-alternativ ("januari" först, så att "jan" inte vinner). */
const MONTH_ALT =
  'januari|jan|februari|feb|mars|mar|april|apr|maj|juni|jun|juli|jul|augusti|aug|september|sep|oktober|okt|november|nov|december|dec';

/**
 * Ett datumuttryck i en kalenderrad.
 *
 * Alternativen ordnas så att intervall vinner över enkla datum:
 * "13-15 november" (alt 2) före "15 november" (alt 4), och
 * "13/11 - 15/11" (alt 1) före "13/11" (alt 3).
 */
const DATE_TOKEN_RX = new RegExp(
  '(\\d{1,2})\\s*\\/\\s*(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s*\\/\\s*(\\d{1,2})' +
    '|(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+(' + MONTH_ALT + ')' +
    '|(\\d{1,2})\\s*\\/\\s*(\\d{1,2})' +
    '|(\\d{1,2})\\s+(' + MONTH_ALT + ')',
  'gi'
);

/** Klockslag ("kl. 15.00"). */
const TIME_RX = /(\d{1,2})\s*[.:]\s*(\d{2})/;
/** Terminrubrik ("HT-2026", "VT-2026"). */
const TERM_RX = /^(HT|VT)-(\d{4})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 2000 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** En kalenderrad, rått extraherad. */
export interface IfkCalendarEntry {
  title: string | null;
  date: string | null;
  endDate: string | null;
  time: string | null;
  term: string | null;
}

interface ParsedWhen {
  date: string;
  endDate?: string;
  time?: string;
  /** Själva datumuttrycket, för att kunna stryka det ur titeln. */
  token: string;
}

/**
 * Tolkar ett datumuttryck ("13-15 november", "24/11", "25 augusti").
 *
 * Returnerar null om raden inte har ett entydigt datum, t.ex. två datum
 * ("söndag 20/12, tisdag 22/12") eller ett som inte finns ("vecka 32").
 */
function parseWhen(when: string, year: number | null): ParsedWhen | null {
  if (year === null) return null;

  const tokens = [...when.matchAll(DATE_TOKEN_RX)];
  if (tokens.length !== 1) return null;
  const match = tokens[0];

  let day: number;
  let month: number;
  let endDay: number | undefined;
  let endMonth: number | undefined;

  const [, sd1, sm1, sd2, sm2, rd1, rd2, rmon, xd, xm, nd, nmon] = match;

  if (sd1) {
    // "13/11 - 15/11"
    day = Number(sd1);
    month = Number(sm1);
    endDay = Number(sd2);
    endMonth = Number(sm2);
  } else if (rd1) {
    // "13-15 november"
    day = Number(rd1);
    endDay = Number(rd2);
    month = MONTHS[rmon.toLowerCase()];
  } else if (xd) {
    // "24/11"
    day = Number(xd);
    month = Number(xm);
  } else {
    // "25 augusti"
    day = Number(nd);
    month = MONTHS[nmon.toLowerCase()];
  }

  if (!month) return null;
  if (!isValidYmd(year, month, day)) return null;

  const date = `${year}-${pad(month)}-${pad(day)}`;
  let endDate: string | undefined;
  if (endDay !== undefined && endMonth !== undefined) {
    if (!isValidYmd(year, endMonth, endDay)) return null;
    endDate = `${year}-${pad(endMonth)}-${pad(endDay)}`;
  } else if (endDay !== undefined) {
    if (!isValidYmd(year, month, endDay)) return null;
    endDate = `${year}-${pad(month)}-${pad(endDay)}`;
  }

  // Ett klockslag är inte ett extra datum — det plockas bort innan
  // kontrollen av "extra siffror" nedan.
  const timeMatch = when.match(TIME_RX);
  const time = timeMatch ? `${pad(Number(timeMatch[1]))}:${timeMatch[2]}` : undefined;

  // Om det finns fler dagsiffror kvar i raden än det vi just tolkat är
  // datumet tvetydigt ("22 och 24 februari") → hoppas över.
  const rest = when.replace(match[0], ' ').replace(TIME_RX, ' ');
  if (/(?<!\d)\d{1,2}(?!\d)/.test(rest)) return null;

  return { date, endDate, time, token: match[0] };
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Veckodag som står kvar i titeln när datumet har strukits ("… yngre simmare, lördag"). */
const WEEKDAY_RX = /(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)$/i;

/**
 * Läser kalendariet ur Simklubbens kalendariumsida.
 *
 * Två format stöds: `<p>`-listan under terminrubriker och den äldre
 * tabellen (namn | datum).
 */
export function parseCalendarEntries(html: string): IfkCalendarEntry[] {
  const $ = cheerio.load(html);
  const scope = $('.sa-paragraph__body').first();
  const container = scope.length > 0 ? scope : $.root();
  const entries: IfkCalendarEntry[] = [];

  let term: string | null = null;
  let year: number | null = null;

  container.find('p, table').each((_, node) => {
    const el = $(node);
    const tag = node.type === 'tag' ? node.name.toLowerCase() : '';

    if (tag === 'table') {
      // Tabellen har en egen terminrubrik i första kolumnen.
      let tableTerm: string | null = null;
      let tableYear: number | null = null;
      el.find('tr').each((__, tr) => {
        const cells = $(tr).find('td');
        const name = clean(cells.eq(0).text());
        const when = clean(cells.eq(1).text());
        const head = name.match(TERM_RX);
        if (head) {
          tableTerm = name;
          tableYear = Number(head[2]);
          return;
        }
        if (!name || !when) return;
        const parsed = parseWhen(when, tableYear);
        if (!parsed) return;
        entries.push({
          title: name,
          date: parsed.date,
          endDate: parsed.endDate ?? null,
          time: parsed.time ?? null,
          term: tableTerm,
        });
      });
      return;
    }

    const text = clean(el.text());
    if (!text) return;

    const head = text.match(TERM_RX);
    if (head) {
      term = text;
      year = Number(head[2]);
      return;
    }

    const parsed = parseWhen(text, year);
    if (!parsed) return;

    const title = clean(
      clean(text.replace(parsed.token, ' ')).replace(/[\s,;:.-]+$/, '').replace(WEEKDAY_RX, '')
    ).replace(/[\s,;:.-]+$/, '');
    entries.push({
      title: title || null,
      date: parsed.date,
      endDate: parsed.endDate ?? null,
      time: parsed.time ?? null,
      term,
    });
  });

  return entries;
}

/** Länkar till IFK:s övriga avdelningar (portalen) respektive kalendariet (sim). */
function familyLinks($: cheerio.CheerioAPI, selfHost: string): string[] {
  const found = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let host: string;
    try {
      host = new URL(href, 'https://www.ifkstockholm.se').hostname;
    } catch {
      return;
    }
    if (host === selfHost) return;
    if (!host.includes('ifkstockholm')) return;
    found.add(href.startsWith('http') ? href : `https://${host}${href}`);
  });
  return [...found];
}

export interface IfkStockholmExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'ifk-sim-kalendarium' | 'ifk-portal-links' | 'ifk-sim-links' | 'none';
}

/**
 * Plockar ut evenemangen.
 *
 * `now` är med som parameter så att filtreringen av avslutade terminradar
 * går att testa deterministiskt.
 */
export function extract(
  html: string,
  url: string,
  source = SOURCE_ID,
  now: Date = new Date()
): IfkStockholmExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const host = new URL(url).hostname;
  const entries = parseCalendarEntries(html);
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.date || !entry.title) continue;
    // Terminraderna är ett kalenderår i taget; avslutade rader hoppas över.
    if (entry.date < today) continue;

    const key = `${entry.title}|${entry.date}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title: entry.title,
        date: entry.date,
        time: entry.time ?? undefined,
        endDate: entry.endDate ?? undefined,
        organizer: ORGANIZER,
        description: entry.term ? `Termin: ${entry.term}` : undefined,
        url,
        category: 'sports',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.6,
          hasTitle: true,
          hasDate: true,
          hasVenue: false,
          hasUrl: true,
          hasDescription: Boolean(entry.term),
          hasTicketInfo: false,
          signals: ['ifk-sim-kalendarium', ...(entry.term ? [`term:${entry.term}`] : [])],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length > 0) {
    return { showUrls: [], events, method: 'ifk-sim-kalendarium' };
  }

  // Ingen kalender på den här sidan — lämna vidare de länkar som faktiskt
  // leder till en (portalen → avdelningarna, simklubben → kalendariet).
  const $ = cheerio.load(html);
  if (host.includes('ifkstockholmsimklubb')) {
    const kalendarium = new Set(
      $('a[href]')
        .filter((_, el) => clean($(el).text()).toLowerCase() === 'kalendarium')
        .map((_, el) => $(el).attr('href') ?? '')
        .get()
        .filter((href) => href.includes('ID=408177'))
        .map((href) => new URL(href, SIM).toString())
    );
    if (kalendarium.size > 0) {
      return { showUrls: [...kalendarium], events: [], method: 'ifk-sim-links' };
    }
    return { showUrls: [], events: [], method: 'none' };
  }

  const departments = familyLinks($, host);
  if (departments.length > 0) {
    return { showUrls: departments, events: [], method: 'ifk-portal-links' };
  }

  return { showUrls: [], events: [], method: 'none' };
}
