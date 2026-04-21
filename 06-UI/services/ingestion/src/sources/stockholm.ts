/**
 * Stockholm Events Source
 * 
 * Fetches events from Stockholm-based venues using the fetch adapter.
 * Stockholm is always prioritized in the ingestion pipeline.
 * 
 * This source:
 * 1. Uses Cloudflare proxy if configured (for protected endpoints)
 * 2. Falls back to direct fetch
 * 3. Returns events in RawEventInput format
 */

import axios from 'axios';
import { rawEventsQueue } from '../queue';
import { fetchWithCf, isCloudflareConfigured } from '../fetch/cloudflareAdapter';
import type { RawEventInput } from '@eventpulse/shared';

// Configuration
const CITY_FILTER = 'stockholm';
const COUNTRY = 'SE';
const PRIORITY_CITY = 'Stockholm';

// Known Stockholm venues (initial seed list)
const STOCKHOLM_VENUES = [
  { name: 'Café Opera', slug: 'cafe-opera', url: 'https://www.cafeopera.net' },
  { name: 'Debaser', slug: 'debaser', url: 'https://debaser.se' },
  { name: 'Stora Teatern', slug: 'stora-teatern', url: 'https://storateatern.se' },
  { name: 'Gamla Stan', slug: 'gamla-stan', url: null },
  { name: 'Kungsträdgården', slug: 'kungstradgarden', url: null },
  { name: 'Medelhavsmuseet', slug: 'medelhavsmuseet', url: null },
  { name: 'Moderna Museet', slug: 'moderna-museet', url: 'https://www.modernamuseet.se' },
  { name: 'Fotografiska', slug: 'fotografiska', url: 'https://www.fotografiska.com' },
  { name: 'Kulturhuset Stadsteatern', slug: 'kulturhuset', url: 'https://www.kulturhuset.se' },
  { name: 'Scandic Grand Central', slug: 'scandic-grand-central', url: null },
  { name: 'Berns', slug: 'berns', url: 'https://www.berns.se' },
  { name: 'Café Opera', slug: 'cafe-opera', url: 'https://www.cafeopera.net' },
  { name: 'Folkoperan', slug: 'folkoperan', url: 'https://www.folkoperan.se' },
  { name: 'Oscarsteatern', slug: 'oscarsteatern', url: 'https://www.oscarsteatern.se' },
  { name: 'Stora Teatern', slug: 'stora-teatern', url: 'https://www.storateatern.se' },
];

// Deduplicate venues
const UNIQUE_VENUES = Array.from(
  new Map(STOCKHOLM_VENUES.map(v => [v.slug, v])).values()
);

/**
 * Main scraper function
 */
export async function scrapeStockholm(): Promise<string> {
  console.log(`[stockholm] Starting scrape with ${UNIQUE_VENUES.length} venues...`);
  
  let totalQueued = 0;
  
  // First, generate sample events for testing
  const sampleCount = await generateStockholmSamples();
  totalQueued += sampleCount;
  
  // Then try to fetch real events for each Stockholm venue
  for (const venue of UNIQUE_VENUES) {
    try {
      const count = await scrapeVenueEvents(venue);
      totalQueued += count;
    } catch (err) {
      console.error(`[stockholm] Failed to scrape ${venue.name}:`, (err as Error).message);
    }
  }
  
  console.log(`[stockholm] Total queued: ${totalQueued} events`);
  return 'completed';
}

/**
 * Scrape events for a single venue
 */
