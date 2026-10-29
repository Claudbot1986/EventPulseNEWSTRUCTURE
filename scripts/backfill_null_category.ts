#!/usr/bin/env tsx
/**
 * scripts/backfill_null_category.ts
 *
 * Sätter category_slug på events som saknar den.
 *
 * Bakgrund (2026-10-29): `scripts/ingest-sitemap-discovery.mjs` skapade events
 * utan `category_slug` (NULL). Utan kategori kan eventet ALDRIG få en bild:
 * `pickLibraryFallback` matchar i ordningen venue+category → category → kind
 * → default, och biblioteket innehåller inga bilder med NULL-kategori.
 * 59 events från körningen 2026-10-29 stod därför kvar som platshållare i
 * appen trots att biblioteket hade 865 bilder.
 *
 * Fallbackvärdet är 'community' — samma kedja som normaliseringen använder
 * (`category_slug = canonicalized[0] ?? sourceDefault ?? 'community'`,
 * 04-Normalizer/categoryCanonicalize.ts) och samma fallback som
 * ingest-eventbrite-stockholm.mjs använder sedan 2026-10-06.
 *
 * Skriptet är idempotent: en andra körning hittar 0 rader.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/backfill_null_category.ts            # dry-run
 *   node --env-file=.env --import tsx scripts/backfill_null_category.ts --apply    # skriv
 */
import { createClient } from '@supabase/supabase-js';

const isApply = process.argv.includes('--apply');
const FALLBACK = 'community';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[backfill] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function main(): Promise<void> {
  console.log(`[backfill] läge: ${isApply ? 'APPLY' : 'DRY-RUN'} · fallback=${FALLBACK}`);

  const { data, error } = await db
    .from('events')
    .select('id, title_sv, source, category_slug, image_url')
    .is('category_slug', null);
  if (error) {
    console.error('[backfill] select error:', error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  console.log(`[backfill] events med NULL category_slug: ${rows.length}`);

  const perSource = new Map<string, number>();
  for (const r of rows) perSource.set(r.source ?? '(null)', (perSource.get(r.source ?? '(null)') ?? 0) + 1);
  for (const [s, n] of [...perSource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} × ${s}`);
  }

  const withImage = rows.filter((r) => r.image_url).length;
  console.log(`[backfill] av dem har ${withImage} en bild och ${rows.length - withImage} saknar bild`);

  if (rows.length === 0) {
    console.log('[backfill] inget att göra');
    return;
  }

  if (!isApply) {
    console.log('\n[backfill] DRY-RUN. Kör med --apply för att skriva.');
    return;
  }

  const ids = rows.map((r) => r.id);
  let updated = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data: res, error: upErr } = await db
      .from('events')
      .update({ category_slug: FALLBACK })
      .in('id', ids.slice(i, i + 200))
      .select('id');
    if (upErr) {
      console.error(`[backfill] update error: ${upErr.message}`);
      process.exit(1);
    }
    updated += res?.length ?? 0;
  }
  console.log(`[backfill] uppdaterade ${updated} events`);

  const { count: left } = await db
    .from('events')
    .select('id', { count: 'exact', head: true })
    .is('category_slug', null);
  console.log(`[backfill] kvar med NULL category_slug: ${left}`);
  if (left && left > 0) process.exitCode = 1;
}

main();
