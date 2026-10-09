#!/usr/bin/env -S npx tsx
/**
 * _upload_bfl_to_library.ts — Fas A: ladda upp 85 webp + registrera i image_library.
 *
 * Säkerhetsmodell:
 *   - Default = --dry-run (visar plan, laddar inte upp)
 *   - --apply för skarp körning
 *   - Storage-upload: upsert=true (idempotent)
 *   - image_library: addToLibrary() är idempotent (storage_path UNIQUE)
 *   - Vid minsta fel: skriptet stoppar vid första misslyckade filen
 *
 * Användning:
 *   npx tsx scripts/_upload_bfl_to_library.ts --dry-run   # default
 *   npx tsx scripts/_upload_bfl_to_library.ts --apply
 *   npx tsx scripts/_upload_bfl_to_library.ts --only theatre-drama
 */

import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STORAGE_BUCKET = 'event-posters';
const STAMPED_PREFIX = 'import-stamped';
const SRC_DIR = join(process.cwd(), 'local_image_library');

// Round5-taggar (2026-10-07) — bfl5_*.webp som genererades för 1/30-påfyllnad.
const TAGS_ROUND5 = ['bfl', 'flux-pro-1.1', 'stamped-2026-10-07', 'round5-1per30'];
// Befintliga round2-taggar (2026-10-06) för bakåtkompatibilitet.
const TAGS_ROUND2 = ['bfl', 'flux-pro-1.1', 'stamped-2026-10-06'];
const DEFAULT_RATING = 3;

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

function publicUrlFor(storagePath: string): string {
  const base = process.env.SUPABASE_STORAGE_URL || process.env.AI_IMAGE_PUBLIC_URL
    || `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}`;
  return `${base.replace(/\/$/, '')}/${storagePath.replace(/^\//, '')}`;
}

interface WebpFile {
  cat: string;
  filename: string;
  storagePath: string;       // event-posters/import-stamped/<name>.webp
  publicUrl: string;
  sizeBytes: number;
}

function collectWebps(): ReadonlyArray<WebpFile> {
  const out: WebpFile[] = [];
  if (!existsSync(SRC_DIR)) {
    console.error(`[upload-bfl] saknar källmapp: ${SRC_DIR}`);
    return [];
  }
  for (const cat of readdirSync(SRC_DIR)) {
    if (only && cat !== only) continue;
    const sub = join(SRC_DIR, cat);
    let stat: string[];
    try {
      stat = readdirSync(sub);
    } catch { continue; }
    for (const f of stat) {
      if (!f.toLowerCase().endsWith('.webp')) continue;
      // Valfri bfl5-only-flagga för staging av round5 (--only5 laddar bara bfl5_).
      if (process.argv.includes('--only5') && !f.startsWith('bfl5_') && !f.startsWith('bfl5b_') && !f.startsWith('bfl5c_') && !f.startsWith('bfl5d_')) continue;
      const storagePath = `${STORAGE_BUCKET}/${STAMPED_PREFIX}/${f}`;
      out.push({
        cat,
        filename: f,
        storagePath,
        publicUrl: publicUrlFor(storagePath),
        sizeBytes: readFileSync(join(sub, f)).length,
      });
    }
  }
  return out;
}

interface AddToLibraryResult {
  ok: boolean;
  id: string | null;
  storage_path: string;
  error?: string;
}

