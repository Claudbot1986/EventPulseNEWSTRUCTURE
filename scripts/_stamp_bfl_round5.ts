#!/usr/bin/env -S npx tsx
/**
 * _stamp_bfl_round5.ts — applicera AI Act Art. 50-stämpel + konvertera
 * round5-PNG till WebP q80.
 *
 * Input:  local_image_library/<cat>/bfl5_*.png  +  samma filnamn .json
 * Output: local_image_library/<cat>/bfl5_*.webp  (samma filnamn, ny extension)
 *
 * Pipeline per fil:
 *   1. läs PNG + .json (för prompt + model)
 *   2. applyAiCompliance({ buffer, prompt, model }) → stämplad PNG
 *   3. sharp(...).webp({ quality: 80 }) → WebP q80
 *   4. spara .webp, ta bort .png (valfritt — kan behållas som backup)
 *
 * Säkerhetsmodell:
 *   - Default = --dry-run (visar plan, stämplar inte)
 *   - --apply för skarp körning
 *   - Idempotent: skippar om .webp redan finns
 *
 *   npx tsx scripts/_stamp_bfl_round5.ts           # dry-run
 *   npx tsx scripts/_stamp_bfl_round5.ts --apply   # kör
 *   npx tsx scripts/_stamp_bfl_round5.ts --only theatre-drama
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { applyAiCompliance } from '../08-Agent/tools/ai_compliance';

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const isApply = process.argv.includes('--apply');
const root = join(process.cwd(), 'local_image_library');

interface Item {
  cat: string;
  filename: string;      // bfl5_*.png
  metaPath: string;      // .json bredvid
  pngPath: string;
  webpPath: string;      // .webp istället för .png
}

function collect(): Item[] {
  const out: Item[] = [];
  for (const cat of readdirSync(root)) {
    if (only && cat !== only) continue;
    const sub = join(root, cat);
    let files: string[];
    try { files = readdirSync(sub); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.png')) continue;
      if (!f.startsWith('bfl5_')) continue;
      const baseName = f.replace(/\.png$/, '');
      const pngPath = join(sub, f);
      const metaPath = join(sub, `${baseName}.json`);
      const webpPath = join(sub, `${baseName}.webp`);
      if (!existsSync(metaPath)) continue;          // hoppa över utan metadata
      out.push({ cat, filename: f, pngPath, metaPath, webpPath });
    }
  }
  return out;
}

async function stampOne(item: Item): Promise<{ item: Item; ok: boolean; bytes?: number; skipped?: boolean; error?: string }> {
  if (existsSync(item.webpPath)) return { item, ok: true, skipped: true };
  if (!isApply) return { item, ok: true, skipped: true, /* dry-run note */ };

  try {
    const meta = JSON.parse(readFileSync(item.metaPath, 'utf8'));
    const png = readFileSync(item.pngPath);
    const stampedPng = await applyAiCompliance({
      buffer: png,
      prompt: meta.prompt ?? '',
      model: meta.model ?? 'flux-pro-1.1',
      position: 'bottom-right',  // legacy 240×64 SE-pill (bfl2/3/4-design)
    });
    const webp = await sharp(stampedPng).webp({ quality: 80 }).toBuffer();
    writeFileSync(item.webpPath, webp);
    return { item, ok: true, bytes: webp.length };
  } catch (err) {
    return { item, ok: false, error: (err as Error).message };
  }
}

const items = collect();
console.log(`[stamp-round5] hittade ${items.length} PNG i ${root} (only=${only ?? 'alla'}, apply=${isApply})`);

if (items.length === 0) {
  console.log(`[stamp-round5] inga bfl5_*.png att stämpla. Kör _generate_bfl_round5_images.mjs först.`);
  process.exit(0);
}

// Sample
const sample = items[0];
console.log(`[stamp-round5] exempel: ${sample.cat}/${sample.filename} → ${sample.webpPath.replace(process.cwd() + '/', '')}`);

if (!isApply) {
  const byCat = new Map<string, number>();
  for (const it of items) byCat.set(it.cat, (byCat.get(it.cat) ?? 0) + 1);
  console.log('');
  console.log('fördelning:');
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }
  console.log('');
  console.log('Kör med --apply för att stämpla + konvertera till WebP.');
  process.exit(0);
}

console.log('');
let cursor = 0;
let ok = 0, skip = 0, errs = 0;
async function worker(): Promise<void> {
  while (cursor < items.length) {
    const idx = cursor++;
    const r = await stampOne(items[idx]);
    if (r.skipped) { skip++; continue; }
    if (r.ok) {
      ok++;
      if (ok % 5 === 0) console.log(`  ${ok}/${items.length} ok (senaste: ${r.item.cat}/${r.item.filename})`);
    } else {
      errs++;
      console.error(`  ✗ ${r.item.cat}/${r.item.filename}: ${r.error}`);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: 4 }, () => worker()));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log('');
console.log(`[stamp-round5] DONE in ${elapsed}s`);
console.log(`  stämplade + webp:    ${ok}`);
console.log(`  skip (finns redan):  ${skip}`);
console.log(`  fel:                 ${errs}`);
console.log('');
console.log('Nästa: kör review-minor-safety.mjs + review-knife-glove.mjs för att granska bilderna.');

if (errs > 0) process.exit(1);