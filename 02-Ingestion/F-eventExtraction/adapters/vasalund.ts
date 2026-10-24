/**
 * Vasalunds IF adapter — fotbollsklubb, Stockholm.
 *
 * MÄTT (2026-10-24, lokal Playwright/Chromium — ingen ScrapingBee-kredit):
 *
 * 1. Källans registrerade URL `https://www.vasalund.se` är en PARKERAD domän
 *    till salu ("TILL SALU", 7 397 B, HTTP 200). Varje sökväg på domänen
 *    (/kalender, /matcher, /biljetter, /nyheter …) returnerar samma
 *    försäljningssida — där finns noll evenemang. Klubbens riktiga sajt är
 *    `https://www.vasalund.com` (114 kB, DM/360Player + Vumatch).
 *    Adaptern täcker därför BÅDA värdarna; innehållet finns bara på .com.
 *
 * 2. JS-RENDERING ÄR OBLIGATORISK. Server-HTML:en på /matcher innehåller
 *    bara JS-mallen (en template-literal med `<div class="match-item">`) och
 *    0 renderade match-rader. Kalendern fylls via
 *    `GET /rts/collections/public/<id>/runtime/collection/events/query-data`.
 *
 * 3. /matcher (working listing URL) har två rutnät:
 *      - `upcoming-grid` = 10 framtida matcher
 *      - `results-grid`  = 21 spelade matcher (har `match-score`) → SKIPPAS
 *    Varje `match-item` i upcoming-grid:
 *      - lag:  `<div class="team-name">` (första = hemma, andra = borta)
 *      - meta: `<div class="match-meta"><span>lör 24 okt. 2026</span>
 *              <span>16:00</span><span>Sollentunavallen 1</span></div>`
 *      - platsen saknas på 2 av 10 rader (opponent ej fastställd ännu).
 *
 * 4. /kalender (klubbens egen kalender) — `div.event-items` med en
 *    `div.calendar-club-event-main` per rad. Datumet ligger INTE i raden:
 *      - månad/år: `<h4 class="calendar-club-date-selector-header">okt 2026`
 *      - dagen: skrivs bara på FÖRSTA raden per dag
 *        (`calendar-club-day-item-date` → `<div>24</div><div>lör</div>`);
 *        de övriga 525 raderna har tomt `calendar-club-day-item-date`, så
 *        datumet måste föras vidare (carry-forward).
 *      - kategori: `event-type-match|cup|practice|meeting|camp|uncategorized`
 *      - titel/tid/plats: `calendar-club-day-item-title/-time/-location`
 *
 * 5. Kategorier: adaptern tar bara `event-type-match` (klubbens matcher).
 *    practice (368), cup (36), meeting (23) och camp (7) är interna
 *    verksamheter — ungdomsträningar, föräldramöten, cupdagar — inte
 *    evenemang en person kan ta del av.
 *
 * KORSTEXT: kalenderns dag 24 ("Sollentuna FK - Vasalund", 16:00,
 * Sollentunavallen 1) stämmer exakt med /matcher ("Sollentuna FK vs Herrar",
 * lör 24 okt. 2026, 16:00, Sollentunavallen 1). Veckodagen i kalendern
 * stämmer med 2026-10-01 = torsdag.
 *
 * Per CLAUDE.md Generalization Protection Rule: adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST Vasalunds IF.
 */
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'vasalund-2';
const ORGANIZER = 'Vasalunds IF';

/**
 * `vasalund.se` = källans registrerade URL (parkerad domän till salu).
 * `vasalund.com` = klubbens riktiga sajt.
 */
const HOSTS = new Set([
  'vasalund.se',
  'www.vasalund.se',
  'vasalund.com',
  'www.vasalund.com',
]);

export function matches(url: string): boolean {
  try {
    return HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Svenska månadsförkortningar och -namn → månadsnummer. */
const MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  mar: 3,
  mars: 3,
  apr: 4,
  april: 4,
  maj: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  aug: 8,
  augusti: 8,
  sep: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Endast matcher — klubbens faktiska spelmatcher. */
const MATCH_ONLY = 'match';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&aring;/g, 'å')
    .replace(/&Auml;/g, 'Ä')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&Aring;/g, 'Å');
}

