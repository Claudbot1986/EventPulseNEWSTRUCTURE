#!/usr/bin/env -S npx tsx
/**
 * _stamp_bulk.ts — stämpla ALLA rå-bilder i local_image_library/ och
 * leverera stämplade kopior i separat syskonkatalog.
 *
 * Skillnad mot _stamp_local_bfl.ts (DEPRECERAD):
 *   - Rå-bilder i local_image_library/ rörs ALDRIG (varken byte-tröskel
 *     eller tas bort). Original är ständig.
 *   - Stämplade bilder hamnar i local_image_library_stamped/<cat>/ (NY
 *     syskonkatalog), inte i samma mapp som rå-bilderna.
 *   - Filnamn får suffix `.stamped.webp` för att tydligt skilja från rå
 *     .webp som ev. finns lokalt.
 *   - In-place-stämpling ersätts helt med kopiera + stämpla.
 *
 * Pipeline per bild (säker):
 *   1. Läs bytes från local_image_library/<cat>/<name>.{webp,png}
 *      (read-only — inga skrivoperationer i RAW_LIB).
 *   2. Läs metadata från local_image_library/<cat>/<name>.json
 *      (använd default-prompt om .json saknas).
 *   3. Skapa local_image_library_stamped/<cat>/ om den inte finns.
 *   4. applyAiCompliance({ buffer, prompt, model, position: 'bottom-left' })
 *   5. Verifiera med checkAiStamp (kräver verify.ok=true, annars skippa).
 *   6. sharp.webp({ quality: 80 }) → WebP q80.
 *   7. Skriv local_image_library_stamped/<cat>/<name>.stamped.webp.
 *   8. Skriv local_image_library_stamped/<cat>/<name>.stamped.xmp.
 *   9. Ladda upp WebP till Supabase Storage event-post/import-stamped/.
 *  10. Upsert image_library-tabellen (storage_path unik).
 *
 * Säkerhet:
 *   - Default = --dry-run (visar plan, skriver inte)
 *   - --apply för skarp körning
 *   - Idempotent: om .stamped.webp redan finns lokalt → skippa
 *   - --force: re-stämpla även om .stamped.webp finns (vid design-byte)
 *   - Fail-mode: per-bild fel loggas och hoppas över, körningen fortsätter
 *
 * Användning:
 *   npx tsx scripts/_stamp_bulk.ts                          # dry-run alla
 *   npx tsx scripts/_stamp_bulk.ts --only exhibition         # dry-run en kategori
 *   npx tsx scripts/_stamp_bulk.ts --only exhibition --apply --force
 *   npx tsx scripts/_stamp_bulk.ts --apply --force          # alla kategorier
 */
import 'dotenv/config';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { applyAiCompliance, checkAiStamp, buildAiXmp } from '../08-Agent/tools/ai_compliance';

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
const STORAGE_BUCKET = 'event-posters';
const STORAGE_PREFIX = 'import-stamped';
const MODEL_DEFAULT = 'flux-pro-1.1';

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const isApply = process.argv.includes('--apply');
const isForce = process.argv.includes('--force');
const isDryRun = !isApply;

interface RawImage {
  cat: string;
  filename: string;          // filnamn i RAW_LIB (för log)
  sourcePath: string;        // faktisk sökväg att läsa ifrån (originals om finns)
  sourceFilename: string;    // filnamn i originals/RAW_LIB
  sourceIsOriginal: boolean; // true om vi läser från import-original/
  rawPath: string;
  metaPath: string;
  stampedWebpPath: string;
  stampedXmpPath: string;
  storagePath: string;
  publicUrl: string;
}

function publicUrlFor(storagePath: string): string {
  const base = process.env.SUPABASE_STORAGE_URL || process.env.AI_IMAGE_PUBLIC_URL
    || `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}`;
  return `${base.replace(/\/$/, '')}/${storagePath.replace(/^\//, '')}`;
}

