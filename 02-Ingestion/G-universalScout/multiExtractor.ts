/**
 * MultiExtractor: Extrahera events från flera kandidater, välj bästa resultatet.
 * 
 * Steg 3 av 3 i nya Universal Engine:
 *   Scout → Ranker → MultiExtractor
 * 
 * Strategi:
 * 1. Kör extractFromHtml på ALLA rankerade kandidater parallellt
 * 2. Jämför resultaten: högst antal events vinner
 * 3. Om tie: välj högst density-ranked candidate
 * 4. Returnera bästa resultatet + alla resultat för transparens
 * 
 * "First success wins" är för aggressivt — vi provade alla.
 */

import { fetchHtml } from '../tools/fetchTools.js';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor.js';
import type { ExtractResult } from '../F-eventExtraction/universal-extractor.js';
import type { RankedCandidate } from './ranker.js';
import type { ParsedEvent } from '../F-eventExtraction/schema.js';

export interface ExtractionAttempt {
  candidate: RankedCandidate;
  result: ExtractResult;
  eventCount: number;
  durationMs: number;
}

export interface MultiExtractorResult {
  sourceId: string;
  attempts: ExtractionAttempt[];
  bestCandidate: RankedCandidate | null;
  bestResult: ExtractResult | null;
  totalEvents: number;
  totalAttempts: number;
  winnerMethod: string;   // e.g. "B4d", "A1+C"
  winnerMethodBreakdown: Record<string, number>;
  allEvents: ParsedEvent[];  // events from winner
  didConverge: boolean;  // did we find events?
  abortReason: string | null;
}

// ─── Main MultiExtractor ───────────────────────────────────────────────────────

export async function multiExtract(
  sourceId: string,
  candidates: RankedCandidate[],
  abortSignal?: AbortSignal,
): Promise<MultiExtractorResult> {
  const attempts: ExtractionAttempt[] = [];
  
  // Limit to top 5 candidates to avoid excessive fetches
  const toTry = candidates.slice(0, 5);
  
  if (toTry.length === 0) {
    return {
      sourceId,
      attempts: [],
      bestCandidate: null,
      bestResult: null,
      totalEvents: 0,
      totalAttempts: 0,
      winnerMethod: '',
      winnerMethodBreakdown: {},
      allEvents: [],
      didConverge: false,
      abortReason: 'no candidates provided',
    };
  }
  
  // ── Step 1: Fetch and extract from all candidates in parallel ─────────────────
  
  const fetchPromises = toTry.map(async (candidate): Promise<ExtractionAttempt> => {
    const t0 = Date.now();
    
    try {
      // Fetch the candidate page
      const fetchResult = await fetchHtml(candidate.url, { timeout: 20000, signal: abortSignal });
      const durationMs = Date.now() - t0;
      
      if (!fetchResult.success || !fetchResult.html) {
        const emptyResult: ExtractResult = {
          events: [], rawCount: 0, parseErrors: [`fetch failed: ${fetchResult.error || 'unknown'}`],
          sourceUrl: candidate.url, methodsUsed: [], methodBreakdown: {},
        };
        return { candidate, result: emptyResult, eventCount: 0, durationMs };
      }
      
      // Extract using ALL methods (universal-extractor tries everything)
      const extractResult = extractFromHtml(fetchResult.html, sourceId, candidate.url);
      
      return {
        candidate,
        result: extractResult,
        eventCount: extractResult.events.length,
        durationMs,
      };
    } catch (e) {
      const durationMs = Date.now() - t0;
      const emptyResult: ExtractResult = {
        events: [], rawCount: 0, parseErrors: [(e as Error).message],
        sourceUrl: candidate.url, methodsUsed: [], methodBreakdown: {},
      };
      return { candidate, result: emptyResult, eventCount: 0, durationMs };
    }
  });
  
  const settled = await Promise.allSettled(fetchPromises);
  
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      attempts.push(s.value);
    } else {
      // This should not happen since we handle errors inside, but safety first
      attempts.push({
        candidate: toTry[attempts.length],
        result: { events: [], rawCount: 0, parseErrors: [(s as any).reason?.message || 'unknown'], sourceUrl: '', methodsUsed: [], methodBreakdown: {} },
        eventCount: 0,
        durationMs: 0,
      });
    }
  }
  
  // ── Step 2: Find best result ───────────────────────────────────────────
  // Sort by: most events first, then by candidate rank (tie-breaker)
  attempts.sort((a, b) => {
    if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
    return a.candidate.rank - b.candidate.rank;
  });
  
  const best = attempts[0];
  
  // ── Step 3: Build winner method summary ───────────────────────────────────
  let winnerMethod = '';
  let winnerMethodBreakdown: Record<string, number> = {};
  
  if (best && best.eventCount > 0) {
    winnerMethod = best.result.methodsUsed.join('+');
    winnerMethodBreakdown = { ...best.result.methodBreakdown };
  }
  
  // ── Step 4: Deduplicate events across candidates ────────────────────────────
  // If multiple candidates found events, deduplicate by title+date
  const allEventsMap = new Map<string, ParsedEvent>();
  for (const attempt of attempts) {
    for (const evt of attempt.result.events) {
      const key = `${evt.title}|${evt.date}|${evt.time || ''}`;
      if (!allEventsMap.has(key)) {
        allEventsMap.set(key, evt);
      }
    }
  }
  const allEvents = Array.from(allEventsMap.values());
  
  return {
    sourceId,
    attempts,
    bestCandidate: best?.candidate ?? null,
    bestResult: best?.result ?? null,
    totalEvents: allEvents.length,
    totalAttempts: attempts.length,
    winnerMethod,
    winnerMethodBreakdown,
    allEvents,
    didConverge: allEvents.length > 0,
    abortReason: null,
  };
}
