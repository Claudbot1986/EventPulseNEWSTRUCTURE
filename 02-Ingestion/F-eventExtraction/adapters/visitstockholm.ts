/**
 * VisitStockholm.com adapter — Stockholm's official curated events listing
 *
 * Site-specific pattern (verified 2026-08-21 from https://www.visitstockholm.com/events/):
 *
 * LISTING PAGE (/events/):
 * - Next.js + CSS-modules site. Each event card has these CSS-module classes
 *   (use attribute selectors to match across hash suffixes):
 *     - Outer wrapper:    [class*="CardEvent_CardEvent__krQlj"]
 *     - Anchor (href):    [class*="CardEvent_CardEvent__Link"]   (absolute URL)
 *     - Title (h3):       [class*="CardEvent_CardEvent__Title"]
 *     - Category text:    [class*="CardEvent_CardEventPicture__CategoryText"]
 *     - Meta row:         [class*="CardEvent_CardEvent__MetaRow"]  (date + venue)
 *   First meta row contains the date (e.g. "Aug 21 - Aug 23"), second row the venue.
 *   First-page fetch yields 28 cards (verified 2026-08-21, range Aug 21 - Sep 30).
 *
 * DETAIL PAGE (/events/{slug}/YYYY-MM-DD/HHMM/HHMM/):
 * - JSON-LD block contains a schema.org/Event entry with full:
 *   name, startDate, endDate, location (Place w/ address), organizer, offers.url.
 * - Fallback to og:title / og:description / og:image if JSON-LD absent.
 *
 * Per CLAUDE.md Generalization Protection Rule: this adapter is isolated from
 * C0/C1/C2 — it applies ONLY to visitstockholm.com URLs.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'visitstockholm';
const CITY = 'Stockholm';

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.visitstockholm.com' || u.hostname === 'visitstockholm.com';
  } catch {
    return false;
  }
}

/**
 * Parse "Aug 21 - Aug 23" or "Aug 21 - Sep 30" or "Aug 21" into ISO date(s).
 * Returns start date (and optionally end date).
 */
