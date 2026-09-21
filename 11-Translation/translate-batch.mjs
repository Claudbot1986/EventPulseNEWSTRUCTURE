#!/usr/bin/env node
/**
 * 11-Translation/translate-batch.mjs — batched event translation backfill.
 *
 * Same mission as translate.mjs (fill event_translations from events_public
 * via MiniMax), but ~20 events per API call instead of 1 — MiniMax-M3's
 * large context window makes the single-event loop unnecessarily slow
 * (~35 rows/min, timeouts under load). translate.mjs stays as the proven
 * mop-up tool for stragglers.
 *
 * Matchback design: input and output are numbered JSON arrays —
 *   in : [{"n":1,"title":"...","description":"..."}, ...]
 *   out: [{"n":1,"title":"...","description":"..."}, ...]
 * Rows are matched on "n" only; a missing n fails the batch and triggers
 * the failure ladder: retry whole batch → recursive split in half →
 * single items (the proven translate.mjs case). Extra n are ignored.
 *
 * BILLING GUARD (user requirement 2026-09-21): MiniMax insufficient-funds
 * signals (HTTP 402, base_resp status_code 1008, or body text matching
 * /insufficient|balance|余额|欠费/i) throw BillingError, which is NEVER
 * retried — all workers stop pulling tasks immediately and the run exits
 * with code 3. Rows already written persist; skip-existing resumes after
 * a top-up.
 *
 * Usage:
 *   node translate-batch.mjs --languages ar,fa,so --limit 100
 *   node translate-batch.mjs --languages ar --limit 20 --dry-run
 *   node translate-batch.mjs --languages ar,fa,so,pl,tr --limit 10000 --batch-size 20 --concurrency 6
 *
 * Required env:
 *   MINIMAX_API_KEY       — MiniMax API key (same project as 08-Agent chat).
 *   SUPABASE_URL          — Supabase project URL.
 *   SUPABASE_SERVICE_KEY  — service_role key (read+write event_translations).
 */

import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
// Testkörning 2026-09-21: 60s/8192 gav timeout-snoppar även på 2-items-batchar —
// M3-svar tog längre än timeouten (klientabort avbryter inte servern: kostnaden
// tickar ändå). 180s/16k ger varje anrop utrymme att faktiskt slutföras.
const LLM_TIMEOUT_MS = 180_000; // batches generate far more output than single rows
const LLM_MAX_TOKENS = 16_384;  // M3 thinks in <think> blocks that consume the budget first
const LLM_ATTEMPTS = 2;         // per batch before the split ladder kicks in
const PAGE = 1_000;            // PostgREST response cap — paginate events fetch

const LANGUAGE_NAMES = {
  ar: 'Arabic', fa: 'Persian (Farsi)', so: 'Somali', pl: 'Polish', tr: 'Turkish',
};

class BillingError extends Error {}

// Module-level run state: set once any worker hits a billing error so all
// workers stop pulling new tasks immediately.
let billingAbort = false;

const stats = { translated: 0, skipped: 0, failed: 0, splitBatches: 0 };

function parseArgs(argv) {
  const out = { languages: [], limit: 25, model: 'MiniMax-M3', batchSize: 20, concurrency: 6, withinDays: 0, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--languages') out.languages = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 25;
    else if (a === '--model') out.model = argv[++i] || 'MiniMax-M3';
    else if (a === '--batch-size') out.batchSize = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (a === '--concurrency') out.concurrency = Math.max(1, parseInt(argv[++i], 10) || 6);
    else if (a === '--within-days') out.withinDays = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node translate-batch.mjs --languages ar,fa,so [--limit N] [--model X] [--batch-size N] [--concurrency N] [--within-days N] [--dry-run]');
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (out.languages.length === 0) {
    console.error('Missing --languages ar,fa,...');
    process.exit(2);
  }
  return out;
}

function buildSystemPrompt(language) {
  const langName = LANGUAGE_NAMES[language] || `the language with ISO 639-1 code "${language}"`;
  return [
    'You are a professional translator for an event-discovery app.',
    `The user sends a JSON array of Swedish events: [{"n":1,"title":"...","description":"..."}, ...].`,
    `Translate each event's title and description into ${langName}.`,
    'Return JSON only: an array with EXACTLY the same "n" values as the input — [{"n":1,"title":"...","description":"..."}, ...].',
    'Preserve venue names, artist names, and proper nouns verbatim.',
    'If a description is empty, return it as an empty string.',
    'Do not add commentary, do not reorder, merge, or split events.',
  ].join(' ');
}

function parseJsonArray(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Salvage truncated tail: cut back to the last complete item, close array.
    const lastGood = text.lastIndexOf('},');
    if (lastGood === -1) throw new Error(`JSON parse failed: ${err.message}`);
    try {
      return JSON.parse(`${text.slice(0, lastGood + 1)}]`);
    } catch {
      throw new Error(`JSON parse failed: ${err.message}`);
    }
  }
}

