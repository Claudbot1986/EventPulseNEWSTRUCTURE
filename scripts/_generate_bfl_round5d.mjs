#!/usr/bin/env node
/**
 * _generate_bfl_round5d.mjs — sista 4 bilder för att nå 1/30-målet:
 *   - theatre-drama: 3 till (behöver 60, har 57)
 *   - exhibition: 1 till (behöver 20, har 19)
 *
 *   node scripts/_generate_bfl_round5d.mjs --apply
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

const SAFETY_SUFFIX = 'no weapons, no knives, no blood, no gloves, no hands holding objects, no close-up faces of minors, no violence, child-safe imagery, family-friendly, no bodies lying down, no death scenes, no funeral scenes';

const PROMPTS = {
  'theatre-drama': [
    'Wide editorial photograph of a Stockholm theater backstage with costume rails holding colorful garments, scattered scripts on a wooden table, a single warm work light. Industrial preparation mood, empty and quiet, no people visible, no somber themes.',
    'Wide editorial photograph of a Stockholm theater lobby after a performance. Empty plush benches, marble floors reflecting brass chandeliers, scattered programs on a side table, the auditorium door ajar. Post-show calm, warm tones, no death imagery.',
    'Wide editorial photograph of a Stockholm theater stage during a quiet dress rehearsal. Single chair center-stage under tight warm spotlight, dark backdrop, empty seats in shadow. Minimalist and anticipatory, no somber themes, no death scenes.',
  ],
  'exhibition': [
    'Wide editorial photograph of a Stockholm art gallery interior with white walls and soft skylight. Large colorful abstract paintings in simple frames, polished wooden floor reflecting, no visitors visible. Calm and contemplative, no people, no somber themes.',
  ],
};

async function processItem({ category, rep, prompt }) {
  const dir = join(root, category);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(prompt + 'r5d').digest('hex').slice(0, 10);
  const fname = `bfl5d_a_wide_r${rep}_${hash}`;
  const imgPath = join(dir, `${fname}.png`);
  const metaPath = join(dir, `${fname}.json`);
  if (existsSync(imgPath) && existsSync(metaPath)) return { ok: true, skipped: true };
  if (dryRun) return { ok: true, dryRun: true };
  try {
    const { buf, id, seed } = await generateOne(`${prompt} ${SAFETY_SUFFIX}.`);
    writeFileSync(imgPath, buf);
    writeFileSync(metaPath, JSON.stringify({
      category_slug: category, pattern: 'A_wide', rep, round: '5d',
      prompt, model: 'flux-pro-1.1', bfl_id: id, seed,
      generated_at: new Date().toISOString(), bytes: buf.length,
      local_path: imgPath.replace(process.cwd() + '/', ''),
      replacement_for: '1_per_30_image_library_2026-10-07-final-fill-2',
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

console.log(`Genererar ${items.length} round5d-bilder, concurrency=${CONCURRENCY}, dryRun=${dryRun}`);
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