#!/usr/bin/env node
/**
 * venue-rescue-batch.mjs — Rädda 2 368 events där venue_full_name finns men
 * venue_id är NULL. Kör samma matchningslogik som migration
 * 20261006-0001-venue-rescue-from-named.sql, men via service_role batch-updates
 * (Management API-tokengen är 401, så vi går via REST istället).
 *
 * 3 steg (samma som SQL):
 *   1. Exakt normaliserad match
 *   2. Suffix-trim match
 *   3. Contains-match
 *
 * Varje matchat event får:
 *   - venue_id (link till venues-tabellen)
 *   - venue_lat/venue_lng (om venues har koordinater)
 *   - lat/lng (om venues har koordinater och event saknar)
 *   - venue_full_address/venue_city (om venues har det och event saknar)
 *
 * Användning:
 *   node scripts/venue-rescue-batch.mjs --dry-run    # bara räkna, skriv inte
 *   node scripts/venue-rescue-batch.mjs --apply      # faktiskt skriv till DB
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const APPLY = process.argv.includes('--apply');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function norm(s) { return s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\wåäöéü ]/g, '').trim(); }

const SUFFIX_RE = /\s*(jazz club|jazzbar|jazz|konserthus|concert hall|concert house|live music venue|live|music venue|baren|bar & nightclub|nightclub|teatern|teater|kyrkan|church|museet|museum|galleriet|gallery|hotell|hotel|stadium|arenan|hallen|salen|klubb|pub|café|cafe|restaurang|bar|store|gallery|kyrka|capel|kapell|chapel|konsthall|stadsteatern|stadsteater|teatern|teater)$/i;

console.log(`=== Venue Rescue Batch (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

// 1) Hämta alla events med venue_full_name men null venue_id
console.log('Hämtar events...');
let allEvents = [];
let page = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await supabase
    .from('events')
    .select('id, venue_full_name, venue_full_address, venue_city, venue_lat, venue_lng, lat, lng')
    .eq('status', 'published')
    .is('venue_id', null)
    .not('venue_full_name', 'is', null)
    .range(page * PAGE, (page + 1) * PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allEvents = allEvents.concat(data);
  if (data.length < PAGE) break;
  page++;
}
console.log(`  ${allEvents.length} events med venue_full_name men null venue_id`);

// 2) Hämta alla venues
console.log('Hämtar venues...');
let allVenues = [];
page = 0;
while (true) {
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, address, city, lat, lng')
    .range(page * PAGE, (page + 1) * PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allVenues = allVenues.concat(data);
  if (data.length < PAGE) break;
  page++;
}
console.log(`  ${allVenues.length} venues i tabellen`);

// Bygg lookup-map (normaliserad namn → venue)
const venueByNorm = {};
for (const v of allVenues) {
  const k = norm(v.name);
  // Första vinner om dubbletter (förutsätter venues-tabellen DB är clean)
  if (!venueByNorm[k]) venueByNorm[k] = v;
}

// 3) Matcha varje event mot en venue-row
console.log('\nMatchar events mot venues...\n');
const updates = []; // { id, updates }
let step1 = 0, step2 = 0, step3 = 0, skipped = 0;

for (const e of allEvents) {
  const n = norm(e.venue_full_name);
  
  // Steg 1: Exakt normaliserad
  let v = venueByNorm[n];
  let step = 0;
  if (v) {
    step = 1;
    step1++;
  } else {
    // Steg 2: Suffix-trim
    const trimmed = n.replace(SUFFIX_RE, '').trim();
    if (trimmed !== n && venueByNorm[trimmed]) {
      v = venueByNorm[trimmed];
      step = 2;
      step2++;
    } else if (n.length >= 4) {
      // Steg 3: Contains-match (första träff)
      for (const vc of allVenues) {
        const vn = norm(vc.name);
        if (vn.includes(n) || n.includes(vn)) {
          v = vc;
          step = 3;
          step3++;
          break;
        }
      }
    }
  }
  
  if (!v) { skipped++; continue; }
  
  // Bygg update-payload
  const upd = { venue_id: v.id };
  // Propagera venue-geo om venues har det och event saknar
  if (v.lat != null && v.lng != null) {
    if (e.venue_lat == null) upd.venue_lat = v.lat;
    if (e.venue_lng == null) upd.venue_lng = v.lng;
    if (e.lat == null || (e.lat === 59.3293 && e.lng === 18.0686)) {
      if (v.lat !== 59.3293 || v.lng !== 18.0686) {
        // Bara uppdatera lat/lng om venues INTE är Sergels-torg-fallback
        if (e.lat == null) upd.lat = v.lat;
        if (e.lng == null) upd.lng = v.lng;
      }
    }
  }
  if (v.address && !e.venue_full_address) upd.venue_full_address = v.address;
  if (v.city && !e.venue_city) upd.venue_city = v.city;
  
  updates.push({ id: e.id, updates: upd });
}

console.log(`Steg 1 (exakt):           ${step1} events`);
console.log(`Steg 2 (suffix-trim):      ${step2} events`);
console.log(`Steg 3 (contains):         ${step3} events`);
console.log(`───────────────────────────`);
console.log(`Totalt matchade:           ${updates.length} events`);
console.log(`Skippade (ingen match):    ${skipped} events`);

if (updates.length === 0) {
  console.log('\nInga events att uppdatera. Avslutar.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] Skipping DB write. Kör med --apply för att faktiskt skriva.');
  process.exit(0);
}

// 4) Batchad UPDATE (max 200 per call för att inte överbelasta PostgREST)
console.log('\nBörjar skriva till DB...\n');
const BATCH = 100;
let written = 0, errors = 0;

for (let i = 0; i < updates.length; i += BATCH) {
  const slice = updates.slice(i, i + BATCH);
  
  // Gruppera per identisk update-payload för effektivitet (mindre requests)
  const groups = {};
  for (const u of slice) {
    const k = JSON.stringify(u.updates);
    if (!groups[k]) groups[k] = { updates: u.updates, ids: [] };
    groups[k].ids.push(u.id);
  }
  
  for (const g of Object.values(groups)) {
    const { error } = await supabase
      .from('events')
      .update(g.updates)
      .in('id', g.ids)
      .is('venue_id', null); // Säkerhetsgard: bara uppdatera om fortfarande null
    if (error) {
      errors++;
      console.error(`  [ERR] ${g.ids.length} events failed: ${error.message}`);
    } else {
      written += g.ids.length;
    }
  }
  
  if ((i + BATCH) % 500 === 0 || i + BATCH >= updates.length) {
    console.log(`  Progress: ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
}

console.log(`\n=== KLART ===`);
console.log(`Skrivna: ${written} events`);
console.log(`Errors:  ${errors} batches`);

// 5) Verifiera nytt count
const { count: newNull } = await supabase
  .from('events')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'published')
  .is('venue_id', null);
const { count: total } = await supabase
  .from('events')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'published');
console.log(`\nNytt antal null venue_id: ${newNull} / ${total} (${(100*newNull/total).toFixed(1)}%)`);
console.log(`Tidigare: 3923 / 14293 (27.4%)`);