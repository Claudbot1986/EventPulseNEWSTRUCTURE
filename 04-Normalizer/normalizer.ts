import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import type { Job } from 'bullmq';
import type { RawEventInput, NormalizedEvent } from '@eventpulse/shared';
import { searchSyncQueue } from '../03-Queue/queue';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function buildDedupHash(source: string, sourceId: string): string {
  return createHash('sha256').update(`${source}::${sourceId}`).digest('hex');
}

/** Patterns that indicate a promoter/company name, NOT a venue */
const PROMOTER_COMPANY_PATTERNS = [
  // Company suffixes
  'inc', 'ab', 'ltd', 'llc', 'bv', 'gmbh', 'oy',
  // Major ticket platforms
  'live nation', 'lnc', 'ticketmaster', 'axs', 'eventim', 'ticketek',
  // Generic business types
  'promoter', 'booking', 'management', 'agency', 'productions',
  'entertainment', 'group', 'holdings', 'associates',
  // Generic event/promoter names that are not venues
  'stockholm live', 'wine vision', 'wine tasting', 'taste of',
  'concerts', 'events', 'festival', 'tour',
];

/** Words that indicate a REAL venue name (not promoter/artist) */
const VENUE_INDICATORS = [
  'arena', 'stadium', 'theater', 'theatre', 'hall', 'center', 'centre',
  'club', 'venue', 'bar', 'lounge', 'pub', 'restaurant', 'museum',
  'galler', 'konst', 'hallen', 'arenan', 'teatern', 'scenen',
  'krog', 'scen', 'hus', 'garden', 'plaza', 'square',
];

/** Very strong venue indicators - used for attractions fallback */
const STRONG_VENUE_INDICATORS = [
  'arena', 'theater', 'theatre', 'hall', 'centre', 'center',
  'museum', 'opera', 'concert', 'house', 'palace',
];

/**
 * Check if name looks like a promoter/company name (not a real venue)
 */
function isLikelyPromoterOrCompany(name: string): boolean {
  const lower = name.toLowerCase();
  return PROMOTER_COMPANY_PATTERNS.some(p => lower.includes(p));
}

/**
 * Check if name looks like a venue (has venue-like words)
 */
function hasVenueIndicators(name: string): boolean {
  const lower = name.toLowerCase();
  return VENUE_INDICATORS.some(v => lower.includes(v));
}

/**
 * Check if attraction name is likely a venue (stronger criteria)
 * Attractions are usually artists/performers, not venues
 */
function isLikelyAttractionAsVenue(name: string): boolean {
  const lower = name.toLowerCase();

  // Must have STRONG venue indicators
  if (!STRONG_VENUE_INDICATORS.some(v => lower.includes(v))) {
    return false;
  }

  // Must not look like a company
  if (isLikelyPromoterOrCompany(name)) {
    return false;
  }

  // Must be reasonably long (not just "Park" or "Hall")
  if (name.length < 8) {
    return false;
  }

  return true;
}

/**
 * Check if venue name is valid (not "undefined", not empty)
 */
function isValidVenueName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  // Reject literal "undefined" strings from Ticketmaster API
  if (trimmed === 'undefined' || trimmed === 'null' || trimmed === 'None') {
    return false;
  }
  return true;
}

/**
 * Try to extract venue_name from raw_payload as fallback
 * Conservative: only use alternatives if they clearly look like real venues
 */
function extractVenueFromRawPayload(raw: RawEventInput): string | null {
  const payload = raw.raw_payload;
  if (!payload) return null;

  const embedded = (payload as any)._embedded;
  const venue = embedded?.venues?.[0];

  // Primary: first venue name (only if valid)
  const venueName = venue?.name?.trim();
  if (isValidVenueName(venueName)) {
    return venueName;
  }

  // Secondary fallback: use address line1 when venue name is "undefined"
  // This is imperfect but better than null - allows matching by address later
  const addressLine = venue?.address?.line1?.trim();
  if (addressLine && addressLine.length > 3 && addressLine !== 'undefined') {
    return addressLine;
  }

  // NO promoter fallback - promoters are companies, not venues
  // NO attractions fallback - attractions are artists, not venues

  // NO city fallback - "Stockholm" is not a venue
  return null;
}

/**
 * Extract address from raw_payload venue data
 */
function extractVenueAddressFromPayload(raw: RawEventInput): string | null {
  const payload = raw.raw_payload;
  if (!payload) return null;

  const venue = (payload as any)?._embedded?.venues?.[0];
  if (!venue) return null;

  // Try line1 first
  const line1 = venue?.address?.line1?.trim();
  if (line1 && line1.length > 3 && line1 !== 'undefined') {
    return line1;
  }

  // Try line2 as fallback
  const line2 = venue?.address?.line2?.trim();
  if (line2 && line2.length > 3 && line2 !== 'undefined') {
    return line2;
  }

  return null;
}

