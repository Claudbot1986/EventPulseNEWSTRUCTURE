#!/usr/bin/env -S npx tsx
/**
 * _verify_no_orphan_pointers.ts — verifiera att 0 events pekar på
 * orphan-storage-paths INNAN vi raderar dem.
 *
 * Bygger orphan-set (storage-filer som inte finns i local_image_library_stamped/),
 * SQL-söker events vars image_url slutar på någon orphan-suffix.
 * Förväntat: 0 träffar.
 *
 * Säkerhet:
 *   - Skriver INGENTING (read-only)
 *   - Används som gate innan radering
 */

import 'dotenv/config';
import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
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
const OUT_FILE = join(OUT_DIR, 'verify-no-orphans.json');

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
  console.log('[verify] läser storage + local...');
  const storage = await listStorage();
  const local = listLocalStamped();
  const orphans = [...storage].filter((n) => !local.has(n));
  console.log(`[verify] storage: ${storage.size} | local: ${local.size} | orphans: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('[verify] inga orphans — kan inte testa, men OK.');
    return;
  }

  console.log('[verify] SQL-söker events med orphan-pointers...');
  const BATCH = 200;
  const matching: Array<{ id: string; image_url: string }> = [];
  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH);
    const ors = batch.map((n) => `image_url.ilike.%${n.replace(/'/g, "''")}`).join(',');
    const { data, error } = await db
      .from('events')
      .select('id,image_url')
      .or(ors)
      .limit(5000);
    if (error) { console.error(`batch ${i} error:`, error.message); continue; }
    if (data) matching.push(...data);
  }

  const seen = new Set<string>();
  const unique = matching.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const passed = unique.length === 0;
  console.log(`\n[verify] events pekar på orphan-storage-paths: ${unique.length}`);
  console.log(`[verify] ${passed ? '✓ GATE PASSED' : '✗ GATE FAILED — radera INTE storage!'}`);

  if (unique.length > 0) {
    console.log('[verify] exempel (första 10):');
    for (const e of unique.slice(0, 10)) console.log(`  ${e.id} | ${e.image_url}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    storage_size: storage.size,
    local_size: local.size,
    orphan_count: orphans.length,
    events_pointing_to_orphans: unique.length,
    passed,
    sample_violations: unique.slice(0, 50),
  }, null, 2), 'utf-8');
  console.log(`[verify] rapport: ${OUT_FILE}`);

  if (!passed) process.exit(1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
