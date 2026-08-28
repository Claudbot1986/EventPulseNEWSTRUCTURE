/**
 * ArkDes.se adapter — Stockholm architecture museum
 *
 * Site-specific pattern (verified 2026-08-19 from /kalender/):
 * - WordPress site with custom post type `activity` accessible via REST API
 *   GET /wp-json/wp/v2/activity?per_page=100 returns 100 activities (page 2 has 64)
 * - Detail pages at /kalender/{slug}/ (no JSON-LD Event; only WebPage)
 * - "När" section contains ONE single-date paragraph plus "Klockan HH:MM–HH:MM"
 *   Pattern: <p>Tisdag, 8 december 2026</p>\n<p>Klockan 17:30–19:00</p>
 * - "Var" section contains the specific room: <p>Torget</p>, <p>ArkDes Studio</p>,
 *   or <p>ArkDes Foajé</p>. We always also have a "Hitta hit" with the venue
 *   address (Exercisplan 3, Skeppsholmen, Stockholm).
 * - Opening-hours block (Måndag: Stängt ... Söndag: 11:00–17:00) is a footer
 *   and must NOT be extracted as event dates.
 *
 * Per CLAUDE.md Generalization Protection Rule: this adapter is isolated from
 * C0/C1/C2. It applies ONLY to arkdes.se URLs.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'arkdes';
const VENUE = 'ArkDes';
const CITY = 'Stockholm';
const ADDRESS = 'Exercisplan 3, Skeppsholmen, 111 49 Stockholm';
const LAT = 59.3289;
const LNG = 18.0870;

const SWE_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.arkdes.se' || u.hostname === 'arkdes.se';
  } catch {
    return false;
  }
}

function parseSvDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})$/i);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mon = SWE_MONTHS[m[2].toLowerCase()];
  const y = parseInt(m[3], 10);
  if (!mon || d < 1 || d > 31 || y < 2020 || y > 2099) return null;
  return `${y}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractSectionHtml(html: string, id: string): string {
  // Returns the raw HTML of the inner div with the given id (open tag onward,
  // up to and including the FIRST `</div>` that closes it).
  const idx = html.indexOf(`id="${id}"`);
  if (idx === -1) return '';
  const slice = html.slice(idx);
  const end = slice.indexOf('</div>');
  if (end === -1) return '';
  return slice.slice(0, end);
}

function extractSectionP(html: string, id: string): string {
  // Returns joined text of all <p> tags inside the section.
  const $ = cheerio.load(extractSectionHtml(html, id));
  return $('p').map((_, el) => $(el).text().trim()).get().join('\n');
}

function extractNar(html: string): string {
  // Get text from all <p> in the När section
  return extractSectionP(html, 'content-nar');
}

function extractVar(html: string): string {
  const sectionHtml = extractSectionHtml(html, 'content-var');
  const $ = cheerio.load(sectionHtml);
  return $('p').first().text().trim();
}

function extractTitle(html: string, fallback: string): string {
  const $ = cheerio.load(html);
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  if (ogTitle) return ogTitle.replace(/\s*[-–]\s*ArkDes\s*$/, '').trim();
  const h1 = $('h1').first().text().trim();
  if (h1) return h1;
  return fallback;
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
  const og = $('meta[property="og:description"]').attr('content')?.trim();
  if (og) return og.slice(0, 500);
  return $('article p, main p').first().text().trim().slice(0, 300);
}

function parseKlockan(s: string): { start?: string; end?: string } {
  // "Klockan 17:30–19:00" or "Klockan: 18:00–20:00" or "Klockan 18:00"
  const m = s.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    return {
      start: `${m[1].padStart(2, '0')}:${m[2]}`,
      end: `${m[3].padStart(2, '0')}:${m[4]}`,
    };
  }
  const single = s.match(/(\d{1,2}):(\d{2})/);
  if (single) {
    return { start: `${single[1].padStart(2, '0')}:${single[2]}` };
  }
  return {};
}

function extractNarBlock(html: string): {
  date: string | null;
  start?: string;
  end?: string;
} {
  const text = extractNar(html);
  if (!text) return { date: null };

  // Find the date line (any Swedish weekday + DD MMM YYYY)
  const dateLine = text.match(
    /(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\s*,?\s*(\d{1,2}\s+\w+\s+\d{4})/i
  );
  if (!dateLine) return { date: null };

  const date = parseSvDate(dateLine[2]);
  if (!date) return { date: null };

  // Klockan variants: "Klockan 17:30–19:00" / "Klockan: 18:00–20:00" / "Klockan 18:00"
  const klockan = text.match(/klockan:?\s*([0-9:\s–\-]+)/i);
  const times = klockan ? parseKlockan(klockan[1]) : {};

  return { date, ...times };
}

export interface ArkDesExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'arkdes-listing' | 'arkdes-detail' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): ArkDesExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  // Listing page: /kalender/ or /kalender/?week_offset=*
  if (/\/kalender\/?(?:\?|$|#)/.test(url)) {
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const urls: string[] = [];
    $('a[href*="/kalender/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      // Accept absolute or relative URLs; capture the path /kalender/{slug}
      let m = href.match(/^https?:\/\/[^/]+(\/kalender\/[^/?#]+)/);
      if (!m) m = href.match(/^(\/kalender\/[^/?#]+)/);
      if (!m) return;
      const u = m[1];
      if (seen.has(u)) return;
      seen.add(u);
      urls.push(`https://www.arkdes.se${u}`);
    });
    return { showUrls: urls, events: [], method: 'arkdes-listing' };
  }

  // Detail page: /kalender/{slug}/
  const nar = extractNarBlock(html);
  if (!nar.date) return { showUrls: [], events: [], method: 'none' };

  const slugMatch = url.match(/\/kalender\/([^/?#]+)/);
  const slug = slugMatch ? slugMatch[1] : 'event';
  const fallbackTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const title = extractTitle(html, fallbackTitle);
  const room = extractVar(html);
  const image = extractImage(html);
  const description = extractDescription(html);
  const venueFull = room ? `${VENUE} – ${room}` : VENUE;

  const events: ParsedEvent[] = [];
  try {
    const evt = ParsedEventSchema.parse({
      title,
      date: nar.date,
      time: nar.start,
      endTime: nar.end,
      venue: venueFull,
      address: ADDRESS,
      city: CITY,
      description: description || undefined,
      url,
      imageUrl: image || undefined,
      category: 'design',
      source,
      sourceUrl: url,
      confidence: {
        score: 0.9,
        hasTitle: true,
        hasDate: true,
        hasVenue: true,
        hasUrl: true,
        hasDescription: !!description,
        hasTicketInfo: false,
        signals: ['arkdes-detail-page', `slug:${slug}`],
      },
    });
    events.push(evt);
  } catch {
    /* skip malformed */
  }

  return { showUrls: [], events, method: 'arkdes-detail' };
}

/**
 * Helper for push scripts: fetch all activity URLs from the ArkDes REST API.
 * Returns the full list of /kalender/{slug}/ URLs.
 */
export async function fetchActivitySlugs(): Promise<string[]> {
  const all: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://www.arkdes.se/wp-json/wp/v2/activity?per_page=100&page=${page}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 EventPulse/1.0' } }
    );
    if (!res.ok) break;
    const items: Array<{ link: string }> = await res.json();
    if (items.length === 0) break;
    for (const it of items) all.push(it.link);
    if (items.length < 100) break;
  }
  return all;
}
