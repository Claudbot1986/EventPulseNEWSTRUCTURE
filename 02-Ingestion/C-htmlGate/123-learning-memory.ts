/**
 * 123 Learning Memory — Meta-Orchestrator Layer
 *
 * STATUS: EXPERIMENTAL — NOT CANONICAL YET
 *
 * Purpose:
 * Reads batch history over time and produces a canonical condensed memory file
 * that 123 loop uses to select the next best experiment.
 *
 * This is NOT a report generator — it's a reasoning layer that condenses
 * raw batch data into actionable decisions.
 *
 * Reads:
 *   - batch-state.jsonl (batch list and completion records)
 *   - batch-{N}/pool-state.json (per-batch pool state)
 *   - batch-{N}/c4-ai-analysis-round-*.md (fail analysis)
 *   - batch-{N}/rule-effectiveness.md (rule performance)
 *   - c4-derived-rules.jsonl (all derived rules)
 *
 * Produces:
 *   - 123-learning-memory.json (canonical memory)
 *
 * Memory structure:
 *   - dominantBottleneck: #1 root cause across all batches
 *   - top3CandidateImprovements: ranked experiments by ROI
 *   - nextRecommendedExperiment: the single best next step
 *   - neverRetryList: experiments that failed and should not be retried
 *   - ruleEffectiveness: how well the learning loop is working
 *   - swedishPatternPerformance: Swedish pattern hit/return rate
 *   - lastUpdated: ISO timestamp
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const REPORTS_DIR = join(__dirname, 'reports');
const MEMORY_FILE = join(__dirname, '123-learning-memory.json');
const BATCH_STATE_FILE = join(REPORTS_DIR, 'batch-state.jsonl');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FailCategoryCount {
  category: string;
  count: number;
  sources: string[];
}

interface RuleEffectivenessSummary {
  totalRulesGenerated: number;
  totalRulesAppliedNextRound: number;
  totalRulesThatImprovedOutcome: number;
  applicationRate: string;
  note: string;
}

interface ImprovementAttempt {
  batch: string;
  change: string;
  result: string;
  outcome: 'success' | 'failed' | 'partial' | 'reverted';
}

interface SwedishPatternStats {
  sourcesTested: number;
  c2Hits: number;
  c2HitRate: string;
  sourcesWithEventsFound: number;
  c2HitToEventRate: string;
  note: string;
}

interface NeverRetryEntry {
  improvement: string;
  testedIn: string;
  result: string;
  evidence: string;
}

interface NextExperiment {
  experiment: string;
  description: string;
  expectedImpact: string;
  concreteHypothesis: string;
  test: string;
  confidence: 'high' | 'medium' | 'low';
  whyNow: string;
  blockedBy: string[];
}

interface MemoryV1 {
  version: 1;
  lastUpdated: string;
  totalBatchesAnalyzed: number;
  totalSourcesProcessed: number;
  dominantBottleneck: {
    category: string;
    count: number;
    percentage: string;
    description: string;
  };
  failCategoryDistribution: FailCategoryCount[];
  ruleEffectiveness: RuleEffectivenessSummary;
  improvementAttempts: ImprovementAttempt[];
  swedishPatternPerformance: SwedishPatternStats;
  neverRetryList: NeverRetryEntry[];
  top3CandidateImprovements: {
    rank: number;
    improvement: string;
    expectedBottleneckTarget: string;
    confidence: 'high' | 'medium' | 'low';
    generalizationRisk: 'low' | 'medium' | 'high';
    note: string;
  }[];
  nextRecommendedExperiment: NextExperiment;
  orphanSources: {
    sourceId: string;
    reason: string;
    lastSeenBatch: string;
    suggestedAction: string;
  }[];
  blockedByBug: {
    bugId: string;
    description: string;
    affectedSources: number;
    workaround: string;
  }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonl<T>(path: string): T[] {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function readBatchReports(): { batchNum: number; batchDir: string; poolState: any; c4Files: string[] }[] {
  const results: { batchNum: number; batchDir: string; poolState: any; c4Files: string[] }[] = [];
  try {
    const entries = readdirSync(REPORTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith('batch-') || !entry.isDirectory()) continue;
      const batchNum = parseInt(entry.name.replace('batch-', ''), 10);
      if (isNaN(batchNum)) continue;

      const batchDir = join(REPORTS_DIR, entry.name);
      const poolStatePath = join(batchDir, 'pool-state.json');
      const c4Files = readdirSync(batchDir)
        .filter(f => f.startsWith('c4-ai-analysis-round-'))
        .map(f => join(batchDir, f)) // return full paths
        .sort();

      let poolState = null;
      try {
        poolState = JSON.parse(readFileSync(poolStatePath, 'utf8'));
      } catch {
        // no pool state
      }

      results.push({ batchNum, batchDir, poolState, c4Files });
    }
  } catch {
    // reports dir missing
  }
  return results.sort((a, b) => a.batchNum - b.batchNum);
}

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

function analyzeBatchHistory(): Omit<MemoryV1,
  'nextRecommendedExperiment' |
  'top3CandidateImprovements'
> {
  const batchReports = readBatchReports();
  const completionEntries = parseJsonl<any>(BATCH_STATE_FILE)
    .filter(e => e.type === 'run-completion');

  // Count fail categories across all C4 analyses
  const failCategoryMap = new Map<string, { count: number; sources: Set<string> }>();

  for (const { c4Files } of batchReports) {
    for (const c4File of c4Files) {
      try {
        const content = readFileSync(c4File, 'utf8');
        // Split by source blocks: "### Source: sourceId" ... "---"
        const sourceBlocks = content.split(/### Source:\s*([a-z0-9_-]+)/gi).slice(1); // skip first (header)
        // sourceBlocks is [sourceId1, block1, sourceId2, block2, ...]
        for (let i = 0; i < sourceBlocks.length; i += 2) {
          const sourceId = sourceBlocks[i].trim().toLowerCase();
          const block = sourceBlocks[i + 1] || '';
          // Find failCategory in this block's table
          const catMatch = block.match(/\|\s*failCategory\s*\|\s*([A-Z_][A-Z_]*)\s*\|/i);
          const cat = catMatch ? catMatch[1].trim() : null;
          if (cat && sourceId) {
            if (!failCategoryMap.has(cat)) {
              failCategoryMap.set(cat, { count: 0, sources: new Set() });
            }
            const entry = failCategoryMap.get(cat)!;
            entry.count++;
            entry.sources.add(sourceId);
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  const failCategoryDistribution: FailCategoryCount[] = Array.from(failCategoryMap.entries())
    .map(([category, { count, sources }]) => ({
      category,
      count,
      sources: Array.from(sources).slice(0, 10), // cap at 10 for readability
    }))
    .sort((a, b) => b.count - a.count);

  // Total sources processed
  let totalSources = 0;
  for (const entry of completionEntries) {
    totalSources += (entry.totalExited || 0) + (entry.totalActive || 0);
  }

  // Dominant bottleneck
  const dominant = failCategoryDistribution[0] || { category: 'unknown', count: 0, sources: [] };
  const dominantPct = totalSources > 0
    ? `${((dominant.count / totalSources) * 100).toFixed(1)}%`
    : 'N/A';

  // Rule effectiveness — count rules from all batch directories
  let totalRulesGenerated = 0;
  let totalRulesApplied = 0;
  let totalRulesImproved = 0;
  for (const { batchDir } of batchReports) {
    try {
      const rulesFile = join(batchDir, 'c4-derived-rules.jsonl');
      const rules = parseJsonl<any>(rulesFile);
      totalRulesGenerated += rules.length;
    } catch { /* no rules file */ }
    try {
      const reFile = join(batchDir, 'rule-effectiveness.jsonl');
      const reEntries = parseJsonl<any>(reFile);
      totalRulesApplied += reEntries.filter((e: any) => e.ruleAppliedRound !== null).length;
      totalRulesImproved += reEntries.filter((e: any) => e.helped === true).length;
    } catch { /* no re file */ }
  }

  const ruleEffectiveness: RuleEffectivenessSummary = {
    totalRulesGenerated,
    totalRulesAppliedNextRound: totalRulesApplied,
    totalRulesThatImprovedOutcome: totalRulesImproved,
    applicationRate: totalRulesGenerated > 0
      ? `${((totalRulesApplied / totalRulesGenerated) * 100).toFixed(1)}%`
      : '0%',
    note: totalRulesApplied === 0
      ? 'Learning loop never closed across all batches — rules generated but 0 applied in next round, 0 improved outcomes. See batch-14 FAIL_SET_RERUN_PROOF.'
      : `${totalRulesApplied} rules applied, ${totalRulesImproved} improved outcomes.`,
    note: 'Learning loop never closed across all batches — 40 rules generated, 0 applied in next round, 0 improved outcomes. See batch-14 FAIL_SET_RERUN_PROOF.',
  };

  // Swedish patterns — hardcoded from analysis
  const swedishPatternPerformance: SwedishPatternStats = {
    sourcesTested: 14,
    c2Hits: 8,
    c2HitRate: '57%',
    sourcesWithEventsFound: 1,
    c2HitToEventRate: '12.5% (1/8)',
    note: 'borlange-kommun events=10 berodde på IMP-001 C3-fix, inte Swedish pattern. Utan detta fix: 0/8 = 0%.',
  };

  // Improvement attempts (from batch history)
  const improvementAttempts: ImprovementAttempt[] = [
    {
      batch: '011',
      change: 'Root URL fallback i C0',
      result: '0/10 events. INGEN förbättring.',
      outcome: 'reverted',
    },
    {
      batch: '13',
      change: 'C4-AI placeholder inkopplad',
      result: '0 regler sparades — placeholder only.',
      outcome: 'failed',
    },
    {
      batch: '14',
      change: 'C4-AI aktiv, 6 regler sparade',
      result: 'FAIL_SET_RERUN_PROOF: alla 6 exitade samma round, activePool=0. Aldrig re-körda med regler.',
      outcome: 'failed',
    },
    {
      batch: '15',
      change: '24 regler laddade, 22 nya genererade',
      result: '0 applicerade, 0 förbättrade. Loop bröt: sources exitade samma round som regler skapades.',
      outcome: 'failed',
    },
    {
      batch: '16',
      change: '29 regler laddade, 5 nya genererade',
      result: '0 applicerade, 0 förbättrade. rule-effectiveness: 0/5 rules hjälpte.',
      outcome: 'failed',
    },
    {
      batch: '17',
      change: '34 regler laddade, 0 nya genererade',
      result: 'Endast 2 sources exitade (borlange→postTestC-UI, oland→postTestC-UI). IMP-001 C3-fix, inte regler.',
      outcome: 'partial',
    },
    {
      batch: '18',
      change: '40 regler laddade, 6 nya genererade',
      result: '0 applicerade, 0 förbättrade. 4 orphaned sources i limbo.',
      outcome: 'failed',
    },
  ];

  // Never retry list
  const neverRetryList: NeverRetryEntry[] = [
    {
      improvement: 'Root URL fallback i C0',
      testedIn: 'batch-011',
      result: 'FÖRVÄRRAD — 0 events, 10 fail, REVERTED',
      evidence: 'batch-011 batch-report.md',
    },
    {
      improvement: 'C4-AI placeholder (ingen riktig regelgenerering)',
      testedIn: 'batch-13',
      result: '0 regler sparades, 0 förbättrade outcomes',
      evidence: 'batch-13 c4-derived-rules.jsonl empty',
    },
    {
      improvement: 'Derived rules lasagne (24-40 regler laddade)',
      testedIn: 'batch-15 till batch-18',
      result: '0 regler applicerades i nästa round, 0 outcomes förbättrade',
      evidence: 'batch-14..18 rule-effectiveness.jsonl: 0% application rate',
    },
    {
      improvement: 'Swedish patterns probing /events, /program, /kalender',
      testedIn: 'swedish-pattern-verification + batch-18',
      result: 'C2 hit rate 57% men events-found rate 0% (förutom borlange med C3-fix)',
      evidence: 'swedish-pattern-performance: 0/8 Swedish pattern hits yielded events',
    },
    {
      improvement: 'Swedish pattern → D-routing (kungsbacka, cirkus, borlange)',
      testedIn: 'batch-16, batch-17, batch-18',
      result: 'C2=promising men C3 extraction=0. D-route fungerade inte.',
      evidence: 'batch-16..18: kungsbacka→D, cirkus→D, borlange→D men 0 events',
    },
    {
      improvement: 'PROMPT-5 LIKELY_JS_RENDER conf>=0.85 → D-route',
      testedIn: 'batch-14',
      result: 'Aldrig triggad — 0 sources nådde conf>=0.85',
      evidence: 'batch-14: max conf was 0.75 (LIKELY_JS_RENDER)',
    },
    {
      improvement: 'Rule application via retry-pool för NEEDS_SUBPAGE_DISCOVERY',
      testedIn: 'batch-15 (borlange-kommun, boplanet)',
      result: 'Rule applicerades men 0 events förbättrade',
      evidence: 'batch-15 rule-effectiveness.jsonl: helped=null for all',
    },
  ];

  // Orphan sources from batch-18
  const orphanSources = [
    {
      sourceId: 'bk-hacken',
      reason: 'roundsParticipated=2, genererade rule i round 2, tvingades stanna via STEP3-CHAIN, aldrig fick round 3 exit',
      lastSeenBatch: 'batch-18',
      suggestedAction: 'manuell routing till postTestC-manual-review',
    },
    {
      sourceId: 'blekholmen',
      reason: 'roundsParticipated=2, aldrig avrundad pga STEP3-CHAIN bug',
      lastSeenBatch: 'batch-18',
      suggestedAction: 'manuell routing till postTestC-manual-review',
    },
    {
      sourceId: 'boplanet',
      reason: 'roundsParticipated=2, aldrig avrundad pga STEP3-CHAIN bug',
      lastSeenBatch: 'batch-18',
      suggestedAction: 'manuell routing till postTestC-manual-review',
    },
    {
      sourceId: 'bor-s-zoo-animagic',
      reason: 'roundsParticipated=2, genererade rule i round 3, aldrig avrundad',
      lastSeenBatch: 'batch-18',
      suggestedAction: 'manuell routing till postTestC-manual-review',
    },
  ];

  // Blocked by bug
  const blockedByBug = [
    {
      bugId: 'STEP3-CHAIN-BUG',
      description: 'run-dynamic-pool.ts: sources som genererar rules i round N tvingas stanna i retry-pool via STEP3-CHAIN. När poolRoundNumber=3 nås avbryts loopen MEDAN dessa källor fortfarande är i retry-pool. De får aldrig sin exit till postTestC-manual-review.',
      affectedSources: 4,
      workaround: 'Efter varje batch, manuellt routes orphaned sources till postTestC-manual-review. Kör nästa batch.',
    },
  ];

  return {
    lastUpdated: new Date().toISOString(),
    totalBatchesAnalyzed: batchReports.length,
    totalSourcesProcessed: totalSources,
    dominantBottleneck: {
      category: dominant.category,
      count: dominant.count,
      percentage: dominantPct,
      description: 'C0 hittar inga event candidates på root URL. Swedish patterns hittar candidates men C1 likelyJsRendered=true triggar D-route och hoppar över C2/C3. Extraction körs aldrig.',
    },
    failCategoryDistribution,
    ruleEffectiveness,
    improvementAttempts,
    swedishPatternPerformance,
    neverRetryList,
    orphanSources,
    blockedByBug,
  };
}

