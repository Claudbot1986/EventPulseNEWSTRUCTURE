#!/usr/bin/env -S npx tsx
/**
 * _upload_stamped_to_storage.ts — ladda upp ett stämplat bildbibliotek till
 * Supabase Storage och (optionellt) registrera det i image_library.
 *
 * ── Varför skriptet såg ut som det gjorde (och varför det ändrades) ───────
 *
 * 2026-10-29, fyra fel som gjorde att uppladdningen inte kunde fungera:
 *
 *  1. Kategori-undermappen saknades i sökvägen.
 *     `storagePath = ${STORAGE_PREFIX}/${storageName}` laddade upp till
 *     `import-stamped/<fil>.webp`. Men DB:s `image_library.storage_path`
 *     (och därmed den public URL som byggs från den) förväntar sig
 *     `event-posters/import-stamped/<kategori>/<fil>.webp`.
 *     → Uppladdningen landade på en sökväg som ingen pekar på.
 *
 *  2. Fillistan var icke-rekursiv. `list(STORAGE_PREFIX)` returnerar bara
 *     första nivån — med kategori-undermappar skulle det bli katalognamn
 *     ("community") i stället för filnamn.
 *
 *  3. Skip-kontrollen jämförde bara filnamnet (`split('/').pop()`), inte
 *     hela sökvägen. Med kategorier i sökvägen måste jämförelsen vara på
 *     hela sökvägen, annars skulle en fil i fel kategori "fanns" redan.
 *
 *  4. Källmappen var hårdkodad till `local_image_library_stamped` — det
 *     gamla 16:9-biblioteket. Nu är standard `local_image_library_stamped_v2`.
 *
 * ── Aspect ratio-filter ───────────────────────────────────────────────────
 *
 * Default: ladda BARA upp 3:2-bilder (1248×832). Det gamla biblioteket
 * innehåller 16:9 (1280×720) som ska ersättas, och UI:s bildram är låst
 * till 3:2 (LOCKED_EVENT_IMAGE_ASPECT = 1.5). `--include-all` laddar upp
 * alla format.
 *
 * ── Användning ────────────────────────────────────────────────────────────
 *
 *   node --env-file=.env --import tsx scripts/_upload_stamped_to_storage.ts
 *   node --env-file=.env --import tsx scripts/_upload_stamped_to_storage.ts --apply
 *   node --env-file=.env --import tsx scripts/_upload_stamped_to_storage.ts \
 *     --src=local_image_library_stamped_v2 --register --apply
 *
 * Flaggor:
 *   --apply              Skriv (default = dry-run)
 *   --src=<dir>          Källbibliotek (default local_image_library_stamped_v2)
 *   --include-all        Ladda även upp icke-3:2
 *   --register           Registrera i image_library (upsert)
 *
 * Säkerhet:
 *   - Default = --dry-run
 *   - Storage: upsert=true
 *   - Skip existing (på hela sökvägen)
 *   - Stoppar EJ vid enstaka fel — loggar och fortsätter
 *   - 8 parallella workers
 */

import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BUCKET = 'event-posters';
const STORAGE_PREFIX = 'import-stamped';
const ALLOWED_EXT = new Set(['.webp']); // stamped dir innehåller .webp + .xmp, vi vill bara .webp
const TARGET_ASPECT = 1.5; // 3:2
const ASPECT_TOLERANCE = 0.01; // ±1 %

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SRC_DIR = join(process.cwd(), arg('src') ?? 'local_image_library_stamped_v2');
const isApply = process.argv.includes('--apply');
const includeAllAspects = process.argv.includes('--include-all');
const doRegister = process.argv.includes('--register');

const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const LOG_FILE = join(OUT_DIR, 'upload-log.json');

interface FileJob {
  localPath: string;
  storagePath: string;   // import-stamped/<kategori>/<fil>.webp  (utan bucket-namn)
  dbStoragePath: string; // event-posters/import-stamped/<kategori>/<fil>.webp
  sizeBytes: number;
  category: string;      // lokal undermapp = kategori
  aspect: number;
}

/** Rekursiv lista av ALLA filer i bucketen, som sökvägar relative till bucketen. */
async function listStorageFiles(): Promise<Set<string>> {
  const all = new Set<string>();
  async function walk(prefix: string): Promise<void> {
    let off = 0;
    for (;;) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset: off });
      if (error) { console.error('storage list error:', prefix, error.message); return; }
      if (!data || data.length === 0) break;
      for (const f of data) {
        if (f.id) {
          all.add(prefix ? `${prefix}/${f.name}` : f.name);
        } else {
          await walk(prefix ? `${prefix}/${f.name}` : f.name);
        }
      }
      if (data.length < 1000) break;
      off += 1000;
    }
  }
  await walk('');
  return all;
}

