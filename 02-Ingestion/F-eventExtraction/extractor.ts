/**
 * JSON-LD Extractor - Extracts and normalizes events from JSON-LD structured data
 * Based on goals.md: Fast path via structured data (JSON-LD, schema.org/Event)
 *
 * Priority order:
 * 1. JSON-LD ItemList (annexet)
 * 2. @graph (berwaldhallen, stockholmlive)
 * 3. EventSeries subEvent (berwaldhallen)
 * 4. Direct Event array (fryshuset)
 * 5. Single Event
 */

import * as cheerio from 'cheerio';
import {
  JsonLdEventSchema,
  JsonLdItemListSchema,
  JsonLdGraphSchema,
  JsonLdEventSeriesSchema,
  ExtractionConfidenceSchema,
  ParsedEventSchema,
  type JsonLdEvent,
  type ParsedEvent,
  type ExtractionConfidence,
} from './schema';

export interface ExtractResult {
  events: ParsedEvent[];
  rawCount: number;
  parseErrors: string[];
  sourceUrl: string;
}

// ─── JSON-LD Script Extraction ────────────────────────────────────────────────

/**
 * Extract all JSON-LD scripts from HTML
 */
function extractJsonLdScripts(html: string): any[] {
  const results: any[] = [];

  try {
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (content) {
          const data = JSON.parse(content);
          results.push(data);
        }
      } catch {
        // Skip malformed JSON
      }
    });
  } catch {
    // Skip parse errors
  }

  return results;
}

// ─── Event Extraction from JSON-LD structures ────────────────────────────────

/**
 * Extract events from ItemList structure (annexet)
 * Items may be ListItem->item->Event or direct Event objects
 */
function extractFromItemList(data: any, source: string): JsonLdEvent[] {
  const events: JsonLdEvent[] = [];

  const parsed = JsonLdItemListSchema.safeParse(data);
  if (!parsed.success) return events;

  const { itemListElement } = parsed.data;
  for (const item of itemListElement) {
    if (item.item?.['@type'] === 'Event') {
      const event = JsonLdEventSchema.safeParse(item.item);
      if (event.success) events.push(event.data);
    }
    // Handle direct Event in itemListElement (some sites flatten this)
    if (item['@type'] === 'Event') {
      const event = JsonLdEventSchema.safeParse(item);
      if (event.success) events.push(event.data);
    }
  }

  return events;
}

/**
 * Extract events from @graph structure (berwaldhallen, stockholmlive)
 * Filter to only Event types within the graph
 */
function extractFromGraph(data: any, source: string): JsonLdEvent[] {
  const events: JsonLdEvent[] = [];

  const parsed = JsonLdGraphSchema.safeParse(data);
  if (!parsed.success) return events;

  for (const item of parsed.data['@graph']) {
    if (item['@type'] === 'Event' || item['@type'] === 'EventSeries') {
      // EventSeries has subEvent, not direct event data
      if (item['@type'] === 'Event') {
        const event = JsonLdEventSchema.safeParse(item);
        if (event.success) events.push(event.data);
      }
    }
  }

  return events;
}

/**
 * Extract events from EventSeries subEvent structure (berwaldhallen)
 */
function extractFromEventSeries(data: any, source: string): JsonLdEvent[] {
  const events: JsonLdEvent[] = [];

  const parsed = JsonLdEventSeriesSchema.safeParse(data);
  if (!parsed.success) return events;

  const { subEvent } = parsed.data;
  if (!subEvent) return events;

  const subEvents = Array.isArray(subEvent) ? subEvent : [subEvent];
  for (const sub of subEvents) {
    const event = JsonLdEventSchema.safeParse(sub);
    if (event.success) events.push(event.data);
  }

  return events;
}

/**
 * Extract events from direct array (fryshuset)
 */
function extractFromArray(data: any[], source: string): JsonLdEvent[] {
  const events: JsonLdEvent[] = [];

  for (const item of data) {
    if (item['@type'] === 'Event') {
      const event = JsonLdEventSchema.safeParse(item);
      if (event.success) events.push(event.data);
    }
  }

  return events;
}

