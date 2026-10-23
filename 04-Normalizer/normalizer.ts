import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import type { Job } from 'bullmq';
import type { RawEventInput, NormalizedEvent } from '@eventpulse/shared';
import { searchSyncQueue } from '../03-Queue/queue';
import { computeConfidenceV1 } from './confidence_v1';
import { evaluateTitle, checkBlockB } from './title-quality-gate';
// 2026-10-02 — Description routing-helper (5.2). Ren function: tar raw.description
// + venue.country och returnerar description_sv + description_en + audit-reason.
import { routeDescription, type VenueInfo } from './descriptionRouting';
// 2026-10-05 — T0201 description rights + fact-based summary.
// Tre nya moduler som bygger eventpulse_summary + license + retention från
// source-fälten och raw.description. Inga anrop till LLM i Fas 1.
import { resolveDescriptionLicense, type SourceLicenseRegistry } from './descriptionLicense';
import { buildEventpulseFacts, buildEventpulseSummary, type EventpulseFacts } from './eventpulseSummary';
import { shouldCaptureRawDescription, countFilledFacts } from './rawDescriptionRetention';
import { getDefaultCategorySlugForSource } from './sourceCategoryDefaults';
import { canonicalizeCategorySlug } from './categoryCanonicalize';
import { extractHeadliner, resolveArtist } from './artistResolver';
import { aiImageQueue, startAiImageWorker } from '../08-Agent/workers/aiImageWorker';
import { enqueueSideEffect } from './sideEffectQueue';
import { appendSkipLog } from '../08-Agent/utils/skipLog';
import { pickLibraryFallback, markEventWithLibraryFallback } from '../08-Agent/utils/imageLibrary';
// 2026-10-07 — P7 Editorial Engine. Opt-in via EDITORIAL_ENABLED=1.
import { maybeRunEditorial, type NormalizedEventForEditorial } from './editorial/normalizerIntegration';

// Starta AI-bild-worker i samma process (no-op om AI_IMAGE_PIPELINE_ENABLED=0).
startAiImageWorker();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Geo-coordinate prioritering (2026-10-02, geo-bug fix) ────────────────
// BUG A: tidigare sattes events.lat/lng enbart från raw.lat, vilket lämnade
// events med riktig venue-resolved koordinat på fallback 59.3293/18.0686 om
// raw-data saknade lat/lng. ~261 events var drabbade (35% av alla fallback-events).
//
// NYTT BETEENDE:
//   - Om venue.lat/lng är riktig geo (ej fallback) OCH raw.lat/lng är null/fallback:
//     använd venue.lat/lng.
//   - Annars använd raw.lat/lng (eller fallback som sistahandsalternativ).
//
// Stockholm Sergels torg fallback = 59.3293, 18.0686 (från migration
// 20261002-0001-venues-country.sql rad 20 — venue_resolve skapar nya venues
// med dessa koordinater om lat/lng saknas).
export const GEO_FALLBACK_LAT = 59.3293;
export const GEO_FALLBACK_LNG = 18.0686;
export const GEO_FALLBACK_EPSILON = 1e-6;

export function isGeoFallback(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return lat != null && lng != null
    && Math.abs(lat - GEO_FALLBACK_LAT) < GEO_FALLBACK_EPSILON
    && Math.abs(lng - GEO_FALLBACK_LNG) < GEO_FALLBACK_EPSILON;
}

/**
 * Välj bästa lat/lng för ett event utifrån raw + venue.
 *
 * Prioritet:
 *   1. raw.lat (om satt OCH inte fallback) — källan har riktig geo
 *   2. venue.lat (om satt OCH inte fallback) — venues resolvaste koordinat
 *   3. raw.lat (även om fallback, om venue är null) — bättre än inget
 *   4. fallback (59.3293/18.0686) — sista utväg
 *
 * @returns {[lat, lng]} alltid definierat (sista fallback är Sergels torg)
 */
