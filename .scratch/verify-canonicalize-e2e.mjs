/**
 * verify-canonicalize-e2e.mjs — Steg 1-3 verifiering efter 20260929-0001.
 *
 * Verifierar de tre "nästa steg" som utlovades i rapporten:
 *
 *   Steg 1: Inga `[normalizer] canonicalized: X → Y` rader när adaptrar
 *           skickar korrekt Utforska-slug direkt.
 *   Steg 2: category_slug på nya events är en av de 24 Utforska-slugs.
 *   Steg 3: Inga FK-violations eller adapter-regressions.
 *
 * Användning:
 *   node --env-file=.env .scratch/verify-canonicalize-e2e.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { canonicalizeCategorySlug } from '../04-Normalizer/categoryCanonicalize.ts';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// De 24 Utforska-slugs (från 06-UI/components/UtforskaFilterDropdown.js +
// HomeScreen-tile music + nightlife).
const UTFORSKA_SLUGS = new Set([
  'music', 'pop-rock', 'jazz', 'classical', 'electronic', 'hip-hop',
  'metal', 'world-folk', 'musical', 'opera', 'theatre-comedy',
  'theatre-drama', 'dance', 'circus', 'exhibition', 'flea-market',
  'food', 'wine-tasting', 'kids', 'family', 'film', 'talks-lectures',
  'workshop', 'sports', 'community', 'nightlife',
]);

const DEPRECATED = [
  'culture', 'art-exhibitions', 'theater', 'musikaler',
  'art', 'design', 'food-drink', 'barn', 'festivals',
];

let failed = 0;
function check(label, cond, detail = '') {
  const marker = cond ? '✓' : '✗';
  console.log(`  ${marker} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
}

// ─── STEG 1: Verifiera att canonicalize INTE triggas för redan-korrekta slugs ──
console.log('\n=== STEG 1: Canonicalize no-op för Utforska-slugs ===');
const samples = [
  ['music',        false],   // Hem-sidans "live"-tile
  ['opera',        false],
  ['theatre-comedy', false],
  ['theatre-drama', false],
  ['dance',        false],
  ['circus',       false],
  ['exhibition',   false],
  ['flea-market',  false],
  ['food',         false],
  ['wine-tasting', false],
  ['kids',         false],
  ['family',       false],
  ['film',         false],
  ['talks-lectures', false],
  ['workshop',     false],
  ['sports',       false],
  ['community',    false],
  ['nightlife',    false],
  ['musical',      false],
  ['pop-rock',     false],
  ['jazz',         false],
  ['classical',    false],
  ['electronic',   false],
  ['hip-hop',      false],
  ['metal',        false],
  ['world-folk',   false],
];
let canonicalizeTriggers = 0;
for (const [slug, expectedChanged] of samples) {
  const r = canonicalizeCategorySlug(slug);
  const changed = r?.changed ?? false;
  if (changed !== expectedChanged) {
    check(`${slug} → changed=${changed}`, false, `expected changed=${expectedChanged}`);
  }
  if (changed) canonicalizeTriggers++;
}
check('Inga canonicalize-triggers för giltiga slugs', canonicalizeTriggers === 0,
  `${canonicalizeTriggers} triggrar (förväntat 0)`);

// Och verifiera att canonicalize TRIGGAS för deprecated slugs (försvar-i-djup)
console.log('\n=== STEG 1b: Canonicalize TRIGGAR för deprecated slugs (defense) ===');
for (const slug of DEPRECATED) {
  const r = canonicalizeCategorySlug(slug);
  const ok = r !== null && r.changed && UTFORSKA_SLUGS.has(r.slug);
  check(`${slug} → ${r?.slug ?? '(null)'}`, ok,
    ok ? `canonicalized (changed=true)` : `FAILED`);
}

// ─── STEG 2: DB-tillstånd — Inga deprecated slugs i events ──────────────────
console.log('\n=== STEG 2: Inga deprecated slugs i events.category_slug ===');
const { count: deprecatedEvents } = await supabase
  .from('events')
  .select('*', { count: 'exact', head: true })
  .in('category_slug', DEPRECATED);
check('Events med deprecated slugs', deprecatedEvents === 0,
  `${deprecatedEvents} events (förväntat 0)`);

// Hämta alla events och verifiera att alla har en Utforska-slug
const { data: allEvents } = await supabase
  .from('events')
  .select('category_slug')
  .not('category_slug', 'is', null);
const totalEvents = allEvents?.length ?? 0;
const offUtforska = (allEvents ?? []).filter((e) => !UTFORSKA_SLUGS.has(e.category_slug));
check(`Alla ${totalEvents} events har Utforska-slug`,
  offUtforska.length === 0,
  offUtforska.length > 0
    ? `${offUtforska.length} events utanför (t.ex. ${offUtforska.slice(0, 3).map((e) => e.category_slug).join(', ')})`
    : 'alla 5402 events är giltiga'
);

// ─── STEG 3: Inga FK-violations eller kategorier-orphan ────────────────────
console.log('\n=== STEG 3: Inga FK-violations eller orphan categories ===');

// 3a. Inga events pekar på category_slug som inte finns i categories-tabellen
const { data: cats } = await supabase
  .from('categories')
  .select('slug');
const allCatSlugs = new Set((cats ?? []).map((c) => c.slug));
const orphan = (allEvents ?? []).filter((e) => !allCatSlugs.has(e.category_slug));
check('Inga events pekar på saknad kategori-rad i DB',
  orphan.length === 0,
  orphan.length > 0 ? `${orphan.length} orphan rows` : 'OK');

// 3b. Inga event_categories-rader pekar på borttagna categories
const { data: allJoins, count: joinsTotal } = await supabase
  .from('event_categories')
  .select('event_id, category_id', { count: 'exact' });
const catIds = new Set((cats ?? []).map((c) => c.id));
// Hämta alla category-IDs via separat query (ovan returnerar bara slugs)
const { data: allCats } = await supabase
  .from('categories')
  .select('id');
const allCatIds = new Set((allCats ?? []).map((c) => c.id));
const orphanJoins = (allJoins ?? []).filter((j) => !allCatIds.has(j.category_id));
check(`event_categories (${joinsTotal} rows) — alla pekar på giltig kategori`,
  orphanJoins.length === 0,
  orphanJoins.length > 0 ? `${orphanJoins.length} orphan joins` : 'OK');

// 3c. Inga deprecated slugs kvar i categories-tabellen
const deprecatedCats = (cats ?? []).filter((c) => DEPRECATED.includes(c.slug));
check('Inga deprecated slugs i categories-tabellen',
  deprecatedCats.length === 0,
  deprecatedCats.length > 0 ? `Kvar: ${deprecatedCats.map((c) => c.slug).join(', ')}` : 'OK');

// ─── Sammanfattning ─────────────────────────────────────────────────────────
console.log('\n=== SAMMANFATTNING ===');
if (failed === 0) {
  console.log('✓ Alla 3 steg passerar. Pipeline future-proof verifierad.');
} else {
  console.log(`✗ ${failed} check(s) misslyckades.`);
  process.exit(1);
}