/**
 * Extract single Event object
 * Excludes EventSeries, WebSite, WebPage, Organization etc.
 */
function extractSingleEvent(data: any, source: string): JsonLdEvent | null {
  // Must explicitly be @type === 'Event' to avoid accepting EventSeries or other types
  if (data['@type'] !== 'Event') return null;

  const event = JsonLdEventSchema.safeParse(data);
  if (event.success) return event.data;
  return null;
}

// ─── Confidence Scoring ─────────────────────────────────────────────────────

/**
 * Calculate confidence score for an extracted JSON-LD event
 * Based on goals.md signals: positive (+=) and negative (-=) signals
 */
function scoreConfidence(event: JsonLdEvent): ExtractionConfidence {
  const signals: string[] = [];
  let score = 0.5; // Base score

  // Positive signals
  if (event.name && event.name.length > 5) {
    score += 0.15;
    signals.push('strong_title');
  } else if (event.name) {
    score += 0.05;
    signals.push('has_title');
  }

  if (event.startDate) {
    score += 0.15;
    signals.push('has_startDate');
  }

  if (event.location && typeof event.location === 'object' && 'name' in event.location) {
    score += 0.1;
    signals.push('has_venue');
  }

  if (event.location && typeof event.location === 'object' && 'address' in event.location) {
    score += 0.05;
    signals.push('has_address');
  }

  if (event.url) {
    score += 0.05;
    signals.push('has_url');
  }

  if (event.description && event.description.length > 50) {
    score += 0.1;
    signals.push('has_description');
  }

  if (event.offers) {
    score += 0.05;
    signals.push('has_offers');
  }

  if (event.eventStatus?.includes('Scheduled')) {
    score += 0.05;
    signals.push('event_scheduled');
  }

  // Negative signals
  if (!event.startDate || event.startDate.length < 10) {
    score -= 0.2;
    signals.push('weak_date');
  }

  if (!event.name || event.name.length < 3) {
    score -= 0.15;
    signals.push('weak_title');
  }

  if (!event.location) {
    score -= 0.1;
    signals.push('no_venue');
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    hasTitle: Boolean(event.name && event.name.length > 5),
    hasDate: Boolean(event.startDate && event.startDate.length >= 10),
    hasVenue: Boolean(event.location && typeof event.location === 'object' && 'name' in event.location),
    hasUrl: Boolean(event.url),
    hasDescription: Boolean(event.description && event.description.length > 50),
    hasTicketInfo: Boolean(event.offers),
    eventStatus: event.eventStatus,
    signals,
  };
}

// ─── Event Normalization ──────────────────────────────────────────────────────

/**
 * Normalize a JSON-LD Event to ParsedEvent format
 */
