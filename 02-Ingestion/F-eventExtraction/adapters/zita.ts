/**
 * Zita (Zita Folkets Bio) adapter — biograf, Birger Jarlsgatan 37, Stockholm.
 *
 * Site-specific pattern (verified 2026-10-24 from /evenemang):
 * - Sidan är ett handrullat kalendarium, inte JSON-LD och inte WordPress.
 * - Två parallella sektioner med samma rader:
 *     1. `div.calendar_row`      — blocken "idag" och "i morgon"
 *     2. `div.calendar_row_large` — blocken "mån 26 okt", "tis 27 okt" ...
 * - Varje rad (`calendar_row`) innehåller:
 *     - tid:      `<span class="column_time"><strong>16:00</strong>`
 *     - datum:    `load-booking.php?s=Salong%203&t=16:00&d=2026-10-24`
 *                 (datumet ligger i ett inline-<script>, inte i ett attribut)
 *     - titel:    sista `<a title="...">` i `span.calendar_media` — den FÖRSTA
 *                 ankaret kan vara en programrubrik ("Barnens Bio",
 *                 "Grekiska Filmdagar", "English Subtitles"), inte evenemanget
 *     - salong:   "(Zita 3)" i klartext, alternativt `s=Salong%203` i scriptet
 * - Rader utan `d=` i scriptet är föreställningar som redan börjat
 *   ("För sent att boka") — de saknar datum och ska hoppas över.
 *
 * Per CLAUDE.md Generalization Protection Rule: adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST zita.se.
 */
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'zita';
const VENUE = 'Zita';
const CITY = 'Stockholm';
const ADDRESS = 'Birger Jarlsgatan 37, Stockholm';
const BASE = 'https://zita.se';

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'zita.se' || u.hostname === 'www.zita.se';
  } catch {
    return false;
  }
}

/** En kalendarrad, rått extraherad ur HTML:en. */
interface RawRow {
  time: string | null;
  date: string | null;
  title: string | null;
  hall: string | null;
  href: string | null;
}

const ROW_SPLIT = /<div class="calendar_row(?:_large)?">/;
const TIME_RX = /<strong>(\d{1,2}:\d{2})<\/strong>/;
const DATE_RX = /[?&]d=(\d{4}-\d{2}-\d{2})/;
const HALL_TEXT_RX = /\((Zita\s*\d+)\)/;
const HALL_PARAM_RX = /s=Salong(?:%20|\s)(\d+)/;
const ANCHOR_RX = /<a\b[^>]*\btitle="([^"]*)"[^>]*\bhref="([^"]*)"/g;

/**
 * Delar upp kalendariumet i rader och läser tid/datum/titel/salong.
 *
 * Raderna skickas i två varianter (`calendar_row` och `calendar_row_large`),
 * men innehållet är identiskt — därför läses båda med samma regexar.
 */
export function parseRows(html: string): RawRow[] {
  const parts = html.split(ROW_SPLIT);
  const rows: RawRow[] = [];

  for (const part of parts.slice(1)) {
    const time = part.match(TIME_RX)?.[1] ?? null;
    const date = part.match(DATE_RX)?.[1] ?? null;

    // Sista ankaret i raden är evenemanget; det första kan vara en
    // programrubrik ("Barnens Bio:", "English Subtitles:").
    let title: string | null = null;
    let href: string | null = null;
    for (const m of part.matchAll(ANCHOR_RX)) {
      const candidate = decodeEntities(m[1]).trim();
      if (!candidate) continue;
      title = candidate;
      href = m[2];
    }

    const hall =
      part.match(HALL_TEXT_RX)?.[1]?.replace(/\s+/g, ' ') ??
      (part.match(HALL_PARAM_RX) ? `Zita ${part.match(HALL_PARAM_RX)![1]}` : null);

    rows.push({ time, date, title, hall, href });
  }

  return rows;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&aring;/g, 'å')
    .replace(/&Aring;/g, 'Å')
    .replace(/&Auml;/g, 'Ä')
    .replace(/&Ouml;/g, 'Ö');
}

function absoluteUrl(href: string): string {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return BASE;
  }
}

export interface ZitaExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'zita-listing' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): ZitaExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const rows = parseRows(html);
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  const showUrls = new Set<string>();

  for (const row of rows) {
    // Utan datum kan raden inte överleva importens datumvakt — hoppa över.
    if (!row.date || !row.title) continue;

    const key = `${row.title}|${row.date}|${row.time ?? ''}|${row.hall ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const eventUrl = row.href ? absoluteUrl(row.href) : url;
    showUrls.add(eventUrl);

    try {
      const evt = ParsedEventSchema.parse({
        title: row.title,
        date: row.date,
        time: row.time ?? undefined,
        venue: row.hall ? `${VENUE}, ${row.hall}` : VENUE,
        address: ADDRESS,
        city: CITY,
        url: eventUrl,
        ticketUrl: eventUrl,
        category: 'cinema',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.85,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: false,
          signals: ['zita-calendar-row', `hall:${row.hall ?? 'unknown'}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'zita-listing' };
}
