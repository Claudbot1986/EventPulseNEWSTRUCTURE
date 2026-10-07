#!/usr/bin/env node
/**
 * _generate_bfl_prompts_v3.mjs — Jev-validerad v3-promptgenerator.
 *
 * Tar emot:
 *   tmp_image_corpus/<cat>_full.json    (beskrivningskorpus)
 *   tmp_image_corpus/<cat>_signal.json  (TF-IDF topp-ord)
 *   tmp_image_corpus/<cat>_jev.json     (Jev q1/q2/q3)
 *
 * Policy baserat på Jev:
 *   q1 ≥ 0.65 → använd 3-4 signal-ord i promptarna
 *   q1 < 0.65 → använd bara generiska kategori-ord + venue
 *   q2 ≥ 0.60 → använd specifik venue i minst 2 av 4 mönster
 *   q3 ≤ 0.48 → skippa artister/regissörer helt
 *
 * Output: tmp_image_corpus/<cat>_prompts_v3.json
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
- be grounded in the description excerpts and signal words given
- mention concrete Stockholm venues when present in the data (do not invent addresses or signage)
- include specific human presence unless category is object-only (flea-market, exhibition can be object-only)
- specify natural-light or stage-light photography, NEVER mention text/logos/words on signs
- be 1-2 sentences, 25-60 words, English, no preamble
- stay strictly inside the category
- DO NOT mention artist or regissör names (Flux cannot render them, and they add no visual signal)

Output strictly a JSON array of 5 objects:
[
  {"pattern":"A_wide","prompt":"..."},
  {"pattern":"B_medium","prompt":"..."},
  {"pattern":"C_environment","prompt":"..."},
  {"pattern":"D_detail","prompt":"..."},
  {"pattern":"E_intimate","prompt":"..."}
]`;

async function genFor(cat) {
  const full = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_full.json`), 'utf8'));
  const sig = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_signal.json`), 'utf8'));
  const jev = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_jev.json`), 'utf8'));
  if (full.approx_images_needed === 0) return { cat, skipped: true };

  const q1 = jev.q1_signal_words?.prob ?? 0;
  const q2 = jev.q2_venue_naming?.prob ?? 0;

  const signal1 = q1 >= 0.65
    ? sig.top_1grams_distinctive.slice(0, 5).map((x) => x.w).join(', ')
    : sig.top_1grams_distinctive.slice(0, 2).map((x) => x.w).join(', ');
  const signal2 = q1 >= 0.65
    ? sig.top_2grams_distinctive.slice(0, 4).map((x) => x.w).join(' | ')
    : sig.top_2grams_distinctive.slice(0, 2).map((x) => x.w).join(' | ');

  const venueBlock = q2 >= 0.60
    ? `Use this Stockholm venue in at least 2 of the 4 patterns: ${[...new Set(full.sample_events_with_descriptions.map((s) => s.venue).filter(Boolean))].slice(0, 3).join(', ')}.`
    : `Do not invent a venue; keep it generic ("a Stockholm venue", "a Nordic theater stage", etc).`;

  const samples = full.sample_events_with_descriptions.slice(0, 6)
    .map((s) => `- "${s.title}" at ${s.venue || '?'}\n  desc: ${s.description_preview.replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n');

  const user = `Category: ${cat} (Jev confidence: signal-words=${q1.toFixed(2)}, venue=${q2.toFixed(2)})

${q1 >= 0.65 ? 'USE THESE HIGH-CONFIDENCE SIGNAL WORDS to make the image unmistakable for it: ' + signal1 + '. Top 2-grams: ' + signal2 : 'This category has weak distinctive signals — lean on the venue mood (lighting, materials, people) rather than specific props.'}

${venueBlock}

Sample real events with descriptions (ground truth):
${samples}

Write 5 distinct Flux-1.1-Pro prompts. NO artist or regissör names. Pattern A wide, B medium, C environment, D detail, E intimate (close, personal, perhaps a hand/face/object detail). Each prompt 25-60 words, English.`;

  const t0 = Date.now();
  // Retry upp till 3 ggr vid JSON-parse-fel
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.7 + attempt * 0.05, // högre vid retry
          max_tokens: 1500,
          messages: [
            { role: 'system', content: SYSTEM + (attempt > 1 ? '\n\nIMPORTANT: Output ONLY the JSON array, nothing else.' : '') },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (attempt === 3) return { cat, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      let prompts = [];

      // Hitta alla JSON-array-kandidater, ta den längsta giltiga
      const candidates = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '[') {
          let depth = 0, inStr = false, esc = false, end = -1;
          for (let j = i; j < text.length; j++) {
            const c = text[j];
            if (inStr) {
              if (esc) { esc = false; continue; }
              if (c === '\\') { esc = true; continue; }
              if (c === '"') inStr = false;
            } else {
              if (c === '"') inStr = true;
              else if (c === '[') depth++;
              else if (c === ']') { depth--; if (depth === 0) { end = j; break; } }
            }
          }
          if (end >= 0) candidates.push({ start: i, end, raw: text.slice(i, end + 1) });
        }
      }
      candidates.sort((a, b) => b.raw.length - a.raw.length);
      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c.raw);
          if (Array.isArray(parsed) && parsed.length >= 3) { prompts = parsed; break; }
        } catch (_) {}
      }
      if (prompts.length === 0) {
        if (attempt === 3) return { cat, error: 'no valid JSON array found', raw: `len=${text.length} head=${text.slice(0, 100)} tail=${text.slice(-200)}` };
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }

      const out = {
        category_slug: cat,
        events: full.events,
        jev_q1: q1,
        jev_q2: q2,
        jev_q3: jev.q3_artist_naming?.prob ?? null,
        description_corpus_size: full.description_corpus_size,
        model: MODEL,
        prompts,
      };
      writeFileSync(join('tmp_image_corpus', `${cat}_prompts_v3.json`), JSON.stringify(out, null, 2));
      return { cat, ok: true, ms: Date.now() - t0, n: prompts.length, attempts: attempt };
    } catch (err) {
      if (attempt === 3) return { cat, error: err.message };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { cat, error: 'gave up after 3 attempts' };
}

const cats = readdirSync('tmp_image_corpus')
  .filter((f) => f.endsWith('_full.json'))
  .map((f) => f.replace(/_full\.json$/, ''))
  .filter((c) => !only || c === only);

console.log(`Genererar v3-prompts (Jev-validerade) för ${cats.length} kategorier (concurrency=${concurrency})…`);

let cursor = 0;
async function worker() {
  const out = [];
  while (cursor < cats.length) {
    const idx = cursor++;
    const cat = cats[idx];
    const r = await genFor(cat);
    out.push(r);
  }
  return out;
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