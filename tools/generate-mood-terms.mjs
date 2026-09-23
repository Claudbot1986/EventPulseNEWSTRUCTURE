#!/usr/bin/env node
// generate-mood-terms.mjs — Fas D (2026-09-23): AI-generate the Swedish term
// lexicon for the "Stämningsfullt" mood tile, ONCE.
//
// The output is REVIEWED BY THE USER and then committed as static data in
// 08-Agent/tools/moods.ts. No runtime LLM — the feed mood filter is a pure
// string match over this list (title + description_sv/en).
//
// Reads MINIMAX_API_KEY from project-root .env (NOT committed) and never
// prints it. Exploratory/dev-only, NOT bundled into the Expo client.
//
// USAGE (from project root):
//   node tools/generate-mood-terms.mjs            # prints JSON to stdout
//   node tools/generate-mood-terms.mjs --pretty   # readable indented JSON

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

const KEY = process.env.MINIMAX_API_KEY;
const BASE = 'https://api.minimax.io/v1';
const MODEL = 'MiniMax-M3';

if (!KEY) {
  console.error('STOP: MINIMAX_API_KEY not set in project-root .env');
  process.exit(2);
}

const prompt = [
  `You are building a static word lexicon for a Stockholm events app.`,
  `The app has an "Utforska" (explore) section with mood tiles. One tile is`,
  `"Stämningsfullt" (Swedish: atmospheric/moody/evocative — candlelit,`,
  `intimate, magical, melancholic-beautiful; think candlelight concerts,`,
  `sacred choral music in churches, intimate jazz clubs, atmospheric theatre,`,
  `contemporary dance in low light, evening exhibitions — NOT loud festivals,`,
  `standup comedy, sports, or children's events).`,
  ``,
  `Generate the terms that would let a substring/word match on event titles and`,
  `descriptions recognize such events. Terms must be words that ACTUALLY appear`,
  `in Swedish event marketing copy (titles, descriptions) for Stockholm events.`,
  ``,
  `Rules:`,
  `- Swedish terms primarily; include the few common English terms that appear`,
  `  in Stockholm event copy (e.g. "candlelight").`,
  `- Base forms that also match inflections as substrings where safe`,
  `  (e.g. "stämningsfull" matches "stämningsfullt", "stämningsfulla").`,
  `- Avoid overly broad terms that would sweep in non-atmospheric events`,
  `  (e.g. "musik" alone, "kväll" alone, "konsert" alone are FORBIDDEN).`,
  `- 30-50 terms, ordered by discriminating power (best first).`,
  ``,
  `Answer in exactly this JSON format, nothing else:`,
  `{"terms": ["...", "..."], "english_terms": ["..."]}`,
].join('\n');

const res = await fetch(`${BASE}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000,
    temperature: 0.7,
  }),
});
if (!res.ok) {
  console.error(`MiniMax HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
const json = await res.json();
const text = json.choices?.[0]?.message?.content ?? '';
const match = text.match(/\{[\s\S]*\}/);
if (!match) {
  console.error('No JSON object in model output:\n' + text.slice(0, 500));
  process.exit(1);
}
const parsed = JSON.parse(match[0]);
if (process.argv.includes('--pretty')) {
  console.log(JSON.stringify(parsed, null, 2));
} else {
  console.log(JSON.stringify(parsed));
}