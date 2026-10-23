/**
 * Network Event Extractor — Extract events from API responses
 * 
 * Designed for Tixly API format but extensible for other API patterns.
 * 
 * Usage:
 *   import { extractFromApi } from './networkEventExtractor';
 *   const events = extractFromApi(apiResponse, sourceId);
 */

import { fetchJson } from '../tools/fetchTools';
import { toUtcInstantFromString } from '../lib/stockholmTime';

// NOTE (batch B K5): the objects built in this file use the LEGACY
// network-event shape (id/startTime/price/lastModified), which does NOT
// match the canonical ParsedEvent schema (required date + confidence).
// Downstream, toRawEventInput() reads event.date/event.time — those were
// never set here, so every network-path event lost its date and was then
// dropped by the normalizer ("passerat datum/saknar datum"). Fixed
// 2026-10-23: toRawEventInput() now also accepts the legacy startTime /
// endTime fields, and this file guarantees startTime is a UTC ISO instant.
export interface LegacyNetworkEvent {
  id: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  url?: string;
  imageUrl?: string;
  venue?: string;
  category?: string;
  organizer?: string;
  price?: { min: number; max: number };
  status?: string;
  source: string;
  sourceUrl?: string;
  lastModified: string;
}

// ── Field resolution ─────────────────────────────────────────────────────────

/**
 * Plocka ut ren text ur ett fält som kan vara antingen en sträng eller ett
 * objekt med `rendered` (WordPress/CMS: `{ title: { rendered: "…" } }`).
 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const rendered = (value as { rendered?: unknown }).rendered;
    if (typeof rendered === 'string') return rendered;
  }
  return '';
}

/**
 * Fält som otvetydigt betyder "när händelsen sker".
 *
 * MEDvetet INTE `date` / `date_gmt`: på WordPress är det postens
 * publiceringsdatum, inte händelsedatumet. Att använda det vore att hitta
 * på ett datum — CLAUDE.md: "AI may not invent events, venues, dates".
 * Samma sak för `created` / `modified` / `published`.
 */
const START_FIELDS = [
  'startTime', 'startDate', 'StartDate', 'start_date', 'start_datetime',
  'eventDate', 'event_date', 'eventStart', 'beginDate', 'startsAt', 'starts_at',
] as const;

const END_FIELDS = [
  'endTime', 'EndTime', 'endDate', 'EndDate', 'end_date', 'endsAt', 'ends_at',
] as const;

/** Första användbara strängen bland `fields`. Epoch-millisekunder accepteras. */
function firstString(item: unknown, fields: readonly string[]): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;
  for (const field of fields) {
    const value = rec[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
  }
  return undefined;
}

/**
 * Bygg en LegacyNetworkEvent ur ett rått API-objekt, eller null om objektet
 * inte är en händelse.
 *
 * Null är korrekt svar för t.ex. ett API-index-dokument
 * (`{ name, description, url, routes, namespaces }`) — det är inte en
 * händelse, och det har inget datum. Före 2026-10-23 räknades sådana
 * dokument som "1 event", vilket gjorde att B-gatet loggade "✅ N events"
 * och markera källan som framgångsrik — medan databasen fick noll rader.
 */
function toLegacyEvent(item: unknown, sourceId: string, idx: number): LegacyNetworkEvent | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;

  const title = textOf(rec.name) || textOf(rec.title) || textOf(rec.Name) || textOf(rec.Title);
  if (!title || title === 'Untitled') return null;

  // `dates` är en array av datumobjekt (t.ex. [{ date: '2026-11-15' }]).
  // firstString() läser fält på ett OBJEKT — alltså måste första elementet
  // i arrayen skickas in, inte arrayen själv. (Bug: skickade vi arrayen
  // direkt fanns inget 'date'-fält på den, och händelsen föll bort.)
  const firstDate = Array.isArray(rec.dates) && rec.dates.length > 0 ? rec.dates[0] : undefined;
  const rawStart =
    firstString(rec, START_FIELDS) ??
    firstString(firstDate, ['date', 'start', 'startDate', 'startDateTime']);
  const startTime = rawStart ? toUtcInstantFromString(rawStart) : null;
  // Utan datum är det inte en händelse. Skipa inte ett.
  if (!startTime) return null;

  const rawEnd = firstString(rec, END_FIELDS);
  const endTime = rawEnd ? toUtcInstantFromString(rawEnd) : undefined;

  const description = textOf(rec.description) || textOf(rec.Description) || textOf(rec.content) || textOf(rec.excerpt);
  const minPrice = typeof rec.minPrice === 'number' ? rec.minPrice : undefined;
  const maxPrice = typeof rec.maxPrice === 'number' ? rec.maxPrice : undefined;
  const price =
    rec.price && typeof rec.price === 'object'
      ? { min: Number((rec.price as { min?: number }).min ?? 0), max: Number((rec.price as { max?: number }).max ?? 0) }
      : minPrice !== undefined || maxPrice !== undefined
        ? { min: minPrice ?? 0, max: maxPrice ?? 0 }
        : undefined;

  return {
    id: `${sourceId}-${rec.id ?? rec.EventId ?? idx}`,
    title,
    description,
    startTime,
    endTime,
    url: textOf(rec.url) || textOf(rec.link) || textOf(rec.Url) || textOf(rec.purchaseUrl) || textOf(rec.PurchaseUrl),
    imageUrl: textOf(rec.imageUrl) || textOf(rec.image) || textOf(rec.ImageUrl) || textOf(rec.EventImagePath),
    venue: textOf(rec.venue) || textOf(rec.Venue) || textOf(rec.location) || textOf(rec.Location),
    category: textOf(rec.category) || textOf(rec.Category) || textOf(rec.genre) || textOf(rec.Genre),
    organizer: textOf(rec.organizer) || textOf(rec.Organizer),
    price,
    status: textOf(rec.status) || 'available',
    source: sourceId,
    sourceUrl: '',
    lastModified: new Date().toISOString(),
  };
}