function normalizeEvent(event: JsonLdEvent, source: string, sourceUrl?: string): ParsedEvent | null {
  if (!event.name) return null;

  const confidence = scoreConfidence(event);

  // Parse date/time from ISO string
  const startDate = event.startDate || '';
  const date = startDate.split('T')[0] || '';
  const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) || '' : '';

  const endDate = event.endDate?.split('T')[0] || '';
  const endTime = event.endDate?.includes('T') ? event.endDate.split('T')[1]?.substring(0, 5) || '' : '';

  // Extract location
  let venue = '';
  let address = '';
  let city = 'Stockholm';

  if (event.location) {
    if (typeof event.location === 'string') {
      venue = event.location;
    } else if ('name' in event.location && event.location.name) {
      venue = event.location.name;
      if (event.location.address) {
        if (typeof event.location.address === 'string') {
          address = event.location.address;
        } else {
          address = [
            event.location.address.streetAddress,
            event.location.address.postalCode,
            event.location.address.addressLocality,
          ]
            .filter(Boolean)
            .join(', ');
          city = event.location.address.addressLocality || city;
        }
      }
    }
  }

  // Extract organizer
  const organizer = event.organizer?.name || '';

  // Extract performers
  let performers: string[] = [];
  if (event.performer) {
    const perf = Array.isArray(event.performer) ? event.performer : [event.performer];
    performers = perf.map(p => (typeof p === 'string' ? p : p.name || '')).filter(Boolean);
  }

  // Extract offers (ticket info)
  let isFree: boolean | undefined;
  let priceMin: number | undefined;
  let priceMax: number | undefined;
  let ticketUrl: string | undefined;

  if (event.offers) {
    const offers = Array.isArray(event.offers) ? event.offers : [event.offers];
    const firstOffer = offers[0];

    if (firstOffer) {
      if (typeof firstOffer === 'object') {
        isFree = firstOffer.price === '0' || firstOffer.price === '0.00';
        if (firstOffer.price && firstOffer.price !== '0' && firstOffer.price !== '0.00') {
          priceMin = parseFloat(firstOffer.price) || undefined;
        }
        ticketUrl = firstOffer.url || undefined;
      }
    }
  }

  // Determine category from title keywords
  const category = detectCategory(event.name, event.description);

  return {
    title: event.name,
    date,
    time,
    endDate,
    endTime,
    venue,
    address,
    city,
    description: event.description || undefined,
    url: event.url || sourceUrl,
    ticketUrl,
    organizer: organizer || undefined,
    performers: performers.length > 0 ? performers : undefined,
    category,
    isFree,
    priceMin,
    priceMax,
    imageUrl: event.image || undefined,
    status: event.eventStatus?.includes('Scheduled') ? 'scheduled' : 'unknown',
    source,
    sourceUrl: sourceUrl || undefined,
    confidence,
  };
}

/**
 * Simple category detection based on title/description keywords
 */
function detectCategory(title: string, description?: string): string {
  const text = `${title} ${description || ''}`.toLowerCase();

  if (text.includes('jazz') || text.includes('blues') || text.includes('musik') || text.includes('konsert')) {
    return 'music';
  }
  if (text.includes('standup') || text.includes('komedi') || text.includes('comed')) {
    return 'theater';
  }
  if (text.includes('dans') || text.includes('dance')) {
    return 'dance';
  }
  if (text.includes('barn') || text.includes('familj') || text.includes('barnteater')) {
    return 'family';
  }
  if (text.includes('mat') || text.includes('wine') || text.includes('öl') || text.includes('food')) {
    return 'food';
  }
  if (text.includes('utställning') || text.includes('konst') || text.includes('exhibition')) {
    return 'art';
  }
  if (text.includes('sport') || text.includes('match')) {
    return 'sports';
  }

  return 'culture';
}

// ─── Main Extraction ─────────────────────────────────────────────────────────

/**
 * Extract all events from HTML using JSON-LD structured data
 *
 * @param html - Raw HTML from a source page
 * @param source - Source name (e.g. 'berwaldhallen', 'annexet')
 * @param sourceUrl - URL of the page (for provenance)
 * @returns ExtractResult with parsed events, counts, and errors
 */
