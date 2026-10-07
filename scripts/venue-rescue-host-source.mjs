#!/usr/bin/env node
/**
 * venue-rescue-host-source.mjs — Fixa 903 events via ticket_url-host- och
 * source-mappning. Varje host/source har deterministisk venue-tillgängdighet
 * verifierad mot venues-tabellen.
 *
 * Användning:
 *   node scripts/venue-rescue-host-source.mjs --dry-run
 *   node scripts/venue-rescue-host-source.mjs --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const APPLY = process.argv.includes('--apply');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Deterministiska mappningar
const HOST_TO_VENUE = {
  'dramaten.se': 'Dramaten',
  'boka.berwaldhallen.se': 'Berwaldhallen',
  'aviciiarena.se': 'Avicii Arena',
  'sodrateatern.com': 'Södra Teatern',
  'kulturhusetstadsteatern.se': 'Kulturhuset Stadsteatern',
  'nalen.com': 'Nalen',
  'annexet.se': 'Annexet',
};

const SOURCE_TO_VENUE = {
  'friendsarena': 'Friends Arena',
  'tele2-arena': 'Tele2 Arena',
  'artipelag': 'Artipelag',
};

console.log(`=== Venue Rescue Host/Source (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

// Slå upp venue-id för varje mappning
const hostVenueMap = {};
for (const [host, query] of Object.entries(HOST_TO_VENUE)) {
  const { data: v } = await supabase.from('venues').select('id, name, lat, lng').ilike('name', query).limit(1);
  if (v && v.length > 0) hostVenueMap[host] = v[0];
}
const sourceVenueMap = {};
for (const [src, query] of Object.entries(SOURCE_TO_VENUE)) {
  const { data: v } = await supabase.from('venues').select('id, name, lat, lng').ilike('name', query).limit(1);
  if (v && v.length > 0) sourceVenueMap[src] = v[0];
}

console.log(`Host-mappningar: ${Object.keys(hostVenueMap).length} st`);
console.log(`Source-mappningar: ${Object.keys(sourceVenueMap).length} st\n`);

// Hämta alla events utan venue_id/null venue_full_name
let allRows = [];
let page = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await supabase
    .from('events')
    .select('id, source, ticket_url, lat, lng, venue_lat, venue_lng, venue_full_address, venue_city')
    .eq('status', 'published')
    .is('venue_id', null)
    .is('venue_full_name', null)
    .range(page * PAGE, (page + 1) * PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allRows = allRows.concat(data);
  if (data.length < PAGE) break;
  page++;
}
console.log(`Events med null venue_id + null venue_full_name: ${allRows.length}\n`);

// Matcha varje event
const updates = []; // { id, payload }
const methodCounts = {};

for (const e of allRows) {
  let v = null;
  let method = null;
  
  // Försök via ticket_url-host
  if (e.ticket_url) {
    try {
      const host = new URL(e.ticket_url).hostname.replace(/^www\./, '');
      if (hostVenueMap[host]) {
        v = hostVenueMap[host];
        method = `host:${host}`;
      }
    } catch {}
  }
  
  // Annars via source
  if (!v && sourceVenueMap[e.source]) {
    v = sourceVenueMap[e.source];
    method = `source:${e.source}`;
  }
  
  if (!v) continue;
  
  const payload = { venue_id: v.id, venue_full_name: v.name };
  // Propagera venue-geo (bara om venue HAR koordinater och event SAKNAR dem)
  if (v.lat != null && v.lng != null && Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
    if (e.venue_lat == null) payload.venue_lat = v.lat;
    if (e.venue_lng == null) payload.venue_lng = v.lng;
    if ((e.lat == null || (e.lat === 59.3293 && e.lng === 18.0686)) &&
        !(v.lat === 59.3293 && v.lng === 18.0686)) {
      if (e.lat == null) payload.lat = v.lat;
      if (e.lng == null) payload.lng = v.lng;
    }
  }
  
  updates.push({ id: e.id, payload });
  methodCounts[method] = (methodCounts[method] || 0) + 1;
}

console.log('=== Matchade events ===');
Object.entries(methodCounts).sort((a, b) => b[1] - a[1]).forEach(([m, c]) => {
  console.log(`  ${c}×  ${m}`);
});
console.log(`  TOTAL: ${updates.length}`);

if (updates.length === 0) {
  console.log('\nInga events att uppdatera. Avslutar.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] Skipping DB write. Kör med --apply för att faktiskt skriva.');
  process.exit(0);
}

// Skriv till DB
console.log('\nBörjar skriva till DB...\n');
let written = 0, errors = 0;
const BATCH = 50;

for (let i = 0; i < updates.length; i += BATCH) {
  const slice = updates.slice(i, i + BATCH);
  
  // Gruppera per identisk update-payload
  const groups = {};
  for (const u of slice) {
    const k = JSON.stringify(u.payload);
    if (!groups[k]) groups[k] = { payload: u.payload, ids: [] };
    groups[k].ids.push(u.id);
  }
  
  for (const g of Object.values(groups)) {
    const { error } = await supabase
      .from('events')
      .update(g.payload)
      .in('id', g.ids)
      .is('venue_id', null);
    if (error) {
      errors++;
      console.error(`  [ERR] ${g.ids.length} events failed: ${error.message}`);
    } else {
      written += g.ids.length;
    }
  }
  
  if ((i + BATCH) % 250 === 0 || i + BATCH >= updates.length) {
    console.log(`  Progress: ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
}

console.log(`\n=== KLART ===`);
console.log(`Skrivna: ${written} events`);
console.log(`Errors:  ${errors} batches`);

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