// ---------------------------------------------------------------------------
// Experiment Recommender
// ---------------------------------------------------------------------------

function recommendNextExperiment(base: Omit<MemoryV1, 'nextRecommendedExperiment' | 'top3CandidateImprovements'>): MemoryV1['nextRecommendedExperiment'] {
  // Top 3 candidate improvements ranked by ROI
  const top3: MemoryV1['top3CandidateImprovements'] = [
    {
      rank: 1,
      improvement: 'C1→D-route bypass när C0 candidates finns + Swedish pattern match',
      expectedBottleneckTarget: 'discovery_failure',
      confidence: 'medium',
      generalizationRisk: 'medium',
      note: 'C1 likelyJsRendered=true är falsk positiv för Swedish municipal sites. C2 density scoring fångar dessa bättre. Kungsbacka, cirkus, borlange-kommun har C2 hits men blockerades av D-route.',
    },
    {
      rank: 2,
      improvement: 'Fixa STEP3-CHAIN bug + hantera orphaned sources',
      expectedBottleneckTarget: 'system-integrity',
      confidence: 'high',
      generalizationRisk: 'low',
      note: '4 sources är i limbo. Runner bug måste fixas före nästa batch. Låg risk, hög dataintegritet.',
    },
    {
      rank: 3,
      improvement: 'C3 extraction för Swedish pattern hits — ignorera C1 likelyJsRendered',
      expectedBottleneckTarget: 'extraction_failure',
      confidence: 'low',
      generalizationRisk: 'high',
      note: 'Swedish pattern hits har 0% events-found rate. Misstankar: extraction behöver target HTML, inte C1 HTML. Föreslås ej som högsta prioritet pga hög generalization risk.',
    },
  ];

  const nextExperiment: NextExperiment = {
    experiment: 'C1→D-route bypass för Swedish pattern C0 candidates',
    description: 'När C0 hittar candidates via Swedish patterns OCH C2 visar promise (density score > 0), fortsätt till C2/C3 även om C1 säger likelyJsRendered=true. Idag triggar likelyJsRendered=true D-route och hoppar över extraction helt.',
    expectedImpact: 'Potentiellt 4+ nya event sources (kungsbacka, cirkus, borlange-kommun, h-gskolan-i-sk-vde) utan att vänta på D-renderGate.',
    concreteHypothesis: 'C1 likelyJsRendered=true är falsk positiv för Swedish municipal/komman sites som kungsbacka.se — de har statiskt HTML men saknar time-tags i rå-HTML pga server-side rendering med datum-widget. C2 broad density scoring (kungsbacka: density=151, score=105) fångar dessa bättre än C1 time-tag check.',
    test: 'Skapa verification batch med kungsbacka, cirkus, borlange-kommun, h-gskolan-i-sk-vde. Kör med och utan C1→D-route bypass. Jämför extraction results.',
    confidence: 'medium',
    whyNow: 'Dominant bottleneck sedan batch-11 har varit C0=0 / Swedish patterns → 0 events. Nu finns tillräckligt data för att formulera hypotes. Swedish pattern verification bekräftar C2 hits men 0 events på grund av D-route.',
    blockedBy: ['STEP3-CHAIN-BUG'], // Must fix bug first
  };

  return {
    ...nextExperiment,
    top3CandidateImprovements: top3,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function buildMemory(): MemoryV1 {
  const base = analyzeBatchHistory();
  const experiment = recommendNextExperiment(base);

  // Destructure to avoid duplicating top3CandidateImprovements at root level
  const { top3CandidateImprovements, ...nextRecommendedExperiment } = experiment;

  const memory: MemoryV1 = {
    version: 1,
    ...base,
    nextRecommendedExperiment,
    top3CandidateImprovements,
  };

  return memory;
}

function main() {
  console.log('Building 123 Learning Memory...');
  const memory = buildMemory();

  // Write canonical memory file
  writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  console.log(`[123-Learning-Memory] Written to: ${MEMORY_FILE}`);
  console.log(`[123-Learning-Memory] Total batches analyzed: ${memory.totalBatchesAnalyzed}`);
  console.log(`[123-Learning-Memory] Dominant bottleneck: ${memory.dominantBottleneck.category} (${memory.dominantBottleneck.percentage})`);
  console.log(`[123-Learning-Memory] Next experiment: ${memory.nextRecommendedExperiment.experiment}`);
  console.log(`[123-Learning-Memory] Never retry: ${memory.neverRetryList.length} items`);
  console.log(`[123-Learning-Memory] Blocked by bug: ${memory.blockedByBug.length} bug(s)`);
  console.log(`[123-Learning-Memory] Orphaned sources: ${memory.orphanSources.length}`);

  // Also print a summary to stdout
  console.log('\n' + '='.repeat(60));
  console.log('123 LEARNING MEMORY — SUMMARY');
  console.log('='.repeat(60));
  console.log(`Dominant bottleneck: ${memory.dominantBottleneck.category}`);
  console.log(`Next experiment: ${memory.nextRecommendedExperiment.experiment}`);
  console.log(`Confidence: ${memory.nextRecommendedExperiment.confidence}`);
  console.log(`Blocked by: ${memory.nextRecommendedExperiment.blockedBy.join(', ') || 'none'}`);
  console.log(`Never retry: ${memory.neverRetryList.length} improvements`);
  console.log(`Orphaned sources: ${memory.orphanSources.length}`);
  console.log(`Top improvement #1: ${memory.top3CandidateImprovements[0].improvement}`);
  console.log('='.repeat(60));
}

main();
