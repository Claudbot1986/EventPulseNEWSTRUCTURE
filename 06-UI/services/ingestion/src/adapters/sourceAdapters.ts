/**
 * Source Adapters - Unified interface for different ingestion methods
 * Adapts various source types to the common ingestion pipeline
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { rawEventsQueue } from '../queue';
import type { RawEventInput } from '@eventpulse/shared';

// Import ENDTOEND sources (JavaScript files)
import * as friendsarenaModule from '../../sources/friendsarena.js';
import * as tele2arenaModule from '../../sources/tele2arena.js';
import * as berwaldhallenModule from '../../sources/berwaldhallen.js';
import * as fryshusetModule from '../../sources/fryshuset.js';
import * as slakthusetModule from '../../sources/slakthuset.js';
import * as malmoliveModule from '../../sources/malmolive.js';

export interface SourceConfig {
  name: string;
  method: 'wordpress' | 'json-ld' | 'api' | 'elasticsearch' | 'html';
  enabled: boolean;
}

export interface SourceResult {
  source: string;
  method: string;
  status: 'success' | 'partial' | 'fail' | 'skipped';
  eventsFound: number;
  eventsQueued: number;
  errors: string[];
  duration: number;
}

/**
 * WordPress REST API Fetcher
 * Sources: friendsarena, tele2arena
 */
export async function fetchWordPressSource(
  sourceName: string,
  apiUrl: string
): Promise<SourceResult> {
  const start = Date.now();
  const result: SourceResult = {
    source: sourceName,
    method: 'wordpress',
    status: 'skipped',
    eventsFound: 0,
    eventsQueued: 0,
    errors: [],
    duration: 0,
  };

  try {
    console.log(`[${sourceName}] Fetching WordPress API...`);
    const response = await axios.get(apiUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'EventPulse/1.0',
        'Accept': 'application/json',
      },
    });

    if (response.status !== 200) {
      result.errors.push(`HTTP ${response.status}`);
      result.status = 'fail';
      return result;
    }

    const events = Array.isArray(response.data) ? response.data : [];
    result.eventsFound = events.length;

    console.log(`[${sourceName}] Found ${events.length} events`);

    // Queue each event
    for (const ev of events) {
      try {
        const raw = mapWordPressEvent(ev, sourceName);
        if (raw) {
          await rawEventsQueue.add(`${sourceName}:${raw.source_id}`, raw);
          result.eventsQueued++;
        }
      } catch (e: any) {
        result.errors.push(`Queue error: ${e.message}`);
      }
    }

    result.status = result.eventsQueued > 0 ? 'success' : 'partial';
  } catch (err: any) {
    result.errors.push(err.message);
    result.status = 'fail';
  }

  result.duration = Date.now() - start;
  return result;
}

/**
 * Map WordPress event to RawEventInput
 */
