#!/usr/bin/env node
/**
 * _generate_bfl_round5c.mjs — sista påfyllnaden för 1/30-målet.
 * Genererar 7 säkra bilder:
 *   - theatre-drama: 3 extra (behöver 60, har 57)
 *   - theatre-comedy: 1 extra (behöver 26, har 25)
 *   - workshop: 1 extra (behöver 4, har 3)
 *   - wine-tasting: 2 extra (behöver 2, har 1)
 *
 * Prompts handplockade med safety-fras inbakad.
 *
 *   node scripts/_generate_bfl_round5c.mjs --apply
 */
import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY && !process.argv.includes('--dry-run')) { console.error('Missing BFL_API_KEY'); process.exit(2); }

const ENDPOINT = 'https://api.bfl.ai/v1/flux-pro-1.1';
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 180_000;
const CONCURRENCY = 2;

const dryRun = !process.argv.includes('--apply');
const root = join(process.cwd(), 'local_image_library');

async function generateOne(prompt) {
  const submit = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width: 1024, height: 576, steps: 28, prompt_upsampling: false }),
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
      return { buf: Buffer.from(await img.arrayBuffer()), id, seed: pd.result.seed ?? null };
    }
    if (pd.status === 'Failed' || pd.status === 'Error') throw new Error(`BFL ${pd.status}`);
  }
  throw new Error(`BFL timeout (180s)`);
}

const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly, no bodies lying down, no death scenes, no funeral scenes, no alcohol visible, no minor faces';

const PROMPTS = {
  'theatre-drama': [
    'Wide editorial photograph of a Stockholm theater stage during a daytime rehearsal. Wooden chairs and music stands arranged on an empty stage, scripts scattered on a side table, tall windows letting in soft Nordic daylight. Empty seats in the foreground, no performers visible, calm working atmosphere.',
    'Wide editorial photograph of a Stockholm theater lobby with art deco mirrors reflecting brass chandeliers. Marble floors and plush empty benches, daylight streaming through high windows. Architectural elegance, no people visible, welcoming atmosphere.',
    'Wide editorial photograph of a Stockholm theater auditorium seen from the upper balcony. Rows of empty seats descend toward a softly lit stage with a single closed red curtain. Warm tungsten glow, anticipatory and calm, no somber imagery.',
  ],
  'theatre-comedy': [
    'Wide editorial photograph of a Stockholm comedy club interior with a small wooden stage, warm tungsten house lights, rows of empty seats, a microphone stand visible. Cozy and inviting, no people, no somber themes.',
  ],
  'workshop': [
    'Wide editorial photograph of a Stockholm community workshop space with long wooden tables, scattered papers and art supplies, large windows letting in soft daylight. Empty and inviting, no people, materials arranged naturally, warm atmosphere.',
  ],
  'wine-tasting': [
    'Wide editorial photograph of a bright Stockholm wine-tasting room with a long table draped in linen, dozens of empty wine glasses catching window light, a chalkboard menu on the wall, soft Scandinavian daylight. No people visible, elegant and inviting, no alcohol being consumed.',
    'Wide editorial photograph of a Stockholm wine cellar with wooden barrels stacked against stone walls, soft amber lighting, a single tasting table with empty glasses. Atmospheric and elegant, no people, no alcohol being poured or consumed.',
  ],
};

async function processItem({ category, rep, prompt }) {
  const dir = join(root, category);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(prompt + 'r5c').digest('hex').slice(0, 10);
  const fname = `bfl5c_a_wide_r${rep}_${hash}`;
  const imgPath = join(dir, `${fname}.png`);
  const metaPath = join(dir, `${fname}.json`);
  if (existsSync(imgPath) && existsSync(metaPath)) return { ok: true, skipped: true };
  if (dryRun) return { ok: true, dryRun: true };
  try {
    const { buf, id, seed } = await generateOne(`${prompt} ${SAFETY_SUFFIX}.`);
    writeFileSync(imgPath, buf);
    writeFileSync(metaPath, JSON.stringify({
      category_slug: category, pattern: 'A_wide', rep, round: '5c',
      prompt, model: 'flux-pro-1.1', bfl_id: id, seed,
      generated_at: new Date().toISOString(), bytes: buf.length,
      local_path: imgPath.replace(process.cwd() + '/', ''),
      replacement_for: '1_per_30_image_library_2026-10-07-final-fill',
    }, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const items = [];
let rep = 0;
for (const [cat, prompts] of Object.entries(PROMPTS)) {
  for (const prompt of prompts) {
    items.push({ category: cat, rep: rep++, prompt });
  }
}

console.log(`Genererar ${items.length} round5c-ersättningar, concurrency=${CONCURRENCY}, dryRun=${dryRun}`);
let cursor = 0, ok = 0, errs = 0;
async function worker() {
  while (cursor < items.length) {
    const idx = cursor++;
    const it = items[idx];
    const r = await processItem(it);
    if (r.ok) {
      ok++;
      console.log(`  ✓ ${it.category}/r${it.rep}`);
    } else {
      errs++;
      console.error(`  ✗ ${it.category}/r${it.rep}: ${r.error}`);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`Klart: ${ok} ok, ${errs} fel — ${((Date.now()-t0)/1000).toFixed(1)}s`);