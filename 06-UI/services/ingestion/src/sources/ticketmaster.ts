import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { rawEventsQueue } from '../queue';
import { buildExpansionQueue } from '../discovery/expansionQueue';
import type { RawEventInput, VenueCandidate } from '@eventpulse/shared';

const API_KEY = process.env.TICKETMASTER_API_KEY!;
const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Maps Ticketmaster segment + genre to DB category slugs
 * Source of truth for category normalization
 */
const SEGMENT_TO_SLUG: Record<string, string> = {
  'music': 'music',
  'arts & theatre': 'art-exhibitions',
  'sports': 'sports',
  'miscellaneous': 'community',
};

const GENRE_TO_SLUG: Record<string, string> = {
  'rock': 'music',
  'pop': 'music',
  'jazz': 'music',
  'electronic': 'nightlife',
  'dance/electronic': 'nightlife',
  'hip-hop/rap': 'music',
  'folk': 'music',
  'latin': 'music',
  'comedy': 'theatre-comedy',
  'theatre': 'theatre-comedy',
  'food & drink': 'food-drink',
  'food': 'food-drink',
  'family': 'family',
  'fairs & festivals': 'community',
  'other': 'community',
  'martial arts': 'sports',
};

/**
 * Normalize Ticketmaster classification to DB category slug
 */
function normalizeCategory(segment: string, genre: string): string[] {
  const slugs: string[] = [];
  
  // Primary category from segment
  const segmentSlug = SEGMENT_TO_SLUG[segment.toLowerCase()];
  if (segmentSlug) {
    slugs.push(segmentSlug);
  }
  
  // Secondary from genre (if different)
  const genreSlug = GENRE_TO_SLUG[genre.toLowerCase()];
  if (genreSlug && !slugs.includes(genreSlug)) {
    slugs.push(genreSlug);
  }
  
  return slugs.length > 0 ? slugs : ['community'];
}

interface TicketmasterVenue {
  id?: string;
  name?: string;
  city?: { name?: string };
  address?: { line1?: string };
  location?: { latitude?: string; longitude?: string };
}

/**
 * Filter out ticket tier events (Platinum, VIP, Packages, Premium)
 * These are duplicate events that pollute the data
 */
function isValidEvent(event: any): boolean {
  const name = (event.name || "").toLowerCase()

  if (
    name.includes("platinum") ||
    name.includes("vip") ||
    name.includes("package") ||
    name.includes("premium")
  ) {
    return false
  }

  return true
}

/**
 * Check if a venue name is valid (not undefined, not generic)
 */
function isValidVenueName(name: string | null | undefined): boolean {
  if (!name) return false;
  
  const trimmed = name.trim();
  if (!trimmed) return false;
  
  // Reject the literal string "undefined" from Ticketmaster API
  if (trimmed === 'undefined' || trimmed === 'null' || trimmed === 'None') {
    return false;
  }
  
  // Reject other obvious non-venue strings
  if (trimmed.length < 2) return false;
  
  return true;
}

/**
 * Extract venue_name from Ticketmaster event with conservative fallback chain
 * Only fallback when there's clear evidence the alternative is a real venue
 */
function extractVenueName(event: any): string | null {
  const embedded = event._embedded;
  
  // Primary: first venue name from _embedded.venues
  const venue = embedded?.venues?.[0];
  if (venue) {
    const venueName = venue.name?.trim();
    
    // Validate that we got a real venue name, not "undefined"
    if (isValidVenueName(venueName)) {
      return venueName;
    }
    
    // If venue name is invalid but we have a venue ID, we could look it up
    // For now, return null to let normalizer handle it from raw_payload
    if (venue.id) {
      // Venue exists but name is corrupted - let normalizer extract from raw_payload
      return null;
    }
  }

  // NO promoter fallback - this creates false venues
  // Promoters like "Lugerinc AB" are companies, not venues

  // NO attractions fallback - attractions are artists, not venues

  // No fallback for city - too generic (e.g., "Stockholm" is not a venue)
  return null;
}

/**
 * Check if promoter is too generic to use as venue fallback
 */
function isGenericPromoter(name: string): boolean {
  const generic = [
    'ticketmaster', 'live nation', 'lnc', 'axs', 'eventim',
    'ticketek', 'ticket master', 'live nation entertainment'
  ];
  const lower = name.toLowerCase();
  return generic.some(g => lower.includes(g));
}

/**
 * Check if promoter is a club/event promoter (likely to be venue too)
 */
function isClubPromoter(name: string): boolean {
  const clubIndicators = ['club', 'bar', 'lounge', 'klubb', 'pub', 'venue'];
  const lower = name.toLowerCase();
  return clubIndicators.some(c => lower.includes(c));
}

/**
 * Check if a name looks like a venue rather than an artist/attraction
 */
