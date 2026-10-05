#!/usr/bin/env node
/**
 * backfill-venue-geocode.mjs — Match events.venue_full_name → venues.name,
 * populate venue_id + venue_lat/venue_lng + events.lat/events.lng from venue.
 *
 * Bakgrund (2026-10-05):
 *   ~9 491 av 13 696 events saknar venue_id efter venue-fix. venue_full_name
 *   finns nu på events (satt av ingestion från source-payload), men events.lat
 *   och events.lng är null för källor som saknar geo (livespot, tribe-events,
 *   sitemap-discovery, etc.).
 *
 *   venues-tabellen har 1 427 venues med riktig lat/lng — vi slår upp koordinater
 *   genom att matcha events.venue_full_name mot venues.name (case-insensitive,
 *   whitespace-normaliserad, plus alias-trimning).
 *
 * Säkerhet:
 *   - DRY-RUN som default. Måste passera --commit för att skriva till DB.
 *   - Idempotent — kör flera gånger utan att duplicera.
 *   - Endast events som har venue_full_name satt OCH venue_lat null OCH venue_id null.
 *   - Trust venues-tabellen före allt annat (venues är curated av agent/discovery).
 *
 * Matchning (4 nivåer, fallande precision):
 *   1. Exact ilike (case-insensitive, trim, whitespace-collapsed)
 *   2. Normalized alias trim (t.ex. "Fasching Jazz Club" → "Fasching")
 *   3. Postgres unaccent + lower similarity (pg_trgm)
 *   4. Fallback: ingen match → skippa
 *
 * Användning:
 *   node scripts/backfill-venue-geocode.mjs --dry-run      # default, visar bara
 *   node scripts/backfill-venue-geocode.mjs --commit       # skriv till DB
 *   node scripts/backfill-venue-geocode.mjs --limit=500    # testa med 500 events
 *   node scripts/backfill-venue-geocode.mjs --source=livespot  # en källa
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const DRY_RUN = !process.argv.includes('--commit');
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const sourceArg = args.find((a) => a.startsWith('--source='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const SOURCE_FILTER = sourceArg ? sourceArg.split('=')[1] : null;

// In-memory venue cache för att slippa 1000-tals lookups per batch
const venueCache = new Map();

/** Normalize venue name för jämförelse: trim, lowercase, collapse whitespace, remove accents */
function normalizeName(name) {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ');
}

/** Trim common suffix-words från venue names ("Jazz Club", "Konserthus", etc.) */
function trimAliases(name) {
  if (!name) return '';
  const aliases = [
    'jazz club', 'jazzbar', 'jazz',
    'konserthus', 'concert hall', 'concert house',
    'live music venue', 'live', 'music venue',
    'baren', 'bar & nightclub', 'nightclub',
    'teatern', 'teater',
    'kyrkan', 'church',
    'museet', 'museum',
    'galleriet', 'gallery',
    'hotell', 'hotel',
  ];
  let trimmed = name.trim().toLowerCase();
  for (const alias of aliases) {
    if (trimmed.endsWith(' ' + alias)) {
      trimmed = trimmed.slice(0, -(alias.length + 1));
      break;
    }
  }
  return trimmed.trim();
}

/** Slå upp venue via 4-stegs strategi */
async function findVenueByName(name) {
  if (!name) return null;
  const cacheKey = normalizeName(name);
  if (venueCache.has(cacheKey)) return venueCache.get(cacheKey);

  // Steg 1: Exact ilike
  const { data: exact, error: exactErr } = await supabase
    .from('venues')
    .select('id, name, lat, lng, address, city')
    .ilike('name', name.trim())
    .limit(1)
    .maybeSingle();
  if (exact) {
    venueCache.set(cacheKey, exact);
    return exact;
  }

  // Steg 2: Trimmed alias
  const trimmed = trimAliases(name);
  if (trimmed && trimmed !== name.trim().toLowerCase()) {
    const { data: alias, error: aliasErr } = await supabase
      .from('venues')
      .select('id, name, lat, lng, address, city')
      .ilike('name', trimmed)
      .limit(1)
      .maybeSingle();
    if (alias) {
      venueCache.set(cacheKey, alias);
      return alias;
    }
  }

  // Steg 3: Contains-match (kortare venue-namn i längre source-namn)
  const norm = normalizeName(name);
  const { data: contains, error: containsErr } = await supabase
    .from('venues')
    .select('id, name, lat, lng, address, city')
    .ilike('name', `%${norm.split(' ')[0]}%`) // första ordet, mest specifikt
    .then(({ data }) => {
      // Filtrera på client side för att bara få med riktig contains
      return data?.filter(row => {
        const vNorm = normalizeName(row.name);
        return vNorm.includes(norm) || norm.includes(vNorm);
      })[0] ?? null;
    });
  if (contains) {
    venueCache.set(cacheKey, contains);
    return contains;
  }

  venueCache.set(cacheKey, null);
  return null;
}

