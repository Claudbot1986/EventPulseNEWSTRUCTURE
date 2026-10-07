#!/usr/bin/env node
/**
 * backfill-venue-from-existing.mjs — Befolka venue_full_* från två källor:
 *
 * Pass 1: events.venue_id IS NOT NULL → kopiera från venues-tabellen
 *         (venues.name, venues.address, venues.city, venues.lat, venues.lng)
 * Pass 2: events.venue_id IS NULL → extrahera från events.raw_data JSON
 *         (raw_data->>'venue', raw_data->>'address', raw_data->>'city')
 *
 * Säkerhet:
 *   - DRY-RUN som default. Måste passera --commit för att skriva.
 *   - WHERE-guards säkrar idempotens — kör flera gånger utan problem.
 *   - Bara events där venue_full_name fortfarande är NULL uppdateras.
 *
 * Användning:
 *   node scripts/backfill-venue-from-existing.mjs --dry-run
 *   node scripts/backfill-venue-from-existing.mjs --commit
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const DRY_RUN = !process.argv.includes('--commit');

async function main() {
  console.log(`=== Backfill venue from existing (${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}) ===`);

  // ─── PASS 1: från venues-tabellen (curated, högsta kvalitet) ─────────────
  console.log('\n─── PASS 1: venue_id IS NOT NULL → venues(name, address, city, lat, lng) ───');

  // Paginerad hämtning (PostgREST .range())
  const PAGE = 1000;
  let allWithVenueId = [];
  let offset1 = 0;
  while (true) {
    const { data: chunk, error: err } = await supabase
      .from('events')
      .select('id, venue_id, venue_full_name, venue_full_address, venue_city, venue_lat, venue_lng, lat, lng')
      .not('venue_id', 'is', null)
      .is('venue_full_name', null)
      .range(offset1, offset1 + PAGE - 1);
    if (err) { console.error('PASS 1 fetch failed:', err.message); process.exit(1); }
    if (!chunk || chunk.length === 0) break;
    allWithVenueId = allWithVenueId.concat(chunk);
    if (chunk.length < PAGE) break;
    offset1 += PAGE;
  }
  const withVenueId = allWithVenueId;
  console.log(`  events with venue_id but missing venue_full_name: ${withVenueId.length}`);

  if (withVenueId.length > 0) {
    // Hämta venue-data för alla unika venue_ids (batch 200)
    const venueIds = [...new Set(withVenueId.map(e => e.venue_id).filter(Boolean))];
    let venues = [];
    for (let i = 0; i < venueIds.length; i += 200) {
      const { data: vrows, error: vErr } = await supabase
        .from('venues')
        .select('id, name, address, city, lat, lng')
        .in('id', venueIds.slice(i, i + 200));
      if (vErr) { console.error('PASS 1 venue fetch failed:', vErr.message); process.exit(1); }
      venues = venues.concat(vrows ?? []);
    }
    const venueMap = new Map(venues.map(v => [v.id, v]));

    let pass1Updates = 0;
    for (const ev of withVenueId) {
      const v = venueMap.get(ev.venue_id);
      if (!v) continue;
      const patch = {
        venue_full_name: v.name,
        venue_full_address: ev.venue_full_address ?? v.address ?? null,
        venue_city: ev.venue_city ?? v.city ?? null,
        venue_lat: ev.venue_lat ?? v.lat ?? null,
        venue_lng: ev.venue_lng ?? v.lng ?? null,
      };
      if (ev.lat == null && v.lat != null) patch.lat = v.lat;
      if (ev.lng == null && v.lng != null) patch.lng = v.lng;
      if (patch.lat != null && patch.lng != null) {
        patch.location = `POINT(${v.lng} ${v.lat})`;
      }

      if (DRY_RUN) {
        if (pass1Updates < 3) console.log(`  [sample] event=${ev.id.slice(0,8)} venue="${v.name}" lat=${v.lat}`);
        pass1Updates++;
      } else {
        const { error } = await supabase.from('events').update(patch).eq('id', ev.id);
        if (error) console.error(`  update ${ev.id}: ${error.message}`);
        else pass1Updates++;
      }
    }
    console.log(`  ${DRY_RUN ? 'Would update' : 'Updated'}: ${pass1Updates}`);
  }

  // ─── PASS 2: från raw_data (source-payload, lägre kvalitet) ──────────────
  console.log('\n─── PASS 2: venue_id IS NULL → raw_data->>\'venue\' / \'address\' / \'city\' ───');

  let allNoVenueId = [];
  let offset2 = 0;
  while (true) {
    const { data: chunk, error: err } = await supabase
      .from('events')
      .select('id, raw_data, venue_full_name, venue_full_address, venue_city, venue_lat, venue_lng, lat, lng')
      .is('venue_id', null)
      .is('venue_full_name', null)
      .range(offset2, offset2 + PAGE - 1);
    if (err) { console.error('PASS 2 fetch failed:', err.message); process.exit(1); }
    if (!chunk || chunk.length === 0) break;
    allNoVenueId = allNoVenueId.concat(chunk);
    if (chunk.length < PAGE) break;
    offset2 += PAGE;
  }
  const noVenueId = allNoVenueId;
  console.log(`  events without venue_id and without venue_full_name: ${noVenueId.length}`);

  let pass2Updates = 0;
  let pass2NoRaw = 0;
  for (const ev of noVenueId) {
    const raw = ev.raw_data ?? {};
    // raw_data kan ha strängen "null" eller tomma strängar från JSON-parsning
    const sanitize = (v) => (v && v !== 'null' && v !== '' ? v : null);
    const vName = sanitize(raw.venue);
    const vAddr = sanitize(raw.address);
    const vCity = sanitize(raw.city);
    if (!vName && !vAddr && !vCity) {
      pass2NoRaw++;
      continue;
    }

    const patch = {
      venue_full_name: vName,
      venue_full_address: vAddr,
      venue_city: vCity,
    };
    if (DRY_RUN) {
      if (pass2Updates < 5) console.log(`  [sample] event=${ev.id.slice(0,8)} venue="${vName}" address="${vAddr}"`);
      pass2Updates++;
    } else {
      const { error } = await supabase.from('events').update(patch).eq('id', ev.id);
      if (error) console.error(`  update ${ev.id}: ${error.message}`);
      else pass2Updates++;
    }
  }
  console.log(`  ${DRY_RUN ? 'Would update' : 'Updated'}: ${pass2Updates}`);
  console.log(`  events with no venue info in raw_data either: ${pass2NoRaw}`);

  console.log('\n=== SUMMARY ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`);
  if (DRY_RUN) console.log('Use --commit to actually write.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });