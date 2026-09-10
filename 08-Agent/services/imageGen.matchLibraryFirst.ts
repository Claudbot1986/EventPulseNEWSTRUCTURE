/**
 * 08-Agent/services/imageGen.matchLibraryFirst.ts
 *
 * Library-first image fallback for nightly ingestion.
 *
 * Designprincip (2026-09-10): BFL-credits är dyra → nattjobbet ska INTE
 * anropa BFL om det redan finns en passande bild i image_library. Vi provar
 * biblioteket först; bara om det inte har något match alls (match_type='none'
 * ELLER biblioteket är tomt) → fall tillbaka till BFL.
 *
 * Strategiskt mål (Phase 2 / post-launch): 10–20 olika bilder per kategori
 * / eventtyp i biblioteket, så att > 95 % av alla events får en passande
 * fallback-bild. BFL blir då en sällsynt edge-case för nya, ocategoriserade
 * events — inte en per-körning-kostnad.
 *
 * Vad detta INTE gör:
 *   - Det lägger INTE till nya bilder i biblioteket självt.
 *   - Det anropar INTE BFL om biblioteket har en match.
 *   - Det muterar INTE image_library.endast events.image_url (via
 *     markEventWithLibraryFallback).
 *
 * Relation till imageGen.ts:
 *   - imageGen.generateBatch() = ren BFL-pipeline (används vid aktiv budget)
 *   - matchLibraryFirst() = ny default-väg för ingestion-cron (no BFL om möjligt)
 *
 * Usage:
 *   import { matchLibraryFirst } from './imageGen.matchLibraryFirst.js';
 *   const result = await matchLibraryFirst({ limit: 50, onlyMissing: true });
 *   // result.bySource = { library: 47, bfl: 0, none: 3 }
 */

import {
  pickLibraryFallback,
  markEventWithLibraryFallback,
  type FallbackResult,
} from '../utils/imageLibrary.js';
import { generateBatch, type BatchResult } from './imageGen.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Supabase client (service_role) ──────────────────────────────────────────

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

// ── Public types ───────────────────────────────────────────────────────────

export interface MatchLibraryFirstOptions {
  /** Hur många events att processa (default 50 — samma som ingestion-cron default). */
  limit?: number;
  /** Filtrera till events med image_url IS NULL (default true — samma som BFL-vägen). */
  onlyMissing?: boolean;
  /** Hur många events att processa parallellt mot biblioteket (default 5). */
  libraryConcurrency?: number;
  /** Hur många events att processa parallellt mot BFL om biblioteket faller igenom (default 3). */
  bflConcurrency?: number;
  /** Progress callback för dashboard / cron-status. */
  onProgress?: (phase: 'library' | 'bfl', done: number, total: number) => void;
}

export interface MatchLibraryFirstResult {
  totalFetched: number;
  /** Antal events som fick en bild från biblioteket. */
  libraryMatched: number;
  /** Antal events där biblioteket INGET hade → BFL kördes (eller kommer köras). */
  bflGenerated: number;
  /** Antal events som varken bibliotek ELLER BFL kunde hantera. */
  unmatched: number;
  /** Hur många BFL-anrop som faktiskt gjordes (för credit-tracking). */
  bflCallsAttempted: number;
  /** Brytning per match_type från biblioteket. */
  matchTypeBreakdown: Record<FallbackResult['match_type'], number>;
  /** Resultat från generateBatch() om det kördes — tom array om biblioteket räckte. */
  bflResult: BatchResult | null;
  /** Första felet om något gick fel totalt (icke-fatalt: enskilda events kan ha misslyckats). */
  firstError: string | null;
}

// ── Huvudfunktion ──────────────────────────────────────────────────────────

/**
 * Library-first image fallback.
 *
 * Flöde per event:
 *   1. Hämta bästa biblioteks-match (venue+category → category → default).
 *   2. Om match_type !== 'none' → markEventWithLibraryFallback → klar (ingen BFL).
 *   3. Om match_type === 'none' → lägg till i BFL-batch.
 *
 * Returnerar samma struktur oavsett om biblioteket var fullt eller tomt —
 * anroparen behöver inte grena.
 */