async function main() {
  console.log(`=== Backfill venue geocode (${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}) ===`);
  console.log(`limit=${LIMIT === Infinity ? 'all' : LIMIT} source=${SOURCE_FILTER ?? 'all'}`);

  // 1. Hämta alla events som behöver backfill
  let query = supabase
    .from('events')
    .select('id, source, title_sv, title_en, venue_full_name, venue_full_address, venue_city, venue_lat, venue_lng, lat, lng, venue_id, raw_data')
    .not('venue_full_name', 'is', null)
    .is('venue_id', null)
    .is('venue_lat', null)
    .limit(LIMIT === Infinity ? 5000 : LIMIT);

  if (SOURCE_FILTER) query = query.eq('source', SOURCE_FILTER);

  const { data: events, error: eventsErr } = await query;
  if (eventsErr) {
    if (eventsErr.message?.includes('venue_full_name does not exist')) {
      console.error('\n❌ Migration 20261005-0001-events-venue-full-fields.sql har INTE körts på Supabase.');
      console.error('Kör den i Supabase Studio först, sedan kör detta script.\n');
    } else {
      console.error('Failed to fetch events:', eventsErr.message);
    }
    process.exit(1);
  }
  console.log(`\nEvents to process: ${events.length}`);

  if (events.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // 2. Loopa igenom, slå upp venue
  let matched = 0;
  let updated = 0;
  let noMatch = 0;
  const unmatchedNames = new Map(); // venue_full_name → count

  const updates = [];
  for (const ev of events) {
    const venue = await findVenueByName(ev.venue_full_name);
    if (!venue) {
      noMatch++;
      const key = ev.venue_full_name;
      unmatchedNames.set(key, (unmatchedNames.get(key) ?? 0) + 1);
      continue;
    }
    matched++;

    // Avgör om vi ska uppdatera events.lat/lng (null) och venue_id
    const patch = {
      venue_id: venue.id,
      venue_lat: venue.lat,
      venue_lng: venue.lng,
    };
    if (ev.lat == null) patch.lat = venue.lat;
    if (ev.lng == null) patch.lng = venue.lng;
    // location POINT om vi har lat/lng
    if (patch.lat != null && patch.lng != null) {
      patch.location = `POINT(${venue.lng} ${venue.lat})`;
    }
    // Backfill venue_full_address + venue_city om de saknas
    if (!ev.venue_full_address && venue.address) patch.venue_full_address = venue.address;
    if (!ev.venue_city && venue.city) patch.venue_city = venue.city;

    updates.push({ id: ev.id, source: ev.source, title: ev.title_sv ?? ev.title_en, patch });
  }

  // 3. Skriv/uppdatera (eller visa plan)
  console.log(`\nMatched: ${matched} / ${events.length}`);
  console.log(`No match: ${noMatch}`);

  if (unmatchedNames.size > 0) {
    const sorted = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log(`\nTop unmatched venue_full_name:`);
    for (const [name, count] of sorted) {
      console.log(`  ${count}× "${name}"`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n--- DRY-RUN: ${updates.length} would-be updates ---`);
    for (const u of updates.slice(0, 8)) {
      console.log(`  ${u.source}: "${u.title}" → venue_id=${u.patch.venue_id?.slice(0, 8)}... lat=${u.patch.lat} lng=${u.patch.lng}`);
    }
    if (updates.length > 8) console.log(`  ... +${updates.length - 8} more`);
    console.log(`\nUse --commit to actually update DB.`);
    return;
  }

  // 4. COMMIT — kör i batcher om 50
  console.log(`\nCommitting ${updates.length} updates...`);
  const BATCH = 50;
  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    // Kör individuella uppdateringar (PostgREST update tar en rad i taget via .eq)
    await Promise.all(batch.map(async (u) => {
      const { error } = await supabase
        .from('events')
        .update(u.patch)
        .eq('id', u.id);
      if (error) {
        failed++;
        console.error(`  ${u.source} "${u.title}": ${error.message}`);
      } else {
        succeeded++;
      }
    }));
    if ((i / BATCH) % 10 === 0) console.log(`  progress: ${i + batch.length}/${updates.length}`);
  }

  updated = succeeded;
  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
  console.log(`No match: ${noMatch}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});