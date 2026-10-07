#!/usr/bin/env -S npx tsx
/**
 * _stamp_local_bfl.ts — stampa ALLA BFL-bilder och leverera som WebP q80.
 *
 * Anledning: events_public pekar uteslutande på .webp för AI-genererade
 * events (12960 events: 8948 png / 4010 webp; ALLA 396 ai-generated=true
 * pekar på webp). Lokala BFL-bilder är just nu stämplade PNG — vi måste
 * konvertera till webp för att matcha DB-format och spara lagringsutrymme.
 *
 * Pipeline (säker):
 *   1. KOPIERA original-PNG från local_image_library/<cat>/<name>.png
 *      → stamping_local/import-original/<cat>/<name>.png   (backup)
 *   2. Stämpla PNG i minnet med applyAiCompliance() (sharp composite + XMP)
 *   3. Verifiera stämpeln mot original (pixel-diff > 0.5)
 *   4. Konvertera stämplad PNG till WebP q80 (sharp webp, effort 4)
 *   5. Skriv webp till stamping_local/import-stamped/<cat>/<name>.webp
 *   6. Först efter att steg 1-5 lyckats: ta bort original-PNG i library och
 *      ersätt med stämplad .webp (samma basename, bara ändelsen .webp).
 *
 * Säkerhet:
 *   - Original-PNG flyttas aldrig innan stämpling + konvertering är klar.
 *     Vid minsta fel: originalet ligger kvar i både library OCH import-original/.
 *   - Backup-originaler i stamping_local/import-original/ finns kvar tills
 *     användaren explicit rensar dem efter QA.
 *   - Idempotent: om import-stamped/<cat>/<name>.webp redan finns, skippa.
 *
 * Användning:
 *   npx tsx scripts/_stamp_local_bfl.ts [--only theatre-drama] [--force] [--dry-run]
 */

import 'dotenv/config';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
  copyFileSync, unlinkSync, renameSync,
} from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

import { applyAiCompliance, checkAiStamp } from '../08-Agent/tools/ai_compliance';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'local_image_library');
const STAMP_ROOT = join(ROOT, 'stamping_local');
const ORIGINAL_DIR = join(STAMP_ROOT, 'import-original');
const STAMPED_DIR = join(STAMP_ROOT, 'import-stamped');

const MODEL_TAG = 'flux-pro-1.1';
const POSITION = 'bottom-left' as const;
const WEBP_QUALITY = 80;
const WEBP_EFFORT = 4;

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'));
}

function copyOriginals(cat: string): { copied: number; skipped: number } {
  const srcCat = join(SRC_DIR, cat);
  if (!existsSync(srcCat)) return { copied: 0, skipped: 0 };
  mkdirSync(join(ORIGINAL_DIR, cat), { recursive: true });

  const files = listPngs(srcCat);
  let copied = 0;
  let skipped = 0;
  for (const f of files) {
    const dst = join(ORIGINAL_DIR, cat, f);
    if (existsSync(dst) && !force) {
      skipped++;
      continue;
    }
    copyFileSync(join(srcCat, f), dst);
    copied++;
  }
  return { copied, skipped };
}

interface StampResult {
  cat: string;
  name: string;
  status: 'ok' | 'dry-run' | 'skipped-already' | 'fail';
  bytes?: number;
  changedRatio?: number | null;
  method?: 'diff' | 'xmp';
  pngBytes?: number;
  webpBytes?: number;
  error?: string;
}