function mapWordPressEvent(ev: any, source: string): RawEventInput | null {
  try {
    const title = ev.title?.rendered || ev.title || '';
    if (!title) return null;

    const eventDate = new Date(ev.date);
    const date = eventDate.toISOString().split('T')[0];
    const time = eventDate.toTimeString().substring(0, 5);

    const description = ev.excerpt?.rendered
      ? ev.excerpt.rendered.replace(/<[^>]*>/g, '').trim()
      : ev.content?.rendered
        ? ev.content.rendered.replace(/<[^>]*>/g, '').trim()
        : '';

    const venueName = getWordPressVenue(source);
    const area = source.includes('malmo') ? 'Malmö' : 'Stockholm';

    return {
      source,
      source_id: `${source}-${ev.id}`,
      title,
      description,
      start_date: date,
      start_time: time,
      end_date: date,
      end_time: null,
      venue_name: venueName,
      venue_city: area,
      venue_address: getVenueAddress(source),
      venue_lat: null,
      venue_lng: null,
      categories: inferCategory(source, title),
      is_free: null,
      price_min_sek: null,
      price_max_sek: null,
      ticket_url: ev.link || null,
      image_url: null,
      detected_language: 'sv',
      raw_payload: ev,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Get venue name for WordPress sources
 */
function getWordPressVenue(source: string): string {
  const venues: Record<string, string> = {
    'friendsarena': 'Friends Arena',
    'tele2arena': 'Tele2 Arena',
  };
  return venues[source] || source;
}

/**
 * Get venue address for WordPress sources
 */
function getVenueAddress(source: string): string {
  const addresses: Record<string, string> = {
    'friendsarena': 'Arena Road 1, 121 78 Johanneshov',
    'tele2arena': 'Globentorget 2, 121 77 Johanneshov',
  };
  return addresses[source] || '';
}

/**
 * Infer category from source and title
 */
function inferCategory(source: string, title: string): string[] {
  const lower = title.toLowerCase();
  
  if (lower.includes('konsert') || lower.includes('concert') || lower.includes('live')) {
    return ['music'];
  }
  if (lower.includes('fotboll') || lower.includes('football') || lower.includes('sport')) {
    return ['sports'];
  }
  if (lower.includes('teatr') || lower.includes('teater')) {
    return ['theatre'];
  }
  
  // Default based on venue
  if (source.includes('friends') || source.includes('tele2')) {
    return ['sports', 'music']; // Arenas have mixed events
  }
  
  return ['culture'];
}

/**
 * JSON-LD Event Fetcher
 * Sources: annexet, aviciiarena, berwaldhallen, fryshuset, slakthuset, sodrateatern, stockholmlive
 */
export async function fetchJsonLdSource(
  sourceName: string,
  pageUrl: string,
  venueName: string
): Promise<SourceResult> {
  const start = Date.now();
  const result: SourceResult = {
    source: sourceName,
    method: 'json-ld',
    status: 'skipped',
    eventsFound: 0,
    eventsQueued: 0,
    errors: [],
    duration: 0,
  };

  try {
    console.log(`[${sourceName}] Fetching JSON-LD page...`);
    const response = await axios.get(pageUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'EventPulse/1.0',
        'Accept': 'text/html,*/*',
      },
    });

    if (response.status !== 200) {
      result.errors.push(`HTTP ${response.status}`);
      result.status = 'fail';
      return result;
    }

    const html = response.data;
    const events = extractJsonLdEvents(html, sourceName, venueName);
    result.eventsFound = events.length;

    console.log(`[${sourceName}] Found ${events.length} events`);

    // Queue each event
    for (const ev of events) {
      try {
        const raw = mapJsonLdEvent(ev, sourceName);
        if (raw) {
          await rawEventsQueue.add(`${sourceName}:${raw.source_id}`, raw);
          result.eventsQueued++;
        }
      } catch (e: any) {
        result.errors.push(`Queue error: ${e.message}`);
      }
    }

    result.status = result.eventsQueued > 0 ? 'success' : 'partial';
  } catch (err: any) {
    result.errors.push(err.message);
    result.status = 'fail';
  }

  result.duration = Date.now() - start;
  return result;
}

/**
 * Extract events from JSON-LD in HTML
 */
function extractJsonLdEvents(html: string, source: string, defaultVenue: string): any[] {
  const events: any[] = [];

  try {
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (!content) return;
        
        const data = JSON.parse(content);

        // Handle ItemList structure
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          for (const item of data.itemListElement) {
            if (item.item?.['@type'] === 'Event') {
              events.push({
                ...item.item,
                _venue: defaultVenue,
              });
            }
          }
        }

        // Handle @graph structure
        if (data['@graph']) {
          for (const item of data['@graph']) {
            if (item['@type'] === 'Event') {
              events.push({ ...item, _venue: defaultVenue });
            }
          }
        }

        // Handle EventSeries
        if (data['@type'] === 'EventSeries' && data.subEvent) {
          for (const sub of data.subEvent) {
            if (sub['@type'] === 'Event') {
              events.push({ ...sub, _venue: defaultVenue });
            }
          }
        }

        // Handle direct Event
        if (data['@type'] === 'Event') {
          events.push({ ...data, _venue: defaultVenue });
        }

        // Handle array
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item['@type'] === 'Event') {
              events.push({ ...item, _venue: defaultVenue });
            }
          }
        }
      } catch (e) {
        // Skip malformed JSON
      }
    });
  } catch (e: any) {
    console.error(`[${source}] HTML parse error:`, e.message);
  }

  return events;
}

