#!/usr/bin/env node
/**
 * venue-rescue-round3.mjs — Fixa fler events via:
 * 1. Nya URL-host-mappningar (Vasamuseet, Sjöhistoriska, Hovet, KB, etc.)
 * 2. raw_data.venue-extraktion för events som HAR raw_data (framför allt aik)
 * 3. Skapa venue-rader för saknade venues (Mosebacke, Kungliga biblioteket)
 *    via Photon OSM-geokodning — INTE hittar-på-koordinater.
 *
 * Användning:
 *   node scripts/venue-rescue-round3.mjs --dry-run
 *   node scripts/venue-rescue-round3.mjs --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const APPLY = process.argv.includes('--apply');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// === URL host → venue query ===
const HOST_TO_VENUE = {
  'vasamuseet.se': 'Vasamuseet',
  'familjeshowen.se': 'Familjeshowen',
  'stockholmjazz.se': null, // blanda — Jazz-specifika events (kolla raw_data)
  'strawberryarena.se': 'Strawberry Arena',
  'sjohistoriska.se': 'Sjöhistoriska museet',
  'hovetarena.se': 'Hovet',
  'kb.se': 'Kungliga biblioteket',
  'tickets.nortic.se': null, // blanda — hantera via raw_data
  'nortic.se': null, // blanda — hantera via raw_data
  'kulturbolaget.se': null, // blandat (Göteborg/Stockholm)
  'livespot.se': null, // HAR redan venue_full_name ofta
};

// === Venues att skapa via Photon om saknas ===
const VENUES_TO_CREATE = [
  { query: 'Mosebacke Stockholm', name: 'Mosebacke', city: 'Stockholm' },
  { query: 'Kungliga biblioteket Stockholm', name: 'Kungliga biblioteket', city: 'Stockholm' },
  { query: 'Vasamuseet Stockholm', name: 'Vasamuseet', city: 'Stockholm' },
  { query: 'Sjöhistoriska museet Stockholm', name: 'Sjöhistoriska museet', city: 'Stockholm' },
  { query: 'Familjeshowen Stockholm', name: 'Familjeshowen', city: 'Stockholm' },
];

const hostVenueMap = {};
const venuesToCreate = [];

console.log(`=== Venue Rescue Round 3 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

// Slå upp venue-id för varje mappning
for (const [host, query] of Object.entries(HOST_TO_VENUE)) {
  if (!query) continue;
  const { data: v } = await supabase.from('venues').select('id, name, lat, lng').ilike('name', query).limit(1);
  if (v && v.length > 0) {
    hostVenueMap[host] = v[0];
    console.log(`  ${host} → ${query}: ✓ ${v[0].name} (${v[0].lat},${v[0].lng})`);
  } else {
    console.log(`  ${host} → ${query}: SAKNAS i venues-tabellen`);
  }
}

// Kolla om Mosebacke och Kungliga biblioteket FINNS
for (const vc of VENUES_TO_CREATE) {
  const { data: v } = await supabase.from('venues').select('id, name, lat, lng').ilike('name', vc.name).limit(1);
  if (v && v.length > 0) {
    console.log(`  Skapa ${vc.name}: finns redan (id=${v[0].id.slice(0,8)}...)`);
    venuesToCreate.push({ ...vc, exists: true, venue: v[0] });
  } else {
    console.log(`  Skapa ${vc.name}: behöver skapas via geocoding`);
    venuesToCreate.push({ ...vc, exists: false });
  }
}

// Hämta alla events utan venue_id/null venue_full_name (kan ha raw_data)
let allRows = [];
let page = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await supabase
    .from('events')
    .select('id, source, ticket_url, lat, lng, venue_lat, venue_lng, raw_data')
    .eq('status', 'published')
    .is('venue_id', null)
    .range(page * PAGE, (page + 1) * PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allRows = allRows.concat(data);
  if (data.length < PAGE) break;
  page++;
}
console.log(`\nEvents kvar med null venue_id: ${allRows.length}`);

// Photon-geokodning för nya venues
async function geocode(query) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'EventPulse venue rescue' } });
    if (!r.ok) return null;
    const j = await r.json();
    const f = j.features?.[0];
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties || {};
    return {
      lat, lng,
      name: props.name || query,
      city: props.city || props.town || props.village || null,
      country: props.country || null,
      street: props.street || null,
      postcode: props.postcode || null,
    };
  } catch (e) {
    console.error(`  Geocode fel för "${query}": ${e.message}`);
    return null;
  }
}

// Skapa nya venues via Photon om det behövs
const createdVenueIds = {};
for (const vc of venuesToCreate) {
  if (vc.exists) continue;
  console.log(`\nGeocoding "${vc.query}" via Photon...`);
  const g = await geocode(vc.query);
  if (!g) {
    console.log(`  Ingen Photon-match. Skippar.`);
    continue;
  }
  if (!g.lat || !g.lng || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) {
    console.log(`  Ogiltiga koordinater. Skippar.`);
    continue;
  }
  // Validera Stockholms-omkrets (lat 59.0–60.0, lng 17.5–19.0)
  if (g.lat < 59.0 || g.lat > 60.0 || g.lng < 17.5 || g.lng > 19.0) {
    console.log(`  Koordinater utanför Stockholm-omkrets: (${g.lat},${g.lng}). Skippar.`);
    continue;
  }
  console.log(`  → ${g.name} @ (${g.lat},${g.lng}) ${g.street || ''} ${g.postcode || ''} ${g.city || ''}`);
  
  if (!APPLY) continue;
  
  // Insert venue
  const { data: newV, error } = await supabase.from('venues').insert({
    name: vc.name,
    address: [g.street, g.postcode].filter(Boolean).join(', ') || null,
    city: g.city || vc.city,
    country: g.country || 'Sweden',
    lat: g.lat,
    lng: g.lng,
    location: `POINT(${g.lng} ${g.lat})`,
  }).select().single();
  if (error) {
    console.log(`  [ERR] Kunde inte skapa: ${error.message}`);
  } else {
    console.log(`  ✓ Skapad venue id=${newV.id.slice(0,8)}...`);
    createdVenueIds[vc.name] = newV;
  }
}

// Hämta ALLA venues (för fuzzy-matchning av raw_data.venue)
console.log('\nHämtar venues för fuzzy-match...');
let allVenues = [];
page = 0;
while (true) {
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, lat, lng, address, city')
    .range(page * PAGE, (page + 1) * PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allVenues = allVenues.concat(data);
  if (data.length < PAGE) break;
  page++;
}

function norm(s) { return s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\wåäöéü ]/g, '').trim(); }
const venueByNorm = {};
for (const v of allVenues) {
  const k = norm(v.name);
  if (!venueByNorm[k]) venueByNorm[k] = v;
}

// Lägg till NYSKAPADEvenues i venueByNorm för fuzzy-matchning
for (const vc of venuesToCreate) {
  const v = createdVenueIds[vc.name] || (vc.exists ? vc.venue : null);
  if (v) {
    const k = norm(v.name);
    if (!venueByNorm[k]) venueByNorm[k] = v;
  }
}

// Matcha varje event
const updates = []; // { id, payload, method }
const methodCounts = {};

for (const e of allRows) {
  let v = null;
  let method = null;
  let rawVenueName = null;
  
  // 1) URL host-mappning
  if (e.ticket_url) {
    try {
      const host = new URL(e.ticket_url).hostname.replace(/^www\./, '');
      if (hostVenueMap[host]) {
        v = hostVenueMap[host];
        method = `host:${host}`;
      }
    } catch {}
  }
  
  // 2) raw_data.venue-extraktion (för källor med raw_data)
  if (!v && e.raw_data && typeof e.raw_data === 'object') {
    rawVenueName = e.raw_data.venue;
    if (rawVenueName && typeof rawVenueName === 'string' && rawVenueName.length >= 2) {
      const n = norm(rawVenueName);
      if (venueByNorm[n]) {
        v = venueByNorm[n];
        method = `raw.exact:${rawVenueName}`;
      } else if (n.length >= 4) {
        for (const vc of allVenues) {
          const vn = norm(vc.name);
          if (vn.includes(n) || n.includes(vn)) {
            v = vc;
            method = `raw.contains:${rawVenueName}`;
            break;
          }
        }
      }
    }
  }
  
  if (!v) continue;
  
  const payload = { venue_id: v.id, venue_full_name: v.name };
  if (rawVenueName) payload.venue_full_name = rawVenueName;
  
  // Propagera venue-geo
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

console.log('\n=== Matchade events ===');
Object.entries(methodCounts).sort((a, b) => b[1] - a[1]).forEach(([m, c]) => {
  console.log(`  ${c}×  ${m}`);
});
console.log(`  TOTAL: ${updates.length}`);

if (updates.length === 0 && Object.keys(createdVenueIds).length === 0) {
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
console.log(`Nya venues skapade: ${Object.keys(createdVenueIds).length}`);

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