/**
 * Momentsapp (momentsapp.no) adapter — Stockholms kalendersidor
 *
 * Mönster verifierat 2026-10-24 med D-gatens riktiga renderPage
 * (ScrapingBee, premium-only) på tre URL:er:
 *
 *   /events/stockholm/kalender/2026-10-24 → 379 607 B, 126 kort, 1 dag
 *   /events/stockholm/kalender/2026-11    → 4 129 970 B, 1 904 kort, 30 dagar
 *   /events/stockholm/kalender/2026-12    → 1 919 958 B, 847 kort
 *
 * Varje kort ligger i <li> och har exakt denna struktur:
 *
 *   <li><a href="/event/<uuid>">
 *     <time datetime="2026-10-23T22:00:00+00:00">00:00</time>
 *     <span class="min-w-0">
 *       <span class="block font-bold ...">TITEL</span>
 *       <span class="mt-0.5 block text-sm ...">VENUE</span>
 *     </span>
 *     <span class="w-fit rounded-full ...">Free</span>   ← valfri
 *   </a></li>
 *
 * Varför en egen adapter behövs (mätt, inte antaget):
 * UniversalExtractor ger 4 resp. 41 träffar på dessa sidor, varav nästan
 * alla har skräptitel (JSON-fragment ur inline-script) och skräptdatum
 * ("6621-29-38" — UUID-bitar som misstas för datum). Kortstrukturen ovan
 * ger däremot 126 respektive 1 904 rena träffar. Skillnaden är inte
 * extraktorns grepphjälp — det är att sidans event ligger i <li>-kort med
 * <time datetime>, inte i vanliga rubrik-block.
 *
 * Tidszoner: <time datetime> är ett korrekt UTC-ögonblick, men sidan visar
 * lokal väggtid. "2026-10-23T22:00:00+00:00" är 00:00 i Stockholm (CEST,
 * UTC+2) och visas som "00:00". Därför konverteras ögonblicket till
 * Europe/Stockholm innan datum/tid skrivs — annars hamnar varje event ett
 * dygn för tidigt.
 *
 * Per CLAUDE.md Generalization Protection Rule: denna adapter är isolerad
 * och tillämpas ENDAST på momentsapp.no. Inga ändringar i C0/C1/C2.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';
import { detectCategory } from '../categoryKeywords.js';

const SOURCE_ID = 'momentsapp-stockholm';
const CITY = 'Stockholm';
const TZ = 'Europe/Stockholm';

/** Ordning i href: /event/<uuid> — uuid-formen utesluter t.ex. /events/stockholm. */
const EVENT_HREF = /^\/event\/[0-9a-f-]{36}\/?$/i;

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'momentsapp.no' || u.hostname === 'www.momentsapp.no';
  } catch {
    return false;
  }
}

/**
 * Konvertera ett ISO-ögonblick till Europe/Stockholm.
 * Returnerar null för trasiga datum.
 */
function toStockholm(iso: string): { date: string; time: string } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  // Vissa ICU-versioner ger "24" för midnatt när hour12:false används.
  const hour = get('hour') === '24' ? '00' : get('hour');

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return { date, time: `${hour}:${get('minute')}` };
}

/**
 * "Bladspann" — de spans som inte innehåller andra spans. I kortstrukturen
 * ger de i ordning: titel, venue, och (valfritt) pris. Att använda
 * "leaf spans" gör parsningen oberoende av Tailwind-klasserna, som kan ändras
 * utan att markupen ändras.
 */
function leafSpans($: cheerio.CheerioAPI, root: cheerio.Element): string[] {
  return $(root)
    .find('span')
    .filter((_, el) => $(el).children('span').length === 0)
    .map((_, el) => $(el).text().trim())
    .get();
}

export interface MomentsappExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'momentsapp-calendar' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): MomentsappExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const $ = cheerio.load(html);
  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  let origin = 'https://momentsapp.no';
  try {
    origin = new URL(url).origin;
  } catch {
    /* använd default */
  }

  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href');
    if (!href || !EVENT_HREF.test(href)) return;

    const datetime = $a.find('time[datetime]').first().attr('datetime');
    if (!datetime) return;

    const swedish = toStockholm(datetime);
    if (!swedish) return;

    const leaves = leafSpans($, el);
    const title = leaves[0] ?? '';
    if (!title) return;
    const venue = leaves[1] || undefined;
    const priceText = leaves[2] ?? '';

    const absoluteUrl = href.startsWith('http') ? href : `${origin}${href}`;
    const key = `${absoluteUrl}|${swedish.date}|${swedish.time}`;
    if (seen.has(key)) return;
    seen.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title,
        date: swedish.date,
        time: swedish.time,
        venue,
        city: CITY,
        url: absoluteUrl,
        isFree: /^free$/i.test(priceText) ? true : undefined,
        category: detectCategory(title, venue),
        source,
        sourceUrl: url,
        confidence: {
          score: 0.9,
          hasTitle: true,
          hasDate: true,
          hasVenue: !!venue,
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: /^free$/i.test(priceText),
          signals: ['momentsapp-calendar-card'],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  });

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [], events, method: 'momentsapp-calendar' };
}
