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
// Use EXPO_PUBLIC_* values because Expo bundles client config. This must be
// a real anon key protected by public-read RLS, never a service-role key.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://bsllkpvkowwndhhxtlln.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const SOURCE_HOST_ALLOWLIST = {
  ticketmaster: ['ticketmaster.se', 'ticketmaster.com'],
  kulturhuset: ['kulturhusetstadsteatern.se', 'kulturhuset.se'],
  'malmo-live': ['malmolive.se'],
  eventbrite: ['eventbrite.com', 'eventbrite.se'],
  billetto: ['billetto.se', 'billetto.com'],
};

const TRUSTED_TICKETING_HOSTS = [
  'ticketmaster.se',
  'ticketmaster.com',
  'eventbrite.com',
  'eventbrite.se',
  'billetto.se',
  'billetto.com',
];

function isAllowedHost(hostname, allowedHosts) {
  return allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
}

function normalizeSourceKey(source) {
  if (!source || typeof source !== 'string') {
    return null;
  }

  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
      return parsed.name.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    }
  } catch {
    // Source is usually a plain provider key; JSON strings are a legacy edge case.
  }

  return trimmed.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function getAllowedHostsForSource(source) {
  const sourceKey = normalizeSourceKey(source);
  const compactSourceKey = sourceKey ? sourceKey.replace(/[^a-z0-9]/g, '') : null;
  const allowedHosts = new Set(TRUSTED_TICKETING_HOSTS);

  if (!sourceKey) {
    return Array.from(allowedHosts);
  }

  for (const [knownSource, hosts] of Object.entries(SOURCE_HOST_ALLOWLIST)) {
    const compactKnownSource = knownSource.replace(/[^a-z0-9]/g, '');
    if (
      sourceKey === knownSource ||
      sourceKey.startsWith(`${knownSource}-`) ||
      compactSourceKey === compactKnownSource ||
      compactSourceKey?.startsWith(compactKnownSource)
    ) {
      hosts.forEach(host => allowedHosts.add(host));
    }
  }

  return Array.from(allowedHosts);
}

function getHostLabel(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const hostname = new URL(url).hostname;
    if (isAllowedHost(hostname, ['ticketmaster.se', 'ticketmaster.com'])) {
      return 'Ticketmaster';
    }
    if (isAllowedHost(hostname, ['eventbrite.com', 'eventbrite.se'])) {
      return 'Eventbrite';
    }
    if (isAllowedHost(hostname, ['billetto.se', 'billetto.com'])) {
      return 'Billetto';
    }
  } catch {
    return null;
  }

  return null;
}

export function getExternalLinkLabel(source, url = null) {
  const hostLabel = getHostLabel(url);
  if (hostLabel === 'Ticketmaster') {
    return 'Köp biljett via Ticketmaster';
  }
  if (hostLabel === 'Eventbrite') {
    return 'Öppna via Eventbrite';
  }
  if (hostLabel === 'Billetto') {
    return 'Öppna via Billetto';
  }

  const sourceKey = normalizeSourceKey(source);
  const compactSourceKey = sourceKey ? sourceKey.replace(/[^a-z0-9]/g, '') : null;

  if (sourceKey === 'ticketmaster' || compactSourceKey === 'ticketmaster') {
    return 'Köp biljett via Ticketmaster';
  }
  if (sourceKey === 'eventbrite' || compactSourceKey === 'eventbrite') {
    return 'Öppna via Eventbrite';
  }
  if (sourceKey === 'billetto' || compactSourceKey === 'billetto') {
    return 'Öppna via Billetto';
  }
  if (sourceKey?.startsWith('kulturhuset') || compactSourceKey?.startsWith('kulturhuset')) {
    return 'Läs mer på Kulturhuset';
  }
  if (sourceKey === 'malmo-live' || compactSourceKey === 'malmolive') {
    return 'Läs mer på Malmö Live';
  }

  return 'Öppna extern eventsida';
}

function getExternalLinkChipLabel(source, url = null) {
  const hostLabel = getHostLabel(url);
  if (hostLabel) {
    return 'Biljett';
  }

  const sourceKey = normalizeSourceKey(source);
  const compactSourceKey = sourceKey ? sourceKey.replace(/[^a-z0-9]/g, '') : null;

  if (sourceKey?.startsWith('kulturhuset') || compactSourceKey?.startsWith('kulturhuset')) {
    return 'Extern länk';
  }
  if (sourceKey === 'malmo-live' || compactSourceKey === 'malmolive') {
    return 'Extern länk';
  }

  return 'Extern länk';
}

