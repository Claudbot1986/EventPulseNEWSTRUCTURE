#!/usr/bin/env node
/**
 * _generate_bfl_prompts.mjs — parallell M3-driven promptgenerator.
 *
 * Per bristkategori: skicka top-ord + sample-events till MiniMax-M3 via
 * OpenRouter, få tillbaka 4 BFL Flux-1.1-Pro promptvarianter (A wide,
 * B medium, C environment, D detail). Skriv per-kategori JSON.
 *
 * concurrency styrs med --concurrency N (default 8).
 * --only <cat> begränsar till en kategori.
 *
 *   node scripts/_generate_bfl_prompts.mjs
 *   node scripts/_generate_bfl_prompts.mjs --only theatre-drama
 *   node scripts/_generate_bfl_prompts.mjs --concurrency 12
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'minimax/minimax-m3';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('Missing OPENROUTER_API_KEY'); process.exit(2); }

const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const only = argIdx('--only');
const concurrency = Number(argIdx('--concurrency') ?? '8');

const SYSTEM = `You write BFL Flux 1.1 Pro image prompts for a Stockholm event app.
The output of each prompt will be shown next to a real event card. Each prompt must:
- read like a real photo, not AI-art
- mention a concrete Stockholm-style venue when relevant (do not invent exact street addresses)
- include one specific human presence unless the category is object-only (flea-market, exhibition can be object-only)
- specify natural-light or stage-light photography, NEVER mention text, logos, or words on signs
- be 1-2 sentences, 25-60 words, English, no preamble
- stay inside the category (e.g. theatre-drama = actors on stage, opera = singers on stage with orchestra, kids = playful but realistic children, NOT fantasy creatures)

Output strictly a JSON array of 4 objects:
[
  {"pattern":"A_wide","prompt":"..."},
  {"pattern":"B_medium","prompt":"..."},
  {"pattern":"C_environment","prompt":"..."},
  {"pattern":"D_detail","prompt":"..."}
]`;

async function generateFor(cat) {
  const fp = join('tmp_image_corpus', `${cat}.json`);
  const j = JSON.parse(readFileSync(fp, 'utf8'));
  if (j.approx_images_needed === 0) return { cat, skipped: true };

  const top = j.top_words.slice(0, 12).map(([w, c]) => `${w}(${c})`).join(', ');
  const samples = j.sample_events
    .map((s) => `- "${s.title || '(no title)'}" at ${s.venue || 'unknown venue'}`)
    .join('\n');

  const user = `Category: ${j.category_slug}
Events in DB: ${j.events} | library coverage today: ${j.library_count}
Top words (sv+en): ${top}
Sample real events:
${samples}

Write 4 distinct Flux-1.1-Pro prompts for this category. Each pattern must visually distinguish itself so the library ends up with variety.`;

  const t0 = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.85,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) return { cat, error: `HTTP ${res.status}` };
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    // Hitta första kompletta JSON-arrayen (tål ```json``` wrapper och extra text)
    let prompts = [];
    const arrStart = text.indexOf('[');
    if (arrStart < 0) throw new Error('no [ in response');
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = arrStart; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === '[') depth++;
        else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
    }
    if (end < 0) throw new Error('unterminated JSON array');
    prompts = JSON.parse(text.slice(arrStart, end + 1));
    if (!Array.isArray(prompts) || prompts.length === 0) throw new Error('empty array');

    const out = {
      category_slug: cat,
      events: j.events,
      library_now: j.library_count,
      approx_images_needed: j.approx_images_needed,
      model: MODEL,
      prompts,
    };
    writeFileSync(join('tmp_image_corpus', `${cat}_prompts.json`), JSON.stringify(out, null, 2));
    return { cat, ok: true, ms: Date.now() - t0, n: prompts.length };
  } catch (err) {
    return { cat, error: err.message };
  }
}

const dir = 'tmp_image_corpus';
const cats = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('_prompts.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((c) => !only || c === only);

console.log(`Genererar BFL-promptar för ${cats.length} kategorier (concurrency=${concurrency})…`);

let cursor = 0;
async function worker() {
  const results = [];
  while (cursor < cats.length) {
    const idx = cursor++;
    const cat = cats[idx];
    const r = await generateFor(cat);
    results.push(r);
  }
  return results;
}

const t0 = Date.now();
const workers = Array.from({ length: Math.min(concurrency, cats.length) }, () => worker());
const all = (await Promise.all(workers)).flat();
const total = Date.now() - t0;

let ok = 0, errs = 0, skip = 0;
for (const r of all) {
  if (r.ok) { ok++; console.log(`  ✓ ${r.cat.padEnd(20)} ${r.n} prompts (${r.ms}ms)`); }
  else if (r.skipped) { skip++; }
  else { errs++; console.error(`  ✗ ${r.cat}: ${r.error}`); }
}
console.log(`\nKlart: ${ok} ok / ${skip} skipped / ${errs} errors, totalt ${total}ms`);