/**
 * Biljettshop.se adapter — ticket-detail pages with schema.org/Event JSON-LD
 *
 * 2026-10-09 — Flaskhals 3 follow-up: biljettshop.se ticket-detail URLs har
 * JSON-LD events som inte fångas av C-pipelinen (C0 redirectar till sitemap,
 * C1 säger no-main, exit). Denna adapter hanterar dessa URLs direkt.
 *
 * Site-specific pattern (verified 2026-10-09 from 4 ticket URLs):
 *   - Domain: biljettshop.se (enbart)
 *   - URL pattern: /sv/{slug}-YYYY-MM-DD/ eller /en/{slug}-YYYY-MM-DD-/
 *   - JSON-LD: <script type="application/ld+json"> innehåller schema.org
 *     Event-objekt (ofta MusicEvent), ett per kommande showning av artisten
 *     på olika venues. Titlar är redan sammansatta med "Artist Venue Datum
 *     Tid" (t.ex. "Sven Ingvars Kungsbacka Teater 2026-10-09 19:00").
 *   - Varje event har location.name (venue) + startDate (ISO 8601 med tid).
 *
 * Dedup: titlar är unika per (artist + venue + date + time), så normaliserad
 * title+date+venue fungerar som fingerprint.
 *
 * Per CLAUDE.md Generalization Protection Rule: denna adapter är isolerad
 * och tillämpas ENDAST på biljettshop.se URLs. Inga ändringar i C0/C1/C2.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'biljettshop';

const EVENT_SUBTYPES = new Set([
  'Event', 'MusicEvent', 'TheaterEvent', 'BusinessEvent', 'SportsEvent',
  'DanceEvent', 'Festival', 'ComedyEvent', 'ChildrensEvent',
  'LiteraryEvent', 'VisualArtsEvent', 'ExhibitionEvent', 'SocialEvent',
  'ScreeningEvent', 'SaleEvent',
]);

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'biljettshop.se' || u.hostname === 'www.biljettshop.se';
  } catch {
    return false;
  }
}

interface RawLdEvent {
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  location?: { name?: string; address?: string | { streetAddress?: string } };
  offers?: { url?: string; price?: string | number };
  performer?: { name?: string };
}

function collectEvents(node: unknown, acc: RawLdEvent[]): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  const isEvent = typeof t === 'string' && EVENT_SUBTYPES.has(t);
  if (isEvent) {
    const raw: RawLdEvent = {};
    if (typeof obj.name === 'string') raw.name = obj.name;
    if (typeof obj.startDate === 'string') raw.startDate = obj.startDate;
    if (typeof obj.endDate === 'string') raw.endDate = obj.endDate;
    if (typeof obj.url === 'string') raw.url = obj.url;
    if (typeof obj.description === 'string') raw.description = obj.description;
    if (obj.location && typeof obj.location === 'object') {
      raw.location = obj.location as RawLdEvent['location'];
    }
    if (obj.offers && typeof obj.offers === 'object') {
      raw.offers = obj.offers as RawLdEvent['offers'];
    }
    if (obj.performer && typeof obj.performer === 'object') {
      raw.performer = obj.performer as RawLdEvent['performer'];
    }
    acc.push(raw);
  }
  if (Array.isArray(obj['@graph'])) for (const c of obj['@graph']) collectEvents(c, acc);
  if (Array.isArray(obj.itemListElement)) for (const c of obj.itemListElement) collectEvents(c, acc);
  if (Array.isArray(obj.subEvent)) for (const c of obj.subEvent) collectEvents(c, acc);
  if (Array.isArray(obj.about)) for (const c of obj.about) collectEvents(c, acc);
  if (Array.isArray(obj.events)) for (const c of obj.events) collectEvents(c, acc);
  if (obj.mainEntity && typeof obj.mainEntity === 'object') collectEvents(obj.mainEntity, acc);
}

export interface BiljettshopExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'biljettshop-jsonld' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): BiljettshopExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const $ = cheerio.load(html);
  const rawEvents: RawLdEvent[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() || '';
    try {
      const data = JSON.parse(content);
      collectEvents(data, rawEvents);
    } catch { /* skip malformed JSON-LD */ }
  });

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  for (const raw of rawEvents) {
    if (!raw.name || !raw.startDate) continue;

    const date = raw.startDate.split('T')[0];
    const time = raw.startDate.includes('T')
      ? raw.startDate.split('T')[1]?.substring(0, 5)
      : undefined;
    const endDate = raw.endDate?.split('T')[0];

    const venue = raw.location?.name;
    const address =
      typeof raw.location?.address === 'string'
        ? raw.location.address
        : raw.location?.address?.streetAddress;

    // Fingerprint: name + date + venue (deduplicerar biljettshops egna dubletter
    // och undviker dubletter mot databasen)
    const fp = `${raw.name}|${date}|${venue || ''}`;
    if (seen.has(fp)) continue;
    seen.add(fp);

    const eventUrl = raw.url || url;
    const ticketUrl = raw.offers?.url;

    try {
      const evt = ParsedEventSchema.parse({
        title: raw.name,
        date,
        time,
        endDate,
        venue: venue || undefined,
        address: address || undefined,
        url: eventUrl,
        ticketUrl,
        description: raw.description || undefined,
        source,
        sourceUrl: url,
        confidence: {
          score: 0.95,
          hasTitle: true,
          hasDate: true,
          hasVenue: !!venue,
          hasUrl: !!eventUrl,
          hasDescription: !!raw.description,
          hasTicketInfo: !!ticketUrl,
          signals: ['biljettshop-jsonld'],
        },
      });
      events.push(evt);
    } catch { /* skip malformed */ }
  }

  if (events.length === 0) {
    return { showUrls: [], events: [], method: 'none' };
  }
  return { showUrls: [], events, method: 'biljettshop-jsonld' };
}