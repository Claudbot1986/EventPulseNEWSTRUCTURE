/**
 * rssExtractor.ts — Extract events from RSS 2.0 / Atom feeds
 *
 * Adds RSS support to Tool B (B-JSON-feedGate). Previously Tool B only
 * handled JSON APIs (Tixly etc.); many Swedish venues expose calendars as
 * RSS 2.0 (KTH, etc.) and went unused.
 *
 * Designed for two common Swedish venue feed shapes:
 *   1. RSS 2.0 with structured <item> elements:
 *      - <title> = event title
 *      - <link> = event URL (permalink)
 *      - <description> = HTML with embedded date ("Tid:") + location ("Plats:")
 *        (KTH, many SiteVision CMS installations)
 *      - <pubDate> = optional ISO/RFC-822 (rare in Swedish venue feeds)
 *      - <guid> = unique identifier
 *
 *   2. Atom 1.0 with <entry> elements:
 *      - <entry><title>, <entry><link href="...">, <entry><published>, <entry><content>
 *
 * Usage:
 *   import { extractFromRss } from './rssExtractor';
 *   const result = await extractFromRss('https://www.kth.se/...rss=calendar', 'kth-2');
 *   // result.events = ParsedEvent[] (F-eventExtraction/schema.ts)
 */

import { XMLParser } from 'fast-xml-parser';
import type { ParsedEvent, ExtractionConfidence } from '../F-eventExtraction/schema';

export interface RssExtractResult {
  events: ParsedEvent[];
  rawCount: number;
  parseErrors: string[];
  sourceUrl: string;
  rssUrl: string;
  format: 'rss2' | 'atom' | 'unknown';
}

// ─── RSS XML fetch (axios, same User-Agent as Tool B) ───────────────────────

async function fetchRssXml(url: string, timeoutMs = 30000): Promise<{ ok: boolean; xml?: string; error?: string }> {
  try {
    const axios = (await import('axios')).default;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'EventPulse/1.0 (event-ingestion)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      timeout: timeoutMs,
      // Some feeds serve XML with text/xml content-type; axios parses anyway.
      responseType: 'text',
      transformResponse: [(data: unknown) => data], // do not auto-parse as JSON
      validateStatus: (s) => s < 500,
    });
    if (response.status !== 200) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const xml = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    if (!xml || xml.length < 30) {
      return { ok: false, error: 'empty or too-short response' };
    }
    return { ok: true, xml };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ─── Date parsing ────────────────────────────────────────────────────────────

// Swedish day-of-week abbreviations (used by KTH and similar SiteVision CMS feeds)
const SWE_DOW: Record<string, number> = {
  må: 1, ma: 1,
  ti: 2,
  on: 3,
  to: 4,
  fr: 5,
  lö: 6, lo: 6,
  sö: 0, so: 0,
};

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/**
 * Parse a "Tid:" field of the form:
 *   "On 2026-08-19 kl 10.00"
 *   "Må 2026-08-24 kl 14.00 - 16.00"
 *   "Fr 2026-08-21 kl 09.00"
 * Returns { date: 'YYYY-MM-DD', time: 'HH:MM' } or null.
 */
