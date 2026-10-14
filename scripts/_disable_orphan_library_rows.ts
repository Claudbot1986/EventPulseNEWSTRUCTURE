#!/usr/bin/env -S npx tsx
/**
 * _disable_orphan_library_rows.ts — sätt category_slug='__disabled__'
 * på alla image_library-rader vars storage_path pekar på en orphan.
 *
 * pickLibraryFallback filtrerar på category_slug (eq/match), så dessa
 * rader kommer aldrig returneras igen. Då kan vi raderera orphan-storage
 * utan att backend fortsätter peka events på dem via library.
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Idempotent: bara de som INTE redan har __disabled__ uppdateras
 *   - Reversibel: vi kan återställa genom att sätta category_slug till ursprung
 */

import 'dotenv/config';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STAMPED_DIR = join(process.cwd(), 'local_image_library_stamped');
const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const OUT_FILE = join(OUT_DIR, 'disabled-library-rows.json');

const isApply = process.argv.includes('--apply');

function listLocalStamped(): Set<string> {
  const out = new Set<string>();
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) {
        if (name.startsWith('_quarantine') || name === '_test_stamp') continue;
        walk(p);
      } else if (name.endsWith('.webp')) {
        out.add(name.replace(/\.stamped\.webp$/, '.webp'));
      }
    }
  }
  walk(STAMPED_DIR);
  return out;
}

async function main() {
  console.log(`[disable-lib] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  const local = listLocalStamped();
  console.log(`[disable-lib] local: ${local.size} unika filnamn`);

  console.log('[disable-lib] hämtar alla image_library-rader (kan ta tid)...');
  const PAGE = 1000;
  let off = 0;
  const allRows: Array<{ id: string; storage_path: string | null; category_slug: string | null }> = [];
  while (true) {
    const { data, error } = await db
      .from('image_library')
      .select('id,storage_path,category_slug')
      .range(off, off + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    off += PAGE;
  }
  console.log(`[disable-lib] library totalt: ${allRows.length}`);

  const orphanRows = allRows.filter((r) => {
    if (!r.storage_path) return false;
    if (r.category_slug === '__disabled__') return false; // redan inaktiverad
    const m = r.storage_path.match(/import-stamped\/(.+)$/);
    return m ? !local.has(m[1]) : false;
  });
  console.log(`[disable-lib] orphan-rader att inaktivera: ${orphanRows.length}`);

  if (orphanRows.length === 0) {
    console.log('[disable-lib] inget att göra.');
    return;
  }

  // Fördelning per tidigare kategori
  const byCat: Record<string, number> = {};
  for (const r of orphanRows) byCat[r.category_slug || '(null)'] = (byCat[r.category_slug || '(null)'] || 0) + 1;
  console.log('[disable-lib] per tidigare kategori:');
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }

  if (!isApply) {
    console.log(`\n[disable-lib] DRY-RUN. Skulle uppdatera ${orphanRows.length} rader.`);
    console.log('[disable-lib] exempel 5 första:');
    for (const r of orphanRows.slice(0, 5)) console.log('  ', r.storage_path);
    return;
  }

  // Uppdatera i batch om 100 (PostgREST-gräns ~1000 rader per request)
  const BATCH = 100;
  let updated = 0, errs = 0;
  for (let i = 0; i < orphanRows.length; i += BATCH) {
    const batch = orphanRows.slice(i, i + BATCH);
    const ids = batch.map((r) => r.id);
    const { error } = await db
      .from('image_library')
      .update({ category_slug: '__disabled__', updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) {
      errs++;
      console.error(`  batch ${i} error:`, error.message);
    } else {
      updated += batch.length;
    }
    if ((i + BATCH) % 500 === 0 || i + BATCH >= orphanRows.length) {
      process.stdout.write(`\r  ${Math.min(i + BATCH, orphanRows.length)}/${orphanRows.length}     `);
    }
  }
  process.stdout.write('\n');
  console.log(`\n[disable-lib] uppdaterade: ${updated}, fel: ${errs}`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_disabled: updated,
    sample_ids: orphanRows.slice(0, 100).map((r) => r.id),
  }, null, 2), 'utf-8');
  console.log(`[disable-lib] log: ${OUT_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
