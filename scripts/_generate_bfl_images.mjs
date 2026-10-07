#!/usr/bin/env node
/**
 * _generate_bfl_images.mjs — kör v3-prompts mot BFL flux-pro-1.1 i batcher.
 *
 * För varje kategori:
 *   - Läs <cat>_prompts_v4.json
 *   - För varje prompt: anropa BFL, ladda ner binären, skriv
 *           local_image_library/<cat>/bfl_<pattern>_<prompthash>.png
 *           local_image_library/<cat>/bfl_<pattern>_<prompthash>.json  (metadata)
 *   - Skippa pattern om filen redan finns (idempotent).
 *
 * Concurrency 8 mot BFL (rate-limit vänligt). 163 bilder → ~21 batcher.
 *
 *   node scripts/_generate_bfl_images.mjs [--only theatre-drama]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY) { console.error('Missing BFL_API_KEY'); process.exit(2); }

const ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 90_000;
const CONCURRENCY = 8;

const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const only = argIdx('--only');
const root = join(process.cwd(), 'local_image_library');

async function generateOne(prompt, width = 1024, height = 576) {
  const submit = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width, height, steps: 28, prompt_upsampling: false }),
  });
  if (!submit.ok) throw new Error(`BFL submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { id, polling_url } = await submit.json();

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(polling_url, { headers: { 'x-key': BFL_KEY, accept: 'application/json' } });
    if (!poll.ok) throw new Error(`BFL poll ${poll.status}`);
    const pd = await poll.json();
    if (pd.status === 'Ready') {
      const img = await fetch(pd.result.sample);
      if (!img.ok) throw new Error(`image fetch ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      return { buf, id, seed: pd.result.seed ?? null };
    }
    if (pd.status === 'Failed' || pd.status === 'Error') throw new Error(`BFL ${pd.status}`);
  }
  throw new Error(`BFL timeout`);
}

async function processItem(cat, prompt, pattern) {
  const dir = join(root, cat);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 10);
  const fname = `bfl_${pattern.toLowerCase()}_${hash}`;
  const imgPath = join(dir, `${fname}.png`);
  const metaPath = join(dir, `${fname}.json`);

  if (existsSync(imgPath) && existsSync(metaPath)) return { cat, pattern, skipped: true };

  try {
    const { buf, id, seed } = await generateOne(prompt);
    writeFileSync(imgPath, buf);
    writeFileSync(metaPath, JSON.stringify({
      category_slug: cat,
      pattern,
      prompt,
      model: 'flux-pro-1.1',
      bfl_id: id,
      seed,
      generated_at: new Date().toISOString(),
      bytes: buf.length,
      local_path: imgPath.replace(process.cwd() + '/', ''),
    }, null, 2));
    return { cat, pattern, ok: true, bytes: buf.length };
  } catch (err) {
    return { cat, pattern, error: err.message };
  }
}

const cats = readdirSync('tmp_image_corpus')
  .filter((f) => f.endsWith('_prompts_v4.json'))
  .map((f) => f.replace('_prompts_v4.json', ''))
  .filter((c) => !only || c === only);

const items = [];
for (const cat of cats) {
  const j = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_prompts_v4.json`), 'utf8'));
  for (const p of j.prompts) items.push({ cat, prompt: p.prompt, pattern: p.pattern });
}

console.log(`Genererar ${items.length} bilder från ${cats.length} kategorier (concurrency=${CONCURRENCY})…`);

let cursor = 0;
let ok = 0, errs = 0, skip = 0;
async function worker() {
  while (cursor < items.length) {
    const idx = cursor++;
    const { cat, prompt, pattern } = items[idx];
    const r = await processItem(cat, prompt, pattern);
    if (r.skipped) skip++;
    else if (r.ok) {
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok}/${items.length} ok (senaste: ${cat}/${pattern})`);
    } else {
      errs++;
      console.error(`  ✗ ${cat}/${pattern}: ${r.error}`);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const total = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nKlart: ${ok} nya, ${skip} redan OK, ${errs} fel — på ${total}s`);
console.log(`Mapp: ${root}`);