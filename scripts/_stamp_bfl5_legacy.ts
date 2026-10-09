#!/usr/bin/env -S npx tsx
/**
 * _stamp_bfl5_legacy.ts — stämpla ALLA bfl5-bilder med legacy 240×64 SE-pill.
 *
 * Skillnad mot _stamp_bulk.ts:
 *   - Filtrerar BARA bfl5_*.png (rå original från BFL Flux Pro 1.1).
 *   - Hoppar ALDRIG över till .webp i RAW_LIB — det är redan stämplat och
 *     skulle ge dubbelstämpel. .png är den enda råa källan.
 *   - Rör ALDRIG original. Skriver .stamped.webp + .stamped.xmp till
 *     local_image_library_stamped/<cat>/.
 *
 * Säkerhetsmodell (användarbeslut 2026-10-08):
 *   - local_image_library/<cat>/bfl5_*.png är RÅA — aldrig stämplade, rörs aldrig
 *   - local_image_library/<cat>/bfl5_*.webp är REDAN STÄMPLADE — vi hoppar över
 *   - Output: local_image_library_stamped/<cat>/bfl5_*.stamped.webp + .xmp
 *
 * Pipeline per fil:
 *   1. Läs bfl5_*.png (read-only, rörs aldrig)
 *   2. Läs .json för prompt + model
 *   3. applyAiCompliance({ buffer, prompt, model, position: 'bottom-right' })
 *      → stämplad PNG med legacy 240×64 SE-pill
 *   4. sharp(...).webp({ quality: 80 }) → WebP q80
 *   5. buildAiXmp({ model, prompt }) → XMP-sidecar
 *   6. Skriv local_image_library_stamped/<cat>/<name>.stamped.webp
 *   7. Skriv local_image_library_stamped/<cat>/<name>.stamped.xmp
 *
 * Användning:
 *   npx tsx scripts/_stamp_bfl5_legacy.ts                          # dry-run
 *   npx tsx scripts/_stamp_bfl5_legacy.ts --apply                   # kör
 *   npx tsx scripts/_stamp_bfl5_legacy.ts --apply --force           # re-stämpla
 *   npx tsx scripts/_stamp_bfl5_legacy.ts --only exhibition --apply # en kategori
 */
import 'dotenv/config';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { applyAiCompliance, checkAiStamp, buildAiXmp } from '../08-Agent/tools/ai_compliance';

const RAW_LIB = join(process.cwd(), 'local_image_library');
const STAMPED_LIB = join(process.cwd(), 'local_image_library_stamped');
const MODEL_DEFAULT = 'flux-pro-1.1';

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const isApply = process.argv.includes('--apply');
const isForce = process.argv.includes('--force');
const isDryRun = !isApply;

interface Bfl5Item {
  cat: string;
  baseName: string;          // bfl5_a_wide_r0_11fa3cfc18
  pngPath: string;           // source path (read-only)
  metaPath: string;          // .json
  stampedWebpPath: string;   // output
  stampedXmpPath: string;    // output
  alreadyStampedWebp: string; // befintlig stämplad .webp i RAW_LIB (för log)
  hasAlreadyStampedWebp: boolean;
}

function collectBfl5(): Bfl5Item[] {
  const out: Bfl5Item[] = [];
  for (const cat of readdirSync(RAW_LIB)) {
    if (only && cat !== only) continue;
    if (cat.startsWith('_') || cat.startsWith('.')) continue;
    const catDir = join(RAW_LIB, cat);
    let stat: ReturnType<typeof readdirSync>;
    try { stat = readdirSync(catDir); } catch { continue; }

    for (const f of stat) {
      // BARA bfl5_.png — aldrig bfl5_.webp (det är redan stämplat och vi vill
      // inte dubbelstämpla)
      if (!f.startsWith('bfl5_')) continue;
      if (!f.toLowerCase().endsWith('.png')) continue;

      const baseName = f.replace(/\.png$/i, '');
      const pngPath = join(catDir, f);
      const metaPath = join(catDir, `${baseName}.json`);
      if (!existsSync(metaPath)) continue;
      if (!existsSync(pngPath)) continue;

      const stampedWebpPath = join(STAMPED_LIB, cat, `${baseName}.stamped.webp`);
      const stampedXmpPath = join(STAMPED_LIB, cat, `${baseName}.stamped.xmp`);
      const alreadyStampedWebp = join(catDir, `${baseName}.webp`);

      out.push({
        cat,
        baseName,
        pngPath,
        metaPath,
        stampedWebpPath,
        stampedXmpPath,
        alreadyStampedWebp,
        hasAlreadyStampedWebp: existsSync(alreadyStampedWebp),
      });
    }
  }
  return out;
}

interface StampResult {
  cat: string;
  baseName: string;
  status: 'ok' | 'dry-run' | 'skipped-existing' | 'fail';
  bytes?: number;
  changedRatio?: number | null;
  error?: string;
}