function clean(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "lör 24 okt. 2026" → "2026-10-24". */
export function parseSwedishDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([a-zåäö]{3,10})\.?\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase().replace(/\.$/, '')];
  if (!month) return null;
  return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`;
}

/** "okt 2026" → { year: 2026, month: 10 }. */
export function parseMonthHeader(html: string): { year: number; month: number } | null {
  const m = html.match(
    /calendar-club-date-selector-header[^>]*>\s*([a-zåäö]{3,10})\.?\s+(\d{4})/i
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase().replace(/\.$/, '')];
  if (!month) return null;
  return { year: Number(m[2]), month };
}

/** En rad ur /matcher: två lag, datum, tid och (valfri) plats. */
interface RawMatch {
  home: string | null;
  away: string | null;
  date: string | null;
  time: string | null;
  venue: string | null;
  isResult: boolean;
}

const TEAM_RX = /<div class="team-name">([\s\S]*?)<\/div>/g;
// Ingen `g`-flagga: `.match()` ska returnera fångad grupp, inte en träfflista.
const META_RX = /<div class="match-meta">([\s\S]*?)<\/div>/;
const SPAN_RX = /<span>([\s\S]*?)<\/span>/g;

/**
 * Läser matchrader ur `upcoming-grid`. Returnerar tom lista om sidan inte
 * har något kommande-rutnät.
 */
export function parseMatchItems(html: string): RawMatch[] {
  const start = html.indexOf('class="matches-grid upcoming-grid"');
  if (start < 0) return [];

  // Rutnätet slutar vid nästa rutnät (results-grid) — annars vid sidans slut.
  const next = html.indexOf('class="matches-grid', start + 1);
  const grid = html.slice(start, next < 0 ? html.length : next);

  const rows: RawMatch[] = [];
  for (const chunk of grid.split('<div class="match-item">').slice(1)) {
    // Spelade matcher ligger i results-grid och har alltid ett resultat.
    if (chunk.includes('class="match-score"')) continue;

    const teams: string[] = [];
    for (const m of chunk.matchAll(TEAM_RX)) teams.push(clean(m[1]));

    const metaMatch = chunk.match(META_RX);
    const spans: string[] = metaMatch
      ? [...metaMatch[1].matchAll(SPAN_RX)].map((m) => clean(m[1]))
      : [];

    const date = spans[0] ? parseSwedishDate(spans[0]) : null;
    if (!date) continue;

    rows.push({
      home: teams[0] ?? null,
      away: teams[1] ?? null,
      date,
      time: spans[1] ?? null,
      venue: spans[2] ?? null,
      isResult: false,
    });
  }

  return rows;
}

/** En rad ur /kalender. */
interface RawCalendarEvent {
  day: number | null;
  category: string | null;
  title: string | null;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
  venue: string | null;
  group: string | null;
  isCancelled: boolean;
}

const DAY_MARKER_RX = /calendar-club-day-item-date">\s*<div>\s*(\d{1,2})\s*<\/div>/;
const CATEGORY_RX = /event-type-([a-z]+)/;

/**
 * "16:00 - 18:00" → start "16:00", slut "18:00".
 * "08:45 (25/10 16:00)" → start "08:45", slut 25/10 kl 16:00.
 */
export function parseTimeRange(
  raw: string | null,
  year: number,
  month: number
): { time: string | null; endTime: string | null; endDate: string | null } {
  if (!raw) return { time: null, endTime: null, endDate: null };

  const start = raw.match(/(\d{1,2}:\d{2})/);
  const time = start ? start[1] : null;

  const end = raw.match(/\((\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\)/);
  if (end) {
    // Slutdatumet skrivs "dag/månad" — kan hamna i nästa månad.
    const endDay = Number(end[1]);
    const endMonth = Number(end[2]);
    const endYear = endMonth < month ? year + 1 : year;
    return {
      time,
      endTime: end[3],
      endDate: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
    };
  }

  const range = raw.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  return { time, endTime: range ? range[2] : null, endDate: null };
}

/**
 * Läser kalenderns rader. Datumet måste föras vidare: dagen skrivs bara på
 * den första raden för varje dag.
 */
export function parseCalendarRows(html: string): RawCalendarEvent[] {
  if (!html.includes('calendar-club-day-item-date')) return [];

  const rows: RawCalendarEvent[] = [];
  let day: number | null = null;

  // Första biten är allt före första raden (sidhuvud + kategorilégenda).
  const chunks = html.split('<div class="calendar-club-event-main').slice(1);

  for (const chunk of chunks) {
    const marker = chunk.match(DAY_MARKER_RX);
    if (marker) day = Number(marker[1]);

    const category = chunk.match(CATEGORY_RX)?.[1] ?? null;

    const title = clean(chunk.match(/calendar-club-day-item-title[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
    const timeRaw = clean(
      chunk.match(/calendar-club-day-item-time[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
    );
    const venue = clean(
      chunk.match(/calendar-club-day-item-location[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
    );
    const group = clean(
      chunk.match(/calendar-club-day-item-groupname[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
    );

    rows.push({
      day,
      category,
      title: title || null,
      time: timeRaw || null,
      endDate: null,
      endTime: null,
      venue: venue || null,
      group: group || null,
      // 62 av 557 rader är inställda ("calendar-club-event-main canceled").
      isCancelled: chunk.includes('calendar-club-event-main canceled'),
    });
  }

  return rows;
}

export interface VasalundExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'vasalund-matches' | 'vasalund-calendar' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): VasalundExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  // ── /matcher: klubbens officiella framtida matcher ──────────────────────
  const matchRows = parseMatchItems(html);
  for (const m of matchRows) {
    const title = [m.home, m.away].filter(Boolean).join(' vs ');
    if (!title || !m.date) continue;

    const key = `${title}|${m.date}|${m.time ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title,
        date: m.date,
        time: m.time ?? undefined,
        venue: m.venue ?? undefined,
        organizer: ORGANIZER,
        url,
        source,
        sourceUrl: url,
        category: 'sports',
        confidence: {
          score: 0.85,
          hasTitle: true,
          hasDate: true,
          hasVenue: !!m.venue,
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: false,
          signals: ['vasalund-matches', 'upcoming-grid'],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length > 0) {
    // Inga enskilda evenemangsidor finns — bara listan.
    return { showUrls: [], events, method: 'vasalund-matches' };
  }

  // ── /kalender: klubbens egen kalender, endast matcher ───────────────────
  const header = parseMonthHeader(html);
  if (!header) return { showUrls: [], events: [], method: 'none' };

  for (const row of parseCalendarRows(html)) {
    if (row.category !== MATCH_ONLY) continue;
    if (row.day === null || !row.title) continue;

    const date = `${header.year}-${pad(header.month)}-${pad(row.day)}`;
    const { time, endTime, endDate } = parseTimeRange(row.time, header.year, header.month);

    const key = `${row.title}|${date}|${time ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isCancelled = row.isCancelled || /\(inställd\)/i.test(row.title);

    try {
      const evt = ParsedEventSchema.parse({
        title: row.title,
        date,
        time: time ?? undefined,
        endDate: endDate ?? undefined,
        endTime: endTime ?? undefined,
        venue: row.venue ?? undefined,
        description: row.group ?? undefined,
        organizer: ORGANIZER,
        url,
        source,
        sourceUrl: url,
        category: 'sports',
        status: isCancelled ? 'cancelled' : undefined,
        confidence: {
          score: 0.75,
          hasTitle: true,
          hasDate: true,
          hasVenue: !!row.venue,
          hasUrl: true,
          hasDescription: !!row.group,
          hasTicketInfo: false,
          signals: ['vasalund-calendar', 'event-type:match', `day:${row.day}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [], events, method: 'vasalund-calendar' };
}
