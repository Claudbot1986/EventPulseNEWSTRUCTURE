#!/usr/bin/env node
/**
 * 11-Translation/translate.mjs — Event translation cache worker (Språkstöd 2026-09-21).
 *
 * Reads future events from Supabase (service_role), translates each
 * title_sv/description_sv into the requested locales via MiniMax, and
 * upserts the rows into event_translations (service_role write).
 *
 * Usage:
 *   node translate.mjs --languages ar,fa,so --limit 50
 *   node translate.mjs --languages ar --limit 5 --dry-run
 *   node translate.mjs --languages pl,tr --limit 100 --model MiniMax-M2.7
 *
 * Required env:
 *   MINIMAX_API_KEY       — MiniMax API key (same project as 08-Agent chat).
 *   SUPABASE_URL          — Supabase project URL.
 *   SUPABASE_SERVICE_KEY  — service_role key (read+write event_translations).
 *
 * What it does NOT do (intentionally):
 *   - Does not run on a schedule. Caller invokes manually.
 *   - Does not touch events.title_sv / description_sv — those stay
 *     source-of-truth from the ingestion pipeline.
 *   - Does not translate UI strings (06-UI/i18n/strings/) — that's manual
 *     translator work, not cacheable.
 *
 * Safety:
 *   - Dry-run prints the plan but never writes.
 *   - Missing translation row → next worker run picks it up (idempotent upsert).
 *   - MiniMax <think>-blocks are stripped before insert.
 *   - On MiniMax error we log + skip the row (no half-translated inserts).
 */

import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_TIMEOUT_MS = 12_000; // longer than chat — no live UX cost here
// MiniMax-M3 reasons in <think> blocks that consume max_tokens before the
// visible answer. 600 starved the JSON output (empty/truncated responses in
// test run 2026-09-21); 2048 leaves headroom for thinking + output.
const LLM_MAX_TOKENS = 2_048;
const LLM_ATTEMPTS = 2; // one automatic retry on parse/protocol failure

const SYSTEM_PROMPT = [
  'You are a professional translator for an event-discovery app.',
  'Translate the Swedish event title and description into the target language.',
  'Preserve venue names, artist names, and proper nouns verbatim.',
  'Output JSON only: {"title": "...", "description": "..."}.',
  'If description is empty, return description as empty string.',
].join(' ');

function parseArgs(argv) {
  const out = { languages: [], limit: 25, model: 'MiniMax-M3', dryRun: false, concurrency: 6, withinDays: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--languages') out.languages = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 25;
    else if (a === '--model') out.model = argv[++i] || 'MiniMax-M3';
    else if (a === '--concurrency') out.concurrency = Math.max(1, parseInt(argv[++i], 10) || 6);
    else if (a === '--within-days') out.withinDays = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node translate.mjs --languages ar,fa,so [--limit N] [--model X] [--concurrency N] [--within-days N] [--dry-run]');
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

async function translateOnce({ apiKey, model, language, title, description }) {
  const userMsg = JSON.stringify({
    source_language: 'sv',
    target_language: language,
    title: title || '',
    description: description || '',
  });

  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`minimax HTTP ${response.status}`);
  const json = await response.json();
  let text = json?.choices?.[0]?.message?.content ?? '';
  text = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Robust JSON parse — MiniMax occasionally wraps in fences.
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) text = fenceMatch[1];
  // Some responses drop the opening tokens of the JSON object
  // (think-block starvation). Re-anchor on the first '{' before parsing.
  const braceIdx = text.indexOf('{');
  if (braceIdx > 0) text = text.slice(braceIdx);
  const parsed = JSON.parse(text);
  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    description: typeof parsed.description === 'string' ? parsed.description : '',
  };
}

async function translateOne(opts) {
  let lastErr = null;
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      return await translateOnce(opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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

  console.log(`[translate] languages=${args.languages.join(',')} limit=${args.limit} model=${args.model} dry-run=${args.dryRun}`);

  // Read future events. source = events_public (RLS-friendly view).
  // Service-role bypasses RLS — we still need the view for column ergonomics.
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
  // PostgREST caps a single response at 1000 rows regardless of .limit() —
  // page with .range() so --limit 10000 actually reaches all 5649+ events.
  const events = [];
  const PAGE = 1000;
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
  console.log(`[translate] fetched ${events.length} future events`);

  // Skip-existing: fetch (event_id, language) pairs already translated so a
  // re-run resumes instead of redoing work. Chunked because .in() on many
  // UUIDs would exceed PostgREST URL limits (chunk 100 ids → max 100×N rows).
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
  console.log(`[translate] existing rows: ${existing.size} (will skip)`);

  // Flat task list — pairs not already present.
  let resumed = 0, emptySource = 0;
  const tasks = [];
  for (const ev of events) {
    // Events with neither title nor description have nothing to translate —
    // skip client-side instead of paying for an API call per language.
    if (!ev.title_sv && !ev.description_sv) {
      emptySource += args.languages.length;
      continue;
    }
    for (const lang of args.languages) {
      if (existing.has(`${ev.id}|${lang}`)) {
        resumed++;
        continue;
      }
      tasks.push({ ev, lang });
    }
  }

  if (args.dryRun) {
    console.log(`[translate] DRY-RUN — would translate ${tasks.length} rows (${events.length} events × ${args.languages.length} languages − ${resumed} already done − ${emptySource} empty source).`);
    console.log(`[translate] Set --languages and --limit to control the volume. No writes performed.`);
    return;
  }

  console.log(`[translate] tasks: ${tasks.length} (${resumed} already done, ${emptySource} empty source), concurrency=${args.concurrency}`);

  let translated = 0, skipped = 0, failed = 0;
  async function processPair({ ev, lang }) {
    try {
      const out = await translateOne({
        apiKey,
        model: args.model,
        language: lang,
        title: ev.title_sv,
        description: ev.description_sv,
      });
      // Skip empty output (don't write garbage)
      if (!out.title && !out.description) {
        skipped++;
        console.log(`[translate] skip empty: event=${ev.id} lang=${lang}`);
        return;
      }
      const { error: upErr } = await sb.from('event_translations').upsert(
        {
          event_id: ev.id,
          language: lang,
          title: out.title || null,
          description: out.description || null,
          model: args.model,
          translated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,language' }
      );
      if (upErr) {
        failed++;
        console.error(`[translate] upsert failed: event=${ev.id} lang=${lang}: ${upErr.message}`);
      } else {
        translated++;
        if (translated % 25 === 0) {
          console.log(`[translate] progress: ${translated} written, ${failed} failed, ${skipped} skipped, ${tasks.length - (translated + failed + skipped)} left`);
        }
      }
    } catch (err) {
      // 429/5xx/timeout/parse errors land here — count and continue; a later
      // re-run picks the row up via the skip-existing logic.
      failed++;
      console.error(`[translate] error: event=${ev.id} lang=${lang}:`, err.message || err);
    }
  }

  // Simple worker pool: N workers drain the shared task list. `cursor++` is
  // safe here because nothing yields between read and increment.
  let cursor = 0;
  async function workerLoop() {
    while (cursor < tasks.length) {
      const t = tasks[cursor++];
      await processPair(t);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, tasks.length || 1) }, () => workerLoop())
  );

  console.log(`[translate] done — translated=${translated} skipped=${skipped} failed=${failed} resumed-skip=${resumed} empty-source=${emptySource}`);
}

main().catch((err) => {
  console.error('[translate] fatal:', err.message || err);
  process.exit(1);
});
