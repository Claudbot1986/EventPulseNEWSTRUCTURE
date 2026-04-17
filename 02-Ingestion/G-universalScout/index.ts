/**
 * Universal Scout Engine — Main Entry
 * 
 * Three-phase architecture:
 *   Scout  → discovers candidates
 *   Ranker → selects best candidates  
 *   MultiExtractor → extracts from all, picks best result
 * 
 * Design principles:
 * - Scout collects MANY candidates, doesn't give up early
 * - Ranker applies multi-dimensional scoring, not just density
 * - MultiExtractor runs ALL top candidates and picks the winner
 * - No "winner takes all" gate — we try multiple and compare
 * - AppRegistry/JSON-LD/HTML heuristics all get a fair shot
 * 
 * Usage:
 *   import { runUniversalScout } from './G-universalScout';
 *   const result = await runUniversalScout(sourceId, sourceUrl);
 */

import { scout } from './scout.js';
import { rank } from './ranker.js';
import { multiExtract } from './multiExtractor.js';
import type { ScoutResult, ScoutCandidate } from './scout.js';
import type { RankerResult, RankedCandidate } from './ranker.js';
import type { MultiExtractorResult, ExtractionAttempt } from './multiExtractor.js';

export { scout, rank, multiExtract };
export type { ScoutResult, ScoutCandidate, RankerResult, RankedCandidate, MultiExtractorResult, ExtractionAttempt };

export interface UniversalScoutResult {
  sourceId: string;
  url: string;
  // Stage results
  scout: ScoutResult | null;
  ranker: RankerResult | null;
  extractor: MultiExtractorResult | null;
  // Final outcome
  eventsFound: number;
  winnerMethod: string;
  winnerUrl: string | null;
  didConverge: boolean;
  // Timing
  totalDurationMs: number;
  scoutDurationMs: number;
  rankerDurationMs: number;
  extractorDurationMs: number;
  // Failure info
  failReason: string | null;
  failStage: 'scout' | 'ranker' | 'extractor' | null;
}

export async function runUniversalScout(
  sourceId: string,
  url: string,
  abortSignal?: AbortSignal,
): Promise<UniversalScoutResult> {
  const totalStart = Date.now();
  let scoutResult: ScoutResult | null = null;
  let rankerResult: RankerResult | null = null;
  let extractorResult: MultiExtractorResult | null = null;
  
  // ── Stage 1: Scout ───────────────────────────────────────────────────────
  const scoutStart = Date.now();
  try {
    scoutResult = await scout(sourceId, url, abortSignal);
  } catch (e) {
    return {
      sourceId,
      url,
      scout: null,
      ranker: null,
      extractor: null,
      eventsFound: 0,
      winnerMethod: '',
      winnerUrl: null,
      didConverge: false,
      totalDurationMs: Date.now() - totalStart,
      scoutDurationMs: Date.now() - scoutStart,
      rankerDurationMs: 0,
      extractorDurationMs: 0,
      failReason: `scout error: ${(e as Error).message}`,
      failStage: 'scout',
    };
  }
  
  // ── Stage 2: Ranker ────────────────────────────────────────────────────
  const rankerStart = Date.now();
  try {
    rankerResult = rank(sourceId, scoutResult);
  } catch (e) {
    return {
      sourceId,
      url,
      scout: scoutResult,
      ranker: null,
      extractor: null,
      eventsFound: 0,
      winnerMethod: '',
      winnerUrl: scoutResult.candidates[0]?.url ?? null,
      didConverge: false,
      totalDurationMs: Date.now() - totalStart,
      scoutDurationMs: Date.now() - scoutStart,
      rankerDurationMs: Date.now() - rankerStart,
      extractorDurationMs: 0,
      failReason: `ranker error: ${(e as Error).message}`,
      failStage: 'ranker',
    };
  }
  
  // ── Stage 3: MultiExtractor ─────────────────────────────────────────────
  const extractorStart = Date.now();
  try {
    extractorResult = await multiExtract(sourceId, rankerResult.recommendedForExtraction, abortSignal);
  } catch (e) {
    return {
      sourceId,
      url,
      scout: scoutResult,
      ranker: rankerResult,
      extractor: null,
      eventsFound: 0,
      winnerMethod: '',
      winnerUrl: rankerResult.topCandidates[0]?.url ?? null,
      didConverge: false,
      totalDurationMs: Date.now() - totalStart,
      scoutDurationMs: Date.now() - scoutStart,
      rankerDurationMs: Date.now() - rankerStart,
      extractorDurationMs: Date.now() - extractorStart,
      failReason: `extractor error: ${(e as Error).message}`,
      failStage: 'extractor',
    };
  }
  
  return {
    sourceId,
    url,
    scout: scoutResult,
    ranker: rankerResult,
    extractor: extractorResult,
    eventsFound: extractorResult.totalEvents,
    winnerMethod: extractorResult.winnerMethod,
    winnerUrl: extractorResult.bestCandidate?.url ?? null,
    didConverge: extractorResult.didConverge,
    totalDurationMs: Date.now() - totalStart,
    scoutDurationMs: Date.now() - scoutStart,
    rankerDurationMs: Date.now() - rankerStart,
    extractorDurationMs: Date.now() - extractorStart,
    failReason: null,
    failStage: null,
  };
}
