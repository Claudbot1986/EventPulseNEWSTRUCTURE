/**
 * MERGED Source Runner
 * Combines PROTOTYPE (TypeScript) and ENDTOEND (JavaScript) sources
 * PROTOTYPE: API-based sources with queue/pipeline integration
 * ENDTOEND: Scraping-based sources with HTML/JSON parsing
 */

import { scrapeTicketmaster } from './ticketmaster';
import { scrapeStockholm, generateStockholmSamples } from './stockholm';
import { scrapeEventbrite } from './eventbrite';
import { scrapeBilletto } from './billetto';
import { fetchKulturhusetEvents } from './kulturhuset';
import { fetchDebaserEvents } from './debaser';
import { fetchKulturhusetBarnUngEvents } from './kulturhusetBarnUng';
import { rawEventsQueue } from '../queue';
import type { RawEventInput } from '@eventpulse/shared';

export interface SourceResult {
  source: string;
  eventsQueued: number;
  eventsFound: number;
  errors: string[];
  status: 'success' | 'partial' | 'fail';
}

// Map ENDTOEND event format to RawEventInput
function mapToRawEventInput(event: any, source: string): RawEventInput {
  // Kulturhuset scraper provides start_time (full ISO timestamp) and time (HH:MM)
  // Other scrapers may only provide time. Prefer full timestamp when available.
  const fullTimestamp = event.start_time || `${event.date}T${event.time}`;
  
  return {
    source,
    source_id: event.id,
    title: event.title,
    description: event.description || '',
    start_date: event.date,
    start_time: fullTimestamp,  // Use full timestamp (ISO 8601), not just time
    end_date: event.date,
    end_time: event.time,
    venue_name: event.venue,
    venue_city: event.area || 'Stockholm',
    venue_address: event.address || '',
    venue_lat: event.lat || null,
    venue_lng: event.lng || null,
    category: event.category || 'culture',
    url: event.url || '',
    image_url: event.image_url || event.imageUrl || null,
    price_info: event.price_info || event.priceInfo || null,
    promoter: event.promoter || null,
    organizer: event.organizer || null,
    accessibility: event.accessibility || null,
    age_restriction: event.age_restriction || event.ageRestriction || null,
    tags: event.tags || [],
    raw_data: event,
  };
}

// Queue events from any source
async function queueEvents(events: any[], source: string): Promise<number> {
  let queued = 0;
  for (const event of events) {
    try {
      const rawEvent = mapToRawEventInput(event, source);
      // BullMQ job IDs cannot contain ':' - replace with '-'
      const safeJobId = `${source}-${event.id}`.replace(/:/g, '-');
      await rawEventsQueue.add('process-raw-event', rawEvent, {
        jobId: safeJobId,
      });
      queued++;
    } catch (err) {
      console.error(`[${source}] Failed to queue event ${event.id}:`, err);
    }
  }
  return queued;
}

// Run a single source
export async function runSource(
  name: string,
  fetchFn: () => Promise<any[]>,
  options?: { filterFn?: (e: any) => boolean }
): Promise<SourceResult> {
  console.log(`[sources] Running source: ${name}`);
  const result: SourceResult = {
    source: name,
    eventsQueued: 0,
    eventsFound: 0,
    errors: [],
    status: 'success',
  };

  try {
    const events = await fetchFn();
    result.eventsFound = events.length;
    
    const filtered = options?.filterFn 
      ? events.filter(options.filterFn) 
      : events;
    
    if (filtered.length < events.length) {
      console.log(`[${name}] Filtered ${events.length - filtered.length} events`);
    }
    
    result.eventsQueued = await queueEvents(filtered, name);
    
    if (result.eventsQueued === 0 && result.eventsFound > 0) {
      result.status = 'partial';
    }
  } catch (err: any) {
    result.errors.push(err.message || String(err));
    result.status = 'fail';
    console.error(`[${name}] Error:`, err);
  }

  return result;
}

