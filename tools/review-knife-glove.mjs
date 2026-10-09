#!/usr/bin/env node
// review-knife-glove.mjs — vision-granskning av BFL-bilder som söker
// "handske + kniv"-motiv. Användaren rapporterade att ett par bilder
// visar detta — låg session-trösta, ville liv-servern kändes "läskig".
//
// Itererar local_image_library/<cat>/*.webp (exkl. _unsorted), skickar
// varje bild till MiniMax-M3 vision, frågor specifikt om handskar och
// knivar. Output:
//   - konsolen-rapport per kategori (YES/NO + subjekt)
//   - tmp_image_corpus/_knife_glove_review.json (maskinläsbar)
//
// Kategorier som kollas extra dansa match (mat/detektivs/stallning etc).
//
// USAGE:  node tools/review-knife-glove.mjs [--only food,ovrigt,family] [--dry-run]

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'node:fs/promises';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

const KEY = process.env.MINIMAX_API_KEY;
const BASE = 'https://api.minimax.io/v1';
const MODEL = 'MiniMax-M3';

if (!KEY) {
  console.error('STOP: MINIMAX_API_KEY not set in project-root .env');
  process.exit(2);
}

const ROOT_LIB = path.resolve(PROJECT_ROOT, 'local_image_library');
const OUTPUT_JSON = path.resolve(PROJECT_ROOT, 'tmp_image_corpus/_knife_glove_review.json');

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const onlyCats = onlyIdx >= 0
  ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim()))
  : null;
const isDryRun = args.includes('--dry-run');

async function collectImages() {
  const out = [];
  const cats = await fs.readdir(ROOT_LIB);
  for (const cat of cats) {
    if (cat.startsWith('_')) continue;       // _smoke.png, _unsorted
    if (cat.startsWith('.')) continue;
    if (onlyCats && !onlyCats.has(cat)) continue;
    const sub = path.join(ROOT_LIB, cat);
    const stat = await fs.stat(sub).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const files = await fs.readdir(sub);
    for (const f of files) {
      if (!/\.(webp|png|jpe?g)$/i.test(f)) continue;
      // ENDAST round5-bilder (bfl5_*.webp, bfl5b_*.webp, bfl5c_*.webp eller bfl5d_*.webp). Andra rundor hanteras separat.
      if (!f.startsWith('bfl5_') && !f.startsWith('bfl5b_') && !f.startsWith('bfl5c_') && !f.startsWith('bfl5d_')) continue;
      out.push({ cat, file: f, abs: path.join(sub, f) });
    }
  }
  return out;
}

function reviewPrompt() {
  return [
    'You are reviewing a generated photo for a Swedish events app (concerts, theatre, food, sports etc).',
    '',
    'Answer in exactly this format, nothing else:',
    'SUBJECT: <one sentence>',
    'GLOVE: <yes/no — is any glove (handske) visible? Include black/yellow/white disposable gloves or knit gloves.>',
    'KNIFE: <yes/no — is any knife (kniv/kitchen knife/cleaver) visible? Include any blade.>',
    'BOTH: <yes/no — is a hand wearing a glove AND holding a knife together visible?>',
    'WHY_LASKIGT: <one sentence — would this image feel creepy/threatening to a user scrolling an events app? Or no>',
  ].join('\n');
}

async function reviewOne({ cat, file, abs }) {
  const buf = await fs.readFile(abs);
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: reviewPrompt() },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`MiniMax HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content ?? '';
  // Parsa BOTH-flagga
  const both = /\bBOTH:\s*(yes|ja)/i.test(content);
  const glove = /\bGLOVE:\s*(yes|ja)/i.test(content);
  const knife = /\bKNIFE:\s*(yes|ja)/i.test(content);
  const subject = (content.match(/SUBJECT:\s*(.+)/) || [, ''])[1].trim();
  const why = (content.match(/WHY_LASKIGT:\s*(.+)/) || [, ''])[1].trim();
  return { cat, file, both, knife, glove, subject, why };
}

async function runConcurrent(items, concurrency) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const it = items[idx];
      try {
        const r = await reviewOne(it);
        results.push(r);
        const tag = r.both ? '✗ BOTH' : (r.glove && r.knife) ? '⚠ glove+knife' : r.knife ? '⚠ knife' : r.glove ? '⚠ glove' : 'ok';
        console.log(`  ${tag.padEnd(12)} ${r.cat}/${r.file}  — ${r.subject.slice(0, 80)}`);
      } catch (e) {
        results.push({ cat: it.cat, file: it.file, error: e.message });
        console.error(`  ERR          ${it.cat}/${it.file} — ${e.message.slice(0, 80)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

(async () => {
  const items = await collectImages();
  console.log(`Hittade ${items.length} bilder (kategorier: ${onlyCats ? [...onlyCats].join(',') : 'alla'})`);
  if (isDryRun) {
    for (const i of items) console.log(`  ${i.cat}/${i.file}`);
    return;
  }
  const t0 = Date.now();
  const results = await runConcurrent(items, 6);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Summering
  const both = results.filter((r) => r.both);
  const either = results.filter((r) => r.knife || r.glove);
  const byCat = {};
  for (const r of either) {
    byCat[r.cat] = byCat[r.cat] || { both: 0, knife: 0, glove: 0, total: 0 };
    byCat[r.cat].total++;
    if (r.both) byCat[r.cat].both++;
    if (r.knife) byCat[r.cat].knife++;
    if (r.glove) byCat[r.cat].glove++;
  }
  console.log(`\nKlart på ${elapsed}s — ${results.length} granskade, ${errs(results)} fel`);
  console.log(`Handske + kniv (båda): ${both.length}`);
  console.log(`Handske ELLER kniv:    ${either.length}`);
  console.log('');
  console.log('Per kategori (bland de med flagga):');
  console.log('kategori'.padEnd(20), 'båda'.padStart(5), 'kniv'.padStart(5), 'handske'.padStart(8), 'tot'.padStart(5));
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1].both - a[1].both)) {
    console.log(cat.padEnd(20), String(n.both).padStart(5), String(n.knife).padStart(5), String(n.glove).padStart(8), String(n.total).padStart(5));
  }
  if (both.length > 0) {
    console.log('\nBilder med både handske OCH kniv:');
    for (const r of both) {
      console.log(`  ${r.cat}/${r.file}`);
      console.log(`    subject: ${r.subject}`);
      console.log(`    varask?: ${r.why}`);
    }
  }
  // Skriv JSON
  await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify({ reviewed: results.length, elapsed_s: Number(elapsed), both: both.map((r) => `${r.cat}/${r.file}`), results }, null, 2));
  console.log(`\n→ ${OUTPUT_JSON}`);
})();

function errs(results) {
  return results.filter((r) => r.error).length;
}