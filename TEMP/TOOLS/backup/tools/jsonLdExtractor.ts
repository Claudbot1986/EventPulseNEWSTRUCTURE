/**
 * JSON-LD Event Extractor - Extract events from JSON-LD structured data
 * Used by: annexet, aviciiarena, berwaldhallen, fryshuset, slakthuset, sodrateatern, stockholmlive
 */

import * as cheerio from 'cheerio';

export interface JsonLdEvent {
  '@type'?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  url?: string;
  location?: {
    '@type'?: string;
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
    };
  };
  eventStatus?: string;
  eventAttendanceMode?: string;
  organizer?: {
    name?: string;
  };
  performer?: {
    name?: string;
  }[];
}

export interface ExtractedEvent {
  title: string;
  date: string;
  time: string;
  venue?: string;
  area?: string;
  address?: string;
  description?: string;
  url?: string;
  category?: string;
  source: string;
}

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
      } catch (e) {
        // Skip malformed JSON
      }
    });
  } catch (e) {
    console.error('[json-ld] Failed to parse HTML:', e);
  }
  
  return results;
}

/**
 * Extract events from JSON-LD ItemList structure
 * Example: annexet, aviciiarena, sodrateatern
 */
function extractFromItemList(data: any, source: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  
  if (data['@type'] === 'ItemList' && data.itemListElement) {
    for (const item of data.itemListElement) {
      if (item.item && item.item['@type'] === 'Event') {
        const event = mapJsonLdEvent(item.item, source);
        if (event) events.push(event);
      }
    }
  }
  
  return events;
}

/**
 * Extract events from @graph structure
 * Example: berwaldhallen, stockholmlive
 */
function extractFromGraph(data: any, source: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  
  if (data['@graph']) {
    for (const item of data['@graph']) {
      if (item['@type'] === 'Event') {
        const event = mapJsonLdEvent(item, source);
        if (event) events.push(event);
      }
    }
  }
  
  return events;
}

/**
 * Extract events from EventSeries subEvent structure
 * Example: berwaldhallen
 */
function extractFromEventSeries(data: any, source: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  
  if (data['@type'] === 'EventSeries' && data.subEvent) {
    for (const subEvent of data.subEvent) {
      if (subEvent['@type'] === 'Event') {
        const event = mapJsonLdEvent(subEvent, source);
        if (event) events.push(event);
      }
    }
  }
  
  return events;
}

/**
 * Extract events from direct Event array
 * Example: fryshuset, slakthuset
 */
function extractFromArray(data: any[], source: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  
  for (const item of data) {
    if (item['@type'] === 'Event') {
      const event = mapJsonLdEvent(item, source);
      if (event) events.push(event);
    }
  }
  
  return events;
}

/**
 * Map JSON-LD event to standardized format
 */
function mapJsonLdEvent(item: any, source: string): ExtractedEvent | null {
  if (!item.name) return null;
  
  const startDate = item.startDate || '';
  const date = startDate.split('T')[0] || '';
  const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) || '' : '';
  
  const venue = item.location?.name || '';
  const address = item.location?.address?.streetAddress || '';
  const area = item.location?.address?.addressLocality || 'Stockholm';
  
  return {
    title: item.name,
    date,
    time,
    venue,
    area,
    address,
    description: item.description || '',
    url: item.url || '',
    category: 'culture',
    source,
  };
}

/**
 * Main extraction function - extracts events from JSON-LD in HTML
 */
export function extractEventsFromHtml(html: string, source: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const jsonLdData = extractJsonLdScripts(html);
  
  for (const data of jsonLdData) {
    // Try different structures
    events.push(...extractFromItemList(data, source));
    events.push(...extractFromGraph(data, source));
    events.push(...extractFromEventSeries(data, source));
    
    // Handle arrays
    if (Array.isArray(data)) {
      events.push(...extractFromArray(data, source));
    } else if (data['@type'] === 'Event') {
      const event = mapJsonLdEvent(data, source);
      if (event) events.push(event);
    }
  }
  
  // Deduplicate by title+date
  const seen = new Set<string>();
  return events.filter(e => {
    const key = `${e.title}|${e.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Convert extracted event to RawEventInput format for queue
 */
export function toRawEventInput(
  event: ExtractedEvent,
  sourceName: string,
  sourceId?: string
): RawEventInput {
  return {
    source: sourceName,
    source_id: sourceId || generateEventId(sourceName, event.title, event.date),
    title: event.title,
    description: event.description || null,
    start_date: event.date,
    start_time: event.time || null,
    end_date: event.date,
    end_time: null,
    venue_name: event.venue || null,
    venue_city: event.area || 'Stockholm',
    venue_address: event.address || null,
    venue_lat: null,
    venue_lng: null,
    categories: event.category ? [event.category] : ['culture'],
    is_free: null,
    price_min_sek: null,
    price_max_sek: null,
    ticket_url: event.url || null,
    image_url: null,
    source: sourceName,
    detected_language: null,
    raw_payload: event as Record<string, unknown>,
  };
}

/**
 * Generate a deterministic event ID
 */
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

// Re-export RawEventInput type
import type { RawEventInput } from '@eventpulse/shared';
export type { RawEventInput };
