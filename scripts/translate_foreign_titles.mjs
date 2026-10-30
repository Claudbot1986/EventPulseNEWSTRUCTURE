#!/usr/bin/env node
/**
 * translate_foreign_titles.mjs — översätt eventtitlar som INTE är på svenska.
 *
 * Ett event kan ha en titel på ryska, arabiska, kinesiska, hindi osv. Det är
 * inte ett fel — men i en svensk app ska titeln visas på svenska. Den rätta
 * lösningen är en översättning, inte att radera titeln.
 *
 * Skriptet:
 *   1. Hittar publicerade events vars titel innehåller tecken från ett skript
 *      som inte hör hemma i målspråket.
 *   2. Hoppar över events som redan har en översättning (resume-friendly).
 *   3. Översätter titeln med MiniMax M3 och skriver till `event_translations`.
 *
 * Ingen LLM får hitta på events — bara översätta en befintlig titel.
 *
 * Användning:
 *   node --env-file=.env scripts/translate_foreign_titles.mjs --languages sv,en --dry-run
 *   node --env-file=.env scripts/translate_foreign_titles.mjs --languages sv,en --apply
 *
 * Miljö: MINIMAX_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Exit: 0 = ok, 1 = fel, 3 = MiniMax-kontot saknar pengar (aldrig retry).
 */

import { createClient } from '@supabase/supabase-js';
import { findForeignScriptRuns } from '../packages/shared/src/text/scriptScan.js';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_TIMEOUT_MS = 180_000;
const LLM_MAX_TOKENS = 16_384;
const PAGE = 1000;

const LANGUAGE_NAMES = {
  sv: 'Swedish',
  en: 'English',
  de: 'German',
  no: 'Norwegian',
  fi: 'Finnish',
  da: 'Danish',
  nl: 'Dutch',
  fr: 'French',
  'zh-Hans': 'Simplified Chinese',
  it: 'Italian',
  ar: 'Arabic',
  fa: 'Persian (Farsi)',
  so: 'Somali',
  pl: 'Polish',
  tr: 'Turkish',
};

class BillingError extends Error {}

function parseArgs(argv) {
  const out = { languages: ['sv', 'en'], apply: false, limit: 500, batchSize: 10 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--languages') out.languages = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 500;
    else if (a === '--batch-size') out.batchSize = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/translate_foreign_titles.mjs --languages sv,en [--dry-run|--apply] [--limit N]');
      process.exit(0);
    }
  }
  return out;
}

function buildSystemPrompt(language) {
  const langName = LANGUAGE_NAMES[language] || language;
  return [
    'You are a professional translator for an event-discovery app in Stockholm.',
    `The user sends a JSON array of event titles: [{"n":1,"title":"..."}, ...].`,
    `Translate each title into ${langName}.`,
    'Return JSON only: an array with EXACTLY the same "n" values — [{"n":1,"title":"..."}, ...].',
    'Keep the original meaning. Keep proper nouns (artist names, venue names) when a',
    'translation would be misleading. If a title is already in the target language,',
    'return it unchanged. Never invent extra events, dates or venues.',
  ].join(' ');
}

function parseJsonArray(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = cleaned.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const body = fence ? fence[1] : cleaned;
  const start = body.indexOf('[');
  const json = start >= 0 ? body.slice(start) : body;
  return JSON.parse(json);
}

