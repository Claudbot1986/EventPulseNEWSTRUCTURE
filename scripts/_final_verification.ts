#!/usr/bin/env -S npx tsx
/**
 * _final_verification.ts — slutverifiering efter hela städningen.
 *
 * Säkerställer:
 *   1. Storage == local (räkning matchar)
 *   2. Inga events pekar på storage-paths som inte finns
 *   3. Inga events utan bild
 *   4. library active-räkning är rimlig
 *
 * Output till final-verification.txt
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
const OUT_FILE = join(OUT_DIR, 'final-verification.txt');

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
    const { data, error } = await db.storage.from('event-posters').list('import-stamped', { limit: 1000, offset: off });
    if (error) { console.error('storage list error:', error.message); return all; }
    if (!data || data.length === 0) break;
    for (const f of data) all.add(f.name);
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

async function main() {
  console.log('[final-verify] startar slutverifiering...');

  const local = listLocalStamped();
  const storage = await listStorage();
  console.log(`[final-verify] local: ${local.size} | storage: ${storage.size}`);

  const storageMissing = [...local].filter((n) => !storage.has(n));
  const storageOrphans = [...storage].filter((n) => !local.has(n));
  console.log(`[final-verify] missing (lokalt men inte storage): ${storageMissing.length}`);
  console.log(`[final-verify] orphans (storage men inte lokalt): ${storageOrphans.length}`);

  // Library counts
  const { count: libActive } = await db.from('image_library').select('*', { count: 'exact', head: true }).neq('category_slug', '__disabled__');
  const { count: libDisabled } = await db.from('image_library').select('*', { count: 'exact', head: true }).eq('category_slug', '__disabled__');
  console.log(`[final-verify] library: active=${libActive}, disabled=${libDisabled}`);

  // Events utan bild
  const { count: noImage } = await db.from('events').select('*', { count: 'exact', head: true }).or('image_url.is.null,image_url.eq.');
  console.log(`[final-verify] events utan bild: ${noImage}`);

  // Events pekar på 404
  const { data: evs } = await db.from('events').select('id,image_url');
  let bad404 = 0;
  const badExamples: string[] = [];
  for (const e of (evs || [])) {
    if (!e.image_url) continue;
    const m = e.image_url.match(/import-stamped\/([^/?#]+)/);
    if (m && !storage.has(m[1])) {
      bad404++;
      if (badExamples.length < 5) badExamples.push(`${e.id} → ${m[1]}`);
    }
  }
  console.log(`[final-verify] events pekar på 404-storage: ${bad404}`);
  if (badExamples.length) console.log('  exempel:', badExamples);

  // Status counts
  const { data: statusRows } = await db.from('events').select('image_generation_status');
  const statusCount: Record<string, number> = {};
  for (const r of (statusRows || [])) {
    const k = r.image_generation_status || '(null)';
    statusCount[k] = (statusCount[k] || 0) + 1;
  }
  console.log('[final-verify] events per image_generation_status:', statusCount);

  // Pass/fail
  const passed = storageMissing.length === 0 && storageOrphans.length === 0 && noImage === 0 && bad404 === 0;
  console.log(`\n[final-verify] ${passed ? '✓ ALLA GATES PASSED' : '✗ NÅGON GATE FAILED'}`);

  // Rapport
  mkdirSync(OUT_DIR, { recursive: true });
  const lines = [
    `EventPulse storage cleanup — final verification`,
    `Genererad: ${new Date().toISOString()}`,
    ``,
    `=== FILER ===`,
    `local_image_library_stamped: ${local.size} unika filnamn`,
    `supabase storage (event-posters/import-stamped/): ${storage.size} filer`,
    `match: ${local.size === storage.size ? '✓' : '✗'} (skillnad: ${Math.abs(local.size - storage.size)})`,
    ``,
    `=== LIBRARY ===`,
    `active: ${libActive}`,
    `disabled (orphan-pekar): ${libDisabled}`,
    ``,
    `=== EVENTS ===`,
    `utan bild: ${noImage}`,
    `pekar på 404-storage: ${bad404}`,
    `per image_generation_status:`,
    ...Object.entries(statusCount).map(([k, v]) => `  ${k}: ${v}`),
    ``,
    `=== RESULTAT ===`,
    `passed: ${passed ? 'YES' : 'NO'}`,
  ];
  writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf-8');
  console.log(`[final-verify] rapport: ${OUT_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
