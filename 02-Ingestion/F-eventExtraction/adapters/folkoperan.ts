/**
 * Folkoperan.se adapter — Stockholm opera
 *
 * Site-specific pattern (verified 2026-08-19 from /pa-scen/):
 * - Listing page /pa-scen/ shows current/upcoming shows
 *   Each show is an <article> with h3 title + link to /uppsattningar/{slug}/
 *   and a buy-button linking to https://biljetter.folkoperan.se/sv/buyingflow/tickets/{id}/
 * - The biljetter.folkoperan.se buyingflow page embeds a JSON array of
 *   individual performance tickets:
 *     "item_name": "Jag är Ulla Winblad-2026-09-19 18:00:00"
 *   Each item is one performance date+time. Strip the suffix and parse.
 *   The page <title> is "Folkoperan - {show_title} - Biljetter".
 * - Only shows that have a buy-button on /pa-scen/ are exposed via this path
 *   (others aren't yet on sale; site-specific quirk).
 *
 * Per CLAUDE.md Generalization Protection Rule: isolated from C0/C1/C2.
 * Applies ONLY to folkoperan.se URLs.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'folkoperan';
const VENUE = 'Folkoperan';
const CITY = 'Stockholm';
const ADDRESS = 'Hornsgatan 72, 118 21 Stockholm';
const LAT = 59.3172;
const LNG = 18.0580;

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'folkoperan.se' ||
      u.hostname === 'www.folkoperan.se' ||
      u.hostname === 'biljetter.folkoperan.se'
    );
  } catch {
    return false;
  }
}

function extractBuyingflowUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];
  $('a[href*="biljetter.folkoperan.se/sv/buyingflow/tickets/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const m = href.match(/^https?:\/\/biljetter\.folkoperan\.se\/sv\/buyingflow\/tickets\/(\d+)\/?$/);
    if (!m) return;
    const u = `https://biljetter.folkoperan.se/sv/buyingflow/tickets/${m[1]}/`;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  });
  return urls;
}

function extractShowTitle(html: string): string {
  const m = html.match(/<title>\s*Folkoperan\s*-\s*([^<]+?)\s*-\s*Biljetter\s*<\/title>/i);
  if (m) return m[1].trim();
  const og = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (og) return og[1].trim();
  return '';
}

const ITEM_RX = /"item_name":\s*"([^"]+?)(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2})"/g;

function extractPerformances(html: string): Array<{ title: string; date: string; time: string }> {
  const baseTitle = extractShowTitle(html);
  if (!baseTitle) return [];
  const seen = new Set<string>();
  const out: Array<{ title: string; date: string; time: string }> = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(ITEM_RX.source, 'g');
  while ((m = rx.exec(html)) !== null) {
    const dateTime = m[2]; // YYYY-MM-DD HH:MM:SS
    const dtMatch = dateTime.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2}):\d{2}$/);
    if (!dtMatch) continue;
    const date = dtMatch[1];
    const time = `${dtMatch[2].padStart(2, '0')}:${dtMatch[3]}`;
    const key = `${date}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: baseTitle, date, time });
  }
  return out;
}

function extractPrice(html: string): { priceMin: number | undefined } {
  const m = html.match(/"price":\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!isNaN(n) && n > 0) return { priceMin: Math.round(n) };
  }
  return { priceMin: undefined };
}

function extractImage(html: string): string {
  const m = html.match(/<meta property="og:image" content="([^"]+)"/i);
  return m ? m[1].trim() : '';
}

function extractDescription(html: string): string {
  const m = html.match(/<meta property="og:description" content="([^"]+)"/i);
  return m ? m[1].trim().slice(0, 500) : '';
}

export interface FolkoperanExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'folkoperan-listing' | 'folkoperan-tickets' | 'none';
}

export function extract(html: string, url: string, source = SOURCE_ID): FolkoperanExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  if (/biljetter\.folkoperan\.se\/sv\/buyingflow\/tickets\/\d+\/?$/.test(url)) {
    const title = extractShowTitle(html);
    if (!title) return { showUrls: [], events: [], method: 'none' };
    const performances = extractPerformances(html);
    const { priceMin } = extractPrice(html);
    const image = extractImage(html);
    const description = extractDescription(html);

    const events: ParsedEvent[] = [];
    for (const p of performances) {
      try {
        const evt = ParsedEventSchema.parse({
          title: p.title,
          date: p.date,
          time: p.time,
          venue: VENUE,
          address: ADDRESS,
          city: CITY,
          description: description || undefined,
          url,
          imageUrl: image || undefined,
          priceMin,
          category: 'opera',
          source,
          sourceUrl: url,
          confidence: {
            score: 0.92,
            hasTitle: true,
            hasDate: true,
            hasVenue: true,
            hasUrl: true,
            hasDescription: !!description,
            hasTicketInfo: priceMin !== undefined,
            signals: ['folkoperan-buyingflow', `show:${title}`],
          },
        });
        events.push(evt);
      } catch {
        /* skip malformed */
      }
    }
    return { showUrls: [], events, method: 'folkoperan-tickets' };
  }

  if (/\/pa-scen\/?(?:\?|$|#)/.test(url)) {
    const urls = extractBuyingflowUrls(html);
    return { showUrls: urls, events: [], method: 'folkoperan-listing' };
  }

  if (/\/uppsattningar\/[^/?#]+/.test(url)) {
    const urls = extractBuyingflowUrls(html);
    if (urls.length > 0) return { showUrls: urls, events: [], method: 'folkoperan-listing' };
  }

  return { showUrls: [], events: [], method: 'none' };
}
