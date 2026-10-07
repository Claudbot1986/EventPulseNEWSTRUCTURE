/**
 * _retag-batch-null.ts — Steg T0201.3 (2026-10-05): MiniMax-driven
 * re-tagging av events med category_slug IS NULL.
 *
 * Skillnad mot _retag-batch-v3:
 *   • Filtrerar på category_slug IS NULL (inte ='community')
 *   • Skippar MB+Last.fm-enhancement (behöver bara enkla single-label
 *     kategorier; NULL-events har ofta minimal metadata som MB ändå
 *     inte kan matcha).
 *   • Skriver direkt tillbaka hög-confidence förslag (≥ 0.85) till
 *     category_slug. Låg-confidence lämnas NULL.
 *   • Output går till runtime/desc-coverage-t0201.jsonl för spårbarhet.
 *
 * Pipeline:
 *   1. Hämta alla events med category_slug IS NULL (paginerat).
 *   2. Filtrera bort de utan description (< 11 tecken — v3-regeln).
 *   3. Batcha 50 events / LLM-anrop (MiniMax).
 *   4. Validera response (JSON-array, EN kategori per event).
 *   5. confidence >= 0.85 → UPDATE events.category_slug.
 *   6. confidence < 0.85 → lämna NULL (kommer visa 'community' i UI
 *      via buildShortFactBasedLine-fallback eller "Ingen beskrivning").
 *
 * Säkerhet:
 *   - Idempotent (UPDATE skriver över NULL med samma värde = no-op).
 *   - Validerar kategori mot categories-tabellen.
 *   - Kör i batches om 100 events / UPDATE (för snabbhet).
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/_retag-batch-null.ts [--dry-run] [--limit=N]
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CATEGORY_DEFINITIONS,
  buildLlmCriteriaPrompt,
  listCategorySlugs,
  VERSION as DEFINITIONS_VERSION,
} from '../categoryDefinitions.js';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const LLM_MODEL = process.env.MINIMAX_RETAG_MODEL || 'MiniMax-Text-01';
const LLM_TIMEOUT_MS = 60_000;
const LLM_BATCH_SIZE = 50;
const MAX_TOKENS = 4096;
const APPLY_CONFIDENCE_THRESHOLD = 0.85;
const PAGE = 500;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const RUNTIME_DIR = resolve(process.cwd(), 'runtime');
mkdirSync(RUNTIME_DIR, { recursive: true });

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  category_slug: string | null;
  source: string | null;
  start_time: string | null;
}

interface Suggestion {
  id: string;
  category: string;
  confidence: number;
  reasoning: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maxDescLen(e: EventRow): number {
  const sv = e.description_sv?.length ?? 0;
  const en = e.description_en?.length ?? 0;
  return Math.max(sv, en);
}

function buildSystemPrompt(): string {
  const allowedList = listCategorySlugs();
  const criteria = buildLlmCriteriaPrompt();
  return `Du är evenemangsklassificerare för Stockholm. Du får en JSON-array med evenemang och ska klassificera varje enligt definitionerna nedan.

REGLER:
* EN kategori per event (single-label — välj den mest specifika som passar).
* Om inget passar bra, returnera "community".
* Svara ENDAST med en JSON-array. Inga andra ord, ingen markdown.
* Elementformat: {"id": "<uuid>", "category": "<slug>", "confidence": <0.0-1.0>, "reasoning": "<kort motivering på svenska, max 80 tecken>"}.
* Confidence: hur säker du är på kategorin. 1.0 = säker, 0.7 = ganska säker, 0.5 = osäker.

DEFINITIONER (definitions-version: ${DEFINITIONS_VERSION}):
${criteria}

TILLÅTNA SLUGS:
${JSON.stringify(allowedList)}`;
}

async function classifyBatch(events: EventRow[], dryRun: boolean): Promise<Suggestion[]> {
  if (dryRun) {
    return events.map((e) => ({
      id: e.id,
      category: 'community',
      confidence: 0,
      reasoning: '(dry-run)',
    }));
  }

  const eventsForPrompt = events.map((e) => ({
    id: e.id,
    title: e.title_sv ?? e.title_en ?? '',
    description: (e.description_sv ?? e.description_en ?? '').slice(0, 500),
    source: e.source ?? '',
    venue_hint: 'Stockholm',
  }));

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: JSON.stringify(eventsForPrompt) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`minimax HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const body = await resp.json();
    const content = body?.choices?.[0]?.message?.content ?? '';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`minimax: no JSON array in response: ${content.slice(0, 200)}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`minimax: invalid JSON: ${(e as Error).message} — body: ${match[0].slice(0, 200)}`);
    }
    if (!Array.isArray(parsed)) throw new Error('minimax: parsed value is not an array');
    const allowedSet = new Set(listCategorySlugs());
    return (parsed as any[]).map((r) => ({
      id: r.id,
      category: typeof r.category === 'string' && allowedSet.has(r.category) ? r.category : 'community',
      confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0,
      reasoning: typeof r.reasoning === 'string' ? r.reasoning.slice(0, 80) : '',
    }));
  } finally {
    clearTimeout(tid);
  }
}

async function fetchNullCategoryEvents(limit: number | null): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time')
      .eq('status', 'published')
      .is('category_slug', null)
      .order('start_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (limit && rows.length >= limit) break;
    const { data, error } = await q;
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as EventRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
    if (limit && rows.length >= limit) break;
  }
  // Filtrera bort events med för kort beskrivning — de kan inte kategoriseras
  // meningsfullt. De lämnas NULL och UI visar "Ingen beskrivning".
  return rows.filter((e) => maxDescLen(e) >= 11);
}

async function applySuggestions(suggestions: Suggestion[], dryRun: boolean): Promise<{ updated: number; skipped: number }> {
  const validSlugs = new Set(listCategorySlugs());
  let updated = 0;
  let skipped = 0;
  const updates: Array<{ id: string; category_slug: string }> = [];

  for (const s of suggestions) {
    if (s.confidence < APPLY_CONFIDENCE_THRESHOLD) { skipped++; continue; }
    if (!validSlugs.has(s.category)) { skipped++; continue; }
    updates.push({ id: s.id, category_slug: s.category });
  }

  if (dryRun) {
    console.log(`[retag-null] DRY RUN — would update ${updates.length}, skip ${skipped}`);
    return { updated: updates.length, skipped };
  }

  // Parallelliserad per-rad UPDATE med concurrency 20
  const CONCURRENCY = 20;
  const queue = [...updates];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const u = queue.shift()!;
      const { error } = await supabase
        .from('events')
        .update({ category_slug: u.category_slug })
        .eq('id', u.id)
        .is('category_slug', null); // säkerhetsvillkor: bara uppdatera om fortfarande NULL
      if (error) skipped++;
      else updated++;
    }
  });
  await Promise.all(workers);
  return { updated, skipped };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  console.log('[retag-null] Starting (dry-run=' + dryRun + ', limit=' + limit + ')…');
  const startTs = Date.now();

  const events = await fetchNullCategoryEvents(limit);
  console.log(`[retag-null] Found ${events.length} events with category_slug IS NULL (med description >= 11 tecken)`);

  if (events.length === 0) {
    console.log('[retag-null] Nothing to do.');
    process.exit(0);
  }

  // Batch AI-anrop
  const allSuggestions: Suggestion[] = [];
  let failed = 0;
  for (let i = 0; i < events.length; i += LLM_BATCH_SIZE) {
    const batch = events.slice(i, i + LLM_BATCH_SIZE);
    console.log(`[retag-null] LLM batch ${i / LLM_BATCH_SIZE + 1}/${Math.ceil(events.length / LLM_BATCH_SIZE)} (${batch.length} events)…`);
    try {
      const suggs = await classifyBatch(batch, dryRun);
      allSuggestions.push(...suggs);
    } catch (e) {
      console.error(`[retag-null] LLM batch failed: ${(e as Error).message.slice(0, 200)}`);
      failed += batch.length;
    }
  }

  console.log(`\n[retag-null] LLM klar: ${allSuggestions.length} förslag, ${failed} misslyckade`);

  // Confidence buckets
  const buckets: Record<string, number> = {
    '≥ 0.95': 0, '0.90 - 0.949': 0, '0.85 - 0.899': 0,
    '0.80 - 0.849': 0, '0.70 - 0.799': 0, '< 0.70': 0,
  };
  const perCat: Record<string, number> = {};
  for (const s of allSuggestions) {
    perCat[s.category] = (perCat[s.category] ?? 0) + 1;
    if (s.confidence >= 0.95) buckets['≥ 0.95']++;
    else if (s.confidence >= 0.90) buckets['0.90 - 0.949']++;
    else if (s.confidence >= 0.85) buckets['0.85 - 0.899']++;
    else if (s.confidence >= 0.80) buckets['0.80 - 0.849']++;
    else if (s.confidence >= 0.70) buckets['0.70 - 0.799']++;
    else buckets['< 0.70']++;
  }

  console.log('\n=== Confidence-buckets ===');
  for (const [b, n] of Object.entries(buckets)) console.log(`  ${b.padEnd(15)} ${n}`);
  console.log('\n=== Fördelning per kategori (förslag) ===');
  for (const [c, n] of Object.entries(perCat).sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(20)} ${n}`);

  // Apply
  const applyResult = await applySuggestions(allSuggestions, dryRun);
  console.log(`\n=== Apply ===`);
  console.log(`  updated: ${applyResult.updated}`);
  console.log(`  skipped (låg confidence eller ogiltig slug): ${applyResult.skipped}`);

  const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(`\n[retag-null] klar på ${elapsedSec}s`);

  // Audit-log
  appendFileSync(
    resolve(RUNTIME_DIR, 'desc-coverage-t0201.jsonl'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'retag-null',
      dry_run: dryRun,
      limit,
      scanned: events.length,
      suggestions: allSuggestions.length,
      failed,
      confidence_buckets: buckets,
      per_category: perCat,
      updated: applyResult.updated,
      skipped: applyResult.skipped,
      elapsed_sec: elapsedSec,
    }) + '\n'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[retag-null] FATAL:', err);
    process.exit(1);
  });