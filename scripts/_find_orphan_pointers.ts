#!/usr/bin/env -S npx tsx
/**
 * _find_orphan_pointers.ts — hitta events som pekar på orphan-storage-paths.
 *
 * Bygger orphan-set från diff mellan storage-inventory och local_image_library_stamped/.
 * SQL-söker events vars image_url slutar på någon orphan-suffix.
 * Output till CSV som senare steg (4) konsumerar.
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Läser INTE från och skriver INTE till events (bara SQL SELECT och CSV)
 *   - Läser local_image_library_stamped/ (bara ls, inga ändringar)
 */

import 'dotenv/config';
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const OUT_FILE = join(OUT_DIR, 'orphan-events.csv');

const isApply = process.argv.includes('--apply');

function listStorage(): Promise<Set<string>> {
  return new Promise(async (resolve) => {
    const all = new Set<string>();
    let off = 0;
    while (true) {
      const { data, error } = await db.storage.from('event-posters').list('import-stamped', { limit: 1000, offset: off });
      if (error) { console.error('storage list error:', error.message); resolve(all); return; }
      if (!data || data.length === 0) break;
      for (const f of data) all.add(f.name);
      if (data.length < 1000) break;
      off += 1000;
    }
    resolve(all);
  });
}

function listLocalStamped(): Set<string> {
  // Ta ALLA .webp-filer (även icke-stämplade — `local_image_library_stamped/` är källan)
  // strip .stamped.webp → .webp för att matcha storage-naming
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
        // både 'foo.webp' och 'foo.stamped.webp' → 'foo.webp'
        const normalized = name.replace(/\.stamped\.webp$/, '.webp');
        out.add(normalized);
      }
    }
  }
  walk(STAMPED_DIR);
  return out;
}

async function main() {
  console.log(`[orphan-finder] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);

  console.log('[orphan-finder] läser storage-listan...');
  const storage = await listStorage();
  console.log(`[orphan-finder] storage: ${storage.size} filer`);

  console.log('[orphan-finder] läser local_image_library_stamped/...');
  const local = listLocalStamped();
  console.log(`[orphan-finder] local: ${local.size} unika filnamn (.webp efter strip)`);

  const orphans = [...storage].filter((n) => !local.has(n));
  const missing = [...local].filter((n) => !storage.has(n));
  console.log(`[orphan-finder] orphans (i storage men INTE lokalt): ${orphans.length}`);
  console.log(`[orphan-finder] missing (lokalt men INTE i storage): ${missing.length}`);

  if (orphans.length === 0) {
    console.log('[orphan-finder] inga orphans — klar.');
    return;
  }

  // Hitta events vars image_url slutar på någon orphan-suffix
  // (image_url-format: .../import-stamped/<name>)
  console.log('[orphan-finder] SQL: letar events med orphan-pointers...');

  // PostgREST: använd OR med flera LIKE — men 2000+ LIKE kan bli tungt.
  // Gör i batch om 200.
  const BATCH = 200;
  const matchingEvents: Array<{ id: string; title_sv: string | null; image_url: string; category_slug: string | null }> = [];

  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH);
    // Bygg OR-villkor: image_url.ilike.%<name>
    const ors = batch.map((n) => `image_url.ilike.%${n.replace(/'/g, "''")}`).join(',');
    const { data, error } = await db
      .from('events')
      .select('id,title_sv,image_url,category_slug')
      .or(ors)
      .limit(5000);
    if (error) { console.error(`batch ${i} error:`, error.message); continue; }
    if (data) matchingEvents.push(...data);
    if ((i / BATCH) % 10 === 0) process.stdout.write(`  batch ${i}/${orphans.length} (hittat ${matchingEvents.length})\r`);
  }
  process.stdout.write('\n');

  // Deduplicera (en event kan matcha flera orphan-suffix)
  const seen = new Set<string>();
  const unique = matchingEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  console.log(`[orphan-finder] events med orphan-pointers: ${unique.length}`);

  if (unique.length > 0) {
    console.log('[orphan-finder] exempel:');
    for (const e of unique.slice(0, 10)) console.log(`  ${e.id} | ${e.category_slug} | ${(e.title_sv || '').slice(0, 50)} | ${e.image_url}`);
  }

  if (!isApply) {
    console.log(`\n[orphan-finder] DRY-RUN. Skulle skriva ${unique.length} events till ${OUT_FILE}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const lines = ['id,title_sv,category_slug,image_url'];
  for (const e of unique) {
    const safeTitle = (e.title_sv || '').replace(/"/g, '""');
    const safeUrl = (e.image_url || '').replace(/"/g, '""');
    lines.push(`${e.id},"${safeTitle}",${e.category_slug ?? ''},"${safeUrl}"`);
  }
  writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf-8');
  console.log(`[orphan-finder] skrev ${OUT_FILE} (${unique.length} events)`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