export function chooseGeoCoords(
  rawLat: number | null | undefined,
  rawLng: number | null | undefined,
  venueLat: number | null | undefined,
  venueLng: number | null | undefined,
): { lat: number; lng: number } {
  const rawFallback = isGeoFallback(rawLat, rawLng);
  const venueFallback = isGeoFallback(venueLat, venueLng);

  // Raw har riktig geo (ej fallback) → använd raw (auktoritativ källa)
  if (rawLat != null && rawLng != null && !rawFallback) {
    return { lat: rawLat, lng: rawLng };
  }
  // Venue har riktig geo (ej fallback) → använd venue
  if (venueLat != null && venueLng != null && !venueFallback) {
    return { lat: venueLat, lng: venueLng };
  }
  // Raw finns (även om fallback) → använd raw
  if (rawLat != null && rawLng != null) {
    return { lat: rawLat, lng: rawLng };
  }
  // Venue finns (även om fallback) → använd venue
  if (venueLat != null && venueLng != null) {
    return { lat: venueLat, lng: venueLng };
  }
  // Sista utväg: Sergels torg
  return { lat: GEO_FALLBACK_LAT, lng: GEO_FALLBACK_LNG };
}

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
 * Text som är användbart som fältvärde.
 *
 * 2026-10-23 — avvisar bl.a. "undefined"/"null"/"None" och stringifierade
 * JS-objekt ("[object Object]"). De är artefakter, inte platsinformation.
 * Skyddet sitter vid PERSISTERINGSGRÄNSEN, inte bara i extraktorn: gamla
 * extraherade filer innehåller fortfarande artefakten, och varje gammal fil
 * skulle annars skriva skräp tillbaka till databasen.
 */
