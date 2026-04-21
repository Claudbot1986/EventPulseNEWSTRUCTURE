/**
 * Event Service Client for Expo/React Native
 * Fetches events from Supabase REST API directly
 * 
 * ARCHITECTURE:
 * - PRIMARY: Supabase REST API (direct, no backend server needed)
 * - MOBILE: Works from any network (cellular, LAN, WiFi)
 * 
 * IMPORTANT: Direct Supabase access enables true mobile/offline support.
 */

// Supabase Project Configuration
// Note: For production, configure RLS policies to allow public read access
// and use the anon key instead of service role key
const SUPABASE_URL = 'https://bsllkpvkowwndhhxtlln.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzbGxrcHZrb3d3bmRoaHh0bGxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMDQzNCwiZXhwIjoyMDg4ODc2NDM0fQ.2BJFgNoS0iP53WuPS_lyjNlHjy11_VLjKmcrhf5Dyis';

/**
 * Fetch events from Supabase REST API
 * This is the PRIMARY source for events in production
 * Works from mobile (cellular/WiFi) without needing local backend server
 */
export async function fetchFromSupabase() {
  try {
    // Supabase REST API endpoint for events table
    // Request specific columns to avoid column not found errors
    const url = `${SUPABASE_URL}/rest/v1/events?select=id,source,source_id,title_sv,title_en,start_time,end_time,venue_id,lat,lng,is_free,price_min_sek,price_max_sek,ticket_url,image_url,status,category_slug&status=eq.published&order=start_time.asc&limit=100`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
    });

    if (!response.ok) {
      const errorText = `HTTP ${response.status}: ${response.statusText}`;
      console.error('[EventService] Supabase fetch failed:', errorText);
      return {
        events: [],
        sources: [],
        metadata: {
          data_source: 'supabase',
          fallback_used: false,
          error: errorText
        }
      };
    }

    const events = await response.json();
    
    // Normalize events to match expected format
    const normalizedEvents = events.map(event => ({
      id: event.id,
      source: event.source,
      source_id: event.source_id,
      title: event.title_sv || event.title_en || 'Untitled',
      title_sv: event.title_sv,
      title_en: event.title_en,
      date: event.start_time ? event.start_time.split('T')[0] : null,
      start_time: event.start_time,
      end_time: event.end_time,
      venue_id: event.venue_id,
      lat: event.lat,
      lng: event.lng,
      is_free: event.is_free,
      price_min: event.price_min_sek,
      price_max: event.price_max_sek,
      ticket_url: event.ticket_url,
      image_url: event.image_url,
      url: event.ticket_url,
      status: event.status,
      category: event.category_slug
    }));
    
    // Extract unique sources
    const sourceCounts = {};
    normalizedEvents.forEach(event => {
      sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;
    });

    return {
      events: normalizedEvents,
      sources: Object.keys(sourceCounts),
      source_counts: sourceCounts,
      count: normalizedEvents.length,
      metadata: {
        data_source: 'supabase',
        fallback_used: false,
        available_sources: Object.keys(sourceCounts),
        total_count: normalizedEvents.length
      }
    };
  } catch (error) {
    console.error('[EventService] Supabase fetch failed:', error.message);
    return {
      events: [],
      sources: [],
      metadata: {
        data_source: 'supabase',
        fallback_used: false,
        error: error.message
      }
    };
  }
}

/**
 * Aliases for backward compatibility with existing app code
 */
export async function fetchEventsSupabaseOnly() {
  return fetchFromSupabase();
}

export async function fetchEventsWithFallback() {
  return fetchFromSupabase();
}

export async function fetchAllEventsViaServer() {
  return fetchFromSupabase();
}

// Export for use in App.js
export const fetchEvents = fetchFromSupabase;
export const fetchEventsFromSupabase = fetchFromSupabase;

// Export constants for debugging
export { SUPABASE_URL };
