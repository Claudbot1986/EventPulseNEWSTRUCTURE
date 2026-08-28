/**
 * Intiman.se adapter — Stockholm theater (Intiman)
 *
 * Site-specific pattern (verified 2026-08-19 from /forestallningar/):
 * - Listing page /forestallningar/ has /shower/{slug} links to individual shows
 * - Each show page has the line "Spelas DD MMM - DD MMM YYYY" (start-end year)
 * - Each show page lists individual performance dates: "Lördag 19 sep, 18:00"
 *   Format: Weekday DD MMM, HH:MM (no year — uses the year from "Spelas" range)
 * - All performances at "Intiman, Stockholm"
 * - Price: "från NNN kr"
 * - No JSON-LD Event objects on detail pages (only WebSite)
 *
 * Per CLAUDE.md Generalization Protection Rule: this adapter is isolated from
 * C0/C1/C2. It applies ONLY to intiman.se URLs.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'intiman';
const VENUE = 'Intiman';
const CITY = 'Stockholm';

const SWE_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

const SWE_WEEKDAYS = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.intiman.se' || u.hostname === 'intiman.se';
  } catch {
    return false;
  }
}

function parseSvDate(s: string, fallbackYear: number): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([a-zåäö]+)$/i);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mon = SWE_MONTHS[m[2].toLowerCase()];
  if (!mon || d < 1 || d > 31) return null;
  return `${fallbackYear}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractYear(html: string): number | null {
  const m = html.match(/Spelas[\s\S]{0,80}?\d{4}/i);
  if (m) {
    const y = m[0].match(/\d{4}/);
    if (y) return parseInt(y[0], 10);
  }
  return null;
}

function extractTitle(html: string): string {
  const $ = cheerio.load(html);
  return (
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    $('title').text().split('|')[0].trim() ||
    ''
  );
}

function extractPrice(html: string): { priceMin: number | undefined; priceText: string } {
  const m = html.match(/fr[åa]n\s+(\d{2,4})\s*kr/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n)) return { priceMin: n, priceText: `${n} kr` };
  }
  return { priceMin: undefined, priceText: '' };
}

function extractImage(html: string): string {
  const $ = cheerio.load(html);
  return (
    $('meta[property="og:image"]').attr('content') ||
    $('article img').first().attr('src') ||
    ''
  );
}

function extractDescription(html: string): string {
  const $ = cheerio.load(html);
  return (
    $('meta[property="og:description"]').attr('content') ||
    $('article p').first().text().trim().slice(0, 300) ||
    ''
  );
}

function extractShowDates(html: string, year: number): Array<{ date: string; time: string }> {
  const rx = new RegExp(
    `(?:${SWE_WEEKDAYS.join('|')})\\s+(\\d{1,2}\\s+\\w+),\\s+(\\d{1,2}:\\d{2})`,
    'gi'
  );
  const seen = new Set<string>();
  const out: Array<{ date: string; time: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null) {
    const date = parseSvDate(m[1], year);
    if (!date) continue;
    const key = `${date}|${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, time: m[2] });
  }
  return out;
}

function extractShowLinks(html: string): string[] {
  // Pattern: href="...intiman.se/shower/{slug}" — slug ends before quote (no trailing space inside the captured group)
  const rx = /href="https?:\/\/(?:www\.)?intiman\.se\/shower\/([^"]+?)[\s"]/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null) {
    const slug = m[1].trim();
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export interface IntimanExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'intiman-listing' | 'intiman-detail' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): IntimanExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  if (/\/forestallningar\/?(?:$|\?)/.test(url)) {
    const showUrls = extractShowLinks(html).map((slug) => `https://www.intiman.se/shower/${slug}`);
    return { showUrls, events: [], method: 'intiman-listing' };
  }

  const year = extractYear(html) || new Date().getFullYear();
  const shows = extractShowDates(html, year);
  if (shows.length === 0) return { showUrls: [], events: [], method: 'none' };

  const title = extractTitle(html);
  if (!title) return { showUrls: [], events: [], method: 'none' };

  const { priceMin } = extractPrice(html);
  const image = extractImage(html);
  const description = extractDescription(html);

  const events: ParsedEvent[] = [];
  for (const show of shows) {
    try {
      const evt = ParsedEventSchema.parse({
        title,
        date: show.date,
        time: show.time,
        venue: VENUE,
        city: CITY,
        description: description || undefined,
        url,
        imageUrl: image || undefined,
        priceMin,
        category: 'theater',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.9,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: true,
          hasDescription: !!description,
          hasTicketInfo: priceMin !== undefined,
          signals: ['intiman-detail-page', `year-from-spelas:${year}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  return { showUrls: [], events, method: 'intiman-detail' };
}