function isLikelyVenueName(name: string): boolean {
  // Venue indicators
  const venueIndicators = [
    'arena', 'stadium', 'theater', 'theatre', 'hall', 'center', 'centre',
    'club', 'venue', 'bar', 'lounge', 'pub', 'restaurant', 'museum',
    'galler', 'konst', 'hallen', 'arenan', 'teatern', 'scenen'
  ];
  const lower = name.toLowerCase();
  
  // If it contains venue-like words, likely a venue
  if (venueIndicators.some(v => lower.includes(v))) return true;
  
  // Artist/band indicators - names that are clearly NOT venues
  const artistIndicators = [
    /\b(straße|straße|gade|gate|street|stræt)\b/i, // Street names
    /\bband\b/i, /\bartist\b/i, /\bsinger\b/i,
    /\bpresented by\b/i, /\bfeaturing\b/i,
  ];
  
  // If it looks like an artist name with featuring/presented by, NOT a venue
  if (artistIndicators.some(r => r.test(name))) return false;
  
  // Very short names are likely artist names (1-2 words, no venue keywords)
  const words = name.split(/\s+/);
  if (words.length <= 2 && !venueIndicators.some(v => lower.includes(v))) {
    return false;
  }
  
  // Default: be conservative and assume it's NOT a venue
  return false;
}

/**
 * Extract venue_address with fallback chain
 */
function extractVenueAddress(event: any): string | null {
  const venue = event._embedded?.venues?.[0];
  
  // Primary: line1
  const line1 = venue?.address?.line1?.trim();
  if (line1) return line1;

  // Secondary: line2
  const line2 = venue?.address?.line2?.trim();
  if (line2) return line2;

  return null;
}

interface VenueConnection {
  source: string;
  source_venue_id: string | null;
  source_venue_name: string;
  city: string | null;
  connected_entity_type: 'promoter' | 'attraction';
  connected_entity_name: string;
  linked_event_ids: string[];
}

async function saveVenueConnections(events: any[]): Promise<void> {
  console.log('[discovery] Starting venue connection extraction...');

  // Deduplicate by connection key, merging linked_event_ids
  const connectionMap = new Map<string, VenueConnection>();

  for (const ev of events) {
    const venue: TicketmasterVenue = ev._embedded?.venues?.[0];
    if (!venue?.name) continue;

    const venueName = venue.name;
    const venueId = venue.id || null;
    const city = venue.city?.name || null;

    // Extract promoter connection
    if (ev.promoter?.name) {
      const key = `promoter:${venueName}:${ev.promoter.name}`;
      if (connectionMap.has(key)) {
        const existing = connectionMap.get(key)!;
        if (!existing.linked_event_ids.includes(ev.id)) {
          existing.linked_event_ids.push(ev.id);
        }
      } else {
        connectionMap.set(key, {
          source: 'ticketmaster',
          source_venue_id: venueId,
          source_venue_name: venueName,
          city,
          connected_entity_type: 'promoter',
          connected_entity_name: ev.promoter.name,
          linked_event_ids: [ev.id],
        });
      }
    }

    // Extract attraction connections
    const attractions = ev._embedded?.attractions || [];
    for (const attraction of attractions) {
      if (attraction.name) {
        const key = `attraction:${venueName}:${attraction.name}`;
        if (connectionMap.has(key)) {
          const existing = connectionMap.get(key)!;
          if (!existing.linked_event_ids.includes(ev.id)) {
            existing.linked_event_ids.push(ev.id);
          }
        } else {
          connectionMap.set(key, {
            source: 'ticketmaster',
            source_venue_id: venueId,
            source_venue_name: venueName,
            city,
            connected_entity_type: 'attraction',
            connected_entity_name: attraction.name,
            linked_event_ids: [ev.id],
          });
        }
      }
    }
  }

  const connections = Array.from(connectionMap.values());

  if (connections.length === 0) {
    console.log('[discovery] No venue connections to save');
    return;
  }

  console.log(`[discovery] Prepared ${connections.length} unique connections for upsert`);

  const { error } = await supabase
    .from('discovery_venue_connections')
    .upsert(connections, {
      onConflict: 'source,source_venue_name,connected_entity_type,connected_entity_name',
    });

  if (error) {
    console.error('[discovery] ❌ Failed to save venue connections:', error.message);
    console.error('[discovery] Error details:', JSON.stringify(error));
  } else {
    console.log(`[discovery] ✅ Successfully saved ${connections.length} venue connections`);
  }
}