/**
 * Check if venue name looks like an address (street name + number)
 * This indicates it came from address fallback, not real venue name
 */
function looksLikeAddress(name: string | null): boolean {
  if (!name) return false;

  // Common Stockholm street patterns
  const addressPatterns = [
    /^[A-ZÅÄÖ][a-zåäö]+(gatan|vägen|stranden|storget|plan|backen|torget|kvarteret|bryggan|kai)/i, // Swedish streets
    /\d+\s*$/,  // Ends with number (street number)
    /^\d+.*\d+$/, // Contains multiple numbers (address pattern)
  ];

  return addressPatterns.some(p => p.test(name));
}

/**
 * Try to match venue by address against existing venues in database
 * This helps when venue name is corrupted but address is valid
 */
async function findVenueByAddress(address: string): Promise<{ id: string; name: string } | null> {
  if (!address) return null;

  // Try exact-ish match (case insensitive)
  const { data: match } = await supabase
    .from('venues')
    .select('id, name, address')
    .ilike('address', address)
    .limit(1)
    .single();

  if (match) {
    return { id: match.id, name: match.name };
  }

  // Try partial match - address contains venue address
  const { data: partialMatches } = await supabase
    .from('venues')
    .select('id, name, address')
    .ilike('address', `%${address}%`)
    .limit(1)
    .single();

  if (partialMatches) {
    return { id: partialMatches.id, name: partialMatches.name };
  }

  return null;
}

/** Resolve venue_id from name + address, creating a new venue record if needed */
async function resolveVenue(raw: RawEventInput): Promise<string | null> {
  let venueName = raw.venue_name?.trim() || null;

  // Fallback: try to extract from raw_payload
  if (!venueName) {
    const fallbackName = extractVenueFromRawPayload(raw);
    if (fallbackName) {
      console.log(`[normalizer] Using fallback venue_name from raw_payload: "${fallbackName}"`);
      venueName = fallbackName;
    }
  }

  if (!venueName) {
    console.log(`[normalizer] No venue_name for event ${raw.source}:${raw.source_id ?? 'unknown'} "${raw.title}", skipping venue resolution`);
    return null;
  }

  // Normalize venue name: trim whitespace and collapse multiple spaces
  const normalizedName = venueName.replace(/\s+/g, ' ');

  // Try case-insensitive match by name first
  const { data: existing } = await supabase
    .from('venues')
    .select('id')
    .ilike('name', normalizedName)
    .limit(1)
    .single();

  if (existing) {
    console.log(`[normalizer] Venue matched by name: "${normalizedName}" -> ${existing.id}`);
    return existing.id;
  }

  // If name looks like an address, try address-based matching
  if (looksLikeAddress(normalizedName)) {
    const address = extractVenueAddressFromPayload(raw) || normalizedName;
    const addressMatch = await findVenueByAddress(address);

    if (addressMatch) {
      console.log(`[normalizer] Venue matched by address: "${normalizedName}" -> "${addressMatch.name}" (${addressMatch.id})`);
      return addressMatch.id;
    }

    // Try raw_payload address even if venueName didn't come from there
    const rawPayloadAddress = extractVenueAddressFromPayload(raw);
    if (rawPayloadAddress && rawPayloadAddress !== normalizedName) {
      const rawAddressMatch = await findVenueByAddress(rawPayloadAddress);
      if (rawAddressMatch) {
        console.log(`[normalizer] Venue matched by raw_payload address: "${normalizedName}" -> "${rawAddressMatch.name}" (${rawAddressMatch.id})`);
        return rawAddressMatch.id;
      }
    }
  }

  // Try to create new venue, but handle potential race condition
  console.log(`[normalizer] Creating new venue: "${normalizedName}"`);
  const { data: created, error: insertError } = await supabase
    .from('venues')
    .insert({
      name: normalizedName,
      address: raw.venue_address?.trim() ?? '',
      lat: raw.lat ?? 59.3293, // Default: Stockholm city center
      lng: raw.lng ?? 18.0686,
      location: raw.lat && raw.lng
        ? `POINT(${raw.lng} ${raw.lat})`
        : 'POINT(18.0686 59.3293)',
    })
    .select('id')
    .single();

  // Handle race condition: another worker might have created the same venue
  if (insertError) {
    if (insertError.code === '23505') { // PostgreSQL unique_violation
      console.log(`[normalizer] Venue already exists (race condition handled): "${normalizedName}"`);
      // Re-fetch the venue
      const { data: raceVenue } = await supabase
        .from('venues')
        .select('id')
        .ilike('name', normalizedName)
        .limit(1)
        .single();
      return raceVenue?.id ?? null;
    }
    console.error(`[normalizer] Failed to create venue: ${insertError.message}`);
    return null;
  }

  return created?.id ?? null;
}

