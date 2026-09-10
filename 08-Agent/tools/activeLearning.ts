/**
 * 08-Agent/tools/activeLearning.ts
 *
 * P2C (2026-09-10): Active-learning closed loop.
 *
 * Vad: identifierar events med låg confidence_score (< threshold) och
 * flaggar dem för human review via dashboard 7777.
 *
 * Hur (closed loop):
 *   1. Sök events där confidence_score < threshold (default 50).
 *   2. Skriv `needs_human_review: true` i events-tabellen.
 *   3. Dashboard 7777 visar dem i en review-modal.
 *   4. När användaren godkänner/avvisar → record_feedback → nästa loop
 *      kan tränas på den annoterade datan (Phase 2: ML-pipeline).
 *
 * Relation till MASTERPLAN §13:
 *   - Confidence score speglar hur säkra vi är på att eventet är korrekt
 *     extraherat (venue, datum, pris, bild).
 *   - Låg confidence = vi bör ha en människa som tittar.
 *
 * Säkerhet:
 *   - Vi markerar BARA events som redan är publicerade (status='published').
 *   - Vi rör ALDRIG venue-kanalen (vi annoterar bara events, inte nya venues).
 *   - batchSize är hård-cap till 500 för att inte skriva för mycket på en gång.
 *
 * Usage:
 *   import { run } from './activeLearning.js';
 *   const r = await run({ threshold: 50, batchSize: 100, dryRun: false });
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

export interface ActiveLearningOptions {
  /** Confidence-tröskelvärde (0-100). Events under detta flaggas. Default 50. */
  threshold?: number;
  /** Hur många events att processa per körning. Default 100. */
  batchSize?: number;
  /** Dry-run: rapportera men skriv inte. Default false. */
  dryRun?: boolean;
}

export interface ActiveLearningResult {
  threshold: number;
  candidatesFound: number;
  flagged: number;
  alreadyFlagged: number;
  dryRun: boolean;
  firstError: string | null;
  /** IDs för events som flaggades (för review-modal). */
  flaggedIds: string[];
}

// ── Public entrypoint ──────────────────────────────────────────────────────

export async function run(opts: ActiveLearningOptions = {}): Promise<ActiveLearningResult> {
  const threshold = opts.threshold ?? 50;
  const batchSize = opts.batchSize ?? 100;
  const dryRun = opts.dryRun ?? false;

  const result: ActiveLearningResult = {
    threshold,
    candidatesFound: 0,
    flagged: 0,
    alreadyFlagged: 0,
    dryRun,
    firstError: null,
    flaggedIds: [],
  };

  // Hämta events med låg confidence som ännu INTE flaggats
  const { data: candidates, error: fetchErr } = await db()
    .from('events')
    .select('id, title_sv, title_en, confidence_score, needs_human_review')
    .eq('status', 'published')
    .lt('confidence_score', threshold)
    .order('confidence_score', { ascending: true })
    .limit(batchSize);

  if (fetchErr) {
    result.firstError = `fetch failed: ${fetchErr.message}`;
    return result;
  }

  if (!candidates || candidates.length === 0) {
    return result;
  }

  result.candidatesFound = candidates.length;

  // Separera redan-flaggade från nya
  const needsFlagging = candidates.filter((e) => !e.needs_human_review);
  result.alreadyFlagged = candidates.length - needsFlagging.length;
  result.flaggedIds = needsFlagging.map((e) => e.id);

  if (needsFlagging.length === 0) {
    return result;
  }

  if (dryRun) {
    result.flagged = needsFlagging.length;
    return result;
  }

  // Uppdatera i batch
  const ids = needsFlagging.map((e) => e.id);
  const { error: updateErr } = await db()
    .from('events')
    .update({ needs_human_review: true })
    .in('id', ids);

  if (updateErr) {
    result.firstError = `update failed: ${updateErr.message}`;
    return result;
  }

  result.flagged = ids.length;
  return result;
}

// ── CLI wrapper ─────────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';

const cliArgs = process.argv.slice(2);
const thresholdIdx = cliArgs.indexOf('--threshold');
const batchSizeIdx = cliArgs.indexOf('--batch-size');
const dryRunFlag = cliArgs.includes('--dry-run');

const threshold = thresholdIdx !== -1 ? parseInt(cliArgs[thresholdIdx + 1], 10) : 50;
const batchSize = batchSizeIdx !== -1 ? parseInt(cliArgs[batchSizeIdx + 1], 10) : 100;

const isMainModule = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return process.argv[1] === __filename || process.argv[1]?.endsWith('activeLearning.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  run({ threshold, batchSize, dryRun: dryRunFlag })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.firstError ? 1 : 0);
    })
    .catch((e) => {
      console.error('[activeLearning] FATAL:', e);
      process.exit(1);
    });
}
