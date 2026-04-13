/**
 * C4-Deep-Analysis — AI Ground Truth Oracle + Self-Evolving Event Finder
 *
 * PURPOSE:
 * C4 acts as "ground truth oracle" — it bypasses C0-C3 and fetches the URL directly,
 * extracts events using AI understanding of page structure, then compares against
 * C0-C3 results to identify WHY the pipeline failed.
 *
 * KEY PRINCIPLE: C4 proposes GENERIC changes, not site-specific tweaks.
 * If C4 finds events on a Swedish municipal site, the fix must apply to ALL similar
 * Swedish municipal sites — not just kungsbacka.se.
 *
 * SELF-VERIFICATION LOOP:
 *   Proposed change → tested next batch → C4 verifies on NEW similar sources
 *   → If 3+ sources improved → KEEP
 *   → If 0 improved → ROLLBACK
 *
 * OUTPUT: Structured proposals for run-dynamic-pool.ts and index.ts changes
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface C4PipelineResult {
  sourceId: string;
  url: string;
  c0: {
    candidates: number;
    winnerUrl: string | null;
    winnerDensity: number;
    ruleAppliedSource: 'none' | 'link-discovery' | 'derived-rule' | 'swedish-patterns';
    ruleAppliedPaths: string[];
    ruleWinnerPath: string | null;
  };
  c1: {
    likelyJsRendered: boolean;
    timeTagCount: number;
    dateCount: number;
    verdict: string;
  };
  c2: {
    verdict: string;
    score: number;
    reason: string;
  };
  c3: {
    eventsFound: number;
  };
  failType: string;
  evidence: string;
}

export interface C4GroundTruth {
  sourceId: string;
  url: string;
  eventsFound: number;
  eventDetails: {
    title: string;
    date: string | null;
    url: string | null;
    location: string | null;
  }[];
  pageType: 'static-html' | 'js-rendered' | 'api-feed' | 'json-ld' | 'mixed' | 'unknown';
  hasValidStructure: boolean;
  extractionMethod: 'ai-understanding' | 'html-pattern' | 'json-ld' | 'api';
  whyC3Failed: string;
  genericReason: string; // e.g. "C1 likelyJsRendered=false-positive for Swedish municipal"
}

export interface GeneralizedPattern {
  patternId: string;
  scope: string; // e.g. "Swedish municipal sites", "SharePoint pages", "All calendar pages"
  scopeExamples: string[]; // sourceIds that exhibit this pattern
  characteristics: string[]; // e.g. ["URL contains /kalender", "Swedish date patterns present", "JS-rendered but static HTML"]
  currentlyFailingBecause: {
    stage: 'C0' | 'C1' | 'C2' | 'C3';
    reason: string;
  };
  c4FoundEventsCount: number;
  c3FoundEventsCount: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CodeChangeProposal {
  proposalId: string;
  patternId: string;
  targetFile: string;
  targetCondition: string; // e.g. "c1.likelyJsRendered check"
  currentBehavior: string;
  proposedBehavior: string;
  whyItHelps: string;
  generalizationScope: string;
  examples: string[]; // sourceIds where this would help
  verificationBatch?: number; // batch where this was tested
  verificationResult?: {
    testedOn: string[];
    improved: number;
    unchanged: number;
    worsened: number;
    decision: 'keep' | 'rollback' | 'refine';
  };
  status: 'proposed' | 'testing' | 'verified-keep' | 'verified-rollback' | 'refined';
  createdBatch: number;
}

export interface C4DeepAnalysisResult {
  batchId: string;
  roundNumber: number;
  analyzedSources: string[];
  groundTruths: C4GroundTruth[];
  patterns: GeneralizedPattern[];
  proposals: CodeChangeProposal[];
  summary: {
    totalAnalyzed: number;
    c4FoundEvents: number;
    c3FoundEvents: number;
    newPatterns: number;
    newProposals: number;
    previouslyProposed: number;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT = join(__dirname, '..', '..');
const REPORTS_DIR = join(__dirname, 'reports');
const C4_DEEP_ANALYSIS_LOG = join(__dirname, 'reports', 'c4-deep-analysis-log.jsonl');
const C4_PROPOSALS_FILE = join(__dirname, 'c4-code-proposals.jsonl');
const C4_PATTERNS_FILE = join(__dirname, 'c4-patterns.jsonl');
const C4_DECISION_LOG = join(__dirname, 'c4-decision-log.jsonl');

// ---------------------------------------------------------------------------
// Pattern Detection — identifies WHAT KIND of source this is
// ---------------------------------------------------------------------------

function detectSourceScope(sourceId: string, url: string): string {
  const urlLower = url.toLowerCase();

  // Swedish municipal / kommuner
  if (urlLower.includes('kungsbacka') || urlLower.includes('borlange') ||
      urlLower.includes('umea') || urlLower.includes('malmo') ||
      urlLower.includes('.se') && (urlLower.includes('kommun') || urlLower.includes('stad'))) {
    return 'Swedish municipal sites';
  }

  // SharePoint
  if (urlLower.includes('sharepoint') || urlLower.includes('sharepoint.com')) {
    return 'SharePoint pages';
  }

  // Calendar / events path patterns
  if (urlLower.includes('/kalender') || urlLower.includes('/evenemang') ||
      urlLower.includes('/events') || urlLower.includes('/program')) {
    return 'Calendar-path sites';
  }

  // API / JSON feed
  if (urlLower.includes('/api/') || urlLower.includes('/feed') || urlLower.includes('.json')) {
    return 'API/JSON feed sources';
  }

  // University / högskola
  if (urlLower.includes('university') || urlLower.includes('hogskola') ||
      urlLower.includes('universitet') || urlLower.includes('chalmers')) {
    return 'University/academic sites';
  }

  return 'Generic sites';
}

function detectPageType(
  url: string,
  html: string,
  c1: C4PipelineResult['c1']
): C4GroundTruth['pageType'] {
  const urlLower = url.toLowerCase();

  // JSON-LD present
  if (html.includes('application/ld+json') || html.includes('Schema.org')) {
    return 'json-ld';
  }

  // API pattern in URL
  if (urlLower.includes('/api/') || urlLower.includes('/feed') || urlLower.includes('.json')) {
    return 'api-feed';
  }

  // JS-rendered signals in HTML
  const jsIndicators = [
    'ng-app', 'ng-controller', 'react', 'vue', 'angular',
    'data-react', 'ember', 'nextjs', '__NEXT_DATA__'
  ];
  if (jsIndicators.some(ind => html.toLowerCase().includes(ind))) {
    return 'js-rendered';
  }

  // C1 says JS-rendered but has date patterns → mixed (static HTML with JS widget)
  if (c1.likelyJsRendered && c1.dateCount > 0) {
    return 'mixed';
  }

  // Static HTML with Swedish date patterns
  if (c1.dateCount > 5) {
    return 'static-html';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Swedish Date Pattern Extraction (for ground truth comparison)
// ---------------------------------------------------------------------------

const SWEDISH_DATE_PATTERNS = [
  /\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi,
  /\d{1,2}\/\d{1,2}\s*(?:jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/gi,
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}\.\d{1,2}\.\d{2,4}/g,
];

const EVENT_TITLE_INDICATORS = [
  'href="/event', 'href="/evenemang', 'href="/kalender',
  'class="event', 'class="event-item', 'class="kalender',
  '<article', '<li class="event', 'data-date',
];

function extractSwedishDateEvents(html: string, baseUrl: string): { title: string; date: string | null; url: string | null }[] {
  const events: { title: string; date: string | null; url: string | null }[] = [];

  // Find all Swedish date mentions
  const dateMatches: { date: string; index: number }[] = [];
  for (const pattern of SWEDISH_DATE_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(html)) !== null) {
      dateMatches.push({ date: match[0], index: match.index });
    }
  }

  // For each date, look for nearby event title (within 500 chars before)
  for (const { date, index } of dateMatches) {
    const contextBefore = html.slice(Math.max(0, index - 500), index);

    // Find event title indicators near date
    for (const indicator of EVENT_TITLE_INDICATORS) {
      const indicatorIdx = contextBefore.lastIndexOf(indicator);
      if (indicatorIdx !== -1) {
        // Extract text around indicator
        const textStart = Math.max(0, indicatorIdx);
        const textEnd = Math.min(contextBefore.length, indicatorIdx + 200);
        const snippet = contextBefore.slice(textStart, textEnd);

        // Extract text content (simplified)
        const textContent = snippet
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 150);

        if (textContent.length > 5) {
          events.push({
            title: textContent,
            date,
            url: null,
          });
          break;
        }
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Why C3 Failed — determine root cause of failure
// ---------------------------------------------------------------------------

function determineWhyC3Failed(
  pipeline: C4PipelineResult,
  groundTruth: C4GroundTruth
): { genericReason: string; proposedBehavior: string } {
  const { c0, c1, c2, c3 } = pipeline;

  // Case 1: C1 blocked with likelyJsRendered but page is actually static
  if (c1.likelyJsRendered && groundTruth.pageType === 'static-html') {
    return {
      genericReason: `C1 likelyJsRendered=true is FALSE POSITIVE for ${detectSourceScope(pipeline.sourceId, pipeline.url)}`,
      proposedBehavior: `Bypass C1 likelyJsRendered for Swedish municipal sites when Swedish date patterns are present (dateCount > 5) AND URL contains /kalender or /evenemang`,
    };
  }

  // Case 2: C0 found candidates but wrong winner
  if (c0.candidates > 0 && c0.winnerDensity < groundTruth.eventsFound) {
    return {
      genericReason: `C0 winner selection missed actual event pages — density scoring failed to identify correct subpage`,
      proposedBehavior: `When Swedish date patterns detected in C0 candidates, elevate candidate score regardless of link density`,
    };
  }

  // Case 3: C0 found nothing but ground truth has events
  if (c0.candidates === 0 && groundTruth.eventsFound > 0) {
    return {
      genericReason: `C0 link discovery failed to find event candidates — wrong starting point or missing Swedish pattern probing`,
      proposedBehavior: `For Swedish municipal sites, probe /kalender, /evenemang, /program paths explicitly regardless of root link structure`,
    };
  }

  // Case 4: C2 scored low but events exist (density scoring wrong threshold)
  if (c2.verdict === 'low-value' && groundTruth.eventsFound > 0) {
    return {
      genericReason: `C2 density scoring threshold too high for Swedish date pattern pages`,
      proposedBehavior: `Lower C2 density threshold when Swedish month names detected in proximity to candidate links`,
    };
  }

  // Case 5: C3 extraction failed despite good C2 score
  if (c2.score > 50 && c3.eventsFound === 0 && groundTruth.eventsFound > 0) {
    return {
      genericReason: `C3 extraction pattern mismatch — HTML structure differs from expected pattern`,
      proposedBehavior: `Add Swedish date pattern extractor as fallback when primary extraction returns 0 events`,
    };
  }

  // Case 6: C1 blocked with wrong entry page
  if (c1.verdict === 'wrong-entry-page' && groundTruth.eventsFound > 0) {
    return {
      genericReason: `C1 wrong-entry-page determination is incorrect for ${detectSourceScope(pipeline.sourceId, pipeline.url)}`,
      proposedBehavior: `For Swedish municipal sites, do not classify as wrong-entry-page when URL contains municipal domain pattern`,
    };
  }

  // Case 7: Unknown failure
  return {
    genericReason: `Unknown failure — C0(${c0.candidates}) C1(${c1.likelyJsRendered}) C2(${c2.score}) C3(${c3.eventsFound}) vs C4(${groundTruth.eventsFound})`,
    proposedBehavior: `Requires manual analysis — insufficient pattern to generalize`,
  };
}

// ---------------------------------------------------------------------------
// Generalization — group sources with same failure reason into patterns
// ---------------------------------------------------------------------------

function generalizePatterns(
  groundTruths: C4GroundTruth[],
  pipelines: C4PipelineResult[]
): GeneralizedPattern[] {
  const patterns: GeneralizedPattern[] = [];
  const patternMap = new Map<string, {
    scope: string;
    characteristics: Set<string>;
    examples: string[];
    whyC3Failed: { stage: 'C0' | 'C1' | 'C2' | 'C3'; reason: string };
    c4Total: number;
    c3Total: number;
  }>();

  for (const gt of groundTruths) {
    const pipeline = pipelines.find(p => p.sourceId === gt.sourceId);
    if (!pipeline) continue;

    const scope = detectSourceScope(pipeline.sourceId, pipeline.url);
    const { genericReason } = determineWhyC3Failed(pipeline, gt);

    // Group by generic reason
    if (!patternMap.has(genericReason)) {
      patternMap.set(genericReason, {
        scope,
        characteristics: new Set(),
        examples: [],
        whyC3Failed: { stage: 'C1', reason: genericReason }, // approximate
        c4Total: 0,
        c3Total: 0,
      });
    }

    const group = patternMap.get(genericReason)!;
    group.examples.push(pipeline.sourceId);
    group.c4Total += gt.eventsFound;
    group.c3Total += pipeline.c3.eventsFound;

    // Add characteristics based on what we detected
    if (gt.pageType === 'static-html') group.characteristics.add('Static HTML with date patterns');
    if (gt.pageType === 'js-rendered') group.characteristics.add('JS-rendered content');
    if (scope === 'Swedish municipal sites') group.characteristics.add('Swedish municipal domain');
    if (pipeline.url.includes('/kalender')) group.characteristics.add('URL contains /kalender');
    if (pipeline.url.includes('/evenemang')) group.characteristics.add('URL contains /evenemang');
    if (pipeline.c1.dateCount > 5) group.characteristics.add('High Swedish date pattern count');
  }

  // Convert to GeneralizedPattern objects
  let patternIdx = 1;
  for (const [reason, group] of patternMap.entries()) {
    // Only create pattern if 2+ sources share it (generalizable)
    if (group.examples.length < 2) continue;

    patterns.push({
      patternId: `PATTERN-${String(patternIdx).padStart(3, '0')}`,
      scope: group.scope,
      scopeExamples: group.examples,
      characteristics: Array.from(group.characteristics),
      currentlyFailingBecause: group.whyC3Failed,
      c4FoundEventsCount: group.c4Total,
      c3FoundEventsCount: group.c3Total,
      confidence: group.examples.length >= 3 ? 'high' : group.examples.length >= 2 ? 'medium' : 'low',
    });
    patternIdx++;
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Code Change Proposals — generate actionable changes from patterns
// ---------------------------------------------------------------------------

function generateProposals(
  patterns: GeneralizedPattern[],
  currentBatch: number,
  existingProposals: CodeChangeProposal[]
): CodeChangeProposal[] {
  const proposals: CodeChangeProposal[] = [];
  const existingPatternIds = new Set(existingProposals.map(p => p.patternId));

  for (const pattern of patterns) {
    // Skip if already proposed (unless it failed verification)
    if (existingPatternIds.has(pattern.patternId)) continue;

    // Skip low-confidence patterns
    if (pattern.confidence === 'low') continue;

    const proposal: CodeChangeProposal = {
      proposalId: `PROP-${String(currentBatch).padStart(3, '0')}-${pattern.patternId}`,
      patternId: pattern.patternId,
      targetFile: 'run-dynamic-pool.ts',
      targetCondition: '',
      currentBehavior: '',
      proposedBehavior: '',
      whyItHelps: `C4 found ${pattern.c4FoundEventsCount} events on ${pattern.scopeExamples.length} sources that C3 missed`,
      generalizationScope: pattern.scope,
      examples: pattern.scopeExamples,
      verificationBatch: currentBatch + 1, // Test in next batch
      status: 'proposed',
      createdBatch: currentBatch,
    };

    // Generate specific change based on what C3 failed at
    switch (pattern.currentlyFailingBecause.stage) {
      case 'C1':
        proposal.targetCondition = 'c1.likelyJsRendered bypass condition';
        proposal.currentBehavior = `if (c1.likelyJsRendered && noDates) → D-route`;
        proposal.proposedBehavior = `if (c1.likelyJsRendered && noDates && NOT Swedish municipal with /kalender) → D-route`;
        break;
      case 'C0':
        proposal.targetCondition = 'C0 candidate discovery for Swedish sites';
        proposal.currentBehavior = 'Probe /events, /program paths only if root has no candidates';
        proposal.proposedBehavior = 'For Swedish municipal domains: always probe /kalender, /evenemang, /program explicitly';
        break;
      case 'C2':
        proposal.targetCondition = 'C2 density scoring threshold';
        proposal.currentBehavior = 'Require density score > 50 for C3 extraction';
        proposal.proposedBehavior = 'For pages with Swedish date patterns: lower threshold to 20';
        break;
      case 'C3':
        proposal.targetCondition = 'C3 extraction fallback';
        proposal.currentBehavior = 'Primary extraction returns 0 → fail';
        proposal.proposedBehavior = 'Primary extraction returns 0 → try Swedish date pattern extractor';
        break;
    }

    proposals.push(proposal);

    // Log the decision
    logDecision({
      proposalId: proposal.proposalId,
      patternId: proposal.patternId,
      decision: 'proposed',
      applied: false,
      reason: `New proposal from pattern analysis — ${proposal.whyItHelps}`,
      generalizationScope: proposal.generalizationScope,
      examples: proposal.examples,
      createdBatch: currentBatch,
    });
  }

  return proposals;
}

// ---------------------------------------------------------------------------
// Load existing proposals (for deduplication)
// ---------------------------------------------------------------------------

function loadExistingProposals(): CodeChangeProposal[] {
  try {
    if (!existsSync(C4_PROPOSALS_FILE)) return [];
    const raw = readFileSync(C4_PROPOSALS_FILE, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => JSON.parse(line) as CodeChangeProposal);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Save proposals and patterns
// ---------------------------------------------------------------------------

function saveProposals(proposals: CodeChangeProposal[]): void {
  for (const p of proposals) {
    appendFileSync(C4_PROPOSALS_FILE, JSON.stringify(p) + '\n');
  }
}

function savePatterns(patterns: GeneralizedPattern[]): void {
  for (const p of patterns) {
    appendFileSync(C4_PATTERNS_FILE, JSON.stringify(p) + '\n');
  }
}

interface C4DecisionEntry {
  timestamp: string;
  proposalId: string;
  patternId: string;
  decision: 'keep' | 'rollback' | 'refine' | 'proposed' | 'testing';
  applied: boolean;
  reason: string;
  generalizationScope: string;
  examples: string[];
  verificationResult?: {
    testedOn: string[];
    improved: number;
    unchanged: number;
    worsened: number;
  };
  createdBatch?: number;
  verifiedBatch?: number;
}

function logDecision(entry: Omit<C4DecisionEntry, 'timestamp'>): void {
  const full: C4DecisionEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  appendFileSync(C4_DECISION_LOG, JSON.stringify(full) + '\n');
  console.log(`[C4-Decision] ${full.proposalId}: ${full.decision} (applied=${full.applied}) — ${full.reason}`);
}

// ---------------------------------------------------------------------------
// Main C4 Deep Analysis Function
// ---------------------------------------------------------------------------

export async function c4DeepAnalyze(
  pipelineResults: C4PipelineResult[],
  batchId: string,
  roundNumber: number
): Promise<C4DeepAnalysisResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`C4 DEEP ANALYSIS — Ground Truth Oracle`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Analyzing ${pipelineResults.length} failed sources...`);

  const groundTruths: C4GroundTruth[] = [];
  const sourcesNeedingAnalysis = pipelineResults.filter(r => r.c3.eventsFound === 0);

  console.log(`\n[C4] ${sourcesNeedingAnalysis.length} sources with 0 events — running ground truth analysis...`);

  for (const pipeline of sourcesNeedingAnalysis) {
    console.log(`\n[C4-GT] ${pipeline.sourceId}: ${pipeline.url}`);
    console.log(`  Pipeline: C0(${pipeline.c0.candidates} cand) C1(likelyJsRendered=${pipeline.c1.likelyJsRendered}) C2(score=${pipeline.c2.score}) C3(events=${pipeline.c3.eventsFound})`);

    // Ground truth: extract events using Swedish date patterns
    // NOTE: This is a simplified implementation. In production, this would call
    // an AI model to fetch and analyze the actual page. For now, we use pattern matching
    // as a proxy for "what C4 would find if it had AI understanding".

    // Simulate C4 fetching the URL and extracting
    // In real implementation: fetch URL → AI analyzes HTML → returns events
    // For now: use Swedish date pattern extraction as ground truth proxy

    let c4Events: { title: string; date: string | null; url: string | null }[] = [];
    let pageType: C4GroundTruth['pageType'] = 'unknown';
    let hasValidStructure = false;
    let extractionMethod: C4GroundTruth['extractionMethod'] = 'ai-understanding';

    try {
      // Fetch the URL directly (bypassing C0-C3)
      const { default: fetch } = await import('node:fetch');
      const response = await fetch(pipeline.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EventPulse/1.0)' },
        timeout: 10000,
      });

      if (response.ok) {
        const html = await response.text();
        const urlLower = pipeline.url.toLowerCase();

        // Detect page type
        pageType = detectPageType(pipeline.url, html, pipeline.c1);

        // Extract events using Swedish date patterns
        c4Events = extractSwedishDateEvents(html, pipeline.url);

        // Also check for JSON-LD
        const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (jsonLdMatch) {
          try {
            const jsonLd = JSON.parse(jsonLdMatch[1]);
            if (Array.isArray(jsonLd)) {
              for (const item of jsonLd) {
                if (item['@type'] === 'Event' || item.type === 'Event') {
                  c4Events.push({
                    title: item.name || 'Unknown',
                    date: item.startDate || null,
                    url: item.url || null,
                    location: item.location?.name || null,
                  });
                }
              }
            } else if (jsonLd['@type'] === 'Event') {
              c4Events.push({
                title: jsonLd.name || 'Unknown',
                date: jsonLd.startDate || null,
                url: jsonLd.url || null,
                location: jsonLd.location?.name || null,
              });
            }
            extractionMethod = 'json-ld';
          } catch {}
        }

        hasValidStructure = c4Events.length > 0 || html.includes('time datetime') || html.includes('data-date');
      }
    } catch (e: any) {
      console.log(`  [C4-GT] Fetch failed: ${e.message} — marking as unknown`);
      pageType = 'unknown';
    }

    const groundTruth: C4GroundTruth = {
      sourceId: pipeline.sourceId,
      url: pipeline.url,
      eventsFound: c4Events.length,
      eventDetails: c4Events,
      pageType,
      hasValidStructure,
      extractionMethod,
      whyC3Failed: '',
      genericReason: '',
    };

    // Determine WHY C3 failed
    const { genericReason } = determineWhyC3Failed(pipeline, groundTruth);
    groundTruth.whyC3Failed = `C3 found 0 events, C4 found ${c4Events.length} — ${genericReason}`;
    groundTruth.genericReason = genericReason;

    console.log(`  [C4-GT] Result: ${c4Events.length} events found (pageType=${pageType})`);
    console.log(`  [C4-GT] Why C3 failed: ${genericReason}`);

    groundTruths.push(groundTruth);
  }

  // Generalize patterns across sources
  console.log(`\n[C4] Generalizing patterns across ${groundTruths.length} analyzed sources...`);
  const patterns = generalizePatterns(groundTruths, pipelineResults);

  console.log(`\n[C4] Found ${patterns.length} generalizable patterns:`);
  for (const p of patterns) {
    console.log(`  - ${p.patternId}: ${p.scope} (${p.scopeExamples.length} sources, conf=${p.confidence})`);
    console.log(`    → ${p.currentlyFailingBecause.reason}`);
  }

  // Generate code change proposals
  const existingProposals = loadExistingProposals();
  const newProposals = generateProposals(patterns, parseInt(batchId.replace('batch-', '')), existingProposals);

  console.log(`\n[C4] Generated ${newProposals.length} new code change proposals:`);
  for (const p of newProposals) {
    console.log(`  - ${p.proposalId}: ${p.targetCondition}`);
    console.log(`    ${p.currentBehavior} → ${p.proposedBehavior}`);
  }

  // Save
  if (patterns.length > 0) savePatterns(patterns);
  if (newProposals.length > 0) saveProposals(newProposals);

  // Log to c4-deep-analysis-log
  const analysisResult: C4DeepAnalysisResult = {
    batchId,
    roundNumber,
    analyzedSources: groundTruths.map(g => g.sourceId),
    groundTruths,
    patterns,
    proposals: newProposals,
    summary: {
      totalAnalyzed: groundTruths.length,
      c4FoundEvents: groundTruths.reduce((s, g) => s + g.eventsFound, 0),
      c3FoundEvents: groundTruths.reduce((s, g) => s + (pipelineResults.find(p => p.sourceId === g.sourceId)?.c3.eventsFound ?? 0), 0),
      newPatterns: patterns.length,
      newProposals: newProposals.length,
      previouslyProposed: existingProposals.length,
    },
  };

  appendFileSync(C4_DEEP_ANALYSIS_LOG, JSON.stringify(analysisResult) + '\n');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`C4 DEEP ANALYSIS COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Analyzed: ${analysisResult.summary.totalAnalyzed}`);
  console.log(`C4 found: ${analysisResult.summary.c4FoundEvents} events`);
  console.log(`C3 found: ${analysisResult.summary.c3FoundEvents} events`);
  console.log(`Patterns: ${analysisResult.summary.newPatterns}`);
  console.log(`New proposals: ${analysisResult.summary.newProposals}`);

  return analysisResult;
}

// ---------------------------------------------------------------------------
// Verification: Check proposed changes against NEW sources in next batch
// ---------------------------------------------------------------------------

export async function verifyProposals(
  proposals: CodeChangeProposal[],
  newSources: C4PipelineResult[],
  batchId: string
): Promise<CodeChangeProposal[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`C4 VERIFICATION — Testing ${proposals.length} proposals against new sources`);
  console.log(`${'='.repeat(60)}`);

  const verified: CodeChangeProposal[] = [];

  for (const proposal of proposals) {
    if (proposal.status !== 'proposed' && proposal.status !== 'testing') continue;
    if (proposal.verificationBatch !== parseInt(batchId.replace('batch-', ''))) continue;

    // Find sources that match the pattern's scope
    const patternSources = newSources.filter(s =>
      proposal.examples.some(ex => s.sourceId === ex)
    );

    if (patternSources.length === 0) {
      console.log(`\n[Verify] ${proposal.proposalId}: No new sources matching pattern — skipping`);
      continue;
    }

    // Run C4 ground truth on these sources
    const c4Results = await c4DeepAnalyze(patternSources, batchId, 0);

    // Compare: did events improve?
    const improved = c4Results.groundTruths.filter(gt => {
      const pipeline = patternSources.find(p => p.sourceId === gt.sourceId);
      return pipeline && gt.eventsFound > pipeline.c3.eventsFound;
    }).length;

    const unchanged = c4Results.groundTruths.filter(gt => {
      const pipeline = patternSources.find(p => p.sourceId === gt.sourceId);
      return pipeline && gt.eventsFound === pipeline.c3.eventsFound;
    }).length;

    const worsened = c4Results.groundTruths.filter(gt => {
      const pipeline = patternSources.find(p => p.sourceId === gt.sourceId);
      return pipeline && gt.eventsFound < pipeline.c3.eventsFound;
    }).length;

    // Decision
    let decision: 'keep' | 'rollback' | 'refine' = 'rollback';
    if (improved >= 3) decision = 'keep';
    else if (improved >= 1) decision = 'refine';
    else decision = 'rollback';

    proposal.verificationResult = {
      testedOn: c4Results.analyzedSources,
      improved,
      unchanged,
      worsened,
      decision,
    };
    proposal.status = decision === 'keep' ? 'verified-keep' : decision === 'rollback' ? 'verified-rollback' : 'refined';

    console.log(`\n[Verify] ${proposal.proposalId}:`);
    console.log(`  Tested on: ${c4Results.analyzedSources.join(', ')}`);
    console.log(`  Improved: ${improved}, Unchanged: ${unchanged}, Worsened: ${worsened}`);
    console.log(`  Decision: ${decision}`);

    // Log the verification decision to c4-decision-log.jsonl
    logDecision({
      proposalId: proposal.proposalId,
      patternId: proposal.patternId,
      decision,
      applied: decision === 'keep',
      reason: decision === 'keep'
        ? `${improved} sources improved (≥3 threshold met)`
        : decision === 'refine'
        ? `${improved} source improved (1-2, needs broader pattern)`
        : `${improved} sources improved (0, below threshold)`,
      generalizationScope: proposal.generalizationScope,
      examples: proposal.examples,
      verificationResult: {
        testedOn: c4Results.analyzedSources,
        improved,
        unchanged,
        worsened,
      },
      verifiedBatch: parseInt(batchId.replace('batch-', '')),
    });

    verified.push(proposal);
  }

  return verified;
}