async function stampOne(cat: string, name: string): Promise<StampResult> {
  const originalPath = join(ORIGINAL_DIR, cat, name);
  const stampedPngPath = join(STAMPED_DIR, cat, name);                  // .png
  const stampedWebpPath = stampedPngPath.replace(/\.png$/i, '.webp');   // .webp
  const finalWebpPath = join(SRC_DIR, cat, name.replace(/\.png$/i, '.webp'));
  const sourcePngPath = join(SRC_DIR, cat, name);

  if (existsSync(stampedWebpPath) && !force) {
    return { cat, name, status: 'skipped-already' };
  }

  if (!existsSync(originalPath)) {
    return { cat, name, status: 'fail', error: 'original missing' };
  }

  mkdirSync(join(STAMPED_DIR, cat), { recursive: true });

  const buffer = readFileSync(originalPath);
  const metaPath = sourcePngPath.replace(/\.png$/i, '.json');
  const prompt = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf8')).prompt ?? MODEL_TAG)
    : MODEL_TAG;

  // 1. Stämpla (PNG med AI-stämpel + XMP i iTXt-chunk)
  let stampedPng: Buffer;
  try {
    stampedPng = await applyAiCompliance({
      buffer,
      prompt,
      model: MODEL_TAG,
      position: POSITION,
    });
  } catch (e) {
    return {
      cat, name, status: 'fail',
      error: `apply: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 2. Verifiera stämpeln mot original (pixel-diff > 0.5)
  const check = await checkAiStamp(stampedPng, POSITION, buffer);
  if (!check.ok) {
    return {
      cat, name, status: 'fail',
      error: `stamp verification failed: changedRatio=${(check.changedRatio ?? 0).toFixed(3)} method=${check.method}`,
    };
  }

  // 3. Konvertera stämplad PNG → WebP q80 (effort 4 = production-recept)
  let stampedWebp: Buffer;
  try {
    stampedWebp = await sharp(stampedPng)
      .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
      .toBuffer();
  } catch (e) {
    return {
      cat, name, status: 'fail',
      error: `webp encode: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (dryRun) {
    return {
      cat, name, status: 'dry-run',
      pngBytes: stampedPng.length,
      webpBytes: stampedWebp.length,
      changedRatio: check.changedRatio,
    };
  }

  // 4. Skriv WebP till staging-mappen (behåll .png-version också för felsökning)
  writeFileSync(stampedPngPath, stampedPng);
  writeFileSync(stampedWebpPath, stampedWebp);

  // 5. Först nu — när ALLT är klart och verifierat — ersätt original-PNG
  //    i library med stämplad WebP. Original-PNG flyttas bort (inte
  //    raderas — backup finns kvar i stamping_local/import-original/).
  if (existsSync(sourcePngPath)) {
    try {
      unlinkSync(sourcePngPath);
    } catch (e) {
      return {
        cat, name, status: 'fail',
        error: `remove source png: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  // Flytta webp från staging till library (samma filsystem-rename)
  // för atomicitet inom samma volym.
  try {
    renameSync(stampedWebpPath, finalWebpPath);
  } catch (e) {
    // Om rename misslyckas (cross-device), fall tillbaka till copy+unlink
    try {
      copyFileSync(stampedWebpPath, finalWebpPath);
      unlinkSync(stampedWebpPath);
    } catch (e2) {
      return {
        cat, name, status: 'fail',
        error: `move webp to library: ${e2 instanceof Error ? e2.message : String(e2)}`,
      };
    }
  }

  return {
    cat, name, status: 'ok',
    bytes: stampedWebp.length,
    pngBytes: stampedPng.length,
    webpBytes: stampedWebp.length,
    changedRatio: check.changedRatio,
    method: check.method,
  };
}

interface CategorySummary { cat: string; ok: number; fail: number; skip: number; }

async function processCategory(cat: string): Promise<CategorySummary> {
  const { copied, skipped } = copyOriginals(cat);
  if (copied > 0 || skipped > 0) {
    console.log(`  [${cat}] original: ${copied} kopierade, ${skipped} redan i import-original/`);
  }

  const originals = listPngs(join(ORIGINAL_DIR, cat));
  if (originals.length === 0) return { cat, ok: 0, fail: 0, skip: 0 };

  const results = await Promise.all(originals.map((n) => stampOne(cat, n)));
  let ok = 0, fail = 0, skip = 0;
  for (const r of results) {
    if (r.status === 'ok' || r.status === 'dry-run') ok++;
    else if (r.status === 'skipped-already') skip++;
    else {
      fail++;
      console.error(`  ✗ ${cat}/${r.name}: ${r.error}`);
    }
  }
  return { cat, ok, fail, skip };
}

const cats = readdirSync(SRC_DIR).filter((d) => {
  if (only && d !== only) return false;
  const sub = join(SRC_DIR, d);
  try {
    return readdirSync(sub).some((f) => f.toLowerCase().endsWith('.png'));
  } catch { return false; }
});

console.log(`[stamp-local] ${cats.length} kategorier, force=${force}, dryRun=${dryRun}`);
console.log(`[stamp-local] src=${SRC_DIR}`);
console.log(`[stamp-local] inkommande: ${ORIGINAL_DIR}`);
console.log(`[stamp-local] stämplade:  ${STAMPED_DIR}`);
console.log(`[stamp-local] output-format: webp q${WEBP_QUALITY} effort ${WEBP_EFFORT}`);

mkdirSync(ORIGINAL_DIR, { recursive: true });
mkdirSync(STAMPED_DIR, { recursive: true });

const t0 = Date.now();
const all = await Promise.all(cats.map(processCategory));
const total = ((Date.now() - t0) / 1000).toFixed(1);

let ok = 0, fail = 0, skip = 0;
let totalPng = 0, totalWebp = 0;
for (const r of all) {
  ok += r.ok;
  fail += r.fail;
  skip += r.skip;
}

console.log('');
console.log(`[stamp-local] DONE in ${total}s`);
console.log(`  stämplade & konverterade: ${ok}${dryRun ? ' (dry-run)' : ''}`);
console.log(`  redan klart:              ${skip}`);
console.log(`  misslyckade:              ${fail}`);
console.log(`  backup-originals (PNG):   ${ORIGINAL_DIR} (radera manuellt efter QA)`);
console.log(`  stämplade kopior:         ${STAMPED_DIR}`);

if (fail > 0) process.exit(1);