#!/usr/bin/env node
// _round5_status.mjs — snabb överblick av round5-pipeline.
// Räknar:
//   - antal bfl5_*.png i local_image_library
//   - antal bfl5_*.webp
//   - antal planerade items (summerat från *_prompts_round5.json)
//   - flaggade bilder i _knife_glove_review / _minor_safety_review (om finns)
//   - antal image_library-rader med tag='round5-1per30'

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'local_image_library');
const CORPUS = join(process.cwd(), 'tmp_image_corpus');

let planned = 0;
const planFiles = readdirSync(CORPUS).filter((f) => f.endsWith('_prompts_round5.json'));
for (const f of planFiles) {
  const j = JSON.parse(readFileSync(join(CORPUS, f), 'utf8'));
  planned += j.items.length;
}

let png = 0, webp = 0;
const cats = existsSync(ROOT) ? readdirSync(ROOT) : [];
const byCat = {};
for (const cat of cats) {
  if (cat.startsWith('_') || cat.startsWith('.')) continue;
  const sub = join(ROOT, cat);
  let files = [];
  try { files = readdirSync(sub); } catch { continue; }
  let catPng = 0, catWebp = 0;
  for (const f of files) {
    if (!f.startsWith('bfl5_')) continue;
    if (f.endsWith('.png')) { png++; catPng++; }
    if (f.endsWith('.webp')) { webp++; catWebp++; }
  }
  if (catPng > 0 || catWebp > 0) byCat[cat] = { png: catPng, webp: catWebp };
}

let unsafe = [];
if (existsSync(join(CORPUS, '_minor_safety_review.json'))) {
  const j = JSON.parse(readFileSync(join(CORPUS, '_minor_safety_review.json'), 'utf8'));
  unsafe = j.flagged || [];
}

console.log('═══ round5-status ═══');
console.log(`planerade:  ${planned} (i ${planFiles.length} kategorier)`);
console.log(`PNG:        ${png} (av ${planned})`);
console.log(`WebP:       ${webp}`);
console.log(`flaggade:   ${unsafe.length} bilder i _minor_safety_review.json`);
console.log('');
console.log('per kategori:');
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1].png - a[1].png)) {
  console.log(`  ${cat.padEnd(20)} png=${String(n.png).padStart(3)}  webp=${String(n.webp).padStart(3)}`);
}