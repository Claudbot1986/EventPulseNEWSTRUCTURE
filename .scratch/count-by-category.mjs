/**
 * count-by-category.mjs — Räkna events per category_slug.
 *
 * Användning:
 *   node --env-file=.env .scratch/count-by-category.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

const PAGE = 1000;

// Hämta alla events med category_slug != null
let all = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from('events')
    .select('id, category_slug, source, status')
    .not('category_slug', 'is', null)
    .range(from, from + PAGE - 1);
  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  all = all.concat(data);
  if (data.length < PAGE) break;
  from += PAGE;
}

console.log(`Total events med category_slug: ${all.length}\n`);

// Räkna per category_slug
const counts = {};
for (const e of all) {
  const k = e.category_slug ?? '(null)';
  counts[k] = (counts[k] ?? 0) + 1;
}

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log('Antal events per category_slug:');
for (const [slug, n] of sorted) {
  console.log(`  ${String(n).padStart(5)}  ${slug}`);
}

// Utforska-kategorier (8 grupper med 24 subkategorier) från UtforskaFilterDropdown
// plus 18 HomeScreen-tiles från CATEGORY_FILTERS. Totalt 18 unika
// kategori-slugs (alla 18 HomeScreen-tiles återfinns i Utforska).
const UTFORSKA_SLUGS = new Set([
  // music-gruppen
  'pop-rock', 'jazz', 'classical', 'electronic', 'hip-hop', 'metal', 'world-folk', 'musical',
  // theatre
  'opera', 'theatre-comedy', 'theatre-drama', 'dance', 'circus',
  // exhibition
  'exhibition',
  // food
  'food', 'wine-tasting', 'flea-market',
  // kids
  'kids', 'family',
  // film-learning
  'film', 'talks-lectures', 'workshop',
  // sports
  'sports',
  // other
  'community',
  // extra HomeScreen-tile (utanför dropdown-gruppering)
  'nightlife',
  // legacy music (visas som 'live'-smak-tile)
  'music',
]);

console.log('\nUtforska-kategorier (24 från UtforskaFilterDropdown + music + nightlife):');
let utforskaTotal = 0;
for (const slug of sorted) {
  const [k, n] = slug;
  const isUtforska = UTFORSKA_SLUGS.has(k);
  const marker = isUtforska ? ' ' : 'x';
  console.log(`  ${marker}${String(n).padStart(5)}  ${k}${isUtforska ? '' : '  (utanför utforska)'}`);
  if (isUtforska) utforskaTotal += n;
}
console.log(`\nSumma utforska-kategorier: ${utforskaTotal}`);
console.log(`Summa övriga slugs: ${all.length - utforskaTotal}`);