function collectImages(): RawImage[] {
  const out: RawImage[] = [];
  for (const cat of readdirSync(RAW_LIB)) {
    if (only && cat !== only) continue;
    if (cat.startsWith('_') || cat.startsWith('.')) continue;
    const catDir = join(RAW_LIB, cat);
    let stat: ReturnType<typeof readdirSync>;
    try { stat = readdirSync(catDir); } catch { continue; }

    // Bygg en map baseName → { webp?, png? } för att hantera dubbletter.
    // Många bilder finns som både .webp och .png; vi vill bara processa en.
    // Prioritet: .webp (slutformat) > .png (mellanformat).
    const byBase = new Map<string, { webp?: string; png?: string }>();
    for (const f of stat) {
      const lower = f.toLowerCase();
      if (!lower.endsWith('.webp') && !lower.endsWith('.png')) continue;
      if (f.startsWith('.')) continue;
      const baseName = f.replace(/\.(webp|png)$/i, '');
      const existing = byBase.get(baseName) ?? {};
      if (lower.endsWith('.webp')) existing.webp = f;
      else existing.png = f;
      byBase.set(baseName, existing);
    }

    for (const [baseName, formats] of byBase.entries()) {
      const chosen = formats.webp ?? formats.png;
      if (!chosen) continue;
      const stampedFname = `${baseName}.stamped.webp`;
      const stampedXmpFname = `${baseName}.stamped.xmp`;
      const storagePath = `${STORAGE_BUCKET}/${STORAGE_PREFIX}/${stampedFname}`;

      // Säkerhetsregel (användarbeslut 2026-10-08): använd ALLTID ostämplad
      // original från stamping_local/import-original/ om den finns. RAW_LIB
      // kan innehålla gamla stämplade webp (1024×64 stripe-design från
      // _stamp_local_bfl.ts som raderat PNG-original). Att stämpla en
      // redan-stämplad bild ger dubbel-stämpel.
      //
      // Format-prioritet för originals: .png (orörd från BFL) > .webp.
      let sourceFilename = chosen;
      let sourcePath = join(catDir, chosen);
      let sourceIsOriginal = false;
      const originalPng = join(ORIGINALS_LIB, cat, `${baseName}.png`);
      const originalWebp = join(ORIGINALS_LIB, cat, `${baseName}.webp`);
      if (existsSync(originalPng)) {
        sourcePath = originalPng;
        sourceFilename = `${baseName}.png`;
        sourceIsOriginal = true;
      } else if (existsSync(originalWebp)) {
        sourcePath = originalWebp;
        sourceFilename = `${baseName}.webp`;
        sourceIsOriginal = true;
      }

      out.push({
        cat,
        filename: chosen,
        sourcePath,
        sourceFilename,
        sourceIsOriginal,
        rawPath: join(catDir, chosen),
        metaPath: join(catDir, `${baseName}.json`),
        stampedWebpPath: join(STAMPED_LIB, cat, stampedFname),
        stampedXmpPath: join(STAMPED_LIB, cat, stampedXmpFname),
        storagePath,
        publicUrl: publicUrlFor(storagePath),
      });
    }
  }
  return out;
}

interface StampResult {
  cat: string;
  filename: string;
  status: 'ok' | 'dry-run' | 'skipped-existing' | 'fail';
  bytes?: number;
  changedRatio?: number | null;
  error?: string;
}

async function stampOne(img: RawImage): Promise<StampResult> {
  // 1. Idempotens: skippa om redan stämplad (utan --force)
  if (existsSync(img.stampedWebpPath) && !isForce) {
    return { cat: img.cat, filename: img.filename, status: 'skipped-existing' };
  }

  // 2. Läs rå bytes från sourcePath (ostämplad original om finns, annars
  //    RAW_LIB). RAW_LIB rörs aldrig vid läsning heller — vi kopierar inte,
  //    vi läser bara bytes från den säkra originals-källan.
  let rawBytes: Buffer;
  try {
    rawBytes = readFileSync(img.sourcePath);
  } catch (e) {
    return { cat: img.cat, filename: img.filename, status: 'fail', error: `read source: ${(e as Error).message}` };
  }

  // 3. Läs metadata (prompt + model), fallback till default
  let prompt = '';
  let model = MODEL_DEFAULT;
  if (existsSync(img.metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(img.metaPath, 'utf8'));
      prompt = meta.prompt ?? '';
      model = meta.model ?? MODEL_DEFAULT;
    } catch {
      // Trasig JSON är OK — faller tillbaka till default-prompt
    }
  }

  // 4. Stämpla
  let stampedPng: Buffer;
  try {
    stampedPng = await applyAiCompliance({
      buffer: rawBytes,
      prompt,
      model,
      position: 'bottom-right',  // legacy 240×64 SE-pill (bfl2/3/4-design)
    });
  } catch (e) {
    return { cat: img.cat, filename: img.filename, status: 'fail', error: `apply: ${(e as Error).message}` };
  }

  // 5. Verifiera
  const verify = await checkAiStamp(stampedPng, 'bottom-right', rawBytes);
  if (!verify.ok) {
    return {
      cat: img.cat,
      filename: img.filename,
      status: 'fail',
      error: `verify fail: changedRatio=${(verify.changedRatio ?? 0).toFixed(3)} method=${verify.method}`,
      changedRatio: verify.changedRatio,
    };
  }

  // 6. Konvertera till WebP
  let webp: Buffer;
  try {
    webp = await sharp(stampedPng).webp({ quality: 80 }).toBuffer();
  } catch (e) {
    return { cat: img.cat, filename: img.filename, status: 'fail', error: `webp: ${(e as Error).message}` };
  }

  // 7. XMP-sidecar
  const xmpPacket = buildAiXmp({ model, prompt });

  // Dry-run: rapportera plan, skriv inte
  if (isDryRun) {
    return {
      cat: img.cat,
      filename: img.filename,
      status: 'dry-run',
      bytes: webp.length,
      changedRatio: verify.changedRatio,
    };
  }

  // 8. Skriv stämplade filer (till STAMPED_LIB, INTE RAW_LIB)
  mkdirSync(join(STAMPED_LIB, img.cat), { recursive: true });
  writeFileSync(img.stampedWebpPath, webp);
  writeFileSync(img.stampedXmpPath, xmpPacket);

  // 9. Ladda upp till Supabase Storage
  const upload = await db.storage.from(STORAGE_BUCKET).upload(
    `${STORAGE_PREFIX}/${img.stampedWebpPath.split('/').pop()}`,
    webp,
    { contentType: 'image/webp', upsert: true },
  );
  if (upload.error) {
    return {
      cat: img.cat,
      filename: img.filename,
      status: 'fail',
      error: `storage upload: ${upload.error.message}`,
      bytes: webp.length,
      changedRatio: verify.changedRatio,
    };
  }

  // 10. Upsert image_library
  const { error: libErr } = await db.from('image_library').upsert({
    storage_path: img.storagePath,
    public_url: img.publicUrl,
    category_slug: img.cat,
    tags: ['bfl', model, 'stamped-2026-10-08', 'bulk'],
    rating: 3,
    approved_by: 'auto',
  }, { onConflict: 'storage_path', ignoreDuplicates: false });

  if (libErr) {
    return {
      cat: img.cat,
      filename: img.filename,
      status: 'fail',
      error: `image_library upsert: ${libErr.message}`,
      bytes: webp.length,
    };
  }

  return {
    cat: img.cat,
    filename: img.filename,
    status: 'ok',
    bytes: webp.length,
    changedRatio: verify.changedRatio,
  };
}

