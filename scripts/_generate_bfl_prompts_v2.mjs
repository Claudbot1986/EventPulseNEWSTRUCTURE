#!/usr/bin/env node
/**
 * _generate_bfl_prompts_v2.mjs — kör M3 mot HELA beskrivningskorpusen.
 *
 * Läser tmp_image_corpus/<cat>_full.json (byggt av _gather_descriptions_full.mjs)
 * och skickar hela state-fragmentet (top-2grams, tone, sample-events med
 * description_preview) till M3. Får tillbaka 4 BFL Flux-1.1-Pro promptvarianter.
 *
 *   node scripts/_generate_bfl_prompts_v2.mjs
 *   node scripts/_generate_bfl_prompts_v2.mjs --only theatre-drama
 *   node scripts/_generate_bfl_prompts_v2.mjs --concurrency 12
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
- reflect the ACTUAL content of real Stockholm events in this category (use the description excerpts to ground the visual)
- mention concrete Stockholm venues when present in the data (Kulturhuset Stadsteatern, Oscarsteatern, Dramaten, Folkoperan, etc.) — but NEVER invent addresses or signage
- include specific human presence unless category is object-only (flea-market, exhibition can be object-only)
- specify natural-light or stage-light photography, NEVER mention text/logos/words on signs
- be 1-2 sentences, 25-60 words, English, no preamble
- stay strictly inside the category

Output strictly a JSON array of 4 objects:
[
  {"pattern":"A_wide","prompt":"..."},
  {"pattern":"B_medium","prompt":"..."},
  {"pattern":"C_environment","prompt":"..."},
  {"pattern":"D_detail","prompt":"..."}
]`;

async function generateFor(cat) {
  const fp = join('tmp_image_corpus', `${cat}_full.json`);
  const j = JSON.parse(readFileSync(fp, 'utf8'));
  if (j.approx_images_needed === 0) return { cat, skipped: true };

  const samples = j.sample_events_with_descriptions
    .map((s) => `- "${s.title}" at ${s.venue || '?'}\n  description: ${s.description_preview.replace(/\s+/g, ' ')}`)
    .join('\n');

  const tone = j.tone_samples.map((t) => `  • ${t}`).join('\n');
  const bigrams = j.top_bigrams.slice(0, 10).map(([w, c]) => `  ${w} (${c})`).join('\n');

  const user = `Category: ${j.category_slug}
Events in DB: ${j.events} | library coverage today: ${j.library_now}
Description corpus: ${j.description_corpus_size} descriptions, median length ${j.median_desc_len} chars

TYPICAL TONE (first sentences from real descriptions):
${tone}

TOP BIGRAMS in real descriptions (signals what events actually contain):
${bigrams}

SAMPLE EVENTS WITH DESCRIPTIONS (ground truth — your prompts must look like these):
${samples}

Write 4 distinct Flux-1.1-Pro prompts for this category. Each pattern must visually distinguish itself so the library ends up with variety, and ALL FOUR must look like they could illustrate one of the real events above.`;

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
    if (!res.ok) return { cat, error: `HTTP ${res.status} ${await res.text()}` };
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
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
      library_now: j.library_now,
      approx_images_needed: j.approx_images_needed,
      description_corpus_size: j.description_corpus_size,
      model: MODEL,
      prompts,
    };
    writeFileSync(join('tmp_image_corpus', `${cat}_prompts_v2.json`), JSON.stringify(out, null, 2));
    return { cat, ok: true, ms: Date.now() - t0, n: prompts.length };
  } catch (err) {
    return { cat, error: err.message };
  }
}

const dir = 'tmp_image_corpus';
const cats = readdirSync(dir)
  .filter((f) => f.endsWith('_full.json'))
  .map((f) => f.replace(/_full\.json$/, ''))
  .filter((c) => !only || c === only);

console.log(`Genererar BFL-promptar (v2, hela beskrivningar) för ${cats.length} kategorier (concurrency=${concurrency})…`);

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