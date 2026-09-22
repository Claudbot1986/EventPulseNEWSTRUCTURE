#!/usr/bin/env node
// review-explore-tiles.mjs — vision review of generated Utforska-tile photos.
//
// Claude Code cannot Read image files in this environment (hard rule from
// the user 2026-09-21); MiniMax-M3 vision is the review step instead. Sends
// each raw tile photo to the OpenAI-compatible /v1/chat/completions endpoint
// with an image_url (base64 data URL) and prints a per-label review.
//
// Reads MINIMAX_API_KEY from project-root .env (NOT committed) and never
// prints it.
//
// USAGE (from project root):
//   node tools/review-explore-tiles.mjs Live=tmp/explore-tiles/tile-src-live-01.jpg
//   node tools/review-explore-tiles.mjs Live=a.jpg Imorgon=b.jpg Teater=c.jpg Chill=d.jpg
//
// Exploratory/dev-only. NOT bundled into the Expo client.
// Design + word pool: docs/EXPLORE-TILES.md

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'node:fs/promises';

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

// label=path pairs from argv
const pairs = process.argv.slice(2).map((a) => {
  const i = a.indexOf('=');
  if (i === -1) return null;
  return { label: a.slice(0, i), file: a.slice(i + 1) };
}).filter(Boolean);
if (!pairs.length) {
  console.error('Usage: node tools/review-explore-tiles.mjs Label=path/to/image.jpg ...');
  process.exit(2);
}

function reviewPrompt(label) {
  return [
    `You are reviewing a generated 1024x1024 photo intended for a Swedish events app.`,
    `The tile word is "${label}" (Swedish). The photo will be used inside a rounded`,
    `7:5 button where only a vertical strip of the CENTER 33% width (full height)`,
    `is visible — the left 67% of the button is a solid color with the word in white text.`,
    ``,
    `Answer in exactly this format, nothing else:`,
    `SUBJECT: <one sentence describing the main subject>`,
    `MATCH: <yes/no — does the photo evoke the word "${label}"?>`,
    `CENTER_33_CROP: <yes/no — would the main subject stay clearly visible in a center vertical strip of 33% width?>`,
    `ARTIFACTS: <yes/no — any visible text, letters, numbers, logos, watermarks or obvious AI artifacts?>`,
    `VERDICT: <PASS or FAIL for the "${label}" tile>`,
  ].join('\n');
}

async function reviewOne({ label, file }) {
  const abs = path.resolve(PROJECT_ROOT, file);
  const buf = await fs.readFile(abs);
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: reviewPrompt(label) },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`MiniMax HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No message content in response');
  console.log(`\n=== ${label} (${path.basename(file)}, ${(buf.length / 1024).toFixed(0)} kB) ===`);
  console.log(content.trim());
}

(async () => {
  console.log(`Using model=${MODEL}, base=${BASE}`);
  for (const p of pairs) {
    try {
      await reviewOne(p);
    } catch (e) {
      console.error(`FAILED for ${p.label}: ${e.message}`);
      process.exitCode = 1;
    }
  }
})();