#!/usr/bin/env -S npx tsx
/**
 * _quarantine_double_stamps.ts — flytta 177 bilder med dubbel-stämpel till
 * quarantine, rensa dem från DB + storage, så att per-kategori regenerering
 * kan börja från noll.
 *
 * Bakgrund (2026-10-08):
 *   - 398 stämplade bilder i local_image_library_stamped/ producerades.
 *   - 221 av dem hade en ren PNG-original i stamping_local/import-original/
 *     → korrekt EN hörnpill.
 *   - 177 saknade original (raderade av gamla _stamp_local_bfl.ts:unlinkSync)
 *     → vi stämplade en redan-stämplad .webp → dubbel-stämpel (gammal
 *     stripe + ny hörnpill).
 *
 * Strategi (användarbeslut 2026-10-08):
 *   - Släng de 177 hellre än att visa fel bilder.
 *   - Quarantine i STAMPED_LIB/_quarantine_double_stamp_2026-10-08/ (INTE
 *     raderade — sparas för eventuell framtida pixel-restore).
 *   - Rensa DB:
 *       a) image_library.storage_path = event-posters/import-stamped/<n>.webp
 *          (den gamla URL:en som pekade på .webp UTAN .stamped-suffix)
 *       b) events.image_url = samma sak OCH image_url = den nya
 *          <n>.stamped.webp (om events pekade på quarantined)
 *   - Rensa Storage:
 *       a) event-posters/import-stamped/<n>.webp  (gammal URL)
 *       b) event-posters/import-stamped/<n>.stamped.webp (om quarantined)
 *
 * Säkerhet:
 *   - Default = --dry-run (visar plan, rör ingenting)
 *   - --apply för skarp körning
 *   - Idempotent: om filen redan ligger i quarantine → skippa flytt
 *   - Om motsvarande rad i image_library redan är borttagen → skippa
 *
 * Användning:
 *   npx tsx scripts/_quarantine_double_stamps.ts --dry-run
 *   npx tsx scripts/_quarantine_double_stamps.ts --apply
 *   npx tsx scripts/_quarantine_double_stamps.ts --only theatre-drama --dry-run
 */
import 'dotenv/config';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const RAW_LIB = join(process.cwd(), 'local_image_library');
const ORIGINALS_LIB = join(process.cwd(), 'stamping_local', 'import-original');
const STAMPED_LIB = join(process.cwd(), 'local_image_library_stamped');
const QUARANTINE_DIR = join(STAMPED_LIB, '_quarantine_double_stamp_2026-10-08');
const STORAGE_BUCKET = 'event-posters';
const STORAGE_PREFIX = 'import-stamped';

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;
const onlyArgIdx = process.argv.indexOf('--only');
const onlyCat = onlyArgIdx >= 0 ? (process.argv[onlyArgIdx + 1] ?? null) : null;

interface QuarantineCandidate {
  cat: string;
  baseName: string;
  stampedWebpPath: string;      // local_image_library_stamped/<cat>/<n>.stamped.webp
  stampedXmpPath: string;       // .stamped.xmp
  oldRawWebpPath: string;       // local_image_library/<cat>/<n>.webp  (sparas orörd)
  oldStoredPath: string;          // event-posters/import-stamped/<n>.webp
  newStoredPath: string;         // event-posters/import-stamped/<n>.stamped.webp
  quarantineWebpPath: string;
  quarantineXmpPath: string;
}