export function validateExternalUrl(url, source) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return null;
    }

    const allowedHosts = getAllowedHostsForSource(source);
    if (!isAllowedHost(parsed.hostname, allowedHosts)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateImageUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function extractTime(startTime) {
  if (!startTime || typeof startTime !== 'string') {
    return null;
  }

  const timePart = startTime.split('T')[1];
  if (!timePart) {
    return null;
  }

  return timePart.slice(0, 5);
}

export function normalizeSupabaseEvent(event) {
  const date = event.start_time ? event.start_time.split('T')[0] : null;
  const time = extractTime(event.start_time);
  const relatedVenue = Array.isArray(event.venues) ? event.venues[0] : event.venues;
  const venueName = event.venue_name || event.venue || relatedVenue?.name || null;
  const venueAddress = event.venue_address || event.address || relatedVenue?.address || null;
  const city = event.city || event.area || null;
  const category = event.category_slug || event.category || 'unknown';
  const ticketUrl = validateExternalUrl(event.ticket_url || event.url || null, event.source);
  const imageUrl = validateImageUrl(event.image_url || event.imageUrl || null);
  const hasExternalLink = Boolean(ticketUrl);
  const priceMin = event.price_min_sek ?? event.price_min ?? null;
  const priceMax = event.price_max_sek ?? event.price_max ?? null;

  return {
    id: event.id,
    source: event.source,
    source_id: event.source_id,
    title: event.title_sv || event.title_en || event.title || 'Titel saknas',
    title_sv: event.title_sv,
    title_en: event.title_en,
    date,
    time,
    start_time: event.start_time,
    end_time: event.end_time,
    venue_id: event.venue_id,
    venue: venueName,
    venue_name: venueName,
    address: venueAddress,
    venue_address: venueAddress,
    area: city,
    city,
    description: event.description_sv || event.description_en || event.description || null,
    description_sv: event.description_sv,
    description_en: event.description_en,
    lat: event.lat,
    lng: event.lng,
    is_free: event.is_free,
    isFree: event.is_free,
    price_min: priceMin,
    price_max: priceMax,
    priceMin,
    priceMax,
    ticket_url: ticketUrl,
    hasExternalLink,
    externalLinkLabel: hasExternalLink ? getExternalLinkLabel(event.source, ticketUrl) : null,
    externalLinkChipLabel: hasExternalLink ? getExternalLinkChipLabel(event.source, ticketUrl) : null,
    image_url: imageUrl,
    imageUrl,
    url: ticketUrl,
    status: event.status,
    category,
    category_slug: category,
  };
}

/**
 * Fetch events from Supabase REST API
 * This is the PRIMARY source for events in production
 * Works from mobile (cellular/WiFi) without needing local backend server
 */
export async function fetchFromSupabase() {
  try {
    if (!SUPABASE_ANON_KEY) {
      throw new Error('Event service is not configured.');
    }

    // Supabase REST API endpoint for events table
    // Request specific columns to avoid column not found errors
    const url = `${SUPABASE_URL}/rest/v1/events?select=id,source,source_id,title_sv,title_en,description_sv,description_en,start_time,end_time,venue_id,lat,lng,is_free,price_min_sek,price_max_sek,ticket_url,image_url,status,category_slug,venues(name,address)&status=eq.published&order=start_time.asc&limit=100`;
    
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
      throw new Error(errorText);
    }

    const events = await response.json();
    
    // Normalize events to match the renderable consumer UI contract.
    const normalizedEvents = events.map(normalizeSupabaseEvent);
    
    // Extract unique sources
    const sourceCounts = {};
    normalizedEvents.forEach(event => {
      sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;
    });
    const eventsWithExternalLink = normalizedEvents.filter(event => event.hasExternalLink).length;

    return {
      events: normalizedEvents,
      sources: Object.keys(sourceCounts),
      source_counts: sourceCounts,
      count: normalizedEvents.length,
      metadata: {
        data_source: 'supabase',
        fallback_used: false,
        available_sources: Object.keys(sourceCounts),
        total_count: normalizedEvents.length,
        events_with_external_link: eventsWithExternalLink,
        events_missing_external_link: normalizedEvents.length - eventsWithExternalLink
      }
    };
  } catch (error) {
    console.error('[EventService] Supabase fetch failed:', error.message);
    throw error;
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
