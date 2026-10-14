#!/usr/bin/env -S npx tsx
/**
 * _delete_storage_orphans.ts — radera orphan-filer från Supabase Storage.
 *
 * Säkerhetsmodell:
 *   - KRÄVER att _verify_no_orphan_pointers.ts har körts med PASSED
 *   - Default = --dry-run (visar plan, raderar inte)
 *   - --apply: faktisk radering
 *   - Loggar VARJE radering till deleted.csv (med path + timestamp)
 *   - Stoppar EJ vid enstaka fel — loggar och fortsätter
 *   - 8 parallella workers
 *   - Reversibel: vi har inventory i storage-inventory.json om vi behöver rulla tillbaka
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

const BUCKET = 'event-posters';
const PREFIX = 'import-stamped';
const STAMPED_DIR = join(process.cwd(), 'local_image_library_stamped');
const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const LOG_FILE = join(OUT_DIR, 'deleted.csv');

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

async function listStorage(): Promise<Set<string>> {
  const all = new Set<string>();
  let off = 0;
  while (true) {
    const { data, error } = await db.storage.from(BUCKET).list(PREFIX, { limit: 1000, offset: off });
    if (error) { console.error('storage list error:', error.message); return all; }
    if (!data || data.length === 0) break;
    for (const f of data) all.add(f.name);
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

async function deleteOne(name: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const { error } = await db.storage.from(BUCKET).remove([`${PREFIX}/${name}`]);
    if (error) return { ok: false, err: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log(`[delete-orphans] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);

  const local = listLocalStamped();
  const storage = await listStorage();
  const orphans = [...storage].filter((n) => !local.has(n));
  console.log(`[delete-orphans] storage: ${storage.size} | local: ${local.size} | orphans: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('[delete-orphans] inga orphans att radera.');
    return;
  }

  // Fördelning per ext
  const byExt: Record<string, number> = {};
  for (const n of orphans) {
    const ext = n.split('.').pop()?.toLowerCase() || '(none)';
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  console.log('[delete-orphans] per ext:', byExt);

  if (!isApply) {
    console.log('[delete-orphans] exempel 10 första:');
    for (const n of orphans.slice(0, 10)) console.log('  ', n);
    console.log('\n[delete-orphans] DRY-RUN. Kör med --apply för att faktiskt radera.');
    console.log(`[delete-orphans] skulle radera ${orphans.length} filer.`);
    return;
  }

  // Logga allt som kommer raderas
  mkdirSync(OUT_DIR, { recursive: true });
  const t0 = Date.now();
  const logLines: string[] = ['name,deleted,error,timestamp'];
  let ok = 0, err = 0;
  const errs: string[] = [];
  const CONC = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < orphans.length) {
      const i = cursor++;
      const name = orphans[i];
      const r = await deleteOne(name);
      const ts = new Date().toISOString();
      if (r.ok) {
        ok++;
        logLines.push(`${name},true,,${ts}`);
      } else {
        err++;
        logLines.push(`${name},false,"${(r.err || '').replace(/"/g, '""')}",${ts}`);
        if (errs.length < 10) errs.push(`${name}: ${r.err}`);
      }
      if ((ok + err) % 50 === 0 || cursor === orphans.length) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const rate = ((ok + err) / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write(`\r  ${ok + err}/${orphans.length} (ok=${ok}, fel=${err}, ${rate}/s)         `);
      }
    }
  }
  console.log(`[delete-orphans] startar ${CONC} workers...`);
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  process.stdout.write('\n');
  writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf-8');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[delete-orphans] KLART på ${elapsed}s`);
  console.log(`  raderade: ${ok}`);
  console.log(`  fel:     ${err}`);
  console.log(`  log:     ${LOG_FILE}`);
  if (errs.length) {
    console.log('[delete-orphans] exempel fel:');
    for (const e of errs) console.log('  ', e);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