function parseSwedishTidField(input: string): { date: string; time: string; endTime?: string } | null {
  if (!input) return null;
  // Strip "Tid:" prefix if present
  let s = input.replace(/^Tid:\s*/i, '').trim();

  // Optional leading day abbreviation (2-3 letters, possibly with diacritics)
  // followed by space
  s = s.replace(/^[A-Za-zÀ-ÿ]{2,3}\s+/, '');

  // Match YYYY-MM-DD [kl|at]? HH.MM (with optional - HH.MM end time)
  // KTH format: "2026-08-19 kl 10.00"
  // English:   "2026-08-19 at 10.00" or just "2026-08-19 10.00"
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(?:kl\s+|at\s+)?(\d{1,2})\.(\d{2})(?:\s*-\s*(?:kl\s+|at\s+)?(\d{1,2})\.(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h1, m1, h2, m2] = m;
  const date = `${y}-${mo}-${d}`;
  const time = `${pad(parseInt(h1, 10))}:${m1}`;
  const endTime = h2 && m2 ? `${pad(parseInt(h2, 10))}:${m2}` : undefined;
  return { date, time, endTime };
}

/**
 * Parse RFC-822 pubDate (e.g. "Wed, 19 Aug 2026 10:00:00 +0000").
 * Returns ISO date string YYYY-MM-DD or null.
 */
function parseRfc822Date(input: string): string | null {
  if (!input) return null;
  try {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * Parse ISO 8601 date (e.g. "2026-08-19T10:00:00Z" or "2026-08-19").
 * Returns YYYY-MM-DD or null.
 */
function parseIsoDate(input: string): string | null {
  if (!input) return null;
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  try {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// ─── Plats/Location parsing (KTH-style HTML description) ────────────────────

/**
 * Extract "Plats:" value from HTML description.
 * Many Swedish venue feeds wrap date+location in HTML like:
 *   "<p class='date'><strong>Tid: </strong>On 2026-08-19 kl 10.00</p>
 *    <p class='location'><strong>Plats: </strong>M24, Brinellvägen 64A, Stockholm</p>
 *    <p class='subject'><strong>Typ: </strong>Disputationer</p>"
 *
 * Returns the raw location string, or null.
 */
function extractPlatsFromDescription(html: string): string | null {
  if (!html) return null;
  // Strip HTML tags, but keep text
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#xD;|\r/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const platsMatch = text.match(/Plats:\s*([^|]+?)(?=\s*Typ:|\s*$)/i);
  if (platsMatch) return platsMatch[1].trim();
  // Fallback: try "Location:" for English feeds
  const locMatch = text.match(/Location:\s*([^|]+?)(?=\s*Type:|\s*$)/i);
  if (locMatch) return locMatch[1].trim();
  return null;
}

function extractTidFromDescription(html: string): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const tidMatch = text.match(/Tid:\s*([^|]+?)(?=\s*Plats:|\s*$)/i);
  if (tidMatch) return tidMatch[1].trim();
  // English fallback
  const dateMatch = text.match(/Date:\s*([^|]+?)(?=\s*Location:|\s*$)/i);
  if (dateMatch) return dateMatch[1].trim();
  return null;
}

function extractTypFromDescription(html: string): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = text.match(/Typ:\s*([^|]+?)(?=\s*Plats:|\s*$)/i);
  if (m) return m[1].trim();
  const typeMatch = text.match(/Type:\s*([^|]+?)(?=\s*Location:|\s*$)/i);
  if (typeMatch) return typeMatch[1].trim();
  return null;
}

/**
 * Extract event description text (everything after the metadata block).
 * Many feeds put a free-text description AFTER the </div> that wraps Tid/Plats/Typ.
 * If no such text exists, return empty string (NOT the metadata itself).
 */
function extractFreeTextFromDescription(html: string): string {
  if (!html) return '';
  // Strategy 1: anything after </div>
  const parts = html.split(/<\/div>/i);
  const afterDiv = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const cleaned = afterDiv
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#xD;|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 20 ? cleaned : '';
}

// ─── RSS 2.0 item normalization ─────────────────────────────────────────────

function normalizeRssItem(item: any, source: string, sourceUrl: string): ParsedEvent | null {
  const title = (item.title ?? '').toString().trim();
  if (!title || title.toLowerCase() === 'untitled') return null;

  const link = (item.link ?? '').toString().trim();
  const guid = (item.guid ?? '').toString().trim();
  const descriptionHtml = (item.description ?? '').toString();

  let date = '';
  let time: string | undefined;
  let endTime: string | undefined;

  // 1. Try pubDate
  const pubDate = (item.pubDate ?? '').toString().trim();
  if (pubDate) {
    const parsed = parseRfc822Date(pubDate);
    if (parsed) {
      date = parsed;
      const d = new Date(pubDate);
      if (!Number.isNaN(d.getTime())) {
        time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      }
    }
  }

  // 2. Try dc:date (ISO 8601)
  if (!date) {
    const dcDate = (item['dc:date'] ?? '').toString().trim();
    if (dcDate) {
      date = parseIsoDate(dcDate) ?? '';
      const timePart = dcDate.match(/T(\d{2}):(\d{2})/);
      if (timePart) time = `${timePart[1]}:${timePart[2]}`;
    }
  }

  // 3. Fallback: parse Tid: from description
  let plats: string | null = null;
  let typ: string | null = null;
  if (!date) {
    const tidRaw = extractTidFromDescription(descriptionHtml);
    if (tidRaw) {
      const parsed = parseSwedishTidField(tidRaw);
      if (parsed) {
        date = parsed.date;
        time = parsed.time;
        endTime = parsed.endTime;
      }
    }
    plats = extractPlatsFromDescription(descriptionHtml);
    typ = extractTypFromDescription(descriptionHtml);
  } else {
    // Even if pubDate was usable, still grab plats for venue info
    plats = extractPlatsFromDescription(descriptionHtml);
    typ = extractTypFromDescription(descriptionHtml);
  }

  // Skip items without any date — cannot produce a useful ParsedEvent
  if (!date) return null;

  const freeText = extractFreeTextFromDescription(descriptionHtml);

  // Split venue from address heuristically.
  // KTH format options:
  //   "M24, Brinellvägen 64A, Stockholm"   — 3 parts: room, street, city
  //   "F3, Lindstedtsvägen 26"             — 2 parts: room, street (no city → default Stockholm)
  //   "KTH Biblioteket, Entréhallen"       — 2 parts: building, room (no city → default Stockholm)
  //   "Sal T4 (Curiesalen), Hälsovägen 11C, Flemingsberg" — 3 parts incl. parens
  let venue = '';
  let address: string | undefined;
  let city: string | undefined;
  if (plats) {
    const parts = plats.split(',').map(p => p.trim()).filter(Boolean);
    // Heuristic: a part is "city-like" if it ends with a known city suffix or is a
    // standalone word that doesn't look like a street/room (no digits, not in parens).
    // Simple rule: only treat the LAST part as city if it looks like a proper name
    // (no digits, not "Street/Vägen/Gatan" suffix).
    const lastIsCity = (s: string): boolean => {
      if (/\d/.test(s)) return false;                        // contains a number
      if (/(vägen|gatan|plan|entré|hallen|sal$)/i.test(s)) return false;
      return true;
    };
    if (parts.length >= 3 && lastIsCity(parts[parts.length - 1])) {
      city = parts[parts.length - 1];
      address = parts[parts.length - 2];
      venue = parts.slice(0, parts.length - 2).join(', ');
    } else if (parts.length === 2) {
      // No explicit city → keep first as venue, second as address
      venue = parts[0];
      address = parts[1];
    } else {
      venue = plats;
    }
  }

  // Confidence scoring — similar weights to extractor.ts
  const signals: string[] = ['rss-item'];
  let score = 0.5;
  if (title.length > 5) { score += 0.15; signals.push('strong_title'); }
  else if (title) { score += 0.05; signals.push('has_title'); }
  if (date) { score += 0.15; signals.push('has_date'); }
  if (time) { score += 0.05; signals.push('has_time'); }
  if (venue) { score += 0.1; signals.push('has_venue'); }
  if (address) { score += 0.05; signals.push('has_address'); }
  if (link) { score += 0.05; signals.push('has_url'); }
  if (freeText.length > 50) { score += 0.1; signals.push('has_description'); }
  if (typ) signals.push('has_typ');
  score = Math.max(0, Math.min(1, score));

  const confidence: ExtractionConfidence = {
    score,
    hasTitle: title.length > 0,
    hasDate: !!date,
    hasVenue: !!venue,
    hasUrl: !!link,
    hasDescription: freeText.length > 50,
    hasTicketInfo: false,
    signals,
  };

  // Map Swedish "Typ" to category
  let category: string | undefined;
  if (typ) {
    const t = typ.toLowerCase();
    if (t.includes('disputation') || t.includes('seminarium') || t.includes('seminarier')) {
      category = 'culture';
    } else if (t.includes('föreläsning') || t.includes('lecture')) {
      category = 'culture';
    } else if (t.includes('konsert') || t.includes('musik')) {
      category = 'music';
    } else if (t.includes('utställning') || t.includes('konst')) {
      category = 'art';
    } else if (t.includes('sport') || t.includes('match')) {
      category = 'sports';
    } else if (t.includes('barn') || t.includes('student')) {
      category = 'family';
    }
  }

  return {
    title,
    date,
    time,
    endDate: undefined,
    endTime,
    venue: venue || undefined,
    address,
    city: city || 'Stockholm',
    description: freeText || undefined,
    url: link || undefined,
    ticketUrl: undefined,
    organizer: undefined,
    performers: undefined,
    category,
    isFree: undefined,
    priceMin: undefined,
    priceMax: undefined,
    imageUrl: undefined,
    status: 'scheduled',
    source,
    sourceUrl: link || sourceUrl,
    confidence,
  };
}

// ─── Atom entry normalization (basic support) ──────────────────────────────

function normalizeAtomEntry(entry: any, source: string, sourceUrl: string): ParsedEvent | null {
  const title = (entry.title?.['#text'] ?? entry.title ?? '').toString().trim();
  if (!title) return null;

  // Atom <link> can be an object { href, rel } or array of such
  let link = '';
  const linkEl = entry.link;
  if (typeof linkEl === 'string') link = linkEl;
  else if (Array.isArray(linkEl)) {
    const alt = linkEl.find((l: any) => l?.['@_rel'] === 'alternate') ?? linkEl[0];
    link = alt?.['@_href'] ?? alt?.href ?? '';
  } else if (linkEl && typeof linkEl === 'object') {
    link = linkEl['@_href'] ?? linkEl.href ?? '';
  }

  const published = (entry.published ?? entry.updated ?? '').toString().trim();
  const content = (entry.content?.['#text'] ?? entry.content ?? entry.summary?.['#text'] ?? entry.summary ?? '').toString();

  const date = parseIsoDate(published);
  if (!date) return null;
  const timePart = published.match(/T(\d{2}):(\d{2})/);
  const time = timePart ? `${timePart[1]}:${timePart[2]}` : undefined;

  const freeText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const confidence: ExtractionConfidence = {
    score: 0.6,
    hasTitle: true,
    hasDate: true,
    hasVenue: false,
    hasUrl: !!link,
    hasDescription: freeText.length > 50,
    hasTicketInfo: false,
    signals: ['atom-entry'],
  };

  return {
    title,
    date,
    time,
    venue: undefined,
    address: undefined,
    city: 'Stockholm',
    description: freeText || undefined,
    url: link || undefined,
    source,
    sourceUrl: link || sourceUrl,
    confidence,
  };
}

// ─── XML parsing ────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  textNodeName: '#text',
  // Don't merge everything into #text; keep nested structure
  parseTagValue: false,
  isArray: (name, jpath) => {
    // Force arrays for items we iterate
    if (['item', 'entry'].includes(name)) return true;
    return false;
  },
});

// ─── Main entry point ───────────────────────────────────────────────────────

export async function extractFromRss(rssUrl: string, sourceId: string): Promise<RssExtractResult> {
  const fetchResult = await fetchRssXml(rssUrl);
  if (!fetchResult.ok || !fetchResult.xml) {
    return {
      events: [],
      rawCount: 0,
      parseErrors: [`Fetch failed: ${fetchResult.error ?? 'unknown'}`],
      sourceUrl: sourceId,
      rssUrl,
      format: 'unknown',
    };
  }

  let parsed: any;
  try {
    parsed = parser.parse(fetchResult.xml);
  } catch (e: any) {
    return {
      events: [],
      rawCount: 0,
      parseErrors: [`XML parse error: ${e.message}`],
      sourceUrl: sourceId,
      rssUrl,
      format: 'unknown',
    };
  }

  const errors: string[] = [];
  const events: ParsedEvent[] = [];

  // RSS 2.0: <rss><channel><item>
  if (parsed?.rss?.channel) {
    const channel = parsed.rss.channel;
    const items: any[] = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
    for (const item of items) {
      try {
        const ev = normalizeRssItem(item, sourceId, rssUrl);
        if (ev) events.push(ev);
      } catch (e: any) {
        errors.push(`item-normalize: ${e.message}`);
      }
    }
    return {
      events,
      rawCount: items.length,
      parseErrors: errors,
      sourceUrl: sourceId,
      rssUrl,
      format: 'rss2',
    };
  }

  // Atom: <feed><entry>
  if (parsed?.feed?.entry) {
    const entries: any[] = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
    for (const entry of entries) {
      try {
        const ev = normalizeAtomEntry(entry, sourceId, rssUrl);
        if (ev) events.push(ev);
      } catch (e: any) {
        errors.push(`entry-normalize: ${e.message}`);
      }
    }
    return {
      events,
      rawCount: entries.length,
      parseErrors: errors,
      sourceUrl: sourceId,
      rssUrl,
      format: 'atom',
    };
  }

  return {
    events: [],
    rawCount: 0,
    parseErrors: ['No <rss><channel> or <feed><entry> structure found'],
    sourceUrl: sourceId,
    rssUrl,
    format: 'unknown',
  };
}