export function isUsableText(value: string | null | undefined): boolean {
  if (!value) return false;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === 'undefined' || trimmed === 'null' || trimmed === 'None') {
    return false;
  }
  if (/^\[object .+\]$/.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Check if venue name is valid (not "undefined", not empty)
 */
export function isValidVenueName(name: string | null | undefined): boolean {
  if (!isUsableText(name)) return false;
  const trimmed = name!.trim();
  // 2026-10-23 — Reject stringifierade JS-objekt ("[object Object]").
  // Mätt: venues-tabellen hade 156 events kopplade till en venue-rad som hette
  // "[object Object]" (adapter som lade ett objekt i venue_name). En venue-rad
  // med det namnet är inte ett ställe — den sprider bara skräp vidare.
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
  // 2026-10-23 — Samma validering som för raw_payload-fallbacken. Utan den
  // skapades venue-rader med namnet "undefined"/"[object Object]" direkt från
  // källans venue_name.
  let venueName = isValidVenueName(raw.venue_name) ? raw.venue_name.trim() : null;

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
      // 2026-10-23 — artefaktskydd: en venue-rad med address
      // '[object Object]' sprider skräp vidare till varje event som matchar
      // den raden. Mätt: 2 venue-rader bar artefakten.
      address: isUsableText(raw.venue_address) ? raw.venue_address.trim() : '',
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

  // Datumvakt (2026-09-15): gamla/odöpta events ska aldrig insertas.
  // Primärt filter finns i importToEventPulse.importSource; detta är
  // defense-in-depth om någon enqueue:ar direkt (t.ex. manuella verktyg).
  const startMs = raw.start_time ? Date.parse(raw.start_time) : NaN;
  if (!Number.isFinite(startMs) || startMs < Date.now()) {
    console.log(`[normalizer] skip "${raw.title}" (passerat datum/saknar datum: ${raw.start_time || 'tom'})`);
    return;
  }

  // Title quality gate (2026-09-27): reject events whose title is generic enough
  // to be useless (equals source name, placeholder text, date-only, etc.).
  // Defense-in-depth against adapter regressions — Folkoperan produced 106
  // events with title="Folkoperan" from a single bundle buyingflow URL.
  // See 04-Normalizer/title-quality-gate.ts for the rule set.
  const titleGate = evaluateTitle(raw.title, raw.source);
  if (!titleGate.ok) {
    console.log(`[normalizer] skip "${raw.title}" from ${raw.source} (title-gate: ${titleGate.reason})`);
    return;
  }

  // Bulk-pollution gate (Block B): if the same source has produced many events
  // with the same title in this worker process, suspect an adapter loop.
  // WARN at 10+, REJECT at 50+. Process-local state, resets on worker restart.
  const blockB = checkBlockB(raw.title, raw.source);
  if (blockB.rejected) {
    console.log(`[normalizer] skip "${raw.title}" from ${raw.source} (bulk-pollution: ${blockB.count}× same title this session)`);
    return;
  }

  const dedupHash = raw.source_id
    ? buildDedupHash(raw.source, raw.source_id)
    : buildDedupHash(raw.source, `${raw.title}::${raw.start_time}`);

  console.log(`[normalizer] Processing ${raw.source}:${raw.source_id ?? 'unknown'} "${raw.title}"`);

  // Cross-source dedup via ticket_url (2026-09-29). Rent additivt — ändrar
  // INTE dedup_hash-algoritmen (se repo-policy "Do not change dedup hash
  // algorithm"). Konsoliderar events där flera source-adapters skrapar
  // samma URL — t.ex. lulea-hf-2/downtown-2/globen-3/halmstad-konserthus-2
  // (alla biljettshop.se Chicago-musikal): 228 duplicerade rader → 57.
  let existing: { id: string; updated_at: string } | null = null;
  let existingViaTicketUrl = false;
  const ticketUrl = raw.url || raw.ticket_url || null;
  if (ticketUrl) {
    const { data: byUrl } = await supabase
      .from('events')
      .select('id, updated_at')
      .eq('ticket_url', ticketUrl)
      .limit(1)
      .maybeSingle();
    if (byUrl) {
      existing = byUrl;
      existingViaTicketUrl = true;
      console.log(`[normalizer] 🔗 Cross-source dedup hit by ticket_url: ${byUrl.id} (source=${raw.source}, url=${ticketUrl})`);
    }
  }

  // Check for existing event (primary dedup) — körs endast om ticket_url-
  // matchningen ovan inte gav träff. Beteendet är oförändrat jämfört med
  // tidigare; vi lägger bara till en extra chans att hitta en befintlig rad.
  if (!existing) {
    const { data: byHash } = await supabase
      .from('events')
      .select('id, updated_at')
      .eq('dedup_hash', dedupHash)
      .maybeSingle();
    if (byHash) existing = byHash;
  }

  if (existing) {
    console.log(`[normalizer] Updating existing event: ${existing.id}`);
  }

  const venue_id = await resolveVenue(raw);

  // 2026-10-02 — Hämta venue.country för description_sv-fallback (5.2 rule 3).
  // 2026-10-02 (geo-bug fix) — Hämta ÄVENÄVEN venue.lat/lng så vi kan propagera
  // venues koordinater till events om raw.lat är null/fallback. Innan fixen
  // (2026-10-02) sattes events.lat enbart från raw.lat, vilket lämnade
  // ~261 events med venue.name-match men lat=59.3293 fallback.
  let venueCountry: string | null = null;
  let venueLat: number | null = null;
  let venueLng: number | null = null;
  // 2026-10-23 — venue_full_* (namn/adress/stad) skrevs ALDRIG på events-raden
  // i BullMQ-vägen. Endast direkta insert-script (sthlmlist, kulturen) fyllde
  // dem, så allt som gick via queue'n (livespot, eventbrite, luma, jarfalla,
  // Confetti-*) visades UTAN plats i appen: HomeScreen läser venue_full_name
  // direkt från events-tabellen, inte via en join mot venues.
  // Mätt 2026-10-23: 464 events hade venue_id men venue_full_name = NULL.
  // Samma semantik som venue-rescue-batch.mjs: fyll bara det som saknas.
  let venueFullName: string | undefined;
  let venueFullAddress: string | undefined;
  let venueFullCity: string | undefined;
  if (venue_id) {
    const { data: venueRow } = await supabase
      .from('venues')
      .select('country, lat, lng, name, address, city')
      .eq('id', venue_id)
      .limit(1)
      .maybeSingle();
    venueCountry = venueRow?.country ?? null;
    venueLat = venueRow?.lat ?? null;
    venueLng = venueRow?.lng ?? null;
    // 2026-10-23 — både venue-radens namn och källans eget platsnamn kan vara
    // skräp. Mätt: 46 events (downtown-2, lulea-hf-2, globen-3) bar
    // venue_full_name = '[object Object]' — de fick det via källans eget
    // fält, eftersom extraktorn skrev venue: '[object Object]' (JSON-LD-objekt
    // utan .name). isValidVenueName är samma guard som används för att välja
    // venue-rad — här skyddar den denormaliserade kolumnen.
    venueFullName = (isValidVenueName(venueRow?.name) ? venueRow!.name!.trim() : undefined)
      || (isValidVenueName(raw.venue_name) ? raw.venue_name.trim() : undefined);
    // Adressen kommer från den kurade venue-raden när den har en. Saknar den
    // en (venue skapad från ett event utan adress) faller vi tillbaka på
    // eventets egen adress från källan — samma ordning som
    // backfill-venue-from-existing.mjs (venue först, källa sedan).
    //
    // 2026-10-23 — samma artefaktskydd som för namnet. Mätt: 116 events
    // (halmstad-konserthus-2, downtown-2, lulea-hf-2, globen-3) hade
    // venue_full_address = '[object Object]' — de kom från raw.venue_address
    // i extraherade filer som skrevs FÖRE extraktor-fixen. Skyddet måste
    // sitta vid persistensgränsen, annars skriver varje gammal fil skräp
    // tillbaka.
    venueFullAddress = (isUsableText(venueRow?.address) ? venueRow!.address!.trim() : undefined)
      || (isUsableText(raw.venue_address) ? raw.venue_address.trim() : undefined);
    venueFullCity = isUsableText(venueRow?.city) ? venueRow!.city!.trim() : undefined;
  } else {
    // Ingen venue-rad (t.ex. venues-inserten misslyckades) — eventets egen
    // platsnamn är ändå bättre än tomt för appen. Men bara om det är ett
    // giltigt namn: '[object Object]' är inte en plats.
    venueFullName = isValidVenueName(raw.venue_name) ? raw.venue_name.trim() : undefined;
    venueFullAddress = isUsableText(raw.venue_address) ? raw.venue_address.trim() : undefined;
  }

  // MusicBrainz + Last.fm authoritativ artist-uppslagning (2026-09-30).
  // Om vi lyckas slå upp artisen i MusicBrainz OCH Last.fm ger entydiga
  // taggar mot en kanonsk kategori → sätt den som category_slug.
  // Faller gracefully tillbaka till adapter-/source-default vid null.
  let mbResolvedCategory: string | null = null;
  let mbResolvedConfidence = 0;
  let mbArtistId: string | null = null;
  const headlinerInfo = extractHeadliner(raw.title ?? '');
  if (headlinerInfo.headliner && !headlinerInfo.extraction_hint) {
    try {
      const resolved = await resolveArtist(headlinerInfo.headliner, supabase);
      if (resolved?.high_confidence_category && resolved.category_slug) {
        mbResolvedCategory = resolved.category_slug;
        mbResolvedConfidence = resolved.confidence;
        mbArtistId = resolved.artist_id;
        console.log(
          `[normalizer] MB+Last.fm resolved: "${headlinerInfo.headliner}" → ${resolved.category_slug} ` +
          `(conf=${resolved.confidence}, artist_id=${resolved.artist_id})`,
        );
      }
    } catch (err) {
      // resolveArtist ska aldrig kasta, men defensivt: logga och fortsätt.
      console.warn(`[normalizer] resolveArtist misslyckades för "${headlinerInfo.headliner}": ${(err as Error).message}`);
    }
  }

  // Kulturhuset uses 'category' (singular), others use 'categories' (plural)
  const rawCategories = raw.categories ?? (raw.category ? [raw.category] : undefined);

  // Canonicalize (2026-09-29): mappar deprecated slugs ('culture',
  // 'art-exhibitions', 'theater', 'musikaler', 'art', 'design',
  // 'food-drink', 'barn', 'festivals') till sina Utforska-motsvarigheter.
  // Detta är ENDA punkten där vi kan garantera att ALLA events — oavsett
  // källa, adapter-regression eller LLM-batch-output — får en giltig
  // kategori innan de persistas. Adaptrar som redan emitterar korrekt
  // slug passerar genom oförändrat.
  const canonicalizeFirst = rawCategories?.[0] != null
    ? canonicalizeCategorySlug(rawCategories[0])
    : null;
  if (canonicalizeFirst?.changed) {
    console.log(
      `[normalizer] canonicalized: ${canonicalizeFirst.originalSlug} → ${canonicalizeFirst.slug} (source=${raw.source})`,
    );
  }
  const categories = canonicalizeFirst
    ? [canonicalizeFirst.slug]
    : rawCategories;
  let category_ids = await resolveCategoryIds(categories);

  // Get primary category slug (first category from the normalized list).
  // Prioritet (2026-09-30, MB+Last.fm = auktoritativ källa för musik):
  //   1. Adapter-emitterad kategori (categories[0])
  //   2. MusicBrainz + Last.fm resolved (mbResolvedCategory) — vinner över
  //      adapter för music events eftersom MB har auktoritativ artist-data.
  //   3. Source-default (2026-09-29) — kända single-purpose sources
  //      (Berwaldhallen, Debaser, biljettshop.se-Chicago-adapters, etc.)
  //   4. 'community' (fallback)
  const sourceDefaultSlug = getDefaultCategorySlugForSource(raw.source);
  const category_slug =
    categories?.[0]
    ?? mbResolvedCategory
    ?? sourceDefaultSlug
    ?? 'community';

  // Om source-default användes och INTE redan finns i category_ids: lägg
  // till motsvarande UUID i M:M-joinet så eventet exponeras korrekt i
  // UI-filter som läser event_categories (multi-label).
  if (
    sourceDefaultSlug
    && !categories?.includes(sourceDefaultSlug)
    && !category_ids.length
  ) {
    const sourceDefaultIds = await resolveCategoryIds([sourceDefaultSlug]);
    if (sourceDefaultIds.length > 0) {
      category_ids = [...category_ids, ...sourceDefaultIds];
      console.log(
        `[normalizer] source-default applied: ${raw.source} → ${sourceDefaultSlug} ` +
        `(category_id=${sourceDefaultIds[0]})`,
      );
    }
  }

  console.log(`[normalizer] venue_id=${venue_id ?? 'null'}, category_slug=${category_slug}`);

  // Geo prioritering (2026-10-02, geo-bug fix): om raw.lat/lng är null/fallback
  // men venue har riktig geo, använd venues koordinater. Se chooseGeoCoords().
  const { lat: resolvedLat, lng: resolvedLng } = chooseGeoCoords(
    raw.lat, raw.lng, venueLat, venueLng,
  );
  // Logga när vi propagerade venues koordinater (för observability + debugging).
  const venueUsed = isGeoFallback(raw.lat, raw.lng) === false
    && (raw.lat == null || isGeoFallback(raw.lat, raw.lng))
    && venueLat != null && !isGeoFallback(venueLat, venueLng);
  if (venueUsed) {
    console.log(
      `[normalizer] geo-propagated from venue (id=${venue_id?.slice(0,8)}...): ` +
      `raw=(${raw.lat ?? 'null'},${raw.lng ?? 'null'}) → venue=(${resolvedLat},${resolvedLng})`,
    );
  }

  // Description routing (2026-10-02, plan §5.2):
  //   rule 1: detected_language=sv → båda fält får från raw.description
  //   rule 2: title har å/ä/ö → description_sv speglas från raw.description
  //   rule 3 (NY): venue.country === 'SE' → description_sv speglas från
  //                raw.description (även om title saknar å/ä/ö)
  //
  // Tidigare (2026-09-29): bara rule 1+2. Detta fångade INTE engelsk-titlade
  // svenska events (t.ex. "Dexys Midnight Runners" på Göta Lejon) — title
  // saknar å/ä/ö, så rule 2 missade dem. ~3–5 %-enheter av description-gapet
  // beror på denna routing-bugg (Grupp C i planen).
  const venueInfo: VenueInfo = { country: venueCountry };
  const routedDescription = routeDescription({
    rawDescription: raw.description,
    detectedLanguage: raw.detected_language,
    title: raw.title,
    venue: venueInfo,
  });
  if (routedDescription.sv_rule !== 'none') {
    console.log(
      `[normalizer] description_sv routed via ${routedDescription.sv_rule} ` +
      `(venue.country=${venueCountry ?? 'none'}, source=${raw.source})`,
    );
  }

  // ─── T0201 (2026-10-05): Description rights + fact-based summary ─────────
  //
  // Bygger eventpulse_summary + eventpulse_summary_facts deterministiskt från
  // redan normaliserade fält + raw.description (regex-extraktion). Inga LLM-
  // anrop i Fas 1 (användarbeslut). Rättighetsstatus via source-registry med
  // default 'unknown'.
  //
  // raw_description fångas BARA om:
  //   - license är 'unknown' (vi vet inte om innehållet är säkert att visa)
  //   - ELLER deterministisk extraktion lämnade < 5 fyllda fält (reprocessing)
  //
  // Källa-registret laddas en gång per process; tom vid uppstart (override).
  const sourceLicense = resolveDescriptionLicense({
    source: raw.source,
    registry: process.env.EVENTPULSE_DESCRIPTION_LICENSE_REGISTRY
      ? JSON.parse(process.env.EVENTPULSE_DESCRIPTION_LICENSE_REGISTRY) as SourceLicenseRegistry
      : null,
  });

  // Plocka venue-namn för summary-input (om vi redan hämtat venue kan vi
  // hämta namnet; annars använd raw.venue_name om det finns).
  // city: EventPulse är Stockholm-first (MASTERPLAN §1) — default till
  // 'Stockholm' om inte annat är känt. raw har inte city; venues.resolver
  // kan returnera det men vi kör vidare utan för att hålla koden enkel.
  const venueNameForSummary = raw.venue_name ?? null;
  const cityForSummary = venueCountry === 'SE' ? 'Stockholm' : null;

  const { facts: epFacts, provenance: epProvenance } = buildEventpulseFacts({
    category_slug,
    venue_name: venueNameForSummary,
    city: cityForSummary,
    start_time: raw.start_time ?? null,
    end_time: raw.end_time ?? null,
    is_free: raw.is_free ?? null,
    price_min_sek: raw.price_min_sek ?? null,
    price_max_sek: raw.price_max_sek ?? null,
    title: raw.title ?? null,
    raw_description: raw.description ?? null,
    source: raw.source ?? null,
  });

  const eventpulseSummaryText = buildEventpulseSummary(epFacts);

  // Bestäm om raw_description ska lagras (capture-villkor enligt
  // rawDescriptionRetention.ts).
  const filledFactsCount = countFilledFacts(epFacts as unknown as Record<string, unknown>);
  const captureDecision = shouldCaptureRawDescription({
    license: sourceLicense.license,
    filledFactCount: filledFactsCount,
  });
  const rawDescriptionToStore = captureDecision.capture ? (raw.description ?? null) : null;
  const rawDescriptionCapturedAt = captureDecision.capture ? new Date().toISOString() : null;

  console.log(
    `[normalizer] T0201: license=${sourceLicense.license} ` +
    `(${sourceLicense.rule}), summary=${eventpulseSummaryText ? 'YES' : 'NO'}, ` +
    `facts=${filledFactsCount}/25, raw_desc=${captureDecision?.capture ? 'KEPT' : 'DISCARDED'} ` +
    `(${captureDecision.reason}) [event ${raw.title?.slice(0, 30) ?? 'untitled'}]`,
  );

  const observedAt = new Date().toISOString();

  const normalized: Partial<NormalizedEvent> & Record<string, unknown> = {
    title_en: raw.detected_language === 'en' ? raw.title : raw.title ?? null,
    title_sv: raw.detected_language === 'sv' ? raw.title : raw.title,
    description_en: routedDescription.description_en,
    description_sv: routedDescription.description_sv,
    start_time: raw.start_time,
    // Only set end_time if it's a valid ISO timestamp, not just "HH:MM"
    end_time: raw.end_time && raw.end_time.includes('T') ? raw.end_time : null,
    source: raw.source,
    source_id: raw.source_id,
    venue_id,
    // 2026-10-23 — Denormalisera venue-namn/adress/stad på event-raden.
    // HomeScreen läser venue_full_name direkt från events (ingen join mot
    // venues), så utan detta visades queue'-ingested events UTAN plats.
    // undefined = Supabase hoppar över fältet → en befintlig adress skrivs
    // aldrig över med null.
    venue_full_name: venueFullName,
    venue_full_address: venueFullAddress,
    venue_city: venueFullCity,
    // 2026-10-02 geo-bug fix: propagate venues.lat/lng → events.lat/lng.
    lat: resolvedLat,
    lng: resolvedLng,
    location: `POINT(${resolvedLng} ${resolvedLat})`,
    is_free: raw.is_free,
    price_min_sek: raw.price_min_sek,
    price_max_sek: raw.price_max_sek,
    ticket_url: raw.url || raw.ticket_url || null,
    // ── AI-bilder är obligatoriskt. Adapters sätter image_url=null.
    // autoGenServer/autoGen-batch skriver den slutliga URL:n efter AI-generering.
    // Direkt-uppsättning av image_url här skulle kringgå EU AI Act Art. 50-
    // stämplingen och AI-tracking-kolumnerna.
    image_url: null,
    dedup_hash: dedupHash,
    category_slug,  // Denormalized for direct filtering
    status: 'published',
    // status_expanded (sold_out / cancelled / not_yet_on_sale / etc.) flows
    // from adapter via RawEventInput. 'published' status above is the
    // soft-delete flag (defaults to published for new events).
    status_expanded: raw.status_expanded ?? null,
    raw_data: raw.raw_payload,
    // AI-bild-pipeline-markörer. Workern sätter dessa till 'completed' /
    // image_ai_generated=true efter generering. 'pending' = köad, workern
    // plockar upp via BullMQ-kön `ai-image-generation`.
    image_ai_generated: false,
    image_generation_status: 'pending',
    image_generation_attempts: 0,
    // ── T0201 (2026-10-05): Description rights + fact-based summary ─────
    //   - description_license: huruvida description_en/sv får exponeras publikt.
    //   - description_attribution/source_url: för visning i UI om license tillåter.
    //   - raw_description + captured_at: käll-text, 30-dagars retention.
    //   - eventpulse_summary: faktbaserad deterministisk sammanfattning (primär i UI).
    //   - eventpulse_summary_facts/provenance: extraherade fakta + spår.
    //   - eventpulse_summary_generated_at/model: audit.
    description_license: sourceLicense.license,
    description_attribution: sourceLicense.attribution,
    description_source_url: raw.url ?? null,
    raw_description: rawDescriptionToStore,
    raw_description_captured_at: rawDescriptionCapturedAt,
    eventpulse_summary: eventpulseSummaryText,
    eventpulse_summary_facts: epFacts as unknown as Record<string, unknown>,
    eventpulse_summary_provenance: epProvenance as unknown as Record<string, unknown>,
    eventpulse_summary_generated_at: eventpulseSummaryText ? observedAt : null,
    eventpulse_summary_model: 'deterministic-v1',
    // Agent Event Graph columns (MASTERPLAN §13). Seed on every parse so
    // ranking/freshness stay meaningful; confidence mirrors the SQL migration
    // 20260818-0002-confidence-v1.sql.
    freshness_at: observedAt,
    last_seen_at: observedAt,
    confidence_score: computeConfidenceV1({
      venue_id,
      start_time: raw.start_time,
      price_min_sek: raw.price_min_sek ?? null,
      price_max_sek: raw.price_max_sek ?? null,
      is_free: raw.is_free ?? null,
      // image_url är null vid insert — confidence får inte +10 för AI-bild
      // förrän bilden faktiskt är genererad och klar. Vi ger +10 retroaktivt
      // via re-rank i worker när status→completed.
      image_url: null,
      freshness_at: observedAt,
      source: raw.source,
    }),
  };

  let event_id: string;

  if (existing) {
    // 2026-10-23 — träffen via ticket_url kan peka på en rad som tillhör en
    // ANNAN source och därför har en annan dedup_hash. Skriver vi den här
    // källans hash på den raden krockar den med den rad som redan äger hashen:
    //   ERROR: duplicate key value violates unique constraint "events_dedup_hash_key"
    // Uppmätt 2026-10-23 på job 81079 (livespot "Biohack me") — varje sådan
    // träff kastade, så eventet uppdaterades aldrig. Ännu värre: även utan
    // kollision skulle radens identitet bytas ut, och ursprungskällan skulle
    // inte längre hitta den på hash.
    // På hash-vägen är dedupHash per definition redan radens egen — skriv
    // samma värde igen är en no-op — så beteendet där är oförändrat.
    const dedupHashToWrite = existingViaTicketUrl ? undefined : dedupHash;
    if (existingViaTicketUrl) {
      console.log(
        `[normalizer] keeping existing identity (cross-source hit — writing ` +
        `dedup_hash=${dedupHash.slice(0, 12)}…/source=${raw.source} would ` +
        `violate events_dedup_hash_key / idx_events_source_source_id_uniq)`,
      );
    }
    const { data: updated, error: updateError } = await supabase
      .from('events')
      .update({
        ...normalized,
        // Identitetskolumner tillhör raden, inte den här körningen. undefined
        // → Supabase hoppar över dem. Samma mönster som freshness_at nedan.
        dedup_hash: dedupHashToWrite,
        source: existingViaTicketUrl ? undefined : raw.source,
        source_id: existingViaTicketUrl ? undefined : raw.source_id,
        freshness_at: undefined, // keep prior freshness on update
        updated_at: observedAt,
      })
      .eq('id', existing.id)
      .select('id')
      .single();

    if (updateError || !updated) {
      // 2026-10-23 — kasta med DATABASENS egen orsak, inte bara event-uuid:t.
      // Kö-jobbets failedReason är det enda en operator ser när en natt drunknat;
      // "Update failed for event 4b8f8162..." säger ingenting om VARFÖR. Utan
      // detta var 500 failed jobb (mätt 15–20 okt) omöjliga att diagnosticera.
      console.error(`[normalizer] Failed to update event ${existing.id}:`, updateError?.message);
      throw new Error(
        `Update failed for event ${existing.id}: ${updateError?.message ?? 'no rows returned (update matched nothing)'}`,
      );
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
      throw new Error(`Insert failed for event (hash: ${dedupHash}): ${insertError?.message ?? 'no rows returned'}`);
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
  //
  // Eventet är REDAN persisterat i Supabase (rad 807-829) när vi når hit.
  // En felaktig sidoeffekt får därför INTE kasta — annars markeras jobbet
  // som failed och dashboard/gates rapporterar "0 events" fastän raden
  // finns i databasen. Mätt 2026-10-23: 26 jobb dog med "Connection is
  // closed." i den här raden, trots att alla 26 events fanns i databasen.
  await enqueueSideEffect('search_sync-köning', event_id, () =>
    searchSyncQueue.add('sync', { event_id, action: 'upsert' }),
  );

  // Enqueue AI-bild-generering (workern konsumerar asynkront).
  // Skippa om AI-pipelinen är avstängd (AI_IMAGE_PIPELINE_ENABLED=0) — då
  // förblir image_url NULL och UI visar fallback-placeholder.
  if ((process.env.AI_IMAGE_PIPELINE_ENABLED ?? '1') !== '0') {
    // Future-only guard (2026-08-27): matchar dashboardens totalFutureEvents
    // och agent-feeden. Past events syns aldrig i Utforska → waste att
    // generera. Events utan start_time saknar data för att avgöra — skippa
    // säkert + logga för data-quality-observability.
    const startTime = raw.start_time ?? (raw as { startTime?: string | null }).startTime ?? null;
    const isFuture = startTime !== null && new Date(startTime) > new Date();
    if (isFuture) {
      // Library-first check (2026-08-27): om biblioteket har en matchande
      // bild för denna kategori slipper vi BFL-anrop helt. Biblioteket växer
      // automatiskt vid varje BFL-success (se aiImageWorker.ts → addToLibrary).
      // Om biblioteket är tomt (tidig uppstart) fortsätter vi till AI-jobbet.
      const libMatch = await pickLibraryFallback({
        venue_id,
        venue_name: venueNameForSummary,
        category_slug,
        // 2026-10-14 — steg 4: skicka event_id + raw_description så
        // pickLibraryFallback kan använda v2-matchning (cluster_tags via M3).
        event_id,
        raw_description: raw.description ?? null,
      });
      if (libMatch.url && libMatch.library_id) {
        await markEventWithLibraryFallback(event_id, libMatch);
        console.log(
          `[normalizer] 📸📚 event ${event_id} använder biblioteks-bild ` +
            `(match_type=${libMatch.match_type}, library_id=${libMatch.library_id})`,
        );
      } else {
        // Samma princip som search_sync ovan: eventet är persisterat, så en
        // felaktig AI-bild-köning får inte markera jobbet som failed.
        const queued = await enqueueSideEffect('AI-bild-köning', event_id, () =>
          aiImageQueue.add(
            'generate',
            { event_id, enqueued_at: new Date().toISOString() },
            { jobId: `ai-img-${event_id}` }, // dedup-id så vi inte köar samma event flera gånger
          ),
        );
        if (queued) console.log(`[normalizer] 📸 AI-bild-jobb köat: ${event_id} (start=${startTime})`);
      }
    } else {
      const reason = startTime ? 'past' : 'missing_start_time';
      console.log(
        `[normalizer] 📸⏭ event ${event_id} ${reason} ` +
          `(start_time=${startTime ?? 'null'}), skipping AI queue`,
      );
      appendSkipLog('normalizer', {
        event_id,
        source: raw.source ?? null,
        start_time: startTime,
        skip_reason: reason,
      });
    }
  }

  // 2026-10-07 — P7 Editorial Engine (opt-in via EDITORIAL_ENABLED=1).
  // Kör efter event + bild-kö är på plats. Misslyckas tyst så eventet ändå
  // syns (UI faller tillbaka till eventpulse_summary om editorial saknas).
  await maybeRunEditorial({ supabase }, {
    event_id,
    title: raw.title,
    category_slug: (normalized.category_slug as string | null) ?? null,
    venue_name: venueNameForSummary,
    city: cityForSummary,
    start_time: raw.start_time ?? null,
    end_time: raw.end_time ?? null,
    price_min_sek: normalized.price_min_sek ?? null,
    is_free: normalized.is_free ?? null,
    language: (raw as { language?: string | null }).language ?? null,
    source: raw.source ?? null,
    raw_description: (raw as { description?: string | null }).description ?? null,
  });
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