/**
 * Map JSON-LD event to RawEventInput
 */
function mapJsonLdEvent(ev: any, source: string): RawEventInput | null {
  try {
    const title = ev.name || '';
    if (!title) return null;

    const startDate = ev.startDate || '';
    const date = startDate.split('T')[0];
    const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) || '' : '';

    const venue = ev._venue || ev.location?.name || source;
    const address = ev.location?.address?.streetAddress || '';
    const area = ev.location?.address?.addressLocality || 'Stockholm';

    return {
      source,
      source_id: `${source}-${title.replace(/\s+/g, '-').substring(0, 30)}-${date}`,
      title,
      description: ev.description || '',
      start_date: date,
      start_time: time,
      end_date: date,
      end_time: null,
      venue_name: venue,
      venue_city: area,
      venue_address: address,
      venue_lat: ev.location?.geo?.latitude ? parseFloat(ev.location.geo.latitude) : null,
      venue_lng: ev.location?.geo?.longitude ? parseFloat(ev.location.geo.longitude) : null,
      categories: ['culture'],
      is_free: null,
      price_min_sek: null,
      price_max_sek: null,
      ticket_url: ev.url || null,
      image_url: null,
      detected_language: 'sv',
      raw_payload: ev,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Run all configured non-Ticketmaster sources
 */
export async function runAllSources(): Promise<SourceResult[]> {
  const results: SourceResult[] = [];

  // WordPress REST API sources
  results.push(await fetchWordPressSource(
    'friendsarena',
    'https://www.friendsarena.se/wp-json/wp/v2/events?per_page=50'
  ));

  results.push(await fetchWordPressSource(
    'tele2arena',
    'https://www.tele2arena.se/wp-json/wp/v2/events?per_page=50'
  ));

  // JSON-LD sources
  results.push(await fetchJsonLdSource(
    'annexet',
    'https://annexet.se/evenemang',
    'Annexet'
  ));

  results.push(await fetchJsonLdSource(
    'aviciiarena',
    'https://aviciiarena.se/evenemang',
    'Avicii Arena'
  ));

  results.push(await fetchJsonLdSource(
    'berwaldhallen',
    'https://www.berwaldhallen.se/kalender',
    'Berwaldhallen'
  ));

  results.push(await fetchJsonLdSource(
    'fryshuset',
    'https://fryshuset.se/evenemang',
    'Fryshuset'
  ));

  results.push(await fetchJsonLdSource(
    'slakthuset',
    'https://slakthusen.se',
    'Slakthuset'
  ));

  results.push(await fetchJsonLdSource(
    'sodrateatern',
    'https://sodrateatern.com/evenemang',
    'Södra Teatern'
  ));

  results.push(await fetchJsonLdSource(
    'stockholmlive',
    'https://stockholmlive.com/evenemang/',
    'Stockholm Live'
  ));

  return results;
}

/**
 * Print summary of all sources
 */
export function printSourceSummary(results: SourceResult[]): void {
  console.log('\n========== SOURCE SUMMARY ==========');
  console.log('Source          | Method     | Status   | Found | Queued | Time');
  console.log('---------------|------------|----------|-------|--------|-----');

  for (const r of results) {
    const status = r.status.padEnd(8);
    const method = r.method.padEnd(10);
    const name = r.source.padEnd(15);
    console.log(
      `${name} | ${method} | ${status} | ${String(r.eventsFound).padStart(5)} | ${String(r.eventsQueued).padStart(5)} | ${r.duration}ms`
    );
  }

  console.log('=====================================\n');

  const total = results.reduce(
    (acc, r) => ({
      found: acc.found + r.eventsFound,
      queued: acc.queued + r.eventsQueued,
    }),
    { found: 0, queued: 0 }
  );

  console.log(`Total: ${total.found} events found, ${total.queued} events queued`);
}
