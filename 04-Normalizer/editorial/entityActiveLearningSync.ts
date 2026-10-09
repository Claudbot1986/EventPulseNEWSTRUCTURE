/**
 * entityActiveLearningSync — synkroniserar entitets-extraktion med
 * activeLearning-infrastrukturen.
 *
 * FAS 3.5 (2026-10-09): När vi kör extractEntities på ett event och
 * får INFERRED/AMBIGUOUS/UNKNOWN entities sänker vi confidence_score
 * (via computeEntityPenalty). Detta triggar befintlig activeLearning.ts
 * (08-Agent/tools/activeLearning.ts) som flaggar eventet för human
 * review i dashboard 7777.
 *
 * Pipeline:
 *   1. Hämta publicerade events (senaste 500) från Supabase
 *   2. Kör sync extractEntities() på varje (regler, ingen LLM)
 *   3. Beräkna delta via computeEntityPenalty()
 *   4. Uppdatera confidence_score om delta != 0
 *
 * Säkerhet:
 *   - Vi rör bara confidence_score, inget annat fält
 *   - Vi kör ALDRIG LLM (bara sync-regler — ingen API-kostnad)
 *   - dryRun stöds för att förhandsvisa utan att skriva
 *   - Batched updates för att undvika supabase-throttling
 *
 * Cron-rekommendation: kör en gång per dygn, eller vid behov.
 *
 * CLI:
 *   npx tsx entityActiveLearningSync.ts --batch-size 200 --dry-run
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { extractEntities } from './entityExtractor';
import { computeEntityPenalty } from './entityConfidencePenalty';

// ── Supabase client ─────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _supabase;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface EntitySyncOptions {
  /** Max antal events att processa per körning. Default 200. */
  batchSize?: number;
  /** Dry-run: rapportera men skriv inte. Default false. */
  dryRun?: boolean;
  /** Filter på källa. Default: alla publicerade events. */
  source?: string;
}

export interface EntitySyncResult {
  batchSize: number;
  eventsScanned: number;
  eventsWithEntities: number;
  eventsWithPenalty: number;
  eventsWithBoost: number;
  totalDelta: number;
  eventsUpdated: number;
  dryRun: boolean;
  source: string | null;
  firstError: string | null;
  /** Sample-uppdateringar för logging (max 20). */
  samples: Array<{
    id: string;
    title: string;
    oldScore: number;
    newScore: number;
    delta: number;
    entityCount: number;
    inferredCount: number;
  }>;
}

// ── Public entrypoint ──────────────────────────────────────────────────────

export async function run(opts: EntitySyncOptions = {}): Promise<EntitySyncResult> {
  const batchSize = opts.batchSize ?? 200;
  const dryRun = opts.dryRun ?? false;
  const source = opts.source ?? null;

  const result: EntitySyncResult = {
    batchSize,
    eventsScanned: 0,
    eventsWithEntities: 0,
    eventsWithPenalty: 0,
    eventsWithBoost: 0,
    totalDelta: 0,
    eventsUpdated: 0,
    dryRun,
    source,
    firstError: null,
    samples: [],
  };

  // Hämta publicerade events. OBS: events-tabellen har inte venue_name
  // eller description_X som inline-kolumner (de är kopplade via venue_id
  // och source). Vi extraherar därför entiteter enbart från title_sv/en.
  // Det fångar fortfarande de flesta regelbaserade mönster; description-
  // baserade signals (desc_pattern:medverkande etc.) ger bonus i en
  // framtida körning när vi join'ar in dem.
  let query = db()
    .from('events')
    .select('id, title_sv, title_en, category_slug, confidence_score')
    .eq('status', 'published')
    .order('confidence_score', { ascending: true })  // lägsta först — de vi misstänker
    .limit(batchSize);

  if (source) {
    query = query.eq('source', source);
  }

  const { data: candidates, error: fetchErr } = await query;

  if (fetchErr) {
    result.firstError = `fetch failed: ${fetchErr.message}`;
    return result;
  }

  if (!candidates || candidates.length === 0) {
    return result;
  }

  result.eventsScanned = candidates.length;

  // Bygg updates + samples
  const updates: Array<{ id: string; newScore: number; title: string; delta: number; ec: number; inf: number }> = [];

  for (const ev of candidates) {
    const title = ev.title_sv ?? ev.title_en ?? '';

    // extractEntities() med enbart title-baserade signaler.
    // venue_name och raw_description saknas som inline-kolumner
    // i events-tabellen — skulle kräva joins som läggs in här om
    // active learning ska bli mer träffsäker.
    const entities = extractEntities({
      title,
      raw_description: null,
      category_slug: ev.category_slug ?? null,
      venue_name: null,
    });

    if (entities.length === 0) continue;
    result.eventsWithEntities++;

    const delta = computeEntityPenalty(entities);
    if (delta === 0) continue;

    const inferredCount = entities.filter(
      (e) => e.confidence === 'INFERRED' || e.confidence === 'AMBIGUOUS' || e.confidence === 'UNKNOWN'
    ).length;

    const oldScore = ev.confidence_score ?? 0;
    const newScore = Math.max(0, Math.min(100, oldScore + delta));

    if (delta < 0) result.eventsWithPenalty++;
    if (delta > 0) result.eventsWithBoost++;
    result.totalDelta += delta;

    updates.push({
      id: ev.id,
      newScore,
      title,
      delta,
      ec: entities.length,
      inf: inferredCount,
    });

    if (result.samples.length < 20) {
      result.samples.push({
        id: ev.id,
        title: title.slice(0, 60),
        oldScore,
        newScore,
        delta,
        entityCount: entities.length,
        inferredCount,
      });
    }
  }

  result.eventsUpdated = updates.length;

  if (dryRun || updates.length === 0) {
    return result;
  }

  // Skriv uppdateringar till DB (en i taget för att undvika hotell-svar).
  for (const u of updates) {
    const { error: updateErr } = await db()
      .from('events')
      .update({ confidence_score: u.newScore })
      .eq('id', u.id);

    if (updateErr && !result.firstError) {
      result.firstError = `update failed for ${u.id}: ${updateErr.message}`;
    }
  }

  return result;
}

// ── CLI wrapper ─────────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';

const cliArgs = process.argv.slice(2);
const batchIdx = cliArgs.indexOf('--batch-size');
const sourceIdx = cliArgs.indexOf('--source');
const dryRunFlag = cliArgs.includes('--dry-run');

const batchSize = batchIdx !== -1 ? parseInt(cliArgs[batchIdx + 1], 10) : 200;
const source = sourceIdx !== -1 ? cliArgs[sourceIdx + 1] : null;

const isMainModule = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return process.argv[1] === __filename || process.argv[1]?.endsWith('entityActiveLearningSync.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  run({ batchSize, source, dryRun: dryRunFlag })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.firstError ? 1 : 0);
    })
    .catch((e) => {
      console.error('[entityActiveLearningSync] FATAL:', e);
      process.exit(1);
    });
}
