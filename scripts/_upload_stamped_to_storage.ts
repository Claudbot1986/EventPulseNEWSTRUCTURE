#!/usr/bin/env -S npx tsx
/**
 * _upload_stamped_to_storage.ts — ladda upp 697 missing-filer från
 * local_image_library_stamped/ till Supabase Storage.
 *
 * Hoppar över filer som redan finns i storage (idempotent). Gör INTE
 * image_library-upsert — de flesta rader finns redan.
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Storage: upsert=true
 *   - Skip existing
 *   - Stoppar EJ vid enstaka fel — loggar och fortsätter
 *   - 8 parallella workers
 */

import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
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
const STORAGE_PREFIX = 'import-stamped';
const SRC_DIR = join(process.cwd(), 'local_image_library_stamped');
const ALLOWED_EXT = new Set(['.webp']); // stamped dir innehåller .webp + .xmp, vi vill bara .webp

const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const LOG_FILE = join(OUT_DIR, 'upload-log.json');

const isApply = process.argv.includes('--apply');

function listStorageFiles(): Promise<Set<string>> {
  return new Promise(async (resolve) => {
    const all = new Set<string>();
    let off = 0;
    while (true) {
      const { data, error } = await db.storage.from(BUCKET).list(STORAGE_PREFIX, { limit: 1000, offset: off });
      if (error) { console.error('storage list error:', error.message); resolve(all); return; }
      if (!data || data.length === 0) break;
      for (const f of data) all.add(f.name);
      if (data.length < 1000) break;
      off += 1000;
    }
    resolve(all);
  });
}

interface FileJob {
  localPath: string;
  storagePath: string; // event-posters/import-stamped/<name>
  sizeBytes: number;
  category: string;    // local subdir
}

function collectFiles(): FileJob[] {
  const out: FileJob[] = [];
  function walk(dir: string, cat: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) {
        if (name.startsWith('_quarantine') || name === '_test_stamp') continue;
        walk(p, name);
      } else {
        // Normalisera: foo.stamped.webp → foo.webp för storage-naming
        const storageName = name.replace(/\.stamped\.webp$/, '.webp');
        const ext = storageName.substring(storageName.lastIndexOf('.')).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) continue;
        out.push({
          localPath: p,
          storagePath: `${STORAGE_PREFIX}/${storageName}`,
          sizeBytes: s.size,
          category: cat,
        });
      }
    }
  }
  walk(SRC_DIR, '');
  return out;
}

async function uploadOne(job: FileJob): Promise<{ ok: boolean; err?: string }> {
  try {
    const buf = readFileSync(job.localPath);
    const { error } = await db.storage.from(BUCKET).upload(job.storagePath, buf, {
      contentType: 'image/webp',
      cacheControl: 'max-age=31536000',
      upsert: true,
    });
    if (error) return { ok: false, err: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log(`[stamped-upload] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[stamped-upload] källa: ${SRC_DIR}`);

  const allJobs = collectFiles();
  console.log(`[stamped-upload] hittade ${allJobs.length} .webp-filer lokalt (efter dedup av stamped/non-stamped)`);

  // Dedup per storage-name (samma filnamn kan finnas i flera kategorier)
  const seen = new Map<string, FileJob>();
  for (const j of allJobs) {
    if (!seen.has(j.storagePath)) seen.set(j.storagePath, j);
  }
  const uniqueJobs = [...seen.values()];
  console.log(`[stamped-upload] unika storage-paths: ${uniqueJobs.length}`);

  console.log('[stamped-upload] läser storage-listan (kan ta 30s)...');
  const existing = await listStorageFiles();
  console.log(`[stamped-upload] storage har redan ${existing.size} filer`);

  const toUpload = uniqueJobs.filter((j) => {
    const fname = j.storagePath.split('/').pop()!;
    return !existing.has(fname);
  });
  const skipped = uniqueJobs.length - toUpload.length;

  console.log(`[stamped-upload] behöver ladda upp: ${toUpload.length}`);
  console.log(`[stamped-upload] hoppar över (finns redan): ${skipped}`);

  if (toUpload.length === 0) {
    console.log('[stamped-upload] inget att göra.');
    return;
  }

  // Fördelning per kategori
  const byCat: Record<string, number> = {};
  for (const j of toUpload) byCat[j.category] = (byCat[j.category] || 0) + 1;
  console.log('[stamped-upload] per kategori:');
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }

  if (!isApply) {
    console.log('\n[stamped-upload] exempel 5 första:');
    for (const j of toUpload.slice(0, 5)) console.log('  ', j.storagePath);
    console.log('\n[stamped-upload] DRY-RUN. Kör med --apply för att ladda upp.');
    return;
  }

  const t0 = Date.now();
  let ok = 0, err = 0;
  const errs: string[] = [];
  const logEntries: Array<{ path: string; ok: boolean; err?: string; ts: string }> = [];
  // 8 parallella
  const CONC = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < toUpload.length) {
      const i = cursor++;
      const r = await uploadOne(toUpload[i]);
      const ts = new Date().toISOString();
      if (r.ok) {
        ok++;
        logEntries.push({ path: toUpload[i].storagePath, ok: true, ts });
      } else {
        err++;
        logEntries.push({ path: toUpload[i].storagePath, ok: false, err: r.err, ts });
        if (errs.length < 10) errs.push(`${toUpload[i].storagePath}: ${r.err}`);
      }
      if ((ok + err) % 25 === 0 || cursor === toUpload.length) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const rate = ((ok + err) / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write(`\r  ${ok + err}/${toUpload.length} (ok=${ok}, fel=${err}, ${rate}/s)         `);
      }
    }
  }
  console.log(`[stamped-upload] startar ${CONC} workers...`);
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[stamped-upload] KLART på ${elapsed}s`);
  console.log(`  ok:  ${ok}`);
  console.log(`  fel: ${err}`);
  if (errs.length) {
    console.log('[stamped-upload] exempel fel:');
    for (const e of errs) console.log('  ', e);
  }

  // Log
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify({ generated_at: new Date().toISOString(), total: toUpload.length, ok, err, entries: logEntries }, null, 2), 'utf-8');
  console.log(`[stamped-upload] log: ${LOG_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