export interface NetworkExtractResult {
  events: LegacyNetworkEvent[];
  rawCount: number;
  parseErrors: string[];
  sourceUrl: string;
  apiUrl: string;
}

/**
 * Extract events from Tixly API response
 * Tixly returns: { Events: [...], Productions: [...] }
 * Each event has: Name, StartDate, EndDate, MinPrice, MaxPrice, PurchaseUrl, etc.
 */
function extractFromTixlyApi(data: any, sourceId: string): LegacyNetworkEvent[] {
  const events: LegacyNetworkEvent[] = [];
  
  // Tixly has both Events (individual performances) and Productions (grouped events)
  const tixlyEvents = data?.Events || [];
  const tixlyProductions = data?.Productions || [];
  
  // Process individual Events
  for (const event of tixlyEvents) {
    try {
      const parsed: LegacyNetworkEvent = {
        id: `${sourceId}-${event.EventId}`,
        title: event.Name || 'Untitled',
        description: event.Description || '',
        startTime: event.StartDate ? toUtcInstantFromString(event.StartDate) : undefined,
        endTime: event.EndDate ? toUtcInstantFromString(event.EndDate) : undefined,
        url: event.PurchaseUrl || event.PurchaseUrlEnglish || '',
        imageUrl: event.EventImagePath || '',
        venue: event.Venue || '',
        category: event.Category || event.Genre || '',
        organizer: event.Organizer || '',
        price: event.MinPrice !== undefined || event.MaxPrice !== undefined 
          ? { min: event.MinPrice, max: event.MaxPrice }
          : undefined,
        status: event.State?.SoldOut ? 'sold_out' : 
                event.State?.SaleStatusText === 'FewTickets' ? 'few_tickets' : 'available',
        source: sourceId,
        sourceUrl: '',
        lastModified: new Date().toISOString(),
      };
      
      // Only add if we have at least a title and start time
      if (parsed.title && parsed.startTime) {
        events.push(parsed);
      }
    } catch (err) {
      // Skip malformed events
    }
  }
  
  // Process Productions (grouped events with multiple dates)
  for (const production of tixlyProductions) {
    try {
      // Production has Dates array and other metadata
      const dates = production.Dates || [];
      const eventIds = production.EventIds || [];
      
      for (let i = 0; i < dates.length; i++) {
        const parsed: LegacyNetworkEvent = {
          id: `${sourceId}-prod-${production.EventGroupId}-${i}`,
          title: production.Name || 'Untitled',
          description: production.Description || production.SubTitle || '',
          startTime: dates[i] ? toUtcInstantFromString(dates[i]) : undefined,
          endTime: undefined, // Productions may not have end time
          url: production.PurchaseUrl || '',
          imageUrl: production.EventImagePath || production.FeaturedImagePath || '',
          venue: production.Venue || '',
          category: production.Category || production.Genre || '',
          organizer: production.Organizer || '',
          price: production.MinPrice !== undefined || production.MaxPrice !== undefined
            ? { min: production.MinPrice, max: production.MaxPrice }
            : undefined,
          status: production.EventStates?.[i]?.SoldOut ? 'sold_out' : 'available',
          source: sourceId,
          sourceUrl: '',
          lastModified: new Date().toISOString(),
        };
        
        if (parsed.title && parsed.startTime) {
          events.push(parsed);
        }
      }
    } catch (err) {
      // Skip malformed productions
    }
  }
  
  return events;
}

/**
 * Detect API format and extract events accordingly.
 *
 * Exporterad för tester: ren funktion utan nätverksanrop.
 */
export function extractEventsFromPayload(data: unknown, sourceId: string): LegacyNetworkEvent[] {
  // Tixly API: { Events: [...], Productions: [...] }
  if (data && typeof data === 'object' && ((data as Record<string, unknown>).Events || (data as Record<string, unknown>).Productions)) {
    return extractFromTixlyApi(data, sourceId);
  }

  // Direkt array av händelser
  if (Array.isArray(data)) {
    return data
      .map((item, idx) => toLegacyEvent(item, sourceId, idx))
      .filter((e): e is LegacyNetworkEvent => e !== null);
  }

  // Ett enskilt objekt — kan vara en händelse, eller (troligare) ett
  // API-index-dokument. toLegacyEvent avgör det: utan datum är det ingen
  // händelse.
  if (data && typeof data === 'object') {
    const single = toLegacyEvent(data, sourceId, 0);
    return single ? [single] : [];
  }

  return [];
}

/**
 * Fetch and extract events from an API endpoint
 */
export async function extractFromApi(
  apiUrl: string, 
  sourceId: string,
  options: { timeout?: number } = {}
): Promise<NetworkExtractResult> {
  const errors: string[] = [];
  
  try {
    const result = await fetchJson(apiUrl, { timeout: options.timeout || 15000 });
    
    if (!result.success || !result.data) {
      return {
        events: [],
        rawCount: 0,
        parseErrors: [`Failed to fetch API: ${result.error || 'Unknown error'}`],
        sourceUrl: sourceId,
        apiUrl,
      };
    }
    
    const events = extractEventsFromPayload(result.data, sourceId);
    
    return {
      events,
      rawCount: Array.isArray(result.data) ? result.data.length : 1,
      parseErrors: errors,
      sourceUrl: sourceId,
      apiUrl,
    };
  } catch (err: any) {
    return {
      events: [],
      rawCount: 0,
      parseErrors: [`Exception: ${err.message}`],
      sourceUrl: sourceId,
      apiUrl,
    };
  }
}
