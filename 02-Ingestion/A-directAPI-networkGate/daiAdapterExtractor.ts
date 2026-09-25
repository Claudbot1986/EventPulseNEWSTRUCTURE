/**
 * daiAdapterExtractor.ts — delad modul för D-AI-adapter-baserad extraktion
 *
 * Bakgrund: tidigare fanns extractWithDaiAdapter + parseSwedishDate + DaiAdapter-typen
 * inline i runA-extract.ts (privata). När runD-scrapingbee.ts behöver samma logik
 * (storkyrkan-2 har en adapter med ol.list--none > li som UniversalExtractor
 * inte känner igen) extraheras de hit så båda kan använda dem utan duplicering.
 *
 * Brandvägg: inga C0/C1/C2-ändringar, ingen scoring-påverkan — bara mekanisk
 * flytt av redan validerad logik.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import type { ParsedEvent } from '../F-eventExtraction/schema';

export interface DaiAdapter {
  sourceId: string;
  seedUrl: string;
  candidateUrls: string[];
  selectors: {
    eventContainer?: string;
    title?: string;
    date?: string;
    venue?: string;
    description?: string;
    link?: string;
    ticketUrl?: string;
  };
  pagination?: {
    pattern: 'next' | 'numbered' | 'infinite';
    maxPages: number;
    nextSelector?: string;
  };
  rateLimitMs?: number;
  aiConfidence: number;
  generatedAt?: string;
  validationPassed?: boolean;
  validationNotes?: string;
}

// Paths (använder PROJECT_ROOT om satt, annars relativ till denna fil)
import { fileURLToPath } from 'url';
const __filename_dai = fileURLToPath(import.meta.url);
const __dirname_dai = path.dirname(__filename_dai);
const RUNTIME_DIR = process.env.EVENTPULSE_PROJECT_ROOT
  ? path.resolve(process.env.EVENTPULSE_PROJECT_ROOT, 'runtime')
  : path.resolve(__dirname_dai, '../../runtime');
const ADAPTERS_DIR = path.resolve(RUNTIME_DIR, 'adapters');

export function loadDaiAdapter(sourceId: string): DaiAdapter | null {
  const adapterPath = path.join(ADAPTERS_DIR, `${sourceId}.json`);
  if (!fs.existsSync(adapterPath)) return null;
  try {
    const raw = fs.readFileSync(adapterPath, 'utf-8');
    return JSON.parse(raw) as DaiAdapter;
  } catch {
    return null;
  }
}

// ── Swedish date parser (T0041) ────────────────────────────────────────────────
// Format som hanteras:
//   "torsdag 21 maj"                          → 2026-05-21
//   "torsdag 21 maj–söndag 27 sep"            → start 2026-05-21, end 2026-09-27
//   "5 sep kl. 13-17"                         → 2026-09-05
//   "21 maj–söndag 27 sep"                    → start 2026-05-21, end 2026-09-27
//   "2026-05-27" (ISO)                        → 2026-05-27

const SWEDISH_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, september: 9, sept: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

interface ParsedDateRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD (same as start if no range)
}

export function parseSwedishDate(text: string, now: Date = new Date()): ParsedDateRange | null {
  if (!text) return null;
  const currentYear = now.getFullYear();

  // ISO first
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)![0];
    return { start: iso, end: iso };
  }

  // Swedish: extract (day, monthName) pairs in order
  const tokens: { day: number; month: number }[] = [];
  const re = /(\d{1,2})\s+([a-zåäöé]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const monthName = m[2].toLowerCase();
    const month = SWEDISH_MONTHS[monthName];
    if (month) tokens.push({ day, month });
  }
  if (tokens.length === 0) return null;

  const toIso = (day: number, month: number, year: number): string =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const startTok = tokens[0];
  let startYear = currentYear;
  // If start date is in the past, roll to next year
  const startDate = new Date(startYear, startTok.month - 1, startTok.day);
  if (startDate < now) startYear = currentYear + 1;
  const start = toIso(startTok.day, startTok.month, startYear);

  if (tokens.length === 1) return { start, end: start };

  const endTok = tokens[1];
  let endYear = startYear;
  if (endTok.month < startTok.month) endYear = startYear + 1;  // crosses Dec→Jan
  const end = toIso(endTok.day, endTok.month, endYear);
  return { start, end };
}

// ── Extract using D-AI adapter selectors ───────────────────────────────────────

export function extractWithDaiAdapter(html: string, adapter: DaiAdapter): ParsedEvent[] {
  const $ = cheerio.load(html);
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const containerSelector = adapter.selectors.eventContainer;
  if (!containerSelector) return events;

  $(containerSelector).each((_i: number, el: any) => {
    const $el = $(el);

    // Title
    const titleSel = adapter.selectors.title;
    const title = titleSel ? $el.find(titleSel).first().text().trim() : $el.find('h2, h3, a').first().text().trim();
    if (!title || title.length < 3) return;

    // T0043: tiqets-stockholm category card filter
    if (adapter.sourceId === 'tiqets-stockholm' && /^\d+ experiences$/i.test(title)) return;

    // Date — Swedish parser first, fall back to ISO (T0041)
    const dateSel = adapter.selectors.date;
    const dateText = dateSel ? $el.find(dateSel).first().text().trim() : '';
    const parsedRange = parseSwedishDate(dateText);
    const date = parsedRange ? parsedRange.start : '';
    const dateEnd = parsedRange ? parsedRange.end : '';

    // Venue
    const venueSel = adapter.selectors.venue;
    const venue = venueSel ? $el.find(venueSel).first().text().trim() : '';

    // Link
    const linkSel = adapter.selectors.link;
    const linkEl = linkSel ? $el.find(linkSel).first() : $el.find('a').first();
    const linkHref = linkEl.attr('href') || '';

    // Dedupe
    const key = `${title}|${date}|${linkHref}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    events.push({
      title,
      date,
      venue: venue || adapter.sourceId,
      url: linkHref.startsWith('http')
        ? linkHref
        : adapter.seedUrl.replace(/\/$/, '') + (linkHref.startsWith('/') ? linkHref : '/' + linkHref),
      category: 'culture',
      source: adapter.sourceId,
      sourceUrl: adapter.seedUrl,
      confidence: {
        score: adapter.aiConfidence,
        hasTitle: true,
        hasDate: Boolean(date),
        hasVenue: Boolean(venue),
        hasUrl: Boolean(linkHref),
        hasDescription: false,
        hasTicketInfo: false,
        signals: ['d-ai-adapter', `confidence-${adapter.aiConfidence}`],
      },
    });
  });

  return events;
}