function collectCandidates(): QuarantineCandidate[] {
  const out: QuarantineCandidate[] = [];
  for (const cat of readdirSync(RAW_LIB)) {
    if (cat.startsWith('_') || cat.startsWith('.')) continue;
    if (onlyCat && cat !== onlyCat) continue;
    const catDir = join(RAW_LIB, cat);
    let files: string[];
    try { files = readdirSync(catDir); } catch { continue; }

    const bases = new Set(
      files
        .filter((f) => /\.(webp|png)$/i.test(f) && !f.startsWith('.'))
        .map((f) => f.replace(/\.(webp|png)$/i, '')),
    );

    for (const baseName of bases) {
      // Saknar original? Då är den quarantin-misstänkt.
      const origPng = join(ORIGINALS_LIB, cat, `${baseName}.png`);
      const origWebp = join(ORIGINALS_LIB, cat, `${baseName}.webp`);
      if (existsSync(origPng) || existsSync(origWebp)) continue;

      const stampedFname = `${baseName}.stamped.webp`;
      const stampedXmpFname = `${baseName}.stamped.xmp`;
      const stampedWebpPath = join(STAMPED_LIB, cat, stampedFname);
      const stampedXmpPath = join(STAMPED_LIB, cat, stampedXmpFname);

      // Filen i STAMPED_LIB måste faktiskt finnas — annars är den redan
      // borttagen och vi behöver inte quarantin-flytta.
      if (!existsSync(stampedWebpPath)) continue;

      const oldRawWebpPath = join(catDir, `${baseName}.webp`);
      const oldStoredPath = `${STORAGE_BUCKET}/${STORAGE_PREFIX}/${baseName}.webp`;
      const newStoredPath = `${STORAGE_BUCKET}/${STORAGE_PREFIX}/${stampedFname}`;
      const quarantineWebpPath = join(QUARANTINE_DIR, cat, stampedFname);
      const quarantineXmpPath = join(QUARANTINE_DIR, cat, stampedXmpFname);

      out.push({
        cat,
        baseName,
        stampedWebpPath,
        stampedXmpPath,
        oldRawWebpPath,
        oldStoredPath,
        newStoredPath,
        quarantineWebpPath,
        quarantineXmpPath,
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`[quarantine] mode=${isApply ? 'APPLY' : 'DRY-RUN'} only=${onlyCat ?? 'alla'}`);
  console.log(`[quarantine] STAMPED_LIB (read-only):  ${STAMPED_LIB}`);
  console.log(`[quarantine] QUARANTINE_DIR (target):  ${QUARANTINE_DIR}`);
  console.log(`[quarantine] storage prefix:          ${STORAGE_BUCKET}/${STORAGE_PREFIX}/`);
  console.log('');

  const items = collectCandidates();
  console.log(`[quarantine] hittade ${items.length} kandidater.`);
  if (items.length === 0) {
    console.log('[quarantine] inga bilder behöver flyttas — antingen redan sanerat eller alla har original.');
    process.exit(0);
  }

  const grouped = new Map<string, number>();
  for (const it of items) grouped.set(it.cat, (grouped.get(it.cat) ?? 0) + 1);
  console.log('  fördelning:');
  for (const [cat, n] of [...grouped.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(20)} ${n}`);
  }
  console.log('');

  if (isDryRun) {
    console.log('[quarantine] DRY-RUN: inga filer flyttas, ingen DB/storage rensas.');
    console.log('Kör med --apply för att köra skarpt.');
    process.exit(0);
  }

  // 1. Skapa quarantine-mappen
  mkdirSync(QUARANTINE_DIR, { recursive: true });

  // 2. Hämta image_library-rader som matchar quarantined storage_paths
  const storedPaths = items.map((i) => i.newStoredPath);
  // Supabase PostgREST .in() stöder tusentals IDs — dela i batchar om nödvändigt
  const BATCH = 200;
  const libRows: Array<{ id: string; storage_path: string; public_url: string | null }> = [];
  for (let i = 0; i < storedPaths.length; i += BATCH) {
    const batch = storedPaths.slice(i, i + BATCH);
    const { data, error } = await db
      .from('image_library')
      .select('id, storage_path, public_url')
      .in('storage_path', batch);
    if (error) {
      console.error('[quarantine] image_library query error:', error.message);
      process.exit(2);
    }
    if (data) libRows.push(...(data as typeof libRows));
  }
  console.log(`[quarantine] hittade ${libRows.length} image_library-rader att ta bort.`);

  // 3. Events-fråga: vi bryr oss bara om events som pekar EXAKT på de
  //    177 quarantined storage_paths (nya URLs .stamped.webp). Det är en
  //    liten mängd eftersom _restamp_bulk.ts redan hanterar 12 702 events
  //    som pekar på gamla .webp-URL:er.
  //
  //    För säkerhets skull frågar vi en bild i taget per storage_path
  //    (Supabase .in() med 354 okontrollerade URLs är opålitligt).
  const eventRows: Array<{ id: string; image_url: string }> = [];
  const newUrls = items.map((i) => {
    const base = process.env.SUPABASE_STORAGE_URL || process.env.AI_IMAGE_PUBLIC_URL
      || `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}`;
    return `${base.replace(/\/$/, '')}/${i.newStoredPath.replace(/^\//, '')}`;
  });
  for (const url of newUrls) {
    const { data, error } = await db
      .from('events')
      .select('id, image_url')
      .eq('image_url', url)
      .limit(50);
    if (error) {
      console.error(`[quarantine] events eq-query error (${url.slice(0, 80)}...): ${error.message}`);
      continue;
    }
    if (data) eventRows.push(...(data as typeof eventRows));
  }
  console.log(`[quarantine] hittade ${eventRows.length} events vars image_url pekar EXAKT på quarantined storage.`);

  // 4. Utför
  let movedFiles = 0, skippedFiles = 0,
      deletedLibRows = 0, deletedEvents = 0,
      deletedStorage = 0, failCount = 0;

  // 4a. Flytta filer (.stamped.webp + .stamped.xmp) → QUARANTINE_DIR
  for (const it of items) {
    const catQuarDir = join(QUARANTINE_DIR, it.cat);
    if (!existsSync(catQuarDir)) mkdirSync(catQuarDir, { recursive: true });
    try {
      if (existsSync(it.quarantineWebpPath)) {
        skippedFiles++;
      } else {
        renameSync(it.stampedWebpPath, it.quarantineWebpPath);
        movedFiles++;
      }
      if (existsSync(it.stampedXmpPath) && !existsSync(it.quarantineXmpPath)) {
        renameSync(it.stampedXmpPath, it.quarantineXmpPath);
      }
    } catch (e) {
      failCount++;
      console.error(`  ✗ move ${it.cat}/${it.baseName}: ${(e as Error).message}`);
    }
  }
  console.log(`[quarantine] flyttade ${movedFiles} filer (skip ${skippedFiles} redan-i-quarantine).`);

  // 4b. Ta bort image_library-rader
  if (libRows.length > 0) {
    const ids = libRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const { error } = await db.from('image_library').delete().in('id', batch);
      if (error) {
        console.error(`  ✗ image_library delete: ${error.message}`);
        failCount++;
      } else {
        deletedLibRows += batch.length;
      }
    }
    console.log(`[quarantine] tog bort ${deletedLibRows} image_library-rader.`);
  }

  // 4c. Nulla events.image_url för events som pekade på quarantined URLs
  if (eventRows.length > 0) {
    const ids = eventRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const { error } = await db.from('events').update({
        image_url: null,
        image_attribution: null,
        image_license: null,
        image_source_url: null,
        image_ai_generated: false,
        image_generation_status: 'pending',
      }).in('id', batch);
      if (error) {
        console.error(`  ✗ events update: ${error.message}`);
        failCount++;
      } else {
        deletedEvents += batch.length;
      }
    }
    console.log(`[quarantine] nollade ${deletedEvents} events.image_url.`);
  }

  // 4d. Ta bort filer från Storage (event-posters/import-stamped/)
  // Både gamla URL:en (.webp) och nya (.stamped.webp).
  const storagePaths = [
    ...items.map((i) => `${STORAGE_PREFIX}/${i.baseName}.webp`),
    ...items.map((i) => `${STORAGE_PREFIX}/${i.baseName}.stamped.webp`),
  ];
  // Supabase Storage remove() tar en array
  for (let i = 0; i < storagePaths.length; i += BATCH) {
    const batch = storagePaths.slice(i, i + BATCH);
    const { error } = await db.storage.from(STORAGE_BUCKET).remove(batch);
    if (error) {
      console.error(`  ✗ storage remove: ${error.message}`);
      failCount++;
    } else {
      deletedStorage += batch.length;
    }
  }
  console.log(`[quarantine] tog bort ${deletedStorage} storage-objekt.`);

  console.log('');
  console.log(`[quarantine] DONE.`);
  console.log(`  flyttade filer:        ${movedFiles}`);
  console.log(`  redan-i-quarantine:    ${skippedFiles}`);
  console.log(`  image_library-rader:   ${deletedLibRows}`);
  console.log(`  events.image_url noll: ${deletedEvents}`);
  console.log(`  storage-objekt bort:   ${deletedStorage}`);
  console.log(`  fel:                   ${failCount}`);
  console.log('');
  console.log(`[quarantine] quarantine-mapp: ${QUARANTINE_DIR}`);
  console.log(`[quarantine] rå-biblioteket orört (git status local_image_library/ bör vara tomt).`);
  console.log('');
  console.log('NÄSTA STEG: kör per-kategori regenerering med _regen_category.ts. Exempel:');
  console.log('  npx tsx scripts/_regen_category.ts --only theatre-drama --apply');
}

main().catch((err) => { console.error('[quarantine] FATAL:', err); process.exit(99); });