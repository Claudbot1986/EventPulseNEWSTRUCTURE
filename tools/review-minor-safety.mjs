#!/usr/bin/env node
// review-minor-safety.mjs — vision-granskning av BFL round5-bilder.
// Säkerhetsmodell: endast bfl5_*.webp (nygenererade bilder), resten av
// biblioteket är redan publicerat och hanteras inte.
//
// Frågor:
//   - MINOR_FACE: yes/no — syns ett ansikte som tydligt tillhör ett barn (<12 år)?
//   - CLOSEUP_FACE: yes/no — är det close-up på ett ansikte (förstör privacy)?
//   - VIOLENCE: yes/no — syns vapen, knivar, blod, slagsmål?
//   - WEAPON: yes/no — vapen (kniv/pistol/yxa)?
//   - BODY_HORIZONTAL: yes/no — kropp liggande/med föremål i sig (kan tolkas som skadad/död)?
//   - SAFE: yes/no — skulle du visa bilden för en 8-åring?
//
// Output:
//   - tmp_image_corpus/_minor_safety_review.json
//   - tmp_image_corpus/_minor_safety_review_FROZEN.json (sparas EJ här —
//     köraren beslutar om FROZEN)
//
// USAGE:  node tools/review-minor-safety.mjs [--only theatre-drama,opera]
//         node tools/review-minor-safety.mjs --apply  # kör skarpt
//
// Default är --dry-run (visar bara fil-listan).

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

if (!KEY) { console.error('STOP: MINIMAX_API_KEY not set'); process.exit(2); }

const ROOT_LIB = path.resolve(PROJECT_ROOT, 'local_image_library');
const OUTPUT_JSON = path.resolve(PROJECT_ROOT, 'tmp_image_corpus/_minor_safety_review.json');

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const onlyCats = onlyIdx >= 0
  ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim()))
  : null;
const isDryRun = args.includes('--dry-run');

async function collectImages() {
  const out = [];
  const cats = await fs.readdir(ROOT_LIB);
  for (const cat of cats) {
    if (cat.startsWith('_')) continue;
    if (cat.startsWith('.')) continue;
    if (onlyCats && !onlyCats.has(cat)) continue;
    const sub = path.join(ROOT_LIB, cat);
    const stat = await fs.stat(sub).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const files = await fs.readdir(sub);
    for (const f of files) {
      // ENDAST round5-bilder (bfl5_*.webp, bfl5b_*.webp, bfl5c_*.webp eller bfl5d_*.webp). Andra rundor hanteras separat.
      if (!f.startsWith('bfl5_') && !f.startsWith('bfl5b_') && !f.startsWith('bfl5c_') && !f.startsWith('bfl5d_')) continue;
      if (!f.endsWith('.webp')) continue;
      out.push({ cat, file: f, abs: path.join(sub, f) });
    }
  }
  return out;
}

function reviewPrompt() {
  return [
    'You are reviewing an AI-generated photo for a Swedish events app.',
    'The photo will be shown to users of any age (including 8-year-olds) browsing Stockholm events.',
    '',
    'Answer in EXACTLY this format, nothing else:',
    'SUBJECT: <one sentence describing what is shown>',
    'MINOR_FACE: <yes/no — is a clearly identifiable face of a child under 12 visible?>',
    'CLOSEUP_FACE: <yes/no — is the photo a tight close-up of a face (privacy / creepy)?>',
    'VIOLENCE: <yes/no — is there violence, blood, fighting, weapons visible?>',
    'WEAPON: <yes/no — is any weapon (knife, gun, axe, blade) visible?>',
    'BODY_LYING: <yes/no — is a human body lying down horizontally in a way that suggests harm (injury/death scene)?>',
    'SAFE_FOR_KID: <yes/no — would you be comfortable showing this image to an 8-year-old in a family-friendly events app?>',
    'REASON: <one sentence>',
  ].join('\n');
}

async function reviewOne({ cat, file, abs }) {
  const buf = await fs.readFile(abs);
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: reviewPrompt() },
        ],
      }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`MiniMax HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content ?? '';
  const yn = (key) => {
    const m = content.match(new RegExp(`\\b${key}:\\s*(yes|ja)`, 'i'));
    return Boolean(m);
  };
  const extract = (key) => {
    const m = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  return {
    cat, file,
    subject: extract('SUBJECT'),
    minor_face: yn('MINOR_FACE'),
    closeup_face: yn('CLOSEUP_FACE'),
    violence: yn('VIOLENCE'),
    weapon: yn('WEAPON'),
    body_lying: yn('BODY_LYING'),
    safe_for_kid: yn('SAFE_FOR_KID'),
    reason: extract('REASON'),
  };
}

async function runConcurrent(items, concurrency) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const it = items[idx];
      try {
        const r = await reviewOne(it);
        results.push(r);
        const flagged = !r.safe_for_kid || r.weapon || r.violence || r.minor_face || r.body_lying || r.closeup_face;
        const tag = flagged ? '⚠ UNSAFE' : '✓ ok';
        console.log(`  ${tag.padEnd(10)} ${r.cat}/${r.file} — ${r.subject.slice(0, 70)}`);
      } catch (e) {
        results.push({ cat: it.cat, file: it.file, error: e.message });
        console.error(`  ERR         ${it.cat}/${it.file} — ${e.message.slice(0, 80)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

(async () => {
  const items = await collectImages();
  console.log(`[minor-safety] hittade ${items.length} bfl5_*.webp (kategorier: ${onlyCats ? [...onlyCats].join(',') : 'alla'})`);
  if (isDryRun) {
    for (const i of items) console.log(`  ${i.cat}/${i.file}`);
    console.log('');
    console.log('Kör utan --dry-run för att skicka till MiniMax-M3 vision.');
    return;
  }
  if (items.length === 0) {
    console.log('Inga bilder att granska. Kör _stamp_bfl_round5.ts --apply först.');
    process.exit(0);
  }
  const t0 = Date.now();
  const results = await runConcurrent(items, 4);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const unsafe = results.filter((r) =>
    !r.safe_for_kid || r.weapon || r.violence || r.minor_face || r.body_lying || r.closeup_face
  );
  console.log('');
  console.log(`Klart på ${elapsed}s — ${results.length} granskade, ${unsafe.length} flaggade`);
  if (unsafe.length > 0) {
    console.log('\nFlaggade bilder:');
    for (const r of unsafe) {
      const why = [
        !r.safe_for_kid && 'UNSAFE_FOR_KID',
        r.weapon && 'WEAPON',
        r.violence && 'VIOLENCE',
        r.minor_face && 'MINOR_FACE',
        r.body_lying && 'BODY_LYING',
        r.closeup_face && 'CLOSEUP_FACE',
      ].filter(Boolean).join(', ');
      console.log(`  ${r.cat}/${r.file} — [${why}] ${r.reason.slice(0, 80)}`);
    }
  }
  await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify({
    reviewed: results.length,
    elapsed_s: Number(elapsed),
    flagged: unsafe.map((r) => `${r.cat}/${r.file}`),
    results,
  }, null, 2));
  console.log(`\n→ ${OUTPUT_JSON}`);
})();