export function extractFromJsonLd(html: string, source: string, sourceUrl?: string): ExtractResult {
  const events: ParsedEvent[] = [];
  const parseErrors: string[] = [];
  const seenKeys = new Set<string>();

  const jsonLdScripts = extractJsonLdScripts(html);
  let rawCount = 0;

  for (const data of jsonLdScripts) {
    try {
      // Try ItemList (annexet, aviciiarena, sodrateatern)
      const itemListEvents = extractFromItemList(data, source);
      for (const event of itemListEvents) {
        rawCount++;
        const parsed = normalizeEvent(event, source, sourceUrl);
        if (parsed) events.push(parsed);
      }

      // Try @graph (berwaldhallen, stockholmlive)
      const graphEvents = extractFromGraph(data, source);
      for (const event of graphEvents) {
        rawCount++;
        const parsed = normalizeEvent(event, source, sourceUrl);
        if (parsed) events.push(parsed);
      }

      // Try EventSeries (berwaldhallen)
      const seriesEvents = extractFromEventSeries(data, source);
      for (const event of seriesEvents) {
        rawCount++;
        const parsed = normalizeEvent(event, source, sourceUrl);
        if (parsed) events.push(parsed);
      }

      // Try direct array (fryshuset, slakthuset)
      if (Array.isArray(data)) {
        const arrayEvents = extractFromArray(data, source);
        for (const event of arrayEvents) {
          rawCount++;
          const parsed = normalizeEvent(event, source, sourceUrl);
          if (parsed) events.push(parsed);
        }
      }

      // Try single Event
      const single = extractSingleEvent(data, source);
      if (single) {
        rawCount++;
        const parsed = normalizeEvent(single, source, sourceUrl);
        if (parsed) events.push(parsed);
      }
    } catch (e) {
      parseErrors.push(`JSON-LD parse error: ${(e as Error).message}`);
    }
  }

  // Deduplicate by title + date + venue
  const deduped = events.filter(event => {
    const key = `${event.title}|${event.date}|${event.venue}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // Sort by confidence score (highest first)
  deduped.sort((a, b) => b.confidence.score - a.confidence.score);

  return {
    events: deduped,
    rawCount,
    parseErrors,
    sourceUrl: sourceUrl || 'unknown',
  };
}

/**
 * Extract only high-confidence events (score >= threshold)
 */
export function extractHighConfidenceEvents(
  html: string,
  source: string,
  threshold = 0.5,
  sourceUrl?: string
): ParsedEvent[] {
  const result = extractFromJsonLd(html, source, sourceUrl);
  return result.events.filter(e => e.confidence.score >= threshold);
}

// ─── RawEventInput conversion ─────────────────────────────────────────────────

/**
 * Convert ParsedEvent to RawEventInput for the queue
 */
export function toRawEventInput(event: ParsedEvent): RawEventInput {
  return {
    title: event.title,
    description: event.description || null,
    start_time: event.date && event.time ? `${event.date}T${event.time}:00+02:00` : event.date,
    end_time: event.endDate && event.endTime ? `${event.endDate}T${event.endTime}:00+02:00` : event.endDate || null,
    venue_name: event.venue || null,
    venue_address: event.address || null,
    lat: null, // TODO: geocode from address if needed
    lng: null,
    categories: event.category ? [event.category] : [],
    is_free: event.isFree ?? false,
    price_min_sek: event.priceMin || null,
    price_max_sek: event.priceMax || null,
    ticket_url: event.ticketUrl || event.url || null,
    image_url: event.imageUrl || null,
    source: event.source,
    source_id: generateEventId(event.source, event.title, event.date),
    detected_language: 'sv',
    raw_payload: event as Record<string, unknown>,
  };
}

function generateEventId(source: string, title: string, date: string): string {
  const input = `${source}:${title}:${date}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${source}-${Math.abs(hash).toString(36)}`;
}

// ─── HTML Event Extraction ───────────────────────────────────────────────────

/**
 * Extract events from raw HTML using DOM heuristics.
 * Called as fallback when JSON-LD extraction yields 0 events.
 *
 * Supports URL-embedded date patterns (konserthuset, fryshuset, etc.)
 * and common DOM structures (article, li, event cards).
 *
 * @param html - Raw HTML content
 * @param source - Source name (e.g. 'konserthuset')
 * @param baseUrl - Base URL of the page (for resolving relative links)
 * @returns ExtractResult with parsed events
 */
export function extractFromHtml(html: string, source: string, baseUrl?: string): ExtractResult {
  const events: ParsedEvent[] = [];
  const parseErrors: string[] = [];
  const seenKeys = new Set<string>();

  try {
    const $ = cheerio.load(html);
    const base = baseUrl || '';

    // Strategy 1: URL-embedded date patterns
    // Pattern A: /YYYY-MM-DD-HHMM/ (e.g. /2026-04-07-16-00/)
    const urlDateRegexA = /\/?(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\/?/g;
    // Pattern B: /YYYYMMDD-HHMM/ (e.g. /20260407-1600/) — Konserthuset format
    const urlDateRegexB = /\/?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\/?/g;

    // Strategy 2: ISO date in URL path segments
    // Matches: /{YYYY}/{MM}/{DD}/ or /{YYYY-MM-DD}/
    const isoPathDateRegex = /\/(\d{4})\/(\d{2})\/(\d{2})\//g;

    // Strategy 3: Swedish date in text
    // Matches: "7 april 2026" or "26 april 2026"
    const sweDateRegex = /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/gi;

    // Build absolute URL from relative
    function resolveUrl(href: string): string {
      if (href.startsWith('http')) return href;

      // Extract origin from base URL to avoid path duplication
      // e.g. base = https://www.konserthuset.se/program-och-biljetter/kalender/
      //      href = /program-och-biljetter/kalender/konsert/...
      //      result = https://www.konserthuset.se/program-och-biljetter/kalender/konsert/...
      try {
        const baseUrl = new URL(base);
        if (href.startsWith('/')) {
          return `${baseUrl.origin}${href}`;
        }
      } catch {
        // Fallback for invalid base URL
      }

      return `${base.replace(/\/$/, '')}/${href}`;
    }

    // Extract date/time from URL
    function extractDateTimeFromUrl(url: string): { date: string; time: string } | null {
      // Try pattern A: /YYYY-MM-DD-HHMM/
      urlDateRegexA.lastIndex = 0;
      const match1 = urlDateRegexA.exec(url);
      if (match1) {
        const [, year, month, day, hour, min] = match1;
        return { date: `${year}-${month}-${day}`, time: `${hour}:${min}` };
      }

      // Try pattern B: /YYYYMMDD-HHMM/ (Konserthuset format)
      urlDateRegexB.lastIndex = 0;
      const match2 = urlDateRegexB.exec(url);
      if (match2) {
        const [, year, month, day, hour, min] = match2;
        return { date: `${year}-${month}-${day}`, time: `${hour}:${min}` };
      }

      // Try ISO path: /YYYY/MM/DD/
      isoPathDateRegex.lastIndex = 0;
      const match3 = isoPathDateRegex.exec(url);
      if (match3) {
        const [, year, month, day] = match3;
        return { date: `${year}-${month}-${day}`, time: '' };
      }

      return null;
    }

    // Swedish month to number
    const sweMonthMap: Record<string, string> = {
      januari: '01', februari: '02', mars: '03', april: '04',
      maj: '05', juni: '06', juli: '07', augusti: '08',
      september: '09', oktober: '10', november: '11', december: '12',
    };

    // Extract date from Swedish text
    function extractSwedishDate(text: string): string | null {
      sweDateRegex.lastIndex = 0;
      const match = sweDateRegex.exec(text);
      if (match) {
        const [, day, monthName, year] = match;
        const month = sweMonthMap[monthName.toLowerCase()];
        if (month) {
          return `${year}-${month}-${day.padStart(2, '0')}`;
        }
      }
      return null;
    }

    // Find event candidate links in main content
    const eventLinks: Array<{ href: string; text: string }> = [];

    // Scope: main content area
    const scope = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list');

    // Find all links that look like event links
    scope.find('a[href]').each((_: any, el: any) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();

      // Skip nav/footer/sidebar links
      if ($(el).closest('nav, footer, .nav, .sidebar').length > 0) return;

      // Skip if text is too short or looks like navigation
      if (text.length < 5) return;

      // Accept: links with date patterns in URL
      const dateInfo = extractDateTimeFromUrl(href);
      if (dateInfo) {
        eventLinks.push({ href, text });
        return;
      }

      // Accept: links in event-like paths (kalender, event, konsert, etc.)
      if (href.includes('/kalender/') && /[A-ZÄÖÅa-zöäå]/.test(text)) {
        eventLinks.push({ href, text });
        return;
      }
    });

    // Also check list items (li) with links
    scope.find('li').each((_: any, el: any) => {
      const $el = $(el);
      // Skip if in nav
      if ($el.closest('nav, footer, .nav, .sidebar').length > 0) return;

      const link = $el.find('a[href]').first();
      const href = link.attr('href') || '';
      const text = $el.clone().children().remove().end().text().trim() || link.text().trim();

      if (href && text.length > 5) {
        const dateInfo = extractDateTimeFromUrl(href);
        if (dateInfo) {
          eventLinks.push({ href, text });
        }
      }
    });

    // Deduplicate by href
    const uniqueLinks = eventLinks.filter((l, i, arr) =>
      arr.findIndex(x => x.href === l.href) === i
    );

    // Build ParsedEvents
    for (const link of uniqueLinks) {
      const href = resolveUrl(link.href);
      const title = link.text.replace(/\s+/g, ' ').trim();

      // Get date/time from URL
      const urlDateInfo = extractDateTimeFromUrl(link.href);
      let date = urlDateInfo?.date || '';
      let time = urlDateInfo?.time || '';

      // Fallback: try to find date in surrounding/sibling text
      if (!date) {
        const $link = $(`a[href="${link.href}"]`).first();
        const siblingText = $link.parent().text() || '';
        const foundDate = extractSwedishDate(siblingText);
        if (foundDate) date = foundDate;
      }

      // Skip if no date found
      if (!date) continue;

      // Dedupe
      const key = `${title}|${date}|${href}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      // Try to extract venue from title context
      let venue = source;

      // Detect category from URL path
      let category = 'culture';
      if (link.href.includes('/konsert/') || link.href.includes('/musik/')) category = 'music';
      else if (link.href.includes('/teater/') || link.href.includes('/scen/')) category = 'theater';
      else if (link.href.includes('/dans/')) category = 'dance';
      else if (link.href.includes('/barn/') || link.href.includes('/familj/')) category = 'family';
      else if (link.href.includes('/utstallning/')) category = 'art';

      const event: ParsedEvent = {
        title,
        date,
        time: time || undefined,
        venue: venue || undefined,
        url: href,
        category,
        source,
        sourceUrl: href,
        confidence: {
          score: 0.5,
          hasTitle: true,
          hasDate: true,
          hasVenue: false,
          hasUrl: true,
          hasDescription: false,
          hasTicketInfo: false,
          signals: ['html-url-date', 'html-title'],
        },
      };

      events.push(event);
    }

    // Also scan page text for Swedish dates and build events from them
    // This catches sources where dates aren't in URLs
    const pageText = scope.text() || '';
    sweDateRegex.lastIndex = 0;
    let match;
    while ((match = sweDateRegex.exec(pageText)) !== null) {
      const [, day, monthName, year] = match;
      const month = sweMonthMap[monthName.toLowerCase()];
      if (!month) continue;

      const dateStr = `${year}-${month}-${day.padStart(2, '0')}`;
      const key = `text-date|${dateStr}`;
      if (seenKeys.has(key)) continue;

      // Find nearby title
      const datePos = pageText.indexOf(match[0]);
      const snippet = pageText.substring(Math.max(0, datePos - 100), datePos + 100);
      const titleMatch = snippet.match(/[A-ZÄÖÅ][^.!?\n]{5,60}(?=\s*[-–—:.|,])/);

      if (titleMatch) {
        const title = titleMatch[0].replace(/\s+/g, ' ').trim();
        if (title.length > 5) {
          seenKeys.add(key);
          events.push({
            title,
            date: dateStr,
            venue: source,
            source,
            sourceUrl: baseUrl,
            confidence: {
              score: 0.4,
              hasTitle: true,
              hasDate: true,
              hasVenue: false,
              hasUrl: false,
              hasDescription: false,
              hasTicketInfo: false,
              signals: ['html-text-date', 'html-title-snippet'],
            },
          });
        }
      }
    }
  } catch (e) {
    parseErrors.push(`HTML extraction error: ${(e as Error).message}`);
  }

  return {
    events: events.slice(0, 50), // cap at 50 events
    rawCount: events.length,
    parseErrors,
    sourceUrl: baseUrl || 'unknown',
  };
}

// Re-export
import type { RawEventInput } from '@eventpulse/shared';
export type { RawEventInput };
