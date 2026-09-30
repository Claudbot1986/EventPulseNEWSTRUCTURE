/**
 * _retag-batch-v3.ts — Steg 3.4 (v3): MiniMax-driven re-tagging av
 * community-events med de kanonska definitionerna från
 * 04-Normalizer/categoryDefinitions.ts.
 *
 * Skillnad mot v2:
 *  • Använder detaljerade Inkluderar/Exkludera-definitioner (v2 hade
 *    one-liners som inte täckte kantfall).
 *  • Ber om kort reasoning per event — ger audit-spår och gör det
 *    möjligt att förstå *varför* MiniMax valde en viss kategori.
 *  • Single-label (v2 tillät multi-label) — passar community-posten
 *    bättre eftersom events normalt tillhör EN primär kategori.
 *  • Kräver description >= 11 tecken (v2 körde allt).
 *  • Versioneras i loggen via categoryDefinitions.VERSION.
 *
 * Gör INGA DB-mutationer — output är endast förslag som människa
 * granskar innan apply-retag skriver tillbaka.
 *
 * Output:
 *   00-Vault/01-Projects/EventPulse/04-Sources/retag-suggestions-v3-YYYY-MM-DD.jsonl
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/_retag-batch-v3.ts [--dry-run]
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CATEGORY_DEFINITIONS,
  buildLlmCriteriaPrompt,
  listCategorySlugs,
  VERSION as DEFINITIONS_VERSION,
} from '../categoryDefinitions.js';
import { extractHeadliner, resolveArtist } from '../artistResolver.js';
import type { SupabaseClient } from '@supabase/supabase-js';

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  category_slug: string | null;
  source: string | null;
  start_time: string | null;
  ticket_url: string | null;
  venue_id: string | null;
}

interface Suggestion {
  id: string;
  category: string;
  confidence: number;
  reasoning: string;
  /** True if MusicBrainz + Last.fm produced a confident category for this event. */
  mb_resolved?: boolean;
  /** MusicBrainz ID, if resolved. */
  mbid?: string;
  /** Last.fm tags that triggered the category match. */
  matched_tags?: string[];
  /** If MB changed category from what MiniMax originally proposed. */
  category_changed_by_mb?: { from: string; to: string };
}

// ─── Konfiguration ─────────────────────────────────────────────────────────

const BATCH_SIZE = 14;          // events per MiniMax-anrop
const MAX_PARALLEL = 8;         // samtidiga MiniMax-anrop (under 100-gränsen för safety)
const MAX_TOKENS = 6144;        // räcker för 14 events × (category + conf + reasoning)
const LLM_TIMEOUT_MS = 45_000;  // MiniMax-M2.7 thinking + JSON output
const LLM_MODEL = 'MiniMax-M2.7';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const MIN_DESCRIPTION_CHARS = 11;

/** MusicBrainz rate-limits 1 req/s per IP — vi respekterar detta sekventiellt. */
const MB_REQUEST_DELAY_MS = 1_100;
/** Confidence under detta från MiniMax skickas vidare till MB-försök. */
const MB_ENHANCE_THRESHOLD = 0.80;

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// ─── Helpers ───────────────────────────────────────────────────────────────

function maxDescLen(e: EventRow): number {
  return Math.max((e.description_sv ?? '').length, (e.description_en ?? '').length);
}

async function fetchCommunityEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, category_slug, source, start_time, ticket_url, venue_id')
      .eq('category_slug', 'community')
      .order('start_time', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      rows.push(...(data as EventRow[]));
      offset += data.length;
      hasMore = data.length === PAGE;
    } else {
      hasMore = false;
    }
  }
  // Filtrera bort events med för kort beskrivning — de får stanna som community.
  return rows.filter((e) => maxDescLen(e) >= MIN_DESCRIPTION_CHARS);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
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

VIKTIGT — Inkludera/Exkludera:
* Läs HELA definitionen innan du väljer. "Exkludera"-listan är lika viktig som "Inkluderar".
* Stränginstrument-duo med akustisk gitarr och rytmiskt spel → oftast INTE classical även om "akustisk" finns i texten.
* Tribute-konsert till artist → inte musical om det inte finns sceniskt berättande med dans.
* Festival utan tydlig inriktning → community.

DEFINITIONER (definitions-version: ${DEFINITIONS_VERSION}):
${criteria}

