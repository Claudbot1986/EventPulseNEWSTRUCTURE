#!/usr/bin/env node
/**
 * tools/bfl-model-compare.mjs — fristående bildgenererings-experiment.
 *
 * KOPIERAR samma procedur som dashboard-knappen på port 7777
 * (M3-genererad Stockholm-editorial prompt → BFL-bildgenerering),
 * men kör VARJE prompt mot TVÅ olika modeller för jämförelse:
 *
 *   1. BFL flux-2-pro       — nyare BFL-modell (knappen idag kör flux-pro-1.1)
 *   2. MiniMax image-01     — MiniMax bildmodell (används redan för kategoritiles)
 *
 * Skriver INTE till image_library / Supabase / local_image_library.
 * Skapar enbart en tillfällig utdatamapp under tmp/ som användaren kan inspektera.
 *
 * Proceduren som kopieras (läs från bfl_orchestrate.ts + bfl-batch.ts):
 *   1. Hämta Stockholm-editorial prompt för kategorin (cached från M3-batchen)
 *   2. Skicka prompt till bildmodell (1024x576, samma aspect ratio som knappen)
 *   3. Polla BFL tills "Ready" / hämta URL direkt från MiniMax
 *
 * Användning:
 *   node tools/bfl-model-compare.mjs
 *   node tools/bfl-model-compare.mjs --only=music
 *
 * Kräver:
 *   .env med BFL_API_KEY och MINIMAX_API_KEY
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'node:fs/promises';
import * as fss from 'node:fs';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

const BFL_KEY = process.env.BFL_API_KEY;
const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE = 'https://api.minimax.io/v1';

if (!BFL_KEY) { console.error('STOP: BFL_API_KEY not set'); process.exit(2); }
if (!MINIMAX_KEY) { console.error('STOP: MINIMAX_API_KEY not set'); process.exit(2); }

// ── Output directory ──────────────────────────────────────────────────────
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Stöd --out-dir=X för att knapparna ska kunna peka på samma parent-mapp.
// När --out-dir är satt hamnar modell-specifika filer i OUT_DIR/<model>/.
const argOutDir = arg('out-dir');
const argModel = arg('model');
const OUT_DIR = argOutDir
  ? path.resolve(argOutDir)
  : path.join(PROJECT_ROOT, 'tmp', `bfl_model_compare_${TS}`);
await fs.mkdir(OUT_DIR, { recursive: true });

// ── Categories & prompts (cached M3 Stockholm-editorial prompts) ─────────
const CORPUS = path.join(PROJECT_ROOT, 'tmp_image_corpus');
const DEFAULT_CATEGORIES = ['music', 'theatre-drama', 'community'];

function arg(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : null;
}

async function loadPromptForCategory(cat) {
  // Försök v4 först (Stockholm-specifika), sedan round5, sedan .json
  const candidates = [
    path.join(CORPUS, `${cat}_prompts_v4.json`),
    path.join(CORPUS, `${cat}_prompts_round5.json`),
    path.join(CORPUS, `${cat}_prompts.json`),
  ];
  for (const f of candidates) {
    if (fss.existsSync(f)) {
      const j = JSON.parse(await fs.readFile(f, 'utf8'));
      // Använd A_wide-pattern (samma som dashboardens default wide-shot)
      const wide = j.prompts?.find((p) => p.pattern === 'A_wide');
      const prompt = wide?.prompt ?? j.prompts?.[0]?.prompt;
      if (prompt) return { prompt, source: path.basename(f), pattern: wide?.pattern ?? j.prompts?.[0]?.pattern };
    }
  }
  throw new Error(`No cached prompts for category="${cat}" under ${CORPUS}`);
}

// ── BFL flux-2-pro (async submit + poll) ──────────────────────────────────
const BFL_ENDPOINT = 'https://api.bfl.ai/v1/flux-2-pro';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;
const IMG_W = 1024;
const IMG_H = 576;

async function generateBfl(prompt) {
  const submit = await fetch(BFL_ENDPOINT, {
    method: 'POST',
    headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width: IMG_W, height: IMG_H }),
  });
  if (!submit.ok) throw new Error(`BFL submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { id, polling_url } = await submit.json();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(polling_url, { headers: { 'x-key': BFL_KEY, accept: 'application/json' } });
    if (!poll.ok) throw new Error(`BFL poll ${poll.status}`);
    const pd = await poll.json();
    if (pd.status === 'Ready') {
      const img = await fetch(pd.result.sample);
      if (!img.ok) throw new Error(`BFL image fetch ${img.status}`);
      return { buf: Buffer.from(await img.arrayBuffer()), id, seed: pd.result.seed ?? null };
    }
    if (pd.status === 'Failed' || pd.status === 'Error') throw new Error(`BFL ${pd.status}`);
  }
  throw new Error('BFL poll timeout (180s)');
}

// ── MiniMax image-01 (sync URL response) ──────────────────────────────────
async function generateMinimax(prompt) {
  const body = {
    model: 'image-01',
    prompt,
    response_format: 'url',
    width: IMG_W,
    height: IMG_H,
    aspect_ratio: '16:9',
    n: 1,
  };
  const r = await fetch(`${MINIMAX_BASE}/image_generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MINIMAX_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`MiniMax HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const code = j?.base_resp?.status_code;
  if (code !== 0) throw new Error(`MiniMax status_code=${code} msg=${j?.base_resp?.status_msg}`);
  const urls = j?.data?.image_urls ?? [];
  if (!urls.length) throw new Error('No image_urls in MiniMax response');
  const img = await fetch(urls[0]);
  if (!img.ok) throw new Error(`MiniMax download failed ${img.status}`);
  return { buf: Buffer.from(await img.arrayBuffer()), id: j?.data?.task_id ?? null, seed: null, url: urls[0] };
}

async function saveAndReport({ buf, category, model, prompt, source, pattern, id, seed, error }) {
  const safeCat = category.replace(/[^a-z0-9-]/gi, '_');
  const safeModel = model.replace(/[^a-z0-9-]/gi, '_');
  // När --out-dir delar parent mellan modeller: lägg modell som submapp
  // Annars hamnar alla i samma parent (single-model-run från knapp)
  const subdir = argOutDir ? safeModel : '.';
  const targetDir = path.join(OUT_DIR, subdir);
  await fs.mkdir(targetDir, { recursive: true });
  const fname = `${safeCat}.jpg`;
  const fpath = path.join(targetDir, fname);
  if (error) {
    console.log(`  ✗ ${category} / ${model}: ${error}`);
    return { category, model, ok: false, error };
  }
  await fs.writeFile(fpath, buf);
  console.log(`  ✓ ${category} / ${model}  →  ${path.relative(OUT_DIR, fpath)}  (${(buf.length / 1024).toFixed(0)} kB)  id=${id ?? '-'} seed=${seed ?? '-'}`);
  return { category, model, ok: true, file: fpath, prompt, source, pattern, id, seed };
}

async function runForCategory(cat) {
  console.log(`\n[${cat}]`);
  const { prompt, source, pattern } = await loadPromptForCategory(cat);
  console.log(`  prompt (from ${source}, pattern=${pattern}):`);
  console.log(`    "${prompt.slice(0, 140)}${prompt.length > 140 ? '…' : ''}"`);

  const tasks = [];
  const whichModels = argModel
    ? [argModel]
    : ['bfl-flux-2-pro', 'minimax-image-01'];

  for (const m of whichModels) {
    if (m === 'bfl-flux-2-pro') {
      tasks.push(
        generateBfl(prompt)
          .then((r) => saveAndReport({ ...r, category: cat, model: m, prompt, source, pattern }))
          .catch((e) => saveAndReport({ category: cat, model: m, prompt, source, pattern, error: e.message })),
      );
    } else if (m === 'minimax-image-01') {
      tasks.push(
        generateMinimax(prompt)
          .then((r) => saveAndReport({ ...r, category: cat, model: m, prompt, source, pattern }))
          .catch((e) => saveAndReport({ category: cat, model: m, prompt, source, pattern, error: e.message })),
      );
    } else {
      tasks.push(Promise.resolve(saveAndReport({ category: cat, model: m, prompt, source, pattern, error: `unknown model "${m}"` })));
    }
  }
  return Promise.all(tasks);
}

(async () => {
  const only = arg('only');
  const cats = only ? [only] : DEFAULT_CATEGORIES;

  console.log(`=== BFL Model Compare (${TS}) ===`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Categories: ${cats.join(', ')}`);
  console.log(`Models per prompt:`);
  console.log(`  - BFL flux-2-pro  (replaces flux-pro-1.1 used by dashboard button)`);
  console.log(`  - MiniMax image-01 (the image model already used for Explore tiles)`);
  console.log(`Image size: ${IMG_W}x${IMG_H}  (matches bfl-batch.ts)`);

  const results = [];
  for (const cat of cats) {
    try {
      const r = await runForCategory(cat);
      results.push(...r);
    } catch (e) {
      console.error(`  ✗ ${cat}: ${e.message}`);
      results.push({ category: cat, ok: false, error: e.message });
    }
  }

  // Skriv manifest + prompt-logg
  const manifest = {
    timestamp: TS,
    out_dir: OUT_DIR,
    procedure_source: 'dashboard btn port 7777 → bfl_orchestrate.ts → bfl-batch.ts → BFL flux-pro-1.1',
    replaced_model: 'flux-pro-1.1',
    models_compared: ['bfl-flux-2-pro', 'minimax-image-01'],
    image_dimensions: { w: IMG_W, h: IMG_H },
    categories: cats,
    items: results,
  };
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(
    path.join(OUT_DIR, 'README.txt'),
    [
      `BFL Model Compare — ${TS}`,
      ``,
      `Procedure: samma M3-Stockholm-editorial prompts som dashboardknappen på port 7777.`,
      `Inget ändrat i scripts/, BFL-generator/ eller dashboard.`,
      ``,
      `Modeller som jämförs:`,
      `  - bfl-flux-2-pro      : ersätter flux-pro-1.1 (knappens nuvarande BFL-modell)`,
      `  - minimax-image-01    : MiniMax bildmodell (används redan för Explore-tiles)`,
      ``,
      `Bildstorlek: ${IMG_W}x${IMG_H} (samma aspect som bfl-batch.ts)`,
      ``,
      `Filer:`,
      ...results
        .filter((r) => r.ok)
        .map((r) => `  ${path.relative(OUT_DIR, r.file)}  ←  ${r.category} / ${r.model}`),
      ``,
      `Manifest: ${path.join(OUT_DIR, 'manifest.json')}`,
    ].join('\n'),
  );

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Klart: ${ok}/${results.length} bilder`);
  if (fail.length) console.log(`Misslyckades: ${fail.map((f) => `${f.category}/${f.model}`).join(', ')}`);
  console.log(`Mapp: ${OUT_DIR}`);
  console.log(`${'='.repeat(70)}`);

  // Öppna mappen ENDAST när scriptet körs standalone (utan --no-open).
  // Knappen på dashboarden öppnar mappen själv efter att run-state blir success.
  if (!process.argv.includes('--no-open')) {
    try {
      execSync(`open "${OUT_DIR}"`, { stdio: 'ignore' });
      console.log(`\nMappen öppnad i Finder.`);
    } catch {
      console.log(`\nKunde inte öppna mappen automatiskt. Öppna manuellt: ${OUT_DIR}`);
    }
  } else {
    console.log(`\n(--no-open angivet, mapp ej öppnad automatiskt)`);
  }
})();