#!/usr/bin/env node
/**
 * _retry_bfl_round5_timeouts.mjs — retry för de 7 theatre-drama A_wide
 * som timeoutade i första omgången. Längre timeout (180s), lägre
 * concurrency (2).
 *
 * Input: tmp_image_corpus/theatre-drama_prompts_round5.json
 * Output: skriver över bfl5_*.png för saknade items (hash-baserat namn).
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const BFL_KEY = process.env.BFL_API_KEY;
if (!BFL_KEY) { console.error('Missing BFL_API_KEY'); process.exit(2); }

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

const path = join(process.cwd(), 'tmp_image_corpus/theatre-drama_prompts_round5.json');
const data = JSON.parse(readFileSync(path, 'utf8'));

const missing = data.items.filter((it) => {
  const hash = createHash('sha256').update(it.prompt + 'r5').digest('hex').slice(0, 10);
  const fname = `bfl5_${it.pattern.toLowerCase()}_r${it.rep}_${hash}.png`;
  return !existsSync(join(root, 'theatre-drama', fname));
});

console.log(`[retry] ${missing.length} theatre-drama items saknas (timeout). Concurrency=${CONCURRENCY}, timeout=${TIMEOUT_MS}ms, dryRun=${dryRun}`);

if (missing.length === 0) {
  console.log('[retry] alla är på plats. Avbryter.');
  process.exit(0);
}

let cursor = 0;
let ok = 0, errs = 0;

async function processItem(item) {
  const cat = 'theatre-drama';
  const dir = join(root, cat);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(item.prompt + 'r5').digest('hex').slice(0, 10);
  const fname = `bfl5_${item.pattern.toLowerCase()}_r${item.rep}_${hash}`;
  const imgPath = join(dir, `${fname}.png`);
  const metaPath = join(dir, `${fname}.json`);
  if (existsSync(imgPath) && existsSync(metaPath)) return { ok: true, skipped: true };
  if (dryRun) return { ok: true, dryRun: true };
  try {
    const { buf, id, seed } = await generateOne(item.prompt);
    writeFileSync(imgPath, buf);
    writeFileSync(metaPath, JSON.stringify({
      category_slug: cat, pattern: item.pattern, rep: item.rep, round: 5,
      prompt: item.prompt, model: 'flux-pro-1.1', bfl_id: id, seed,
      generated_at: new Date().toISOString(), bytes: buf.length,
      local_path: imgPath.replace(process.cwd() + '/', ''),
      replacement_for: '1_per_30_image_library_2026-10-07-retry',
    }, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function worker() {
  while (cursor < missing.length) {
    const idx = cursor++;
    const it = missing[idx];
    const r = await processItem(it);
    if (r.ok) {
      ok++;
      console.log(`  ✓ ${it.pattern}_r${it.rep} (${ok}/${missing.length})`);
    } else {
      errs++;
      console.error(`  ✗ ${it.pattern}_r${it.rep}: ${r.error}`);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n[retry] klart på ${elapsed}s — ${ok} nya, ${errs} fel (av ${missing.length})`);
console.log(`Credits-användning: ${ok} av ~1338 kvar`);