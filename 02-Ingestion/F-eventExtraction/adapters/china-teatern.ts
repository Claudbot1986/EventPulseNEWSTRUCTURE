/**
 * China Teatern (chinateatern.se) adapter — Stockholm music/shows venue
 *
 * Site-specific pattern (verified 2026-08-19):
 * - Listing page /forestallningar/ has links to /shower/{slug} for current/upcoming shows
 * - Each show page has:
 *     - `<div class="show-hero__date"><p> 7 jan, 2027 - 16 jan, 2027 </p></div>` — year range
 *     - `<h5>Spelas</h5> ... <p>7 jan - 16 jan 2027</p>` — same year info
 *     - "Kommande speltillfällen" section with `<div class="ticket-card">` cards
 *     - Each card has `<h4>Torsdag 7 jan, 19:30</h4>` + `<p class="ticket-card__date">Torsdag 7 jan, 19:30 • China Teatern, Stockholm</p>` + price + ticket URL
 *     - "Turné" section has dates at OTHER cities (skip those for Stockholm-only mandate)
 * - Filter rule: keep only ticket-cards whose text contains "China Teatern" (Stockholm home shows)
 *
 * Per CLAUDE.md Generalization Protection Rule: isolated from C0/C1/C2.
 * Applies ONLY to chinateatern.se URLs.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'china-teatern';
const VENUE = 'China Teatern';
const CITY = 'Stockholm';
const ADDRESS = 'Berzelii Park, 111 47 Stockholm';
const LAT = 59.3326;
const LNG = 18.0728;

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'chinateatern.se' || u.hostname === 'www.chinateatern.se';
  } catch {
    return false;
  }
}

function extractShowSlugUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];
  $('a[href*="/shower/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let path: string;
    try {
      path = new URL(href, 'https://www.chinateatern.se').pathname;
    } catch {
      return;
    }
    const m = path.match(/^\/shower\/([^/?#]+)\/?$/);
    if (!m) return;
    const slug = m[1];
    if (seen.has(slug)) return;
    seen.add(slug);
    urls.push(`https://www.chinateatern.se/shower/${slug}/`);
  });
  return urls;
}

function extractShowYear(html: string): number {
  // Try show-hero__date first: " 7 jan, 2027 - 16 jan, 2027 "
  let m = html.match(/class="show-hero__date"[^>]*>\s*<p>\s*([^<]+?)\s*<\/p>/i);
  if (m) {
    const yearMatch = m[1].match(/(20\d{2})/);
    if (yearMatch) return parseInt(yearMatch[1], 10);
  }
  // Fallback: "Spelas" section "<p>7 jan - 16 jan 2027</p>"
  m = html.match(/(?:Spelas|spelas)[\s\S]{0,200}?<p>\s*[^<]*?(20\d{2})\s*<\/p>/i);
  if (m) return parseInt(m[1], 10);
  return new Date().getFullYear();
}

interface ParsedPerformance {
  date: string;
  time: string;
  ticketUrl?: string;
  priceMin?: number;
}

function extractStockholmPerformances(html: string, year: number): ParsedPerformance[] {
  const $ = cheerio.load(html);
  const out: ParsedPerformance[] = [];
  let inSection = false;

  $('body *').each((_, el) => {
    const $el = $(el);
    if ($el.is('h2, h3')) {
      const txt = $el.text().trim();
      inSection = /^Kommande\s+speltillf[äa]llen/i.test(txt);
      return;
    }
    if (inSection && $el.hasClass('ticket-card')) {
      const heading = $el.find('h4').first().text().trim();
      const dateText = $el.find('.ticket-card__date').first().text().trim();
      const ticketHref = $el.find('a[href*="showtic.se"], a[href*="biljett"]').first().attr('href');
      const priceText = $el.text();
      const priceMatch = priceText.match(/fr[åa]n\s+(\d+)\s*kr/i);

      if (!/china\s*teatern|stockholm/i.test(dateText)) return;

      const headingMatch = heading.match(/(\d{1,2})\s+([a-zåäö]+)(?:\s*,)?\s*(\d{1,2}):(\d{2})/i);
      if (!headingMatch) return;
      const day = parseInt(headingMatch[1], 10);
      const monthName = headingMatch[2].toLowerCase();
      const month = MONTHS[monthName];
      if (!month || isNaN(day)) return;
      const time = `${headingMatch[3].padStart(2, '0')}:${headingMatch[4]}`;
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      out.push({
        date,
        time,
        ticketUrl: ticketHref,
        priceMin: priceMatch ? parseInt(priceMatch[1], 10) : undefined,
      });
    }
  });

  return out;
}

function extractShowTitle(html: string): string {
  const m = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);
  if (m) return m[1].trim().replace(/\s+/g, ' ');
  const og = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (og) return og[1].trim();
  return '';
}

function extractShowImage(html: string): string {
  const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
  return og ? og[1].trim() : '';
}

function extractShowDescription(html: string): string {
  const og = html.match(/<meta property="og:description" content="([^"]+)"/i);
  return og ? og[1].trim().slice(0, 500) : '';
}

export interface ChinaTeaternExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'china-teatern-listing' | 'china-teatern-show' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): ChinaTeaternExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  if (/\/shower\/[^/?#]+/.test(url)) {
    const title = extractShowTitle(html);
    if (!title) return { showUrls: [], events: [], method: 'none' };
    const year = extractShowYear(html);
    const performances = extractStockholmPerformances(html, year);
    const image = extractShowImage(html);
    const description = extractShowDescription(html);

    const events: ParsedEvent[] = [];
    for (const p of performances) {
      try {
        const evt = ParsedEventSchema.parse({
          title,
          date: p.date,
          time: p.time,
          venue: VENUE,
          address: ADDRESS,
          city: CITY,
          description: description || undefined,
          url,
          ticketUrl: p.ticketUrl,
          imageUrl: image || undefined,
          priceMin: p.priceMin,
          category: 'musikaler',
          source,
          sourceUrl: url,
          confidence: {
            score: 0.9,
            hasTitle: true,
            hasDate: true,
            hasVenue: true,
            hasUrl: true,
            hasDescription: !!description,
            hasTicketInfo: !!p.priceMin,
            signals: ['china-teatern-show', `year:${year}`, `perfs:${performances.length}`],
          },
        });
        events.push(evt);
      } catch {
        /* skip malformed */
      }
    }
    return { showUrls: [], events, method: 'china-teatern-show' };
  }

  if (/\/forestallningar\/?(?:\?|$|#)/.test(url)) {
    const urls = extractShowSlugUrls(html);
    return { showUrls: urls, events: [], method: 'china-teatern-listing' };
  }

  return { showUrls: [], events: [], method: 'none' };
}
