#!/usr/bin/env node
/**
 * apply-geocoded-venues.mjs — Apply Photon geocoding results to venues-table.
 *
 * Reads /tmp/geocode_results.json (from /tmp/geocode_venues.py).
 * For each result:
 *   - UPDATE venues SET lat/lng/address WHERE id matches AND lat=59.3293
 *   - Logs success/failure per venue
 *
 * Säkerhet:
 *   - WHERE lat=59.3293 guard: bara uppdatera venues som HAR Sergels-torg-fallback
 *     (skyddar mot att skriva över korrekt data om något ändrats).
 *   - Validerar lat/lng inom Stockholms-området (59.20–59.55, 17.80–18.40)
 *     innan uppdatering.
 *
 * Användning:
 *   node scripts/apply-geocoded-venues.mjs --dry-run
 *   node scripts/apply-geocoded-venues.mjs --commit
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

const DRY_RUN = !process.argv.includes('--commit');

const RESULTS_PATH = process.argv.find(a => a.startsWith('--results='))?.split('=')[1] ?? '/tmp/geocode_results.json';

function isStockholmArea(lat, lon) {
  return lat >= 59.20 && lat <= 59.55 && lon >= 17.80 && lon <= 18.40;
}

async function main() {
  console.log(`=== Apply geocoded venues (${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}) ===`);
  let results;
  try {
    results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${RESULTS_PATH}: ${e.message}`);
    process.exit(1);
  }
  console.log(`Loaded ${results.length} geocoded venues`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let batch = [];
  const BATCH = 50;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const lat = r.lat;
    const lng = r.lon;
    if (!isStockholmArea(lat, lng)) {
      skipped++;
      console.warn(`  [SKIP out-of-bounds] ${r.name} → (${lat}, ${lng})`);
      continue;
    }
    if (DRY_RUN) {
      updated++;
      if (i < 5) console.log(`  [sample] ${r.name} → (${lat}, ${lng}) ${r.street} ${r.postcode}`);
      continue;
    }
    // Build address from Photon street + postcode if we have them
    const newAddress = [r.street, r.postcode].filter(Boolean).join(', ') || r.name;

    const { error } = await supabase
      .from('venues')
      .update({ lat, lng, address: newAddress })
      .eq('id', r.venue_id)
      .eq('lat', 59.3293)
      .eq('lng', 18.0686);

    if (error) {
      errors++;
      console.error(`  [ERR] ${r.name}: ${error.message}`);
    } else {
      updated++;
    }
    if ((i + 1) % BATCH === 0) console.log(`  progress: ${i + 1}/${results.length}`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (out of bounds): ${skipped}`);
  console.log(`Errors: ${errors}`);
  if (DRY_RUN) console.log('Use --commit to actually write to DB.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });