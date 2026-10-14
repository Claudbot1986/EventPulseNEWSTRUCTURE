#!/usr/bin/env -S npx tsx
/**
 * _upload_backup_to_storage.ts — engångs-rescue: ladda upp ALLA bilder från
 * local_image_library_backup/import-stamped/ till Supabase storage så att
 * image_library-rader som pekar på dessa filer slutar vara 404.
 *
 * Bakgrund (2026-10-14): 793 av 5490 library-rader pekade på filer som
 * inte fanns i storage. _upload_bfl_to_library.ts läser från
 * local_image_library_stamped/ (BFL-genererade) men täcker INTE
 * backup-import-stamped/ (gamla bilder, round1 bfl_*, scraped event-bilder).
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Storage: upsert=true (idempotent)
 *   - Hoppar över filer som redan finns i storage (skip=list)
 *   - Stoppar EJ vid enstaka fel — loggar och fortsätter
 */

import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
const SRC_DIRS = [
  join(process.cwd(), 'local_image_library_backup', STORAGE_PREFIX),
  join(process.cwd(), 'local_image_library_backup', 'ai-generated'),
];
const ALLOWED_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg']);

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
}

function collectFiles(): FileJob[] {
  const out: FileJob[] = [];
  const seen = new Set<string>(); // dedup per filnamn, första källan vinner
  for (const dir of SRC_DIRS) {
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir);
    for (const name of names) {
      const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const localPath = join(dir, name);
      const stat = statSync(localPath);
      out.push({
        localPath,
        storagePath: `${STORAGE_PREFIX}/${name}`,
        sizeBytes: stat.size,
      });
    }
  }
  return out;
}

async function uploadOne(job: FileJob): Promise<{ ok: boolean; err?: string }> {
  const contentType =
    job.storagePath.endsWith('.webp') ? 'image/webp' :
    job.storagePath.endsWith('.png') ? 'image/png' :
    job.storagePath.endsWith('.jpg') || job.storagePath.endsWith('.jpeg') ? 'image/jpeg' :
    'application/octet-stream';
  try {
    const buf = readFileSync(job.localPath);
    const { error } = await db.storage.from(BUCKET).upload(job.storagePath, buf, {
      contentType,
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
  console.log(`[backup-upload] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[backup-upload] källor: ${SRC_DIRS.filter(existsSync).join(', ')}`);

  const allJobs = collectFiles();
  console.log(`[backup-upload] hittade ${allJobs.length} unika filer lokalt`);

  console.log('[backup-upload] läser storage-listan (kan ta 30s)...');
  const existing = await listStorageFiles();
  console.log(`[backup-upload] storage har redan ${existing.size} filer`);

  const toUpload = allJobs.filter((j) => {
    const fname = j.storagePath.split('/').pop()!;
    return !existing.has(fname);
  });
  const skipped = allJobs.length - toUpload.length;

  console.log(`[backup-upload] behöver ladda upp: ${toUpload.length}`);
  console.log(`[backup-upload] hoppar över (finns redan): ${skipped}`);

  if (toUpload.length === 0) {
    console.log('[backup-upload] inget att göra.');
    return;
  }

  // Fördelning
  const byExt: Record<string, number> = {};
  for (const j of toUpload) {
    const ext = j.storagePath.split('.').pop()!;
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  console.log('[backup-upload] per ext:', byExt);

  if (!isApply) {
    console.log('[backup-upload] exempel 5 första:');
    for (const j of toUpload.slice(0, 5)) console.log('  ', j.storagePath);
    console.log('\n[backup-upload] DRY-RUN. Kör med --apply för att ladda upp.');
    return;
  }

  const t0 = Date.now();
  let ok = 0, err = 0;
  const errs: string[] = [];
  // 8 parallella
  const CONC = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < toUpload.length) {
      const i = cursor++;
      const r = await uploadOne(toUpload[i]);
      if (r.ok) ok++; else { err++; if (errs.length < 10) errs.push(`${toUpload[i].storagePath}: ${r.err}`); }
      if ((ok + err) % 50 === 0 || cursor === toUpload.length) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const rate = ((ok + err) / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write(`\r  ${ok + err}/${toUpload.length} (ok=${ok}, fel=${err}, ${rate}/s)         `);
      }
    }
  }
  console.log(`[backup-upload] startar ${CONC} workers...`);
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[backup-upload] KLART på ${elapsed}s`);
  console.log(`  ok:  ${ok}`);
  console.log(`  fel: ${err}`);
  if (errs.length) {
    console.log('[backup-upload] exempel fel:');
    for (const e of errs) console.log('  ', e);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