/** Resolve category UUIDs from slugs */
async function resolveCategoryIds(slugs: string[] | undefined): Promise<string[]> {
  if (!slugs || slugs.length === 0) return [];
  const { data } = await supabase
    .from('categories')
    .select('id')
    .in('slug', slugs);
  return (data ?? []).map((c) => c.id);
}

export async function processRawEvent(job: Job<RawEventInput>): Promise<void> {
  const raw = job.data;
  const dedupHash = raw.source_id
    ? buildDedupHash(raw.source, raw.source_id)
    : buildDedupHash(raw.source, `${raw.title}::${raw.start_time}`);

  console.log(`[normalizer] Processing ${raw.source}:${raw.source_id ?? 'unknown'} "${raw.title}"`);

  // Check for existing event (primary dedup)
  const { data: existing } = await supabase
    .from('events')
    .select('id, updated_at')
    .eq('dedup_hash', dedupHash)
    .single();

  if (existing) {
    console.log(`[normalizer] Updating existing event: ${existing.id}`);
  }

  const venue_id = await resolveVenue(raw);

  // Kulturhuset uses 'category' (singular), others use 'categories' (plural)
  const categories = raw.categories ?? (raw.category ? [raw.category] : undefined);
  const category_ids = await resolveCategoryIds(categories);

  // Get primary category slug (first category from the normalized list)
  const category_slug = categories?.[0] ?? 'community';

  console.log(`[normalizer] venue_id=${venue_id ?? 'null'}, category_slug=${category_slug}`);

  const normalized: Partial<NormalizedEvent> & Record<string, unknown> = {
    title_en: raw.title,
    title_sv: raw.detected_language === 'sv' ? raw.title : null,
    description_en: raw.description ?? null,
    description_sv: raw.detected_language === 'sv' ? raw.description : null,
    start_time: raw.start_time,
    // Only set end_time if it's a valid ISO timestamp, not just "HH:MM"
    end_time: raw.end_time && raw.end_time.includes('T') ? raw.end_time : null,
    source: raw.source,
    source_id: raw.source_id,
    venue_id,
    lat: raw.lat ?? 59.3293,
    lng: raw.lng ?? 18.0686,
    location: `POINT(${raw.lng ?? 18.0686} ${raw.lat ?? 59.3293})`,
    is_free: raw.is_free,
    price_min_sek: raw.price_min_sek,
    price_max_sek: raw.price_max_sek,
    ticket_url: raw.url || raw.ticket_url || null,
    image_url: raw.image_url,
    dedup_hash: dedupHash,
    category_slug,  // Denormalized for direct filtering
    status: 'published',
    raw_data: raw.raw_payload,
  };

  let event_id: string;

  if (existing) {
    // Update existing event
    const { data: updated, error: updateError } = await supabase
      .from('events')
      .update({ ...normalized, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id')
      .single();

    if (updateError || !updated) {
      console.error(`[normalizer] Failed to update event ${existing.id}:`, updateError?.message);
      throw new Error(`Update failed for event ${existing.id}`);
    }
    event_id = updated.id;
    console.log(`[normalizer] ✅ Updated: event_id=${event_id}`);

    // Log update
    await logIngestion(raw.source, 'updated');
  } else {
    // Insert new event
    console.log(`[normalizer] Inserting new event (hash: ${dedupHash})...`);
    const { data: inserted, error: insertError } = await supabase
      .from('events')
      .insert(normalized)
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error(`[normalizer] Failed to insert event:`, insertError?.message);
      throw new Error(`Insert failed for event (hash: ${dedupHash})`);
    }
    event_id = inserted.id;
    console.log(`[normalizer] ✅ Inserted: event_id=${event_id}`);

    // Insert category links
    if (category_ids.length > 0) {
      await supabase.from('event_categories').insert(
        category_ids.map((cat_id) => ({ event_id, category_id: cat_id }))
      );
    }

    // Log insert
    await logIngestion(raw.source, 'inserted');
  }

  // Enqueue Meilisearch sync
  await searchSyncQueue.add('sync', { event_id, action: 'upsert' });
}

/** Log ingestion statistics per source */
async function logIngestion(source: string, action: 'inserted' | 'updated'): Promise<void> {
  try {
    await supabase.from('ingestion_logs').insert({
      source,
      action,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Non-critical - don't fail the job for logging errors
    console.warn(`[normalizer] Failed to log ingestion:`, (err as Error).message);
  }
}