async function callMiniMaxOnce({ apiKey, model, language, items }) {
  let response;
  // HTTP 429 = rate limit, not a bad batch. Back off and re-fetch instead of
  // entering the split ladder (splitting under quota pressure makes MORE calls
  // and amplifies the throttling). Bounded to 3 retries per attempt.
  for (let rl = 0; ; rl++) {
    response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: LLM_MAX_TOKENS,
        temperature: 0.1,
        messages: [
          { role: 'system', content: buildSystemPrompt(language) },
          { role: 'user', content: JSON.stringify(items.map(({ n, title, description }) => ({ n, title, description }))) },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (response.status !== 429 || rl >= 3) break;
    const wait = 5_000 * (rl + 1);
    console.warn(`[translate-batch] HTTP 429 rate limit (${language}, ${items.length} items) — backoff ${wait / 1000}s, retry ${rl + 1}/3`);
    await new Promise((r) => setTimeout(r, wait));
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    if (response.status === 402 || /insufficient|balance|余额|欠费/i.test(errBody)) {
      throw new BillingError(`minimax HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }
    throw new Error(`minimax HTTP ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const json = await response.json();

  // MiniMax can return HTTP 200 with an error envelope (base_resp).
  const baseResp = json?.base_resp;
  if (baseResp && typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
    const msg = String(baseResp.status_msg || '');
    if (baseResp.status_code === 1008 || /insufficient|balance|余额|欠费/i.test(msg)) {
      throw new BillingError(`minimax base_resp ${baseResp.status_code}: ${msg}`);
    }
    throw new Error(`minimax base_resp ${baseResp.status_code}: ${msg}`);
  }

  let text = String(json?.choices?.[0]?.message?.content ?? '');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenceMatch) text = fenceMatch[1];
  const bracketIdx = text.indexOf('[');
  if (bracketIdx > 0) text = text.slice(bracketIdx);

  const parsed = parseJsonArray(text);
  return validateMatchback(parsed, items);
}

function validateMatchback(parsed, items) {
  if (!Array.isArray(parsed)) throw new Error('response is not a JSON array');
  const sentN = new Set(items.map((i) => i.n));
  const byN = new Map();
  const extra = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof item.n !== 'number') {
      throw new Error('array item missing numeric "n"');
    }
    if (!sentN.has(item.n)) { extra.push(item.n); continue; }
    byN.set(item.n, item);
  }
  const missing = items.filter((i) => !byN.has(i.n)).map((i) => i.n);
  if (missing.length > 0) throw new Error(`missing n: ${missing.slice(0, 5).join(',')}`);
  if (extra.length > 0) console.warn(`[translate-batch] extra n ignored: ${extra.slice(0, 5).join(',')}`);
  return items.map((i) => {
    const o = byN.get(i.n);
    return {
      event_id: i.event_id,
      title: typeof o.title === 'string' ? o.title : '',
      description: typeof o.description === 'string' ? o.description : '',
    };
  });
}

// Failure ladder: retry batch → recursive split in half → single items.
// Returns { results, failedItems }; only BillingError escapes as a throw.
async function ladder(opts, items) {
  let lastErr = null;
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      return { results: await callMiniMaxOnce({ ...opts, items }), failedItems: [] };
    } catch (err) {
      if (err instanceof BillingError) throw err;
      lastErr = err;
      console.warn(`[translate-batch] batch attempt ${attempt}/${LLM_ATTEMPTS} failed (${items.length} items, ${opts.language}): ${err.message}`);
    }
  }
  if (items.length === 1) return { results: [], failedItems: items };
  stats.splitBatches++;
  const mid = Math.ceil(items.length / 2);
  const left = await ladder(opts, items.slice(0, mid));
  const right = await ladder(opts, items.slice(mid));
  return {
    results: [...left.results, ...right.results],
    failedItems: [...left.failedItems, ...right.failedItems],
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error('MINIMAX_API_KEY not set');
    process.exit(2);
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
    process.exit(2);
  }
  const sb = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log(`[translate-batch] languages=${args.languages.join(',')} limit=${args.limit} model=${args.model} batch-size=${args.batchSize} dry-run=${args.dryRun}`);

  // Read future events — identical pattern to translate.mjs (paginated).
  const nowIso = new Date().toISOString();
  let query = sb
    .from('events_public')
    .select('id, title_sv, description_sv')
    .gt('start_time', nowIso)
    .order('start_time', { ascending: true });
  if (args.withinDays > 0) {
    const cutoff = new Date(Date.now() + args.withinDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.lt('start_time', cutoff);
  }
  const events = [];
  for (let from = 0; from < args.limit; from += PAGE) {
    const to = Math.min(from + PAGE, args.limit) - 1;
    const { data, error } = await query.range(from, to);
    if (error) {
      console.error('events fetch:', error.message);
      process.exit(1);
    }
    events.push(...(data || []));
    if (!data || data.length < to - from + 1) break;
  }
  console.log(`[translate-batch] fetched ${events.length} future events`);

  // Skip-existing: resume-friendly, chunked to stay under PostgREST URL limits.
  const existing = new Set();
  {
    const ids = events.map((e) => e.id);
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data: rows, error: exErr } = await sb
        .from('event_translations')
        .select('event_id, language')
        .in('language', args.languages)
        .in('event_id', ids.slice(i, i + CHUNK));
      if (exErr) {
        console.error('existing fetch:', exErr.message);
        process.exit(1);
      }
      for (const row of rows || []) existing.add(`${row.event_id}|${row.language}`);
    }
  }
  console.log(`[translate-batch] existing rows: ${existing.size} (will skip)`);

  // Per-language queues → chunked into batch tasks.
  let resumed = 0, emptySource = 0;
  const queues = new Map();
  for (const ev of events) {
    if (!ev.title_sv && !ev.description_sv) {
      emptySource += args.languages.length;
      continue;
    }
    for (const lang of args.languages) {
      if (existing.has(`${ev.id}|${lang}`)) {
        resumed++;
        continue;
      }
      if (!queues.has(lang)) queues.set(lang, []);
      queues.get(lang).push({ event_id: ev.id, title: ev.title_sv || '', description: ev.description_sv || '' });
    }
  }
  const tasks = [];
  for (const [lang, items] of queues) {
    for (let i = 0; i < items.length; i += args.batchSize) {
      tasks.push({ lang, items: items.slice(i, i + args.batchSize) });
    }
  }
  const totalPairs = resumed + emptySource + tasks.reduce((n, t) => n + t.items.length, 0);

  if (args.dryRun) {
    console.log(`[translate-batch] DRY-RUN — ${tasks.length} batches (${totalPairs} pairs: ${resumed} already done, ${emptySource} empty source).`);
    for (const [lang, items] of queues) {
      console.log(`[translate-batch]   ${lang}: ${items.length} pairs → ${Math.ceil(items.length / args.batchSize)} batches`);
    }
    console.log(`[translate-batch] No API calls, no writes.`);
    return;
  }

  console.log(`[translate-batch] tasks: ${tasks.length} batches (${resumed} already done, ${emptySource} empty source), concurrency=${args.concurrency}`);

  async function processBatch({ lang, items }) {
    const numbered = items.map((it, idx) => ({ n: idx + 1, ...it }));
    const { results, failedItems } = await ladder({ apiKey, model: args.model, language: lang }, numbered);

    for (const r of results) {
      if (!r.title && !r.description) {
        stats.skipped++;
        console.log(`[translate-batch] skip empty: event=${r.event_id} lang=${lang}`);
        continue;
      }
      const { error: upErr } = await sb.from('event_translations').upsert(
        {
          event_id: r.event_id,
          language: lang,
          title: r.title || null,
          description: r.description || null,
          model: `${args.model}-batch`,
          translated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,language' }
      );
      if (upErr) {
        stats.failed++;
        console.error(`[translate-batch] upsert failed: event=${r.event_id} lang=${lang}: ${upErr.message}`);
      } else {
        stats.translated++;
        if (stats.translated % 25 === 0) {
          console.log(`[translate-batch] progress: ${stats.translated} written, ${stats.failed} failed, ${stats.skipped} skipped, ${stats.splitBatches} split-batches`);
        }
      }
    }
    for (const f of failedItems) {
      stats.failed++;
      console.error(`[translate-batch] error: event=${f.event_id} lang=${lang}: batch ladder exhausted (logged for mop-up)`);
    }
  }

  // Worker pool over the shared task list; billingAbort stops all workers.
  let cursor = 0;
  let billingErr = null;
  async function workerLoop() {
    while (cursor < tasks.length) {
      if (billingAbort) return;
      const t = tasks[cursor++];
      try {
        await processBatch(t);
      } catch (err) {
        if (err instanceof BillingError) {
          billingAbort = true;
          billingErr = err;
          return;
        }
        throw err;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, tasks.length || 1) }, () => workerLoop())
  );

  if (billingErr) {
    console.error(`[translate-batch] BILLING ERROR — MiniMax-kontot saknar pengar (${billingErr.message}). Avbröt omedelbart, inga fler anrop gjordes. Skrivna rader är sparade — kör samma kommando igen efter påfyllning (skip-existing återupptar).`);
    process.exit(3);
  }

  const pairsLeft = tasks.reduce((n, t) => n + t.items.length, 0) - (stats.translated + stats.failed + stats.skipped);
  console.log(`[translate-batch] done — translated=${stats.translated} skipped=${stats.skipped} failed=${stats.failed} split-batches=${stats.splitBatches} resumed-skip=${resumed} empty-source=${emptySource} unprocessed=${pairsLeft}`);
}

main().catch((err) => {
  if (err instanceof BillingError) {
    console.error(`[translate-batch] BILLING ERROR — MiniMax-kontot saknar pengar (${err.message}). Avbryter.`);
    process.exit(3);
  }
  console.error('[translate-batch] fatal:', err.message || err);
  process.exit(1);
});