async function scrapeVenueEvents(venue: { name: string; slug: string; url: string | null }): Promise<number> {
  // For now, create placeholder events based on venue
  // In production, this would fetch from actual APIs or scrape websites
  
  if (!venue.url) {
    // No URL = no scrape, but create venue record
    await createVenueRecord(venue);
    return 0;
  }
  
  try {
    // Try to fetch via Cloudflare if configured
    const response = await fetchWithCf(venue.url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'EventPulse/1.0',
      },
    });
    
    if (!response.ok) {
      console.warn(`[stockholm] ${venue.name}: HTTP ${response.status}`);
      return 0;
    }
    
    // Parse response (would need venue-specific parsing)
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      const data = await response.json();
      // Process JSON response (venue-specific format)
      return processVenueJson(venue, data);
    }
    
    console.log(`[stockholm] ${venue.name}: No JSON endpoint at ${venue.url}`);
    return 0;
    
  } catch (err) {
    console.warn(`[stockholm] ${venue.name}: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * Process JSON response from venue
 */
function processVenueJson(venue: { name: string; slug: string; url: string | null }, data: any): number {
  // Placeholder - would need venue-specific parsing
  // For now, just log that we received data
  console.log(`[stockholm] ${venue.name}: Received data structure`);
  return 0;
}

/**
 * Create venue record in database for Stockholm venues
 */
async function createVenueRecord(venue: { name: string; slug: string }): Promise<void> {
  // This would insert into venues table
  // For now, just log
  console.log(`[stockholm] Would create venue: ${venue.name}`);
}

/**
 * Generate sample Stockholm events for testing
 * This creates mock events for venues without scraping capability
 */
export async function generateStockholmSamples(): Promise<number> {
  console.log('[stockholm] Generating sample events...');
  
  const sampleEvents: Partial<RawEventInput>[] = [
    {
      title: 'Konsert på Café Opera',
      description: 'Live-musik varje helg på Stockholms mest klassiska nattklubb.',
      start_time: getFutureDate(3),
      end_time: getFutureDate(3, 4),
      venue_name: 'Café Opera',
      venue_address: 'Kungsgatan 24, 111 35 Stockholm',
      city: 'Stockholm',
      lat: 59.3345,
      lng: 18.0680,
      source: 'stockholm',
      source_id: 'cafe-opera-sample-1',
      categories: ['nightlife'],
      ticket_url: 'https://www.cafeopera.net',
      is_free: false,
      price_min_sek: 150,
      detected_language: 'sv',
    },
    {
      title: 'Utställning på Fotografiska',
      description: 'Internationellt erkända fotografer och nya stjärnor.',
      start_time: getFutureDate(7),
      end_time: getFutureDate(7, 3),
      venue_name: 'Fotografiska',
      venue_address: 'Stadsgårdshamnen 22, 116 45 Stockholm',
      city: 'Stockholm',
      lat: 59.3197,
      lng: 18.0755,
      source: 'stockholm',
      source_id: 'fotografiska-sample-1',
      categories: ['art-exhibitions'],
      is_free: false,
      price_min_sek: 180,
      detected_language: 'sv',
    },
    {
      title: 'Stand-up på Stora Teatern',
      description: 'Svenska och internationella komiker.',
      start_time: getFutureDate(5),
      end_time: getFutureDate(5, 2),
      venue_name: 'Stora Teatern',
      venue_address: 'Östergatan 18, 111 43 Stockholm',
      city: 'Stockholm',
      lat: 59.3335,
      lng: 18.0705,
      source: 'stockholm',
      source_id: 'stora-teatern-sample-1',
      categories: ['theatre-comedy'],
      is_free: false,
      price_min_sek: 200,
      detected_language: 'sv',
    },
    {
      title: 'Jazz på Fasching',
      description: 'Live jazz varje torsdag med lokala och internationella artister.',
      start_time: getFutureDate(4),
      end_time: getFutureDate(4, 3),
      venue_name: 'Fasching',
      venue_address: 'Kungsgatan 63, 111 43 Stockholm',
      city: 'Stockholm',
      lat: 59.3355,
      lng: 18.0650,
      source: 'stockholm',
      source_id: 'fasching-sample-1',
      categories: ['music'],
      is_free: false,
      price_min_sek: 120,
      detected_language: 'sv',
    },
    {
      title: 'Kulturhuset Barn - Sagostund',
      description: 'Läsning för barn 3-6 år.',
      start_time: getFutureDate(6),
      end_time: getFutureDate(6, 1),
      venue_name: 'Kulturhuset Stadsteatern',
      venue_address: 'Sergels torg, 103 84 Stockholm',
      city: 'Stockholm',
      lat: 59.3345,
      lng: 18.0685,
      source: 'stockholm',
      source_id: 'kulturhuset-barn-1',
      categories: ['family'],
      is_free: true,
      detected_language: 'sv',
    },
  ];
  
  let queued = 0;
  for (const event of sampleEvents) {
    await rawEventsQueue.add(`stockholm:${event.source_id}`, event);
    queued++;
  }
  
  console.log(`[stockholm] Queued ${queued} sample events`);
  return queued;
}

/**
 * Get a future date
 */
function getFutureDate(daysAhead: number, hoursDuration = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(20, 0, 0, 0);
  if (hoursDuration > 0) {
    date.setHours(date.getHours() + hoursDuration);
  }
  return date.toISOString();
}