function parseEnDateRange(
  s: string,
  fallbackYear: number
): { start: string | null; end?: string } {
  const cleaned = s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  // "Aug 21 - Aug 23" / "Aug 21 - Sep 30"
  const rangeM = cleaned.match(
    /^([a-z]+)\s+(\d{1,2})\s*[-–]\s*([a-z]+)\s+(\d{1,2})$/i
  );
  if (rangeM) {
    const sm = EN_MONTHS[rangeM[1].toLowerCase()];
    const em = EN_MONTHS[rangeM[3].toLowerCase()];
    const sd = parseInt(rangeM[2], 10);
    const ed = parseInt(rangeM[4], 10);
    if (sm && em && sd >= 1 && sd <= 31 && ed >= 1 && ed <= 31) {
      return {
        start: iso(fallbackYear, sm, sd),
        end: iso(fallbackYear, em, ed),
      };
    }
  }

  // "Aug 21" / "August 21"
  const singleM = cleaned.match(/^([a-z]+)\s+(\d{1,2})$/i);
  if (singleM) {
    const m = EN_MONTHS[singleM[1].toLowerCase()];
    const d = parseInt(singleM[2], 10);
    if (m && d >= 1 && d <= 31) return { start: iso(fallbackYear, m, d) };
  }

  return { start: null };
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Extract event cards from a listing page. Each card has:
 *   - one [class*="CardEvent_CardEvent__Link"] anchor with absolute href
 *   - one [class*="CardEvent_CardEvent__Title"] h3
 *   - one [class*="CardEvent_CardEventPicture__CategoryText"] for category
 *   - two [class*="CardEvent_CardEvent__MetaRow"] children: date + venue
 */
function extractListingEvents(html: string, url: string): ParsedEvent[] {
  const $ = cheerio.load(html);
  const events: ParsedEvent[] = [];
  const year = new Date().getFullYear();

  $('[class*="CardEvent_CardEvent__krQlj"]').each((_, el) => {
    const $el = $(el);
    const href = $el.find('[class*="CardEvent_CardEvent__Link"]').attr('href');
    const title = $el.find('[class*="CardEvent_CardEvent__Title"]').text().trim();
    const category = $el
      .find('[class*="CardEvent_CardEventPicture__CategoryText"]')
      .first()
      .text()
      .trim();

    if (!href || !title) return;

    const metaRows = $el.find('[class*="CardEvent_CardEvent__MetaRow"]');
    // Strip sr-only icon labels from the row text.
    const dateRaw = metaRows.eq(0).text().replace(/Calendar icon/i, '').trim();
    const venueRaw = metaRows.eq(1).text().replace(/Location icon/i, '').trim();

    const parsed = parseEnDateRange(dateRaw, year);
    if (!parsed.start) return;

    try {
      const evt = ParsedEventSchema.parse({
        title,
        date: parsed.start,
        endDate: parsed.end,
        venue: venueRaw || undefined,
        city: CITY,
        url: href,
        category: category.toLowerCase() || undefined,
        source: SOURCE_ID,
        sourceUrl: url,
        confidence: {
          score: 0.85,
          hasTitle: true,
          hasDate: true,
          hasVenue: !!venueRaw,
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: false,
          signals: ['visitstockholm-listing-card', `category:${category || 'unknown'}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  });

  return events;
}

/**
 * Extract an event from a detail page via JSON-LD Event entry.
 * Falls back to og: meta tags and HTML meta rows.
 */
function extractDetailEvent(html: string, url: string): ParsedEvent | null {
  const $ = cheerio.load(html);

  // 1. Try JSON-LD Event
  let ldEvent: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ldEvent) return;
    const txt = $(el).html();
    if (!txt) return;
    try {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        if (item && item['@type'] === 'Event') {
          ldEvent = item as Record<string, unknown>;
          return;
        }
      }
    } catch {
      /* malformed JSON */
    }
  });

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
  const ogDescription =
    $('meta[property="og:description"]').attr('content')?.trim() || '';
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || '';

  if (ldEvent) {
    const name = (ldEvent.name as string) || ogTitle;
    const startDate = ldEvent.startDate as string | undefined;
    const endDate = ldEvent.endDate as string | undefined;
    if (!name || !startDate) return null;

    const datePart = startDate.split('T')[0];
    const timePart = startDate.includes('T')
      ? startDate.split('T')[1]?.substring(0, 5)
      : undefined;
    const endDatePart = endDate?.split('T')[0];

    const loc = ldEvent.location as
      | { name?: string; address?: string | { streetAddress?: string } }
      | undefined;
    const venueName = loc?.name || undefined;
    const streetAddress =
      typeof loc?.address === 'string'
        ? loc.address
        : loc?.address?.streetAddress;

    const organizer = ldEvent.organizer as { name?: string; url?: string } | undefined;
    const offers = ldEvent.offers as { url?: string } | undefined;

    let description = ogDescription || undefined;
    if (!description && typeof ldEvent.description === 'string') {
      description = (ldEvent.description as string).replace(/<[^>]+>/g, '').trim();
    }

    try {
      return ParsedEventSchema.parse({
        title: name,
        date: datePart,
        time: timePart || undefined,
        endDate: endDatePart,
        venue: venueName,
        address: streetAddress || undefined,
        city: CITY,
        description,
        url,
        ticketUrl: offers?.url,
        organizer: organizer?.name || undefined,
        imageUrl: ogImage || undefined,
        category: 'culture',
        source: SOURCE_ID,
        sourceUrl: url,
        confidence: {
          score: 0.95,
          hasTitle: true,
          hasDate: true,
          hasVenue: !!venueName,
          hasUrl: true,
          hasDescription: !!description,
          hasTicketInfo: !!offers?.url,
          signals: ['visitstockholm-detail-jsonld'],
        },
      });
    } catch {
      return null;
    }
  }

  // 2. Fallback to og: meta + HTML meta rows
  const metaRows = $('[class*="CardEvent_CardEvent__MetaRow"]');
  if (metaRows.length === 0) return null;

  const dateRaw = metaRows.eq(0).text().replace(/Calendar icon/i, '').trim();
  const venueRaw = metaRows.eq(1).text().replace(/Location icon/i, '').trim();
  const year = new Date().getFullYear();
  const parsed = parseEnDateRange(dateRaw, year);
  if (!parsed.start) return null;

  const title = ogTitle || $('h1').first().text().trim();
  if (!title) return null;

  try {
    return ParsedEventSchema.parse({
      title,
      date: parsed.start,
      endDate: parsed.end,
      venue: venueRaw || undefined,
      city: CITY,
      description: ogDescription || undefined,
      url,
      imageUrl: ogImage || undefined,
      category: 'culture',
      source: SOURCE_ID,
      sourceUrl: url,
      confidence: {
        score: 0.7,
        hasTitle: true,
        hasDate: true,
        hasVenue: !!venueRaw,
        hasUrl: true,
        hasDescription: !!ogDescription,
        hasTicketInfo: false,
        signals: ['visitstockholm-detail-fallback'],
      },
    });
  } catch {
    return null;
  }
}

export interface VisitStockholmExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'visitstockholm-listing' | 'visitstockholm-detail' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): VisitStockholmExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  // Detail page: /events/{slug}/YYYY-MM-DD/HHMM/HHMM/  — at least 3 path segments under /events/
  const isDetail = /\/events\/[^/?#]+\/[^/?#]+/.test(url);

  if (isDetail) {
    const event = extractDetailEvent(html, url);
    if (event) {
      return { showUrls: [], events: [event], method: 'visitstockholm-detail' };
    }
    return { showUrls: [], events: [], method: 'none' };
  }

  // Listing page: /events/ or /events/?cat=... etc.
  if (/\/events\/?(?:$|\?|#)/.test(url)) {
    const events = extractListingEvents(html, url);
    if (events.length === 0) {
      return { showUrls: [], events: [], method: 'none' };
    }
    return { showUrls: [], events, method: 'visitstockholm-listing' };
  }

  return { showUrls: [], events: [], method: 'none' };
}