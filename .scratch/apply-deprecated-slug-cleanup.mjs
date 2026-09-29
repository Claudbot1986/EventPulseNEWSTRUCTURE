/**
 * apply-deprecated-slug-cleanup.mjs — Applicera migration 20260929-0001.
 *
 * Kör samma operationer som SQL-migrationen men via Supabase JS client
 * (psql finns inte lokalt, exec_sql RPC saknas).
 *
 * Migrationen är idempotent — kan köras flera gånger.
 *
 * Användning:
 *   node --env-file=.env .scratch/apply-deprecated-slug-cleanup.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

const MAPPING = [
  ['culture', 'community'],
  ['art-exhibitions', 'exhibition'],
  ['theater', 'theatre-drama'],
  ['musikaler', 'musical'],
  ['art', 'exhibition'],
  ['design', 'exhibition'],
  ['food-drink', 'food'],
  ['barn', 'family'],
  ['festivals', 'community'],
];

// ─── 1. Update events.category_slug ────────────────────────────────────────
console.log('=== STEG 1: Uppdatera events.category_slug ===');
for (const [from, to] of MAPPING) {
  // Select first to count affected
  const { count: before } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('category_slug', from);
  if (before === 0) {
    console.log(`  ${from} → ${to}: 0 events (no-op)`);
    continue;
  }
  const { error } = await supabase
    .from('events')
    .update({ category_slug: to })
    .eq('category_slug', from);
  if (error) {
    console.error(`  FEL ${from} → ${to}:`, error.message);
    process.exit(1);
  }
  console.log(`  ${from.padEnd(20)} → ${to.padEnd(20)} ${before} events`);
}

// ─── 2. Update event_categories.category_id ────────────────────────────────
console.log('\n=== STEG 2: Uppdatera event_categories M:M-join ===');
// För de 4 slugs som finns kvar i categories-tabellen (art-exhibitions,
// theater, art, food-drink): peka om event_categories-rader till target-id.
const JOIN_MIGRATIONS = [
  ['art-exhibitions', 'exhibition'],
  ['theater', 'theatre-drama'],
  ['art', 'exhibition'],
  ['food-drink', 'food'],
];

for (const [from, to] of JOIN_MIGRATIONS) {
  // Hämta from-category-id och to-category-id
  const { data: fromCat } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', from)
    .maybeSingle();
  if (!fromCat) {
    console.log(`  ${from}: ingen kategori-rad i DB — skippar`);
    continue;
  }
  const { data: toCat } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', to)
    .maybeSingle();
  if (!toCat) {
    console.error(`  FEL: target '${to}' finns inte i categories-tabellen`);
    process.exit(1);
  }
  const { count: before } = await supabase
    .from('event_categories')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', fromCat.id);
  if (before === 0) {
    console.log(`  ${from} → ${to}: 0 event_categories-rader (no-op)`);
    continue;
  }
  const { error } = await supabase
    .from('event_categories')
    .update({ category_id: toCat.id })
    .eq('category_id', fromCat.id);
  if (error) {
    console.error(`  FEL event_categories ${from} → ${to}:`, error.message);
    process.exit(1);
  }
  console.log(`  ${from.padEnd(20)} → ${to.padEnd(20)} ${before} event_categories-rader`);
}

// ─── 3. Multi-label dedup i event_categories ───────────────────────────────
// Hämta alla rader, gruppera på (event_id, category_id), ta bort dubletter.
// Använder klient-side filter — fungerar för ≤ ~5000 rader.
console.log('\n=== STEG 3: Dedup event_categories (M:M-unikpar) ===');
const { data: allJoins, error: joinErr } = await supabase
  .from('event_categories')
  .select('event_id, category_id');
if (joinErr) {
  console.error('Kunde inte läsa event_categories:', joinErr.message);
  process.exit(1);
}
const seen = new Set();
const toDelete = [];
for (const r of allJoins) {
  const key = `${r.event_id}::${r.category_id}`;
  if (seen.has(key)) {
    toDelete.push(r);
  } else {
    seen.add(key);
  }
}
if (toDelete.length === 0) {
  console.log('  Inga dubletter hittades.');
} else {
  console.log(`  ${toDelete.length} dubletter att ta bort...`);
  // Ta bort i batch om 100 (Supabase rad-gräns).
  let removed = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    // Använd (event_id, category_id) compound via .or() — Supabase JS saknar
    // stöd för compound delete, så vi tar bort via event_id + category_id
    // par en-och-en.
    for (const row of batch) {
      const { error } = await supabase
        .from('event_categories')
        .delete()
        .eq('event_id', row.event_id)
        .eq('category_id', row.category_id);
      if (error) {
        console.error(`  Kunde inte ta bort dup:`, error.message);
      } else {
        removed++;
      }
    }
  }
  console.log(`  ${removed} dubletter borttagna.`);
}

// ─── 4. Ta bort deprecated slugs från categories-tabellen ──────────────────
console.log('\n=== STEG 4: Ta bort deprecated slugs från categories ===');
for (const slug of ['art-exhibitions', 'theater', 'art', 'food-drink']) {
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('slug', slug);
  if (error) {
    console.error(`  FEL tar bort '${slug}':`, error.message);
    process.exit(1);
  }
  console.log(`  Borttagen: ${slug}`);
}

// ─── 5. Verifiering ────────────────────────────────────────────────────────
console.log('\n=== STEG 5: Verifiering ===');
const DEPRECATED = MAPPING.map(([f]) => f);
const { count: remainingDeprecated } = await supabase
  .from('events')
  .select('*', { count: 'exact', head: true })
  .in('category_slug', DEPRECATED);
console.log(`  Events med deprecated slugs kvar: ${remainingDeprecated}`);
if (remainingDeprecated > 0) {
  console.error('MISSLYCKADES: deprecated events finns kvar!');
  process.exit(1);
}
const { data: remainingDeprecatedCats } = await supabase
  .from('categories')
  .select('slug')
  .in('slug', ['art-exhibitions', 'theater', 'art', 'food-drink']);
if (remainingDeprecatedCats && remainingDeprecatedCats.length > 0) {
  console.error('MISSLYCKADES: deprecated slugs finns kvar i categories-tabellen!');
  console.error('  Kvarvarande:', remainingDeprecatedCats.map((c) => c.slug).join(', '));
  process.exit(1);
}
console.log('  Klart — alla deprecated slugs borta från events.category_slug');
console.log('  Klart — alla deprecated slugs borta från categories-tabellen');