// API-based sources from PROTOTYPE
export async function runPrototypeSources(): Promise<SourceResult[]> {
  const results: SourceResult[] = [];

  // Ticketmaster - PROTOTYPE version (proven to work)
  if (process.env.TICKETMASTER_API_KEY) {
    try {
      const events = await scrapeTicketmaster();
      const queued = await queueEvents(events, 'ticketmaster');
      results.push({
        source: 'ticketmaster',
        eventsQueued: queued,
        eventsFound: events.length,
        errors: [],
        status: queued > 0 ? 'success' : 'fail',
      });
    } catch (err: any) {
      results.push({
        source: 'ticketmaster',
        eventsQueued: 0,
        eventsFound: 0,
        errors: [err.message],
        status: 'fail',
      });
    }
  } else {
    console.log('[sources] Ticketmaster: API key not configured');
  }

  // Stockholm - PROTOTYPE version
  try {
    const events = await scrapeStockholm();
    const queued = await queueEvents(events, 'stockholm');
    results.push({
      source: 'stockholm',
      eventsQueued: queued,
      eventsFound: events.length,
      errors: [],
      status: queued > 0 ? 'success' : 'fail',
    });
  } catch (err: any) {
    results.push({
      source: 'stockholm',
      eventsQueued: 0,
      eventsFound: 0,
      errors: [err.message],
      status: 'fail',
    });
  }

  // Eventbrite
  if (process.env.EVENTBRITE_API_KEY) {
    try {
      const events = await scrapeEventbrite();
      const queued = await queueEvents(events, 'eventbrite');
      results.push({
        source: 'eventbrite',
        eventsQueued: queued,
        eventsFound: events.length,
        errors: [],
        status: queued > 0 ? 'success' : 'fail',
      });
    } catch (err: any) {
      results.push({
        source: 'eventbrite',
        eventsQueued: 0,
        eventsFound: 0,
        errors: [err.message],
        status: 'fail',
      });
    }
  }

  // Billetto
  if (process.env.BILLETTO_API_KEY) {
    try {
      const events = await scrapeBilletto();
      const queued = await queueEvents(events, 'billetto');
      results.push({
        source: 'billetto',
        eventsQueued: queued,
        eventsFound: events.length,
        errors: [],
        status: queued > 0 ? 'success' : 'fail',
      });
    } catch (err: any) {
      results.push({
        source: 'billetto',
        eventsQueued: 0,
        eventsFound: 0,
        errors: [err.message],
        status: 'fail',
      });
    }
  }

  return results;
}

// Scraping sources from ENDTOEND (mapped to queue format)
export async function runEndtoendSources(): Promise<SourceResult[]> {
  const results: SourceResult[] = [];

  // Kulturhuset - ENDTOEND version (Elasticsearch API)
  // Fetch ALL events using pagination (API returns ~1296 events)
  try {
    const events = await fetchKulturhusetEvents({ fetchAll: true });
    const queued = await queueEvents(events, 'kulturhuset');
    results.push({
      source: 'kulturhuset',
      eventsQueued: queued,
      eventsFound: events.length,
      errors: [],
      status: queued > 0 ? 'success' : 'fail',
    });
  } catch (err: any) {
    results.push({
      source: 'kulturhuset',
      eventsQueued: 0,
      eventsFound: 0,
      errors: [err.message],
      status: 'fail',
    });
  }

  // Debaser - ENDTOEND version
  try {
    const events = await fetchDebaserEvents({ limit: 50 });
    const queued = await queueEvents(events, 'debaser');
    results.push({
      source: 'debaser',
      eventsQueued: queued,
      eventsFound: events.length,
      errors: [],
      status: queued > 0 ? 'success' : 'fail',
    });
  } catch (err: any) {
    results.push({
      source: 'debaser',
      eventsQueued: 0,
      eventsFound: 0,
      errors: [err.message],
      status: 'fail',
    });
  }

  // Kulturhuset Barn & Ung - ENDTOEND version
  try {
    const events = await fetchKulturhusetBarnUngEvents({ limit: 50 });
    const queued = await queueEvents(events, 'kulturhuset-barn-ung');
    results.push({
      source: 'kulturhuset-barn-ung',
      eventsQueued: queued,
      eventsFound: events.length,
      errors: [],
      status: queued > 0 ? 'success' : 'fail',
    });
  } catch (err: any) {
    results.push({
      source: 'kulturhuset-barn-ung',
      eventsQueued: 0,
      eventsFound: 0,
      errors: [err.message],
      status: 'fail',
    });
  }

  return results;
}

// Run all sources
export async function runAllSources(): Promise<SourceResult[]> {
  const results: SourceResult[] = [];
  
  console.log('[sources] Running all MERGED sources...');
  
  // Run PROTOTYPE sources (API-based)
  const prototypeResults = await runPrototypeSources();
  results.push(...prototypeResults);
  
  // Run ENDTOEND sources (Scraping-based)
  const endtoendResults = await runEndtoendSources();
  results.push(...endtoendResults);
  
  return results;
}

// Run Kulturhuset source standalone (fetches all events via pagination)
export async function runKulturhusetSource(): Promise<SourceResult> {
  return runSource('kulturhuset', () => fetchKulturhusetEvents({ fetchAll: true }));
}
