/**
 * Ranker: Välj de bästa kandidaterna för extraction.
 * 
 * Steg 2 av 3 i nya Universal Engine:
 *   Scout → Ranker → MultiExtractor
 * 
 * Strategi:
 * 1. Ta alla Scout-kandidater
 * 2. Applicera multi-dimensionell ranking
 * 3. Välj topp 3-5 kandidater för MultiExtractor
 * 4. Returnera ranking med reasoning
 */

import type { ScoutCandidate } from './scout.js';

export interface RankedCandidate extends ScoutCandidate {
  rank: number;
  rankReason: string;
  isRecommended: boolean;  // top 3
}

export interface RankerResult {
  sourceId: string;
  allRanked: RankedCandidate[];
  topCandidates: RankedCandidate[];  // top 3
  runnerUpCandidates: RankedCandidate[];  // 4-5
  recommendedForExtraction: RankedCandidate[];  // top 3
  recommendation: string;  // human-readable summary
  totalCandidatesScored: number;
}

// ─── Ranking dimensions ─────────────────────────────────────────────────────────

interface RankingScore {
  total: number;
  breakdown: {
    densityScore: number;      // raw density
    contentFreshness: number;  // dates in future vs past
    sourceQuality: number;     // nav/menu links vs random
    structureSignal: number;   // JSON-LD, AppRegistry, time tags
    breadthBonus: number;     // multiple date mentions = likely list page
  };
}

function scoreCandidate(c: ScoutCandidate): RankingScore {
  const m = c.metrics;
  const density = c.densityScore;
  
  // Content freshness: lots of future dates = likely active calendar
  const futureBonus = Math.min(m.isoDateCount, 10) * 2;
  
  // Source quality: links from nav/menu are better signals than random content links
  const sourceBoost = c.sourceRegion === 'nav' ? 15
    : c.sourceRegion === 'menu' ? 12
    : c.sourceRegion === 'submenu' ? 8
    : c.sourceRegion === 'content' ? 5
    : c.sourceRegion === 'swedish-pattern' ? 6  // good: we explicitly tested it
    : 0;
  
  // Structure signals
  let structure = 0;
  if (m.hasJsonLd) structure += 20;
  if (m.hasAppRegistry) structure += 25;  // AppRegistry = massive signal for Swedish sites
  if (m.timeTagCount > 0) structure += Math.min(m.timeTagCount * 3, 15);
  if (m.jsBlockCount > 2) structure += 8;  // many large JS blocks = rich data page
  
  // Breadth bonus: multiple dates suggest it's a LIST page, not a detail page
  const breadthBonus = (m.isoDateCount + m.sweDateCount) >= 5 ? 10 : 0;
  
  const total = density + futureBonus + sourceBoost + structure + breadthBonus;
  
  return {
    total,
    breakdown: {
      densityScore: density,
      contentFreshness: futureBonus,
      sourceQuality: sourceBoost,
      structureSignal: structure,
      breadthBonus,
    },
  };
}

function buildReason(c: ScoutCandidate, s: RankingScore): string {
  const parts: string[] = [];
  
  if (c.metrics.hasAppRegistry) parts.push('AppRegistry detected');
  else if (c.metrics.hasJsonLd) parts.push('JSON-LD found');
  
  if (c.metrics.timeTagCount > 0) parts.push(`${c.metrics.timeTagCount}x <time>`);
  if (c.metrics.isoDateCount > 0) parts.push(`${c.metrics.isoDateCount} ISO dates`);
  if (c.metrics.sweDateCount > 0) parts.push(`${c.metrics.sweDateCount} Swedish dates`);
  
  if (c.sourceRegion === 'nav') parts.push('from nav');
  else if (c.sourceRegion === 'swedish-pattern') parts.push(`via ${c.href}`);
  
  parts.push(`density=${s.total.toFixed(0)}`);
  
  return parts.join(' | ');
}

// ─── Main Ranker ───────────────────────────────────────────────────────────────

export function rank(sourceId: string, scoutResult: { candidates: ScoutCandidate[]; rootMetrics: ScoutCandidate['metrics'] }): RankerResult {
  const { candidates, rootMetrics } = scoutResult;
  
  // Score all candidates
  const scored = candidates.map(c => ({
    ...c,
    score: scoreCandidate(c),
  }));
  
  // Sort by total score
  scored.sort((a, b) => b.score.total - a.score.total);
  
  // Build ranked list
  const allRanked: RankedCandidate[] = scored.map((c, idx) => ({
    ...c,
    rank: idx + 1,
    rankReason: buildReason(c, c.score),
    isRecommended: idx < 3,
  }));
  
  // Separate tiers
  const topCandidates = allRanked.slice(0, 3);
  const runnerUpCandidates = allRanked.slice(3, 5);
  
  // Build recommendation text
  let recommendation: string;
  if (topCandidates.length === 0) {
    recommendation = 'No candidates with sufficient signal. Recommend manual review.';
  } else if (topCandidates[0].metrics.hasAppRegistry) {
    recommendation = `Primary: ${topCandidates[0].href} — AppRegistry/React pattern detected. MultiExtractor will find events via B4d.`;
  } else if (topCandidates[0].metrics.hasJsonLd) {
    recommendation = `Primary: ${topCandidates[0].href} — JSON-LD detected. MultiExtractor will use A1 method.`;
  } else if (topCandidates[0].metrics.timeTagCount > 0) {
    recommendation = `Primary: ${topCandidates[0].href} — ${topCandidates[0].metrics.timeTagCount}x <time> tags. MultiExtractor HTML heuristics.`;
  } else {
    recommendation = `Primary: ${topCandidates[0].href} — density=${topCandidates[0].densityScore.toFixed(0)}, dates=${topCandidates[0].metrics.isoDateCount + topCandidates[0].metrics.sweDateCount}`;
  }
  
  return {
    sourceId,
    allRanked,
    topCandidates,
    runnerUpCandidates,
    recommendedForExtraction: topCandidates,
    recommendation,
    totalCandidatesScored: candidates.length,
  };
}

function computeRootDensity(m: ScoutCandidate['metrics']): number {
  return (
    m.isoDateCount * 2 +
    m.sweDateCount * 2 +
    m.timeTagCount * 4 +
    m.eventBlockCount +
    (m.hasJsonLd ? 20 : 0) +
    (m.hasAppRegistry ? 25 : 0)
  );
}
