#!/usr/bin/env -S npx tsx
/**
 * _stamp_bfl_round5b.ts — stämpla round5b PNG → WebP. Identisk med
 * _stamp_bfl_round5.ts men söker på bfl5b_*.png istället för bfl5_*.png.
 *
 *   npx tsx scripts/_stamp_bfl_round5b.ts           # dry-run
 *   npx tsx scripts/_stamp_bfl_round5b.ts --apply   # kör
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { applyAiCompliance } from '../08-Agent/tools/ai_compliance';

const isApply = process.argv.includes('--apply');
const root = join(process.cwd(), 'local_image_library');

interface Item { cat: string; pngPath: string; webpPath: string; metaPath: string; }

function collect(): Item[] {
  const out: Item[] = [];
  for (const cat of readdirSync(root)) {
    if (cat.startsWith('_') || cat.startsWith('.')) continue;
    const sub = join(root, cat);
    let files: string[];
    try { files = readdirSync(sub); } catch { continue; }
    for (const f of files) {
      if (!f.startsWith('bfl5b_') && !f.startsWith('bfl5c_') && !f.startsWith('bfl5d_')) continue;
      if (!f.endsWith('.png')) continue;
      const baseName = f.replace(/\.png$/, '');
      const pngPath = join(sub, f);
      const metaPath = join(sub, `${baseName}.json`);
      if (!existsSync(metaPath)) continue;
      out.push({ cat, pngPath, metaPath, webpPath: join(sub, `${baseName}.webp`) });
    }
  }
  return out;
}

async function stampOne(it: Item): Promise<{ ok: boolean; bytes?: number; error?: string }> {
  if (existsSync(it.webpPath)) return { ok: true, bytes: 0 };
  try {
    const meta = JSON.parse(readFileSync(it.metaPath, 'utf8'));
    const png = readFileSync(it.pngPath);
    const stampedPng = await applyAiCompliance({
      buffer: png, prompt: meta.prompt ?? '', model: meta.model ?? 'flux-pro-1.1',
      position: 'bottom-left',
    });
    const webp = await sharp(stampedPng).webp({ quality: 80 }).toBuffer();
    writeFileSync(it.webpPath, webp);
    return { ok: true, bytes: webp.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const items = collect();
console.log(`[stamp-round5b] ${items.length} bfl5b_*.png att stämpla (apply=${isApply})`);
if (items.length === 0) { console.log('Kör _generate_bfl_round5b.mjs först.'); process.exit(0); }
if (!isApply) { console.log('Kör med --apply för att stämpla.'); process.exit(0); }

let cursor = 0, ok = 0, errs = 0;
async function worker(): Promise<void> {
  while (cursor < items.length) {
    const idx = cursor++;
    const r = await stampOne(items[idx]);
    if (r.ok) ok++;
    else { errs++; console.error(`  ✗ ${items[idx].cat}/${items[idx].pngPath}: ${r.error}`); }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: 4 }, () => worker()));
console.log(`[stamp-round5b] DONE: ${ok} stämplade, ${errs} fel på ${((Date.now()-t0)/1000).toFixed(1)}s`);