#!/usr/bin/env node
/**
 * _jev_validate_signals.mjs — för varje bristkategori, kör 3 noul-frågor
 * mot Jev (OpenRouter typesafe/jev-1.13) för att validera ord-signal.
 *
 * Frågor:
 *   Q1: Är de topp-3 orden visuellt meningsfulla i en BFL-prompt?
 *   Q2: Hjälpar specifik venue-naming (t.ex. "Oscarsteatern") till bildens realism?
 *   Q3: Hjälpar artist-/regissörsnamn (t.ex. "Peter Jöback") till bildens realism?
 *
 * Output: tmp_image_corpus/<cat>_jev.json
 *
 *   node scripts/_jev_validate_signals.mjs
 *   node scripts/_jev_validate_signals.mjs --only theatre-drama
 *   node scripts/_jev_validate_signals.mjs --concurrency 12
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const OPENROUTER_URL = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = 'typesafe/jev-1.13';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('Missing OPENROUTER_API_KEY'); process.exit(2); }

const argIdx = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const only = argIdx('--only');
const concurrency = Number(argIdx('--concurrency') ?? '8');

async function jevNoul(state, question) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      state,
      questions: { decision: { type: 'noul', instructions: question } },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const ans = data?.answers?.decision;
  const prob = typeof ans?.noul === 'number' ? ans.noul
             : typeof ans === 'number' ? ans
             : null;
  if (prob === null) throw new Error(`bad answer shape: ${JSON.stringify(data).slice(0, 200)}`);
  return { prob, raw: ans };
}

async function validateFor(cat) {
  const sig = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_signal.json`), 'utf8'));
  const full = JSON.parse(readFileSync(join('tmp_image_corpus', `${cat}_full.json`), 'utf8'));

  const top1 = sig.top_1grams_distinctive.slice(0, 6).map((x) => x.w);
  const top2 = sig.top_2grams_distinctive.slice(0, 4).map((x) => x.w);
  const venues = [...new Set(full.sample_events_with_descriptions.map((s) => s.venue).filter(Boolean))].slice(0, 4);
  const artists = full.sample_events_with_descriptions
    .map((s) => s.title)
    .join(' | ')
    .split(/\s+/)
    .filter((t) => /[A-ZÅÄÖ][a-zåäö]+/.test(t) && t.length > 3 && !/^(Stockholm|Teater|Salongen|Föreställning)$/.test(t))
    .slice(0, 6);

  const state = `Category: ${cat} | ${full.events} events in DB.
Top distinctive words (TF-IDF-ranked): ${top1.join(', ')}.
Top distinctive 2-grams: ${top2.join(' | ')}.
Real Stockholm venues mentioned in this category's descriptions: ${venues.join(', ')}.
Sample event titles (may contain artist/regissör names): ${full.sample_events_with_descriptions.slice(0, 5).map((s) => s.title).join(' | ')}.`;

  const out = { category_slug: cat, signals: { top1, top2, venues, sample_titles: full.sample_events_with_descriptions.slice(0, 5).map((s) => s.title) } };

  // Q1: generella signal-ord
  out.q1_signal_words = await jevNoul(
    state,
    `Are these top distinctive words (${top1.join(', ')}) likely to make a BFL Flux 1.1 Pro prompt produce an image that visually fits the "${cat}" category, when mentioned in a photo-realistic Swedish-event description?`
  );

  // Q2: specifik venue-naming
  out.q2_venue_naming = await jevNoul(
    state,
    `Does naming a specific Stockholm venue like ${venues.join(' or ')} in a BFL Flux 1.1 Pro prompt raise the probability that the resulting image looks like a real ${cat} event photo, compared to a generic venue description?`
  );

  // Q3: artist/regissör-namn
  out.q3_artist_naming = await jevNoul(
    state,
    `Does including specific artist or regissör names (such as "${artists.join(' or ')}") in a BFL Flux 1.1 Pro prompt raise the probability that the resulting image looks authentic for a ${cat} event — or does it hurt because Flux cannot render known faces and the names add nothing visual?`
  );

  writeFileSync(join('tmp_image_corpus', `${cat}_jev.json`), JSON.stringify(out, null, 2));
  return { cat, q1: out.q1_signal_words.prob, q2: out.q2_venue_naming.prob, q3: out.q3_artist_naming.prob };
}

const cats = readdirSync('tmp_image_corpus')
  .filter((f) => f.endsWith('_signal.json'))
  .map((f) => f.replace(/_signal\.json$/, ''))
  .filter((c) => !only || c === only);

console.log(`Jev-validerar ${cats.length} kategorier (concurrency=${concurrency})…`);

let cursor = 0;
async function worker() {
  const out = [];
  while (cursor < cats.length) {
    const idx = cursor++;
    const cat = cats[idx];
    try {
      const r = await validateFor(cat);
      out.push({ ...r, ok: true });
      process.stdout.write(`  ✓ ${cat} q1=${r.q1.toFixed(2)} q2=${r.q2.toFixed(2)} q3=${r.q3.toFixed(2)}\n`);
    } catch (err) {
      out.push({ cat, ok: false, error: err.message });
      process.stdout.write(`  ✗ ${cat}: ${err.message}\n`);
    }
  }
  return out;
}

const t0 = Date.now();
const workers = Array.from({ length: Math.min(concurrency, cats.length) }, () => worker());
const all = (await Promise.all(workers)).flat();
const total = Date.now() - t0;

const ok = all.filter((r) => r.ok).length;
const errs = all.filter((r) => !r.ok).length;
console.log(`\nKlart: ${ok} ok / ${errs} errors, totalt ${total}ms`);

// Sammanställning
const summary = all.filter((r) => r.ok).map((r) => ({
  cat: r.cat,
  signal_words_p: r.q1,
  venue_naming_p: r.q2,
  artist_naming_p: r.q3,
}));
writeFileSync('tmp_image_corpus/_jev_summary.json', JSON.stringify(summary, null, 2));
console.log(`→ tmp_image_corpus/_jev_summary.json`);