async function addToLibrary(input: {
  storage_path: string;
  public_url: string;
  category_slug: string;
  tags: string[];
  rating: number;
}): Promise<AddToLibraryResult> {
  // Upsert med onConflict: storage_path, ignoreDuplicates: true (samma mönster
  // som 08-Agent/utils/imageLibrary.ts:316-331). Vid konflikt: hämta befintlig.
  const { data: upserted, error: upsertErr } = await db
    .from('image_library')
    .upsert(
      {
        storage_path: input.storage_path,
        public_url: input.public_url,
        category_slug: input.category_slug,
        venue_pattern: null,
        tags: input.tags,
        source_event_id: null,
        rating: input.rating,
        approved_by: 'auto',
      },
      { onConflict: 'storage_path', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  if (upsertErr) {
    return { ok: false, id: null, storage_path: input.storage_path, error: upsertErr.message };
  }
  if (upserted?.id) return { ok: true, id: upserted.id, storage_path: input.storage_path };

  // Konflikt — hämta befintlig rad
  const { data: existing, error: fetchErr } = await db
    .from('image_library')
    .select('id')
    .eq('storage_path', input.storage_path)
    .maybeSingle();
  if (fetchErr) return { ok: false, id: null, storage_path: input.storage_path, error: fetchErr.message };
  return { ok: true, id: existing?.id ?? null, storage_path: input.storage_path };
}

interface UploadResult {
  file: WebpFile;
  ok: boolean;
  libraryId: string | null;
  error?: string;
}

async function uploadAndRegister(file: WebpFile): Promise<UploadResult> {
  const buf = readFileSync(join(SRC_DIR, file.cat, file.filename));

  if (isApply) {
    const storagePath = `${STAMPED_PREFIX}/${file.filename}`;
    const { error: upErr } = await db.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buf, {
        contentType: 'image/webp',
        upsert: true,
        cacheControl: '31536000',
      });
    if (upErr) {
      return { file, ok: false, libraryId: null, error: `storage upload: ${upErr.message}` };
    }
  }

  // Välj tagg-set baserat på filnamn (round5 = bfl5_*, bfl5b_*, bfl5c_*, bfl5d_*).
  const isRound5 = /^bfl5[a-z]?_/.test(file.filename);
  const tags = isRound5 ? TAGS_ROUND5 : TAGS_ROUND2;
  const libRes = await addToLibrary({
    storage_path: file.storagePath,
    public_url: file.publicUrl,
    category_slug: file.cat,
    tags,
    rating: DEFAULT_RATING,
  });
  if (!libRes.ok) {
    return { file, ok: false, libraryId: null, error: `image_library: ${libRes.error}` };
  }

  return { file, ok: true, libraryId: libRes.id };
}

const files = collectWebps();
console.log(`[upload-bfl] hittade ${files.length} webp-filer i ${SRC_DIR}`);
console.log(`[upload-bfl] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
console.log(`[upload-bfl] bucket: ${STORAGE_BUCKET}`);
console.log(`[upload-bfl] prefix: ${STAMPED_PREFIX}/`);

// Sample
if (files.length > 0) {
  const sample = files[0];
  console.log(`[upload-bfl] exempel: cat=${sample.cat} storage=${sample.storagePath} url=${sample.publicUrl.slice(0, 90)}…`);
}

if (isDryRun) {
  // Summering per kategori
  const byCat = new Map<string, number>();
  for (const f of files) byCat.set(f.cat, (byCat.get(f.cat) ?? 0) + 1);
  console.log('');
  console.log('fördelning:');
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }
  console.log('');
  console.log('Kör med --apply för att ladda upp + registrera.');
  process.exit(0);
}

// Apply: kör i 4 concurrency
console.log('');
let cursor = 0;
const results: UploadResult[] = [];
async function worker(): Promise<void> {
  while (cursor < files.length) {
    const idx = cursor++;
    const r = await uploadAndRegister(files[idx]);
    results.push(r);
    if (r.ok) {
      if (results.filter((x) => x.ok).length % 10 === 0) {
        const ok = results.filter((x) => x.ok).length;
        console.log(`  ${ok}/${files.length} ok (senaste: ${r.file.cat}/${r.file.filename})`);
      }
    } else {
      console.error(`  ✗ ${r.file.cat}/${r.file.filename}: ${r.error}`);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: 4 }, () => worker()));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const okCount = results.filter((r) => r.ok).length;
const failCount = results.filter((r) => !r.ok).length;

console.log('');
console.log(`[upload-bfl] DONE in ${elapsed}s`);
console.log(`  uppladdade + registrerade: ${okCount}`);
console.log(`  misslyckade:               ${failCount}`);

// Final verifiering: räkna image_library-rader
const { count: libCount } = await db
  .from('image_library')
  .select('*', { count: 'exact', head: true });
console.log(`  image_library totalt nu:   ${libCount}`);

if (failCount > 0) process.exit(1);