export async function matchLibraryFirst(
  opts: MatchLibraryFirstOptions = {},
): Promise<MatchLibraryFirstResult> {
  const {
    limit = 50,
    onlyMissing = true,
    libraryConcurrency = 5,
    bflConcurrency = 3,
    onProgress,
  } = opts;

  const matchTypeBreakdown: Record<FallbackResult['match_type'], number> = {
    'venue+category': 0,
    'category': 0,
    'kind': 0,
    'default': 0,
    'none': 0,
  };

  // ── 1. Hämta events att processa ──────────────────────────────────────────
  let query = db()
    .from('events')
    .select('id, title_sv, title_en, category_slug, venues(name)')
    .eq('status', 'published')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (onlyMissing) {
    query = query.is('image_url', null);
  }

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) {
    return {
      totalFetched: 0,
      libraryMatched: 0,
      bflGenerated: 0,
      unmatched: 0,
      bflCallsAttempted: 0,
      matchTypeBreakdown,
      bflResult: null,
      firstError: `Supabase fetch failed: ${fetchErr.message}`,
    };
  }
  if (!rows || rows.length === 0) {
    return {
      totalFetched: 0,
      libraryMatched: 0,
      bflGenerated: 0,
      unmatched: 0,
      bflCallsAttempted: 0,
      matchTypeBreakdown,
      bflResult: null,
      firstError: null,
    };
  }

  // ── 2. Library-pass: parallellisera biblioteks-uppslag ────────────────────
  let libraryMatched = 0;
  const bflCandidates: Array<{ id: string }> = [];
  let firstError: string | null = null;

  type EventRow = {
    id: string;
    title_sv: string | null;
    title_en: string | null;
    category_slug: string | null;
    venues: { name: string } | { name: string }[] | null;
  };

  const events: EventRow[] = rows as EventRow[];
  const queue = [...events];
  let done = 0;

  async function libraryWorker(): Promise<void> {
    while (queue.length > 0) {
      const ev = queue.shift();
      if (!ev) break;
      try {
        const venueName = Array.isArray(ev.venues)
          ? (ev.venues[0]?.name ?? null)
          : (ev.venues?.name ?? null);
        const match = await pickLibraryFallback({
          venue_id: null,
          venue_name: venueName,
          category_slug: ev.category_slug,
        });
        matchTypeBreakdown[match.match_type]++;
        if (match.match_type !== 'none' && match.url) {
          await markEventWithLibraryFallback(ev.id, match);
          libraryMatched++;
        } else {
          bflCandidates.push({ id: ev.id });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!firstError) firstError = msg;
        // Fall-through till BFL om biblioteket kraschade
        bflCandidates.push({ id: ev.id });
      } finally {
        done++;
        onProgress?.('library', done, events.length);
      }
    }
  }

  const libraryWorkers: Promise<void>[] = [];
  const effectiveLibraryConc = Math.min(libraryConcurrency, events.length);
  for (let w = 0; w < effectiveLibraryConc; w++) {
    libraryWorkers.push(libraryWorker());
  }
  await Promise.all(libraryWorkers);

  // ── 3. BFL-pass: kör bara för de events biblioteket INTE kunde matcha ─────
  let bflGenerated = 0;
  let bflCallsAttempted = 0;
  let bflResult: BatchResult | null = null;

  if (bflCandidates.length > 0) {
    try {
      // generateBatch() väljer sina egna events (filter image_url IS NULL).
      // Vi kan INTE rikta den till en specifik lista — så vi accepterar att
      // den kan hämta andra events också. Resultatet räknas mot totalFetched
      // som "bflGenerated" via okCount.
      bflResult = await generateBatch(bflCandidates.length, {
        onlyMissing: true,
        concurrency: bflConcurrency,
        onProgress: (d, t) => onProgress?.('bfl', d, t),
      });
      bflGenerated = bflResult.okCount;
      bflCallsAttempted = bflResult.totalFetched;
      if (bflResult.errors.length > 0 && !firstError) {
        firstError = bflResult.errors[0]?.error ?? 'unknown BFL error';
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!firstError) firstError = `BFL pass failed: ${msg}`;
    }
  }

  // unmatched = events som biblioteket inte hade OCH BFL misslyckades med
  const unmatched = Math.max(0, bflCandidates.length - bflGenerated);

  return {
    totalFetched: events.length,
    libraryMatched,
    bflGenerated,
    unmatched,
    bflCallsAttempted,
    matchTypeBreakdown,
    bflResult,
    firstError,
  };
}