async function collectFiles(): Promise<FileJob[]> {
  const out: FileJob[] = [];
  if (!existsSync(SRC_DIR)) {
    console.error(`[stamped-upload] källmappen finns inte: ${SRC_DIR}`);
    return out;
  }
  async function walk(dir: string, cat: string): Promise<void> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) {
        if (name.startsWith('_quarantine') || name === '_test_stamp') continue;
        await walk(p, name);
        continue;
      }
      // Normalisera: foo.stamped.webp → foo.webp för storage-naming
      const storageName = name.replace(/\.stamped\.webp$/, '.webp');
      const ext = storageName.substring(storageName.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;

      let aspect = 0;
      try {
        const meta = await sharp(p).metadata();
        if (!meta.width || !meta.height) continue;
        aspect = meta.width / meta.height;
      } catch {
        continue;
      }
      if (!includeAllAspects && Math.abs(aspect - TARGET_ASPECT) / TARGET_ASPECT > ASPECT_TOLERANCE) {
        continue;
      }

      // Kategori-undermappen ÄR en del av sökvägen — det är så DB:s
      // storage_path (och därmed public URL) är byggd.
      const rel = cat ? `${STORAGE_PREFIX}/${cat}/${storageName}` : `${STORAGE_PREFIX}/${storageName}`;
      out.push({
        localPath: p,
        storagePath: rel,
        dbStoragePath: `${BUCKET}/${rel}`,
        sizeBytes: s.size,
        category: cat || '(root)',
        aspect,
      });
    }
  }
  await walk(SRC_DIR, '');
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

async function registerInLibrary(jobs: FileJob[]): Promise<{ ok: number; err: number }> {
  const base = process.env.SUPABASE_STORAGE_URL
    || 'https://bsllkpvkowwndhhxtlln.supabase.co/storage/v1/object/public';
  let ok = 0, err = 0;
  for (const j of jobs) {
    const { error } = await db.from('image_library').upsert(
      {
        storage_path: j.dbStoragePath,
        public_url: `${base}/${j.dbStoragePath}`,
        category_slug: j.category === '(root)' ? null : j.category,
        tags: ['minimax', 'image-01', 'zoom-variation', 'stamped-2026-10-29'],
        approved_by: 'auto',
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'storage_path' },
    );
    if (error) { err++; if (err <= 5) console.error(`[stamped-upload] register-fel ${j.dbStoragePath}: ${error.message}`); }
    else ok++;
  }
  return { ok, err };
}

async function main() {
  console.log(`[stamped-upload] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[stamped-upload] källa: ${SRC_DIR}`);
  console.log(`[stamped-upload] aspect-filter: ${includeAllAspects ? 'alla format' : `bara ${TARGET_ASPECT} (3:2)`}`);
  console.log(`[stamped-upload] registrera i image_library: ${doRegister}`);

  const allJobs = await collectFiles();
  console.log(`[stamped-upload] hittade ${allJobs.length} .webp-filer lokalt`);

  // Dedup per storage-sökväg (samma filnamn kan finnas i flera kategorier).
  const seen = new Map<string, FileJob>();
  for (const j of allJobs) {
    if (!seen.has(j.storagePath)) seen.set(j.storagePath, j);
  }
  const uniqueJobs = [...seen.values()];
  console.log(`[stamped-upload] unika storage-paths: ${uniqueJobs.length}`);

  console.log('[stamped-upload] läser storage-listan (kan ta 30s)...');
  const existing = await listStorageFiles();
  console.log(`[stamped-upload] storage har redan ${existing.size} filer`);

  const toUpload = uniqueJobs.filter((j) => !existing.has(j.storagePath));
  const skipped = uniqueJobs.length - toUpload.length;

  console.log(`[stamped-upload] behöver ladda upp: ${toUpload.length}`);
  console.log(`[stamped-upload] hoppar över (finns redan): ${skipped}`);

  if (toUpload.length === 0 && !doRegister) {
    console.log('[stamped-upload] inget att göra.');
    return;
  }

  const byCat: Record<string, number> = {};
  for (const j of toUpload) byCat[j.category] = (byCat[j.category] || 0) + 1;
  console.log('[stamped-upload] per kategori:');
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }

  if (!isApply) {
    console.log('\n[stamped-upload] exempel 5 första:');
    for (const j of toUpload.slice(0, 5)) console.log('  ', j.dbStoragePath);
    console.log('\n[stamped-upload] DRY-RUN. Kör med --apply för att ladda upp.');
    return;
  }

  const t0 = Date.now();
  let ok = 0, err = 0;
  const errs: string[] = [];
  const logEntries: Array<{ path: string; ok: boolean; err?: string; ts: string }> = [];
  const CONC = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < toUpload.length) {
      const i = cursor++;
      const r = await uploadOne(toUpload[i]);
      const ts = new Date().toISOString();
      if (r.ok) {
        ok++;
        logEntries.push({ path: toUpload[i].dbStoragePath, ok: true, ts });
      } else {
        err++;
        logEntries.push({ path: toUpload[i].dbStoragePath, ok: false, err: r.err, ts });
        if (errs.length < 10) errs.push(`${toUpload[i].dbStoragePath}: ${r.err}`);
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

  if (doRegister) {
    console.log('[stamped-upload] registrerar i image_library...');
    const reg = await registerInLibrary(toUpload);
    console.log(`[stamped-upload] image_library: ok=${reg.ok} fel=${reg.err}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify({ generated_at: new Date().toISOString(), total: toUpload.length, ok, err, entries: logEntries }, null, 2), 'utf-8');
  console.log(`[stamped-upload] log: ${LOG_FILE}`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