TILLÅTNA SLUGS:
${JSON.stringify(allowedList)}`;
}

async function classifyBatch(events: EventRow[], dryRun: boolean): Promise<Suggestion[]> {
  if (dryRun) {
    // Returnera dummy-data så vi kan testa pipeline utan att bränna tokens.
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
    const allowed = new Set(listCategorySlugs());
    return (parsed as Array<Record<string, unknown>>)
      .filter((r) => r && typeof r.id === 'string' && typeof r.category === 'string')
      .map((r) => ({
        id: r.id as string,
        category: allowed.has(r.category as string) ? (r.category as string) : 'community',
        confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0,
        reasoning: typeof r.reasoning === 'string' ? (r.reasoning as string).slice(0, 200) : '',
      }));
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Enhance a low-confidence MiniMax suggestion with MusicBrainz + Last.fm.
 *
 * Called per-event (not batched) after the MiniMax sweep. MB rate-limits
 * 1 req/s, so we run sequentially with a small delay.
 *
 * Returns the original suggestion untouched when:
 *  - title has no extractable headliner (no separator found)
 *  - MB returns no match
 *  - MB match exists but tags are ambiguous / null
 *  - MB produces a low-confidence catch-all (conf < AUTO_WRITE_THRESHOLD)
 *
 * Otherwise overrides `category` + `confidence` + `reasoning` with the
 * MB-derived result and sets `mb_resolved: true`.
 */
async function enhanceWithMusicBrainz(
  event: EventRow,
  original: Suggestion,
  supabase: SupabaseClient,
): Promise<Suggestion> {
  const title = event.title_sv ?? event.title_en ?? '';
  const { headliner, extraction_hint } = extractHeadliner(title);
  if (!headliner || extraction_hint) {
    return { ...original, mb_resolved: false };
  }

  try {
    const resolved = await resolveArtist(headliner, supabase);
    if (!resolved || !resolved.category_slug || !resolved.high_confidence_category) {
      return { ...original, mb_resolved: !!resolved, mbid: resolved?.mbid ?? undefined };
    }
    const changed = original.category !== resolved.category_slug
      ? { from: original.category, to: resolved.category_slug }
      : undefined;
    return {
      ...original,
      category: resolved.category_slug,
      confidence: resolved.confidence,
      reasoning: resolved.reasoning,
      mb_resolved: true,
      mbid: resolved.mbid ?? undefined,
      matched_tags: resolved.matched_tags,
      category_changed_by_mb: changed,
    };
  } catch (err) {
    console.warn(`[retag-v3] MB enhance failed for ${event.id}: ${(err as Error).message.slice(0, 120)}`);
    return { ...original, mb_resolved: false };
  }
}

// Enkel Promise-pool — undvik att starta MAX_PARALLEL samtidigt vid startup.
async function runWithPool<T, R>(items: T[], poolSize: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(poolSize, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface RunSummary {
  date: string;
  definitions_version: string;
  total_community: number;
  after_filter: number;
  batches: number;
  successful: number;
  failed: number;
  confidence_buckets: Record<string, number>;
  per_category: Record<string, number>;
  /** Hur många events MB+Last.fm faktiskt ändrade kategori för. */
  mb_resolved_count: number;
  /** Hur många events vi skickade till MB-efterbearbetning. */
  mb_attempted_count: number;
  /** Hur många MB-träffar som var tvetydiga (ingen kategori). */
  mb_no_category_count: number;
}

function buildSummary(
  events: EventRow[],
  suggestions: Suggestion[],
  batches: number,
  failed: number,
  mbAttempted: number,
  mbResolved: number,
  mbNoCategory: number,
): RunSummary {
  const confBuckets: Record<string, number> = {
    '≥ 0.95': 0,
    '0.90 - 0.949': 0,
    '0.85 - 0.899': 0,
    '0.80 - 0.849': 0,
    '0.70 - 0.799': 0,
    '0.50 - 0.699': 0,
    '< 0.50': 0,
  };
  const perCat: Record<string, number> = {};
  for (const s of suggestions) {
    perCat[s.category] = (perCat[s.category] ?? 0) + 1;
    if (s.confidence >= 0.95) confBuckets['≥ 0.95']++;
    else if (s.confidence >= 0.90) confBuckets['0.90 - 0.949']++;
    else if (s.confidence >= 0.85) confBuckets['0.85 - 0.899']++;
    else if (s.confidence >= 0.80) confBuckets['0.80 - 0.849']++;
    else if (s.confidence >= 0.70) confBuckets['0.70 - 0.799']++;
    else if (s.confidence >= 0.50) confBuckets['0.50 - 0.699']++;
    else confBuckets['< 0.50']++;
  }
  return {
    date: new Date().toISOString().slice(0, 10),
    definitions_version: DEFINITIONS_VERSION,
    total_community: events.length,
    after_filter: events.length,
    batches,
    successful: suggestions.length,
    failed,
    confidence_buckets: confBuckets,
    per_category: perCat,
    mb_resolved_count: mbResolved,
    mb_attempted_count: mbAttempted,
    mb_no_category_count: mbNoCategory,
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[retag-v3] Modell: ${LLM_MODEL}  Definitions-version: ${DEFINITIONS_VERSION}  Dry-run: ${dryRun}`);

  console.log('[retag-v3] Hämtar community-events…');
  const allCommunity = await fetchCommunityEvents();
  // Vi har redan filtrerat i fetchCommunityEvents — men vi behöver totalen för summary.
  const totalCommunity = await (async () => {
    let total = 0;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('events')
        .select('id')
        .eq('category_slug', 'community')
        .range(offset, offset + PAGE - 1);
      if (data && data.length > 0) { total += data.length; offset += data.length; hasMore = data.length === PAGE; }
      else hasMore = false;
    }
    return total;
  })();

  console.log(`[retag-v3] Totalt community-events: ${totalCommunity}`);
  console.log(`[retag-v3] Efter filter (description >= ${MIN_DESCRIPTION_CHARS} t): ${allCommunity.length}`);

  if (allCommunity.length === 0) {
    console.log('[retag-v3] Inget att göra.');
    return;
  }

  const batches = chunk(allCommunity, BATCH_SIZE);
  console.log(`[retag-v3] ${batches.length} batcher × ${BATCH_SIZE} events  (max ${MAX_PARALLEL} parallella)`);

  let succeeded = 0;
  let failed = 0;
  const allSuggestions: Suggestion[] = [];

  await runWithPool(batches, MAX_PARALLEL, async (batch, i) => {
    try {
      const suggestions = await classifyBatch(batch, dryRun);
      allSuggestions.push(...suggestions);
      succeeded++;
      const avgConf = suggestions.reduce((a, s) => a + s.confidence, 0) / Math.max(1, suggestions.length);
      console.log(`[retag-v3] batch ${i + 1}/${batches.length} OK  ${suggestions.length} svar  medel-conf=${avgConf.toFixed(2)}`);
    } catch (err) {
      failed++;
      console.error(`[retag-v3] batch ${i + 1}/${batches.length} FAIL: ${(err as Error).message.slice(0, 200)}`);
    }
  });

  // ─── Steg 2: MB+Last.fm för låg-confidence events ─────────────────────
  // Bara events med conf < MB_ENHANCE_THRESHOLD körs genom MB. MB rate-limit
  // är 1 req/s, så vi kör sekventiellt med MB_REQUEST_DELAY_MS mellan varje.
  let mbAttempted = 0;
  let mbResolved = 0;
  let mbNoCategory = 0;

  if (!dryRun) {
    const eventById = new Map<string, EventRow>();
    for (const e of allCommunity) eventById.set(e.id, e);

    const lowConfIndices: number[] = [];
    allSuggestions.forEach((s, i) => {
      if (s.confidence < MB_ENHANCE_THRESHOLD) lowConfIndices.push(i);
    });

    console.log(`\n[retag-v3] MB-efterbearbetning: ${lowConfIndices.length} events med conf < ${MB_ENHANCE_THRESHOLD}`);
    if (lowConfIndices.length > 0) {
      for (let k = 0; k < lowConfIndices.length; k++) {
        const i = lowConfIndices[k];
        const s = allSuggestions[i];
        const ev = eventById.get(s.id);
        if (!ev) continue;
        mbAttempted++;
        const enhanced = await enhanceWithMusicBrainz(ev, s, supabase);
        allSuggestions[i] = enhanced;
        if (enhanced.mb_resolved && enhanced.category_changed_by_mb) {
          mbResolved++;
        } else if (enhanced.mb_resolved === false && enhanced.mbid) {
          // MB hittade artist men taggarna var tvetydiga / null
          mbNoCategory++;
        }
        if (k < lowConfIndices.length - 1) {
          await new Promise<void>((r) => setTimeout(r, MB_REQUEST_DELAY_MS));
        }
      }
      console.log(`[retag-v3] MB klart. Försökt: ${mbAttempted}  Ändrade kategori: ${mbResolved}  MB-träff utan kategori: ${mbNoCategory}`);
    }
  }

  // Skriv output
  await mkdir(VAULT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(VAULT_DIR, `retag-suggestions-v3-${today}.jsonl`);
  const lines = allSuggestions.map((s) => JSON.stringify(s));
  await writeFile(outPath, lines.join('\n') + '\n', 'utf8');

  const summary = buildSummary(allCommunity, allSuggestions, batches.length, failed, mbAttempted, mbResolved, mbNoCategory);
  summary.total_community = totalCommunity;
  summary.after_filter = allCommunity.length;
  const summaryPath = join(VAULT_DIR, `retag-summary-v3-${today}.json`);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log(`\n[retag-v3] ✓ Skrivit ${allSuggestions.length} förslag till ${outPath}`);
  console.log(`[retag-v3] ✓ Skrivit summary till ${summaryPath}`);
  console.log(`[retag-v3] Batcher: ${batches.length}  OK: ${succeeded}  FAIL: ${failed}`);

  // Stdout-sammanfattning
  console.log('\nConfidence-buckets:');
  for (const [bucket, n] of Object.entries(summary.confidence_buckets)) {
    console.log(`  ${bucket.padEnd(15)} ${n}`);
  }
  console.log('\nPer kategori:');
  for (const [cat, n] of Object.entries(summary.per_category).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }
  console.log('\nMusicBrainz+Last.fm:');
  console.log(`  ${'Försökt'.padEnd(20)} ${summary.mb_attempted_count}`);
  console.log(`  ${'Ändrade kategori'.padEnd(20)} ${summary.mb_resolved_count}`);
  console.log(`  ${'MB-träff, ingen kat.'.padEnd(20)} ${summary.mb_no_category_count}`);
}

main().catch((err) => {
  console.error('[retag-v3] FATAL:', (err as Error).message);
  process.exit(1);
});
