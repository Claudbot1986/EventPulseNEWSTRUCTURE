#!/usr/bin/env node
/**
 * 11-Translation/ui-strings.mjs — AI-fill UI dictionaries (Språkstöd 2026-09-21).
 *
 * Translates the canonical Swedish dictionary (06-UI/i18n/strings/sv.js,
 * ~377 flat 'dotted.key' entries) into a target locale and writes
 * 06-UI/i18n/strings/<locale>.js in the existing house format.
 *
 * Usage:
 *   node ui-strings.mjs                       # all five new locales
 *   node ui-strings.mjs --languages ar,fa     # subset
 *   node ui-strings.mjs --languages ar --dry-run
 *
 * Rules enforced per batch (a failed batch → language file left untouched):
 *   - translated key set MUST equal the source key set
 *   - every {placeholder} token in the source value MUST survive translation
 *   - emojis / punctuation in values are preserved by prompt instruction
 *
 * Required env: MINIMAX_API_KEY (same project as 08-Agent chat).
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRINGS_DIR = new URL('../06-UI/i18n/strings/', import.meta.url);

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const MODEL = 'MiniMax-M3';
const LLM_TIMEOUT_MS = 45_000; // batches of 25 keys need more headroom than single events
const LLM_MAX_TOKENS = 8_192;  // M3 thinks in <think> blocks that consume the budget first
const LLM_ATTEMPTS = 3;
const BATCH_SIZE = 25;

const DEFAULT_LANGUAGES = ['ar', 'fa', 'so', 'pl', 'tr'];
const LANGUAGE_NAMES = {
  ar: 'Arabic', fa: 'Persian (Farsi)', so: 'Somali', pl: 'Polish', tr: 'Turkish',
};
const NATIVE_NAMES = { ar: 'Arabic (العربية)', fa: 'Persian (فارسی)', so: 'Somali (Soomaali)', pl: 'Polish (Polski)', tr: 'Turkish (Türkçe)' };

function parseArgs(argv) {
  const out = { languages: [...DEFAULT_LANGUAGES], dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--languages') out.languages = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') out.dryRun = true;
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  for (const lang of out.languages) {
    if (!LANGUAGE_NAMES[lang]) {
      console.error(`Unsupported locale for UI fill: ${lang} (known: ${Object.keys(LANGUAGE_NAMES).join(', ')})`);
      process.exit(2);
    }
  }
  return out;
}

async function translateBatch({ apiKey, language, entries }) {
  // entries: [[key, value], ...] — model returns {"key": "translated", ...}
  const source = Object.fromEntries(entries);
  // User message is ONLY the string map. Wrapping it in an envelope
  // ({"strings": {...}, ...}) made the model echo envelope keys as
  // translation targets in earlier runs — keep the key space unambiguous.
  const userMsg = JSON.stringify(source);

  const SYSTEM_PROMPT = [
    'You are a professional app-localization translator for an event-discovery app in Stockholm.',
    `The user sends a JSON object of Swedish UI strings. Translate each VALUE into ${LANGUAGE_NAMES[language]}.`,
    'Return JSON only: an object with EXACTLY the same keys as the input, and the translations as values.',
    'Preserve {placeholder} tokens verbatim (do not translate or reorder characters inside braces).',
    'Preserve emojis (✓, 🎉, …), HTML-free — plain text only. Keep the tone short and app-like.',
    'Venue names, artist names, brand names and proper nouns stay verbatim.',
  ].join(' ');

  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: LLM_MAX_TOKENS,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`minimax HTTP ${response.status}`);
  const json = await response.json();
  let text = String(json?.choices?.[0]?.message?.content ?? '');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenceMatch) text = fenceMatch[1];
  const braceIdx = text.indexOf('{');
  if (braceIdx > 0) text = text.slice(braceIdx);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Salvage attempt: truncated tail — cut back to the last complete pair.
    const lastComma = text.lastIndexOf('",');
    if (lastComma === -1) throw new Error(`JSON parse failed: ${err.message}`);
    try {
      parsed = JSON.parse(`${text.slice(0, lastComma + 1)}}`);
    } catch {
      throw new Error(`JSON parse failed: ${err.message}`);
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('response is not a JSON object');
  }

  // Validation 1: key parity.
  const srcKeys = Object.keys(source);
  const outKeys = Object.keys(parsed);
  const missing = srcKeys.filter((k) => !(k in parsed));
  const extra = outKeys.filter((k) => !(k in source));
  if (extra.length > 0) throw new Error(`unexpected keys: ${extra.slice(0, 3).join(', ')}`);
  if (missing.length > 0) throw new Error(`missing keys: ${missing.slice(0, 3).join(', ')}`);

  // Validation 2: placeholder tokens survive.
  for (const key of srcKeys) {
    const src = String(source[key]);
    const out = parsed[key];
    if (typeof out !== 'string') throw new Error(`non-string value for key '${key}'`);
    const tokens = src.match(/\{[^{}]+\}/g) || [];
    for (const token of tokens) {
      if (!out.includes(token)) throw new Error(`placeholder ${token} lost in key '${key}'`);
    }
  }

  return parsed;
}

async function translateBatchWithRetry(opts) {
  let lastErr = null;
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      return await translateBatch(opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function escapeJsString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function renderDictionary({ lang, source, translated }) {
  const header = [
    `/**`,
    ` * ${NATIVE_NAMES[lang]} dictionary (` + `${lang}` + `) — AI-filled from sv.js (canonical) via 11-Translation/ui-strings.mjs.`,
    ` * Key parity is mandatory; missing keys fall back en → sv.`,
    ` *`,
    ` * Interpolation: {name} placeholders. Day/month name arrays live in`,
    ` * ../dateNames.js (not here — they are structured data, not flat strings).`,
    ` */`,
    `export default {`,
  ].join('\n');

  const lines = Object.keys(source).map((key) => {
    const val = translated[key] ?? source[key]; // validation guarantees presence; defensive only
    return `  '${key}': '${escapeJsString(val)}',`;
  });

  return `${header}\n${lines.join('\n')}\n};\n`;
}

async function main() {
  const args = parseArgs(process.argv);

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error('MINIMAX_API_KEY not set');
    process.exit(2);
  }

  // Canonical source = sv.js (Swedish is the reference dictionary).
  const svModule = await import(new URL('sv.js', STRINGS_DIR).href);
  const source = svModule.default;
  const keys = Object.keys(source);
  console.log(`[ui-strings] source=sv.js keys=${keys.length} languages=${args.languages.join(',')} dry-run=${args.dryRun}`);

  if (args.dryRun) {
    const batches = Math.ceil(keys.length / BATCH_SIZE);
    console.log(`[ui-strings] DRY-RUN — would run ${batches} batches × ${args.languages.length} languages = ${batches * args.languages.length} MiniMax calls. No writes.`);
    return;
  }

  for (const lang of args.languages) {
    const translatedAll = {};
    let failedBatches = 0;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batchKeys = keys.slice(i, i + BATCH_SIZE);
      const entries = batchKeys.map((k) => [k, String(source[k])]);
      const batchNo = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(keys.length / BATCH_SIZE);
      try {
        const out = await translateBatchWithRetry({ apiKey, language: lang, entries });
        Object.assign(translatedAll, out);
        console.log(`[ui-strings] ${lang} batch ${batchNo}/${totalBatches} OK (${batchKeys.length} keys)`);
      } catch (err) {
        failedBatches++;
        console.error(`[ui-strings] ${lang} batch ${batchNo}/${totalBatches} FAILED: ${err.message || err}`);
        break; // leave the file untouched on any unrecoverable batch
      }
    }

    if (failedBatches > 0) {
      console.error(`[ui-strings] ${lang}: aborted — file NOT written (fix and re-run; partial progress is discarded by design)`);
      continue;
    }

    const content = renderDictionary({ lang, source, translated: translatedAll });
    const outUrl = new URL(`${lang}.js`, STRINGS_DIR);
    writeFileSync(fileURLToPath(outUrl), content, 'utf-8');
    console.log(`[ui-strings] ${lang}: wrote ${Object.keys(translatedAll).length} keys → ${fileURLToPath(outUrl).replace(REPO_ROOT, '')}`);
  }

  console.log('[ui-strings] done');
}

main().catch((err) => {
  console.error('[ui-strings] fatal:', err.message || err);
  process.exit(1);
});