async function callMiniMax({ apiKey, model, language, items }) {
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: LLM_MAX_TOKENS,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildSystemPrompt(language) },
        { role: 'user', content: JSON.stringify(items.map(({ n, title }) => ({ n, title }))) },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 402 || /insufficient|balance|余额|欠费/i.test(body)) {
      throw new BillingError(`minimax HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    throw new Error(`minimax HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = await response.json();
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
  const parsed = parseJsonArray(text);
  if (!Array.isArray(parsed)) throw new Error('response is not a JSON array');
  const byN = new Map(parsed.map((p) => [p.n, p]));
  return items.map((item) => ({
    event_id: item.event_id,
    title: typeof byN.get(item.n)?.title === 'string' ? byN.get(item.n).title : '',
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.MINIMAX_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!apiKey) { console.error('MINIMAX_API_KEY not set'); process.exit(2); }
  if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'); process.exit(2); }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── 1. Hitta events med främmande titel ────────────────────────────────
  // Skannar HELA den publicerade poolen (paginerat). --limit begränsar
  // antalet event vi ÖVERSÄTTER, inte hur många vi undersöker.
  const candidates = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await sb
      .from('events_public')
      .select('id,source,title_sv,title_en,start_time')
      .order('start_time', { ascending: true })
      .range(from, to);
    if (error) { console.error('events fetch:', error.message); process.exit(1); }
    for (const row of data ?? []) {
      const title = row.title_sv || row.title_en;
      if (!title) continue;
      const runs = findForeignScriptRuns(title, 'sv');
      if (runs.length === 0) continue;
      candidates.push({ id: row.id, title: String(title), source: row.source, start_time: row.start_time });
    }
    if (!data || data.length < PAGE) break;
  }
  console.log(`[translate-foreign] ${candidates.length} events med främmande titel.`);

  const toTranslate = candidates.slice(0, args.limit);

  // ── 2. Hoppa över redan översatta ──────────────────────────────────────
  const existing = new Set();
  for (let i = 0; i < toTranslate.length; i += 100) {
    const ids = toTranslate.slice(i, i + 100).map((c) => c.id);
    const { data: rows } = await sb
      .from('event_translations')
      .select('event_id,language')
      .in('language', args.languages)
      .in('event_id', ids);
    for (const row of rows ?? []) existing.add(`${row.event_id}|${row.language}`);
  }

  const todo = [];
  for (const candidate of toTranslate) {
    for (const language of args.languages) {
      if (existing.has(`${candidate.id}|${language}`)) continue;
      todo.push({ event_id: candidate.id, title: candidate.title, language });
    }
  }
  console.log(`[translate-foreign] ${todo.length} översättningar att göra (${args.languages.join(', ')}).`);

  if (!args.apply) {
    console.log('[translate-foreign] DRY-RUN — inga anrop, inga skrivningar.');
    for (const candidate of candidates.slice(0, 15)) {
      console.log(`  - ${candidate.id.slice(0, 8)} ${candidate.source} "${candidate.title}"`);
    }
    return;
  }

  // ── 3. Översätt i batchar per språk ────────────────────────────────────
  const stats = { translated: 0, failed: 0 };
  for (const language of args.languages) {
    const items = todo.filter((t) => t.language === language);
    for (let i = 0; i < items.length; i += args.batchSize) {
      const batch = items.slice(i, i + args.batchSize).map((it, idx) => ({ ...it, n: idx + 1 }));
      let results = [];
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          results = await callMiniMax({ apiKey, model: 'MiniMax-M3', language, items: batch });
          break;
        } catch (error) {
          if (error instanceof BillingError) throw error;
          console.warn(`[translate-foreign] försök ${attempt} misslyckades (${language}): ${error.message}`);
          if (attempt === 2) results = [];
        }
      }
      for (const result of results) {
        if (!result.title) { stats.failed += 1; continue; }
        const { error } = await sb.from('event_translations').upsert(
          {
            event_id: result.event_id,
            language,
            title: result.title,
            description: null,
            model: 'MiniMax-M3-text-integrity',
            translated_at: new Date().toISOString(),
          },
          { onConflict: 'event_id,language' },
        );
        if (error) {
          stats.failed += 1;
          console.error(`[translate-foreign] upsert failed: ${result.event_id} ${language}: ${error.message}`);
        } else {
          stats.translated += 1;
          console.log(`[translate-foreign] ${language}: "${results.find((r) => r.event_id === result.event_id)?.title ?? ''}"`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  console.log(`[translate-foreign] klart — translated=${stats.translated} failed=${stats.failed}`);
  if (stats.failed > 0) process.exit(1);
}

main().catch((error) => {
  if (error instanceof BillingError) {
    console.error('[translate-foreign] BILLING ERROR — MiniMax-kontot saknar pengar. Avbröt omedelbart.');
    process.exit(3);
  }
  console.error('[translate-foreign] fatal:', error.message || error);
  process.exit(1);
});