export async function scrapeTicketmaster(): Promise<string> {
  console.log('[ticketmaster] Starting scrape...');

  // Debug: log masked API key presence
  const url = `${BASE_URL}/events.json`;
  const params = {
    apikey: API_KEY,
    countryCode: 'SE',
    city: 'Stockholm',
    size: 200,
    sort: 'date,asc',
  };

  let data: any;
  try {
    const response = await axios.get(url, { params });
    data = response.data;
  } catch (err: any) {
    console.error('[ticketmaster] API call failed:', err.message);
    console.error('[ticketmaster] Response status:', err.response?.status);
    console.error('[ticketmaster] Response data:', err.response?.data);
    return 'failed';
  }

  const events = data._embedded?.events ?? [];
  console.log(`[ticketmaster] ${events.length} events found`);

  // Filter out ticket tier events (Platinum, VIP, Packages)
  const validEvents = events.filter(isValidEvent);
  console.log(`[ticketmaster] Filtered events: ${events.length} -> ${validEvents.length}`);

  let queued = 0;
  for (const ev of validEvents) {
    // Extract classification for category mapping
    const classification = ev.classifications?.[0] || {};
    const segment = classification.segment?.name || '';
    const genre = classification.genre?.name || '';
    
    const raw: RawEventInput = {
      title: ev.name,
      description: ev.info ?? null,
      start_time: ev.dates.start.dateTime ?? ev.dates.start.localDate,
      end_time: ev.dates.end?.dateTime ?? null,
      venue_name: extractVenueName(ev),
      venue_address: extractVenueAddress(ev),
      lat: ev._embedded?.venues?.[0]?.location?.latitude ? parseFloat(ev._embedded.venues[0].location.latitude) : null,
      lng: ev._embedded?.venues?.[0]?.location?.longitude ? parseFloat(ev._embedded.venues[0].location.longitude) : null,
      categories: normalizeCategory(segment, genre),
      is_free: ev.priceRanges?.[0]?.type === 'free',
      price_min_sek: ev.priceRanges?.[0]?.currency === 'SEK' ? Math.round(ev.priceRanges[0].min) : null,
      price_max_sek: ev.priceRanges?.[0]?.currency === 'SEK' ? Math.round(ev.priceRanges[0].max) : null,
      ticket_url: ev.url ?? null,
      image_url: ev.images?.[0]?.url ?? null,
      source: 'ticketmaster',
      source_id: ev.id,
      detected_language: null,
      raw_payload: ev as Record<string, unknown>,
    };

    await rawEventsQueue.add(`ticketmaster:${ev.id}`, raw);
    queued++;
  }

  console.log(`[ticketmaster] ✅ Queued ${queued} events`);

  // Extract and save venue candidates for multi-hop discovery
  await saveVenueCandidates(validEvents);

  return 'completed';
}

async function saveVenueCandidates(events: any[]): Promise<string> {
  console.log('[discovery] saveVenueCandidates called');
  console.log('[discovery] Starting venue candidate extraction...');

  // Build venue candidate map to deduplicate
  type ExtendedVenueCandidate = VenueCandidate & {
    quality_score?: number;
    updated_at?: string;
  };
  const venueMap = new Map<string, ExtendedVenueCandidate>();

  for (const ev of events) {
    const venue: TicketmasterVenue = ev._embedded?.venues?.[0];
    if (!venue?.name) continue;

    const venueKey = venue.id || venue.name;
    if (!venueKey) continue;

    let existing = venueMap.get(venueKey);
    if (!existing) {
      existing = {
        source: 'ticketmaster',
        source_id: venue.id || null,
        name: venue.name || 'Unknown Venue',
        city: venue.city?.name || null,
        address: venue.address?.line1 || null,
        lat: venue.location?.latitude ? parseFloat(venue.location.latitude) : null,
        lng: venue.location?.longitude ? parseFloat(venue.location.longitude) : null,
        promoters: [],
        attractions: [],
        linked_event_ids: [],
        quality_score: 50,
        updated_at: new Date().toISOString(),
      };
    }

    // Add promoter from event
    const promoterName = (ev as any).promoter?.name;
    if (promoterName && typeof promoterName === 'string' && !existing.promoters.includes(promoterName)) {
      existing.promoters.push(promoterName);
    }

    // Add attractions from event
    const attractions = (ev as any)._embedded?.attractions || [];
    for (const attraction of attractions) {
      const attName = attraction?.name;
      if (attName && typeof attName === 'string' && !existing.attractions.includes(attName)) {
        existing.attractions.push(attName);
      }
    }

    // Track linked event ID
    const eventId = ev?.id;
    if (eventId && typeof eventId === 'string' && !existing.linked_event_ids.includes(eventId)) {
      existing.linked_event_ids.push(eventId);
    }

    venueMap.set(venueKey, existing);
  }

  // Upsert all candidates
  const candidates = Array.from(venueMap.values());
  console.log(`[discovery] Prepared ${candidates.length} candidates for upsert`);

  if (candidates.length === 0) {
    console.log('[discovery] No venue candidates to save');
    return 'completed';
  }

  // Show first 3 candidates for debugging
  console.log('[discovery] First candidates:', candidates.slice(0, 3));

  const { error } = await supabase
    .from('discovery_venue_candidates')
    .upsert(candidates, {
      onConflict: 'source,name',
    });

  if (error) {
    console.error('[discovery] ❌ Failed to save venue candidates:', error.message);
    console.error('[discovery] Error details:', JSON.stringify(error));
  } else {
    console.log(`[discovery] ✅ Successfully saved ${candidates.length} venue candidates`);
  }

  // Save venue connections (promoters and attractions) for graph traversal
  await saveVenueConnections(events);

  // Build expansion queue from the discovery graph
  await buildExpansionQueue();
  
  return 'completed';
}