async function stampOne(item: Bfl5Item): Promise<StampResult> {
  // 1. Idempotens: skippa om redan stämplad (utan --force)
  if (existsSync(item.stampedWebpPath) && !isForce) {
    return { cat: item.cat, baseName: item.baseName, status: 'skipped-existing' };
  }

  // 2. Läs rå PNG (ostämplat original — rörs aldrig)
  let rawPng: Buffer;
  try {
    rawPng = readFileSync(item.pngPath);
  } catch (e) {
    return { cat: item.cat, baseName: item.baseName, status: 'fail', error: `read png: ${(e as Error).message}` };
  }

  // 3. Läs metadata
  let prompt = '';
  let model = MODEL_DEFAULT;
  try {
    const meta = JSON.parse(readFileSync(item.metaPath, 'utf8'));
    prompt = meta.prompt ?? '';
    model = meta.model ?? MODEL_DEFAULT;
  } catch {
    // trasig JSON → defaults
  }

  // 4. Stämpla med legacy 240×64 SE-pill
  let stampedPng: Buffer;
  try {
    stampedPng = await applyAiCompliance({
      buffer: rawPng,
      prompt,
      model,
      position: 'bottom-right',
    });
  } catch (e) {
    return { cat: item.cat, baseName: item.baseName, status: 'fail', error: `apply: ${(e as Error).message}` };
  }

  // 5. Verifiera mot rå original
  const verify = await checkAiStamp(stampedPng, 'bottom-right', rawPng);
  if (!verify.ok) {
    return {
      cat: item.cat, baseName: item.baseName, status: 'fail',
      error: `verify fail: changedRatio=${(verify.changedRatio ?? 0).toFixed(3)} method=${verify.method}`,
      changedRatio: verify.changedRatio,
    };
  }

  // 6. WebP q80
  let webp: Buffer;
  try {
    webp = await sharp(stampedPng).webp({ quality: 80 }).toBuffer();
  } catch (e) {
    return { cat: item.cat, baseName: item.baseName, status: 'fail', error: `webp: ${(e as Error).message}` };
  }

  // 7. XMP-sidecar
  const xmpPacket = buildAiXmp({ model, prompt });

  if (isDryRun) {
    return { cat: item.cat, baseName: item.baseName, status: 'dry-run', bytes: webp.length, changedRatio: verify.changedRatio };
  }

  // 8. Skriv till STAMPED_LIB (INTE RAW_LIB — original rörs aldrig)
  mkdirSync(join(STAMPED_LIB, item.cat), { recursive: true });
  writeFileSync(item.stampedWebpPath, webp);
  writeFileSync(item.stampedXmpPath, xmpPacket);

  return { cat: item.cat, baseName: item.baseName, status: 'ok', bytes: webp.length, changedRatio: verify.changedRatio };
}

async function main(): Promise<void> {
  console.log(`[stamp-bfl5-legacy] mode=${isApply ? 'APPLY' : 'DRY-RUN'} force=${isForce} only=${only ?? 'alla'}`);
  console.log(`[stamp-bfl5-legacy] src (read-only, rörs aldrig): ${RAW_LIB}`);
  console.log(`[stamp-bfl5-legacy] dst (output):                ${STAMPED_LIB}`);
  console.log(`[stamp-bfl5-legacy] position:                    bottom-right (240×64 SE legacy)`);
  console.log('');

  const items = collectBfl5();
  console.log(`[stamp-bfl5-legacy] hittade ${items.length} bfl5_*.png i RAW_LIB`);

  if (items.length === 0) {
    console.log('[stamp-bfl5-legacy] inga bfl5-bilder att processa.');
    process.exit(0);
  }

  // Fördelning per kategori
  const byCat = new Map<string, number>();
  for (const it of items) byCat.set(it.cat, (byCat.get(it.cat) ?? 0) + 1);
  console.log('  fördelning per kategori:');
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(20)} ${n}`);
  }
  const alsoStampedCount = items.filter(i => i.hasAlreadyStampedWebp).length;
  console.log(`  varav redan-stämplade .webp i RAW_LIB: ${alsoStampedCount} (hoppas över — vi stämplar aldrig redan-stämplade)`);
  console.log('');

  if (isDryRun) {
    console.log('[stamp-bfl5-legacy] DRY-RUN: inga filer skrivs. Kör med --apply för att köra skarpt.');
    process.exit(0);
  }

  if (!existsSync(STAMPED_LIB)) mkdirSync(STAMPED_LIB, { recursive: true });

  let cursor = 0;
  let ok = 0, skip = 0, fail = 0;
  const failExamples: Array<{ cat: string; baseName: string; error: string }> = [];

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const r = await stampOne(items[idx]);
      if (r.status === 'ok') {
        ok++;
        if (ok % 25 === 0) console.log(`  ${ok}/${items.length} ok (senaste: ${r.cat}/${r.baseName})`);
      } else if (r.status === 'skipped-existing') {
        skip++;
      } else {
        fail++;
        if (failExamples.length < 10) failExamples.push({ cat: r.cat, baseName: r.baseName, error: r.error ?? 'unknown' });
        console.error(`  ✗ ${r.cat}/${r.baseName}: ${r.error}`);
      }
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(`[stamp-bfl5-legacy] DONE in ${elapsed}s`);
  console.log(`  stämplade:           ${ok}`);
  console.log(`  skip (befintliga):   ${skip}`);
  console.log(`  misslyckade:         ${fail}`);
  if (fail > 0) {
    console.log('');
    console.log('  Första 10 fel:');
    for (const f of failExamples) console.log(`    - ${f.cat}/${f.baseName}: ${f.error}`);
  }
  console.log('');
  console.log(`  stämplade bilder:    ${STAMPED_LIB}/<cat>/<name>.stamped.webp`);
  console.log(`  rå-bilder (orörda):  ${RAW_LIB}/<cat>/<name>.png`);
  console.log('');
  console.log('Verifiera att local_image_library/ är oförändrat:');
  console.log('  git status local_image_library/');

  if (fail > 0 && fail / items.length > 0.15) {
    console.error(`[stamp-bfl5-legacy] FEL-RATIO > 15% (${fail}/${items.length}) — avbryter med exit 1.`);
    process.exit(1);
  }
}

main().catch(err => { console.error('[stamp-bfl5-legacy] FATAL:', err); process.exit(99); });