async function main(): Promise<void> {
  console.log(`[stamp-bulk] mode=${isApply ? 'APPLY' : 'DRY-RUN'} force=${isForce} only=${only ?? 'alla'}`);
  console.log(`[stamp-bulk] src (read-only):  ${RAW_LIB}`);
  console.log(`[stamp-bulk] dst (output):     ${STAMPED_LIB}`);
  console.log(`[stamp-bulk] storage prefix:   ${STORAGE_BUCKET}/${STORAGE_PREFIX}/`);
  console.log('');

  const items = collectImages();
  console.log(`[stamp-bulk] hittade ${items.length} rå-bilder (webp + png) i ${RAW_LIB}`);

  if (items.length === 0) {
    console.log('[stamp-bulk] inga bilder att processa.');
    process.exit(0);
  }

  // Fördelning per kategori
  const byCat = new Map<string, number>();
  for (const it of items) byCat.set(it.cat, (byCat.get(it.cat) ?? 0) + 1);
  console.log('  fördelning:');
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(20)} ${n}`);
  }
  console.log('');

  if (isDryRun) {
    console.log('[stamp-bulk] DRY-RUN: inga filer skrivs, inga uploads, inga DB-ändringar.');
    console.log('Kör med --apply för att köra skarpt. Lägg till --force för att re-stämpla.');
    process.exit(0);
  }

  if (!existsSync(STAMPED_LIB)) mkdirSync(STAMPED_LIB, { recursive: true });

  // Bearbeta parallellt (4 workers — behåller bild-i/minne-footprint rimlig)
  let cursor = 0;
  let ok = 0, skip = 0, fail = 0;
  const failExamples: Array<{ cat: string; filename: string; error: string }> = [];

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const r = await stampOne(items[idx]);
      if (r.status === 'ok') {
        ok++;
        if (ok % 25 === 0) console.log(`  ${ok}/${items.length} ok (senaste: ${r.cat}/${r.filename})`);
      } else if (r.status === 'skipped-existing') {
        skip++;
      } else if (r.status === 'dry-run') {
        ok++;
      } else {
        fail++;
        if (failExamples.length < 10) failExamples.push({ cat: r.cat, filename: r.filename, error: r.error ?? 'unknown' });
        console.error(`  ✗ ${r.cat}/${r.filename}: ${r.error}`);
      }
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(`[stamp-bulk] DONE in ${elapsed}s`);
  console.log(`  stämplade:           ${ok}`);
  console.log(`  skip (befintliga):   ${skip}`);
  console.log(`  misslyckade:         ${fail}`);
  if (fail > 0) {
    console.log('');
    console.log('  Första 10 fel:');
    for (const f of failExamples) console.log(`    - ${f.cat}/${f.filename}: ${f.error}`);
  }
  console.log('');
  console.log(`  stämplade bilder:    ${STAMPED_LIB}`);
  console.log(`  rå-bilder (orörda):  ${RAW_LIB}`);
  console.log('');
  console.log('Verifiera att local_image_library/ är oförändrat:');
  console.log('  git status local_image_library/');

  if (fail > 0 && fail / items.length > 0.15) {
    console.error(`[stamp-bulk] FEL-RATIO > 15% (${fail}/${items.length}) — avbryter med exit 1.`);
    process.exit(1);
  }
}

main().catch(err => { console.error('[stamp-bulk] FATAL:', err); process.exit(99); });