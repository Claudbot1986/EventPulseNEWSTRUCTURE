#!/usr/bin/env node
/**
 * _generate_bfl_prompts_v4.mjs — M3 Native API via api.minimax.io.
 *
 * Använder MiniMax-M3 native endpoint istället för OpenRouter-proxy.
 * Format: Anthropic Messages API (x-key auth, model "MiniMax-M3").
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ENDPOINT = 'https://api.minimax.io/anthropic/v1/messages';
const MODEL = 'MiniMax-M3';

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) { console.error('Missing MINIMAX_API_KEY'); process.exit(2); }

const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const only = argIdx('--only');
const forceFallback = process.argv.includes('--fallback');

const SYSTEM = `You write BFL Flux 1.1 Pro image prompts for a Stockholm event app.
Each prompt must read like a real photo, mention a concrete Stockholm venue when relevant, include specific human presence unless the category is object-only, specify natural-light or stage-light photography, NEVER mention text/logos, be 25-60 words English, stay inside the category, and NEVER name artists or regissörer.

Output strictly a JSON array of 5 objects:
[
  {"pattern":"A_wide","prompt":"..."},
  {"pattern":"B_medium","prompt":"..."},
  {"pattern":"C_environment","prompt":"..."},
  {"pattern":"D_detail","prompt":"..."},
  {"pattern":"E_intimate","prompt":"..."}
]`;

function fallbackPrompts(cat, sig, full) {
  const topWords = sig.top_1grams_distinctive.slice(0, 3).map((x) => x.w);
  const rawVenue = (full.sample_events_with_descriptions[0]?.venue || 'a Stockholm venue');
  const venue = rawVenue.replace(/Kulturhuset Stadsteatern|China Teatern|Oscarsteatern|Teaterverket Svea|Dramaten|Folkoperan/, (m) => ({
    'Kulturhuset Stadsteatern': 'a Stockholm cultural center',
    'China Teatern': 'a Stockholm theater',
    'Oscarsteatern': 'a Stockholm theater stage',
    'Teaterverket Svea': 'an intimate Stockholm theater',
    'Dramaten': 'a Stockholm dramatic theater',
    'Folkoperan': 'a Stockholm opera house',
  }[m] || 'a Stockholm venue'));

  const categoryHint = {
    'theatre-drama': 'actors on a Stockholm theater stage, dramatic warm spotlight, theatrical atmosphere',
    'theatre-comedy': 'comedians on a Stockholm comedy club stage, warm stage light, candid moment',
    'opera': 'singers on a Stockholm opera stage, orchestra visible, classical warm lighting',
    'dance': 'dancers in a Stockholm performance space, dramatic motion, soft stage light',
    'exhibition': 'an art gallery interior in Stockholm, soft skylight, paintings and installations',
    'sports': 'a Stockholm sports arena, athletes in action under stadium lights',
    'talks-lectures': 'a Stockholm lecture hall, speaker at podium, attentive audience in soft light',
    'workshop': 'people working at tables in a Stockholm creative space, natural daylight, hands busy',
    'kids': 'children and parents at a Stockholm family venue, playful candid moment, warm light',
    'family': 'a Stockholm family event, multi-generation candid moment, warm natural light',
    'wine-tasting': 'a Stockholm wine tasting room, crystal glasses on wooden table, warm amber light',
    'circus': 'a Stockholm circus or variety performance, dynamic acrobatic moment, theatrical color',
    'flea-market': 'a Stockholm flea market, vintage goods on tables, soft overcast daylight',
    'nightlife': 'a Stockholm nightclub interior, colored DJ lights, dynamic dance floor energy',
    'food': 'a Stockholm restaurant setting, plated dishes on wooden table, warm ambient light',
    'film': 'a Stockholm cinema interior, audience in silhouette, glowing screen',
  }[cat] || 'a Stockholm venue atmosphere';

  return [
    { pattern: 'A_wide',        prompt: `Wide establishing shot, ${categoryHint}, ${venue}, no text no logos, real photography.` },
    { pattern: 'B_medium',      prompt: `Medium candid photograph, ${categoryHint}, ${venue}, two or three people in frame, warm natural light, documentary style, no text.` },
    { pattern: 'C_environment', prompt: `Environmental establishing view, ${venue}, atmosphere with subtle hints of ${topWords[0] || 'activity'}, warm lighting, no people in focus, real photography.` },
    { pattern: 'D_detail',      prompt: `Close-up detail photograph at ${venue}, focusing on ${topWords[0] || 'the scene'}${topWords[1] ? ' and ' + topWords[1] : ''}, shallow depth of field, warm light, no text.` },
    { pattern: 'E_intimate',    prompt: `Intimate close photograph at ${venue}, candid human presence in soft focus, hint of ${topWords[1] || 'moment'}, emotional warmth, real photography, no text.` },
  ];
}

async function genWithM3(full, sig, jev) {
  const samples = full.sample_events_with_descriptions.slice(0, 6)
    .map((s) => `- "${s.title}" at ${s.venue || '?'}\n  desc: ${s.description_preview.replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n');

  const q1 = jev.q1_signal_words?.prob ?? 0;
  const q2 = jev.q2_venue_naming?.prob ?? 0;
  const signal1 = q1 >= 0.65
    ? sig.top_1grams_distinctive.slice(0, 5).map((x) => x.w).join(', ')
    : sig.top_1grams_distinctive.slice(0, 2).map((x) => x.w).join(', ');
  const venueBlock = q2 >= 0.60
    ? `Use this Stockholm venue in at least 2 of the 5 patterns: ${[...new Set(full.sample_events_with_descriptions.map((s) => s.venue).filter(Boolean))].slice(0, 3).join(', ')}.`
    : `Do not invent a venue; keep it generic ("a Stockholm venue", "a Nordic theater stage", etc).`;

  const user = `Category: ${full.category_slug} (Jev: signal=${q1.toFixed(2)}, venue=${q2.toFixed(2)})

USE THESE HIGH-CONFIDENCE SIGNAL WORDS: ${signal1}.

${venueBlock}

Sample real events:
${samples}

Write 5 distinct Flux-1.1-Pro prompts (A wide, B medium, C environment, D detail, E intimate). NO artist names. 25-60 words English.`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system: SYSTEM + (attempt > 1 ? '\n\nOutput ONLY the JSON array.' : ''),
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        if (attempt === 3) return null;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      const data = await res.json();
      // Anthropic format: { content: [{ type: "text", text: "..." }] }
      const text = data?.content?.[0]?.text ?? '';

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
          if (Array.isArray(parsed) && parsed.length >= 4) return parsed;
        } catch (_) {}
      }
      if (attempt === 3) return null;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    } catch (e) {
      if (attempt === 3) return null;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

async function genFor(cat) {
  const full = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_full.json`), 'utf8'));
  const sig = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_signal.json`), 'utf8'));
  const jev = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_jev.json`), 'utf8'));
  if (full.approx_images_needed === 0) return { cat, skipped: true };

  let prompts = null;
  let source = 'M3-native';
  if (!forceFallback) {
    prompts = await genWithM3(full, sig, jev);
  }
  if (!prompts || prompts.length < 4) {
    prompts = fallbackPrompts(cat, sig, full);
    source = 'fallback';
  }

  const out = {
    category_slug: cat,
    events: full.events,
    jev_q1: jev.q1_signal_words?.prob ?? null,
    jev_q2: jev.q2_venue_naming?.prob ?? null,
    jev_q3: jev.q3_artist_naming?.prob ?? null,
    description_corpus_size: full.description_corpus_size,
    model: source === 'M3-native' ? MODEL : 'template-fallback',
    prompts,
  };
  writeFileSync(join('tmp_image_corpus', `${cat}_prompts_v4.json`), JSON.stringify(out, null, 2));
  return { cat, ok: true, source, n: prompts.length };
}

const cats = readdirSync('tmp_image_corpus')
  .filter((f) => f.endsWith('_full.json'))
  .map((f) => f.replace('_full.json', ''))
  .filter((c) => !only || c === only);

console.log(`Genererar prompts för ${cats.length} kategorier (forceFallback=${forceFallback})…`);

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
const all = await Promise.all(Array.from({ length: 6 }, () => worker())).then((r) => r.flat());
const total = ((Date.now() - t0) / 1000).toFixed(1);
let ok = 0, errs = 0, skip = 0, fromM3 = 0, fromFallback = 0;
for (const r of all) {
  if (r.ok) {
    ok++;
    if (r.source === 'M3-native') fromM3++; else fromFallback++;
    console.log(`  ✓ ${r.cat.padEnd(20)} ${r.n} prompts (${r.source})`);
  } else if (r.skipped) { skip++; } else { errs++; console.error(`  ✗ ${r.cat}: ${r.error}`); }
}
console.log(`\nKlart: ${ok} ok (${fromM3} M3-native / ${fromFallback} fallback) / ${skip} skipped / ${errs} errors — ${total}s`);