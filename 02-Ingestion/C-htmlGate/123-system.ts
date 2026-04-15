/**
 * 123 System — Complete Source Processing Engine
 * =============================================
 *
 * Combines: autonomous learning loop + source re-queuer + diagnostics
 *
 * USAGE:
 *   # Status overview
 *   npx tsx 02-Ingestion/C-htmlGate/123-system.ts --status
 *
 *   # Re-queue failed/stuck sources back into the pipeline
 *   npx tsx 02-Ingestion/C-htmlGate/123-system.ts --requeue
 *
 *   # Run the autonomous improvement loop
 *   npx tsx 02-Ingestion/C-htmlGate/123-system.ts --loop --max-iter=3
 *
 *   # Dry run — see what would happen
 *   npx tsx 02-Ingestion/C-htmlGate/123-system.ts --dry-run
 *
 *   # Run a single batch (for verification)
 *   npx tsx 02-Ingestion/C-htmlGate/123-system.ts --batch
 *
 *   # Reset all state
 *   npx tsx 02-Ingestion/C-htmlGate/123-system.ts --reset
 *
 * ARCHITECTURE:
 *   sources_status.jsonl (425 entries)
 *     → 361 "failed" (wrongly marked — never properly processed)
 *     → 64 "success"
 *     → 332 "eligible" (status=eligible but also ingestionStage=completed)
 *
 *   The "failed" sources were reset on 2026-04-08 but never re-processed
 *   through the C-htmlGate pipeline. The re-queuer fixes this.
 *
 *   postTestC-manual-review.jsonl (68 entries)
 *     → sources that exhausted 3 rounds without events
 *     → these are candidates for re-queuing with broader patterns
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const C_HTML_GATE = join(PROJECT_ROOT, '02-Ingestion', 'C-htmlGate');
const REPORTS_DIR = join(C_HTML_GATE, 'reports');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');

const PATHS = {
  SOURCES_STATUS: join(RUNTIME_DIR, 'sources_status.jsonl'),
  POSTB_PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  POSTC_UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  POSTC_MANUAL: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
  IMPROVEMENT_STATE: join(C_HTML_GATE, '123-improvement-state.json'),
  IMPROVEMENTS_BANK: join(REPORTS_DIR, 'improvements-bank.jsonl'),
};

// =============================================================================
// TYPES
// =============================================================================

type Outcome = 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'unknown';
type ImprovementState = 'none' | 'proposed' | 'coded' | 'verifying' | 'verified' | 'active' | 'rolled_back';
type CStage = 'C0' | 'C1' | 'C2' | 'C3' | 'ROUTING';

interface SourceStatus {
  sourceId: string;
  status: string;
  ingestionStage: string;
  lastRun: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastEventsFound: number;
  attempts: number;
  lastError?: string;
  lastPathUsed?: string;
  triageResult?: string;
  triageRecommendedPath?: string;
  lastRoutingReason?: string;
  legacyState?: Record<string, unknown>;
}

interface PoolStateData {
  active: unknown[];
  exited: ExitedEntry[];
  failed: unknown[];
}

interface ExitedEntry {
  source?: { sourceId?: string; url?: string };
  decision?: string;
  result?: Record<string, unknown>;
}

interface BatchOutcome {
  batchId: string;
  sources: SourceResult[];
}

interface SourceResult {
  sourceId: string;
  batchId: string;
  round: number;
  outcome: Outcome;
  eventsFound: number;
  failType: string;
  outcomeType: string;
  c0Candidates: number;
  c0SwedishPatternMatches: string[];
  c0RuleAppliedPaths: string[];
  c1LikelyJsRendered: boolean;
  c1TimeTagCount: number;
  c2Score: number;
  c2Verdict: string;
  c3Attempted: boolean;
  c3EventsFound: number;
  derivedRuleApplied: boolean;
  derivedRulePaths: string[];
  failureReason: string;
}

interface FailurePattern {
  patternId: string;
  patternKey: string;
  category: CStage;
  htmlFingerprint: string;
  hypothesis: string;
  concreteFix: string;
  affectedCStage: CStage;
  affectedFile: string;
  confidence: number;
  generalizationRisk: 'low' | 'medium' | 'high';
  sources: string[];
  examples: SourceResult[];
}

interface ImprovementAttempt {
  id: string;
  experiment: string;
  patternKey: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
  generalizationRisk: 'low' | 'medium' | 'high';
  hypothesis: string;
  concreteFix: string;
  affectedCStage: CStage;
  affectedFile: string;
  verificationSources: string[];
  regressionSources: string[];
  createdAt: string;
  verifiedAt?: string;
  activatedAt?: string;
  rolledBackAt?: string;
  rollbackReason?: string;
  verificationResult?: {
    batchId: string;
    improvedSources: string[];
    unchangedSources: string[];
    regressedSources: string[];
    netImprovement: number;
    decision: 'keep' | 'rollback';
  };
}

interface ImprovementStateFile {
  version: 1;
  lastUpdated: string;
  currentState: ImprovementState;
  currentImprovement: ImprovementAttempt | null;
  completedImprovements: ImprovementAttempt[];
  failedImprovements: ImprovementAttempt[];
  blockedByBug: { bugId: string; description: string; status: 'open' | 'fixed' | 'acknowledged' }[];
}

interface CodeChange {
  patternId: string;
  before: string;
  after: string;
}

// =============================================================================
// FILE UTILITIES (no pipes — read files directly)
// =============================================================================

function readLines(path: string): string[] {
  try {
    const content = readFileSync(path, 'utf8');
    return content.trim() ? content.split('\n').filter(l => l.trim()) : [];
  } catch { return []; }
}

function readJsonl<T>(path: string): T[] {
  return readLines(path).map(line => JSON.parse(line) as T);
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return fallback; }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function appendJsonl(path: string, entry: object): void {
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readDirNums(dir: string, prefix: string): number[] {
  try {
    return readdirSync(dir)
      .filter(f => f.startsWith(prefix + '-'))
      .map(f => parseInt(f.replace(prefix + '-', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => b - a);
  } catch { return []; }
}

// =============================================================================
// LOGGING
// =============================================================================

function log(msg: string): void {
  console.log(`[${new Date().toISOString().substring(11, 19)}] ${msg}`);
}

function section(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(' ' + title);
  console.log('='.repeat(70));
}

function warn(msg: string): void {
  console.warn(`[${new Date().toISOString().substring(11, 19)}] WARN: ${msg}`);
}

// =============================================================================
// DIAGNOSTICS — Complete system status
// =============================================================================

interface SystemDiagnostics {
  totalSources: number;
  successSources: number;
  failedSources: number;
  eligibleSources: number;
  postBPreC: number;
  postCManualReview: number;
  postCUI: number;
  recentBatches: number;
  failedByCategory: Record<string, number>;
  improvementState: {
    current: ImprovementState;
    completed: number;
    failed: number;
    blocked: number;
  };
}

function diagnoseSystem(): SystemDiagnostics {
  const sources = readJsonl<SourceStatus>(PATHS.SOURCES_STATUS);

  const successSources = sources.filter(s => s.status === 'success').length;
  const failedSources = sources.filter(s => s.ingestionStage === 'failed').length;
  const eligibleSources = sources.filter(s => s.status === 'eligible').length;

  const postBPreC = readLines(PATHS.POSTB_PREC).length;
  const postCManual = readLines(PATHS.POSTC_MANUAL).length;
  const postCUI = readLines(PATHS.POSTC_UI).length;

  const batchNums = readDirNums(REPORTS_DIR, 'batch');
  const recentBatches = batchNums.length;

  // Categorize failed sources
  const failedByCategory: Record<string, number> = {};
  const failedSrcs = sources.filter(s => s.ingestionStage === 'failed');
  for (const s of failedSrcs) {
    const err = s.lastError || '';
    const cat = categorizeError(err);
    failedByCategory[cat] = (failedByCategory[cat] || 0) + 1;
  }

  const impState = readJson<ImprovementStateFile>(PATHS.IMPROVEMENT_STATE, {
    version: 1, lastUpdated: '', currentState: 'none', currentImprovement: null,
    completedImprovements: [], failedImprovements: [],
    blockedByBug: [],
  });

  return {
    totalSources: sources.length,
    successSources,
    failedSources,
    eligibleSources,
    postBPreC,
    postCManualReview: postCManual,
    postCUI,
    recentBatches,
    failedByCategory,
    improvementState: {
      current: impState.currentState,
      completed: impState.completedImprovements.length,
      failed: impState.failedImprovements.length,
      blocked: impState.blockedByBug.filter(b => b.status === 'open').length,
    },
  };
}

function categorizeError(err: string): string {
  if (!err) return 'no_error_recorded';
  const e = err.toLowerCase();
  if (e.includes('dns') || e.includes('enotfound') || e.includes('getaddrinfo')) return 'DNS/network';
  if (e.includes('html too small') || e.includes('js')) return 'JS-rendered/too_small';
  if (e.includes('timeout')) return 'timeout';
  if (e.includes('403') || e.includes('forbidden')) return '403-forbidden';
  if (e.includes('404') || e.includes('not found')) return '404-not_found';
  if (e.includes('ssl') || e.includes('certificate') || e.includes('tls')) return 'SSL-certificate';
  if (e.includes('connection')) return 'connection';
  return 'other';
}

function printDiagnostics(d: SystemDiagnostics): void {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║ 123 SYSTEM DIAGNOSTICS                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total sources:          ${String(d.totalSources).padEnd(32)}║`);
  console.log(`║  ✓ Success:               ${String(d.successSources).padEnd(32)}║`);
  console.log(`║  ✗ Failed (stuck):       ${String(d.failedSources).padEnd(32)}║`);
  console.log(`║  ○ Eligible:              ${String(d.eligibleSources).padEnd(32)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  postB-preC (ready):      ${String(d.postBPreC).padEnd(32)}║`);
  console.log(`║  postTestC-UI (done):     ${String(d.postCUI).padEnd(32)}║`);
  console.log(`║  postTestC-manual-review: ${String(d.postCManualReview).padEnd(32)}║`);
  console.log(`║  Recent batches:          ${String(d.recentBatches).padEnd(32)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Failed source categories:');
  for (const [cat, count] of Object.entries(d.failedByCategory)) {
    console.log(`║    ${cat}: ${count}`);
  }
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Loop state:              ${d.improvementState.current.padEnd(32)}║`);
  console.log(`║  Improvements (done/fail): ${String(d.improvementState.completed + '/' + d.improvementState.failed).padEnd(32)}║`);
  console.log(`║  Blocked by bugs:         ${String(d.improvementState.blocked).padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
}

// =============================================================================
// SOURCE RE-QUEUER — Fix the 361 stuck sources
// =============================================================================

interface RequeueStats {
  requeuedManualReview: number;
  requeuedFailedNoError: number;
  requeuedFailedRetryable: number;
  skipped: number;
  errors: string[];
}

function requeueSources(): RequeueStats {
  const stats: RequeueStats = {
    requeuedManualReview: 0,
    requeuedFailedNoError: 0,
    requeuedFailedRetryable: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Re-queue from postTestC-manual-review
  const manualEntries = readJsonl<Record<string, unknown>>(PATHS.POSTC_MANUAL);
  const manualIds = new Set<string>();

  for (const entry of manualEntries) {
    const sid = entry.sourceId as string;
    if (!sid) continue;
    manualIds.add(sid);
  }

  if (manualIds.size > 0) {
    // These sources exhausted 3 rounds. Re-queue them with a fresh start.
    // They get a new attempt in the pool.
    const requeueEntries = Array.from(manualIds).map(sid => ({
      sourceId: sid,
      queueName: 'postB-preC',
      queuedAt: new Date().toISOString(),
      priority: 1,
      attempt: 1,
      queueReason: 'manual-review re-queue: fresh start after 3 rounds without events',
      routingReason: 'manual-review re-queued by 123-system',
    }));

    // Prepend to postB-preC (at the front so they get picked up first)
    const existing = readLines(PATHS.POSTB_PREC);
    const allEntries = [...requeueEntries.map(e => JSON.stringify(e)), ...existing];
    writeFileSync(PATHS.POSTB_PREC, allEntries.join('\n') + (allEntries.length ? '\n' : ''));

    stats.requeuedManualReview = requeueEntries.length;
    log(`Re-queued ${requeueEntries.length} sources from manual-review`);
  }

  // 2. Re-queue failed sources with no error (likely reset casualties)
  // These sources were in the pipeline during the 2026-04-08 reset
  // and never got properly processed. They need a fresh start.
  const sources = readJsonl<SourceStatus>(PATHS.SOURCES_STATUS);
  const noErrorFailed = sources.filter(s =>
    s.ingestionStage === 'failed' &&
    (!s.lastError || s.lastError.trim() === '')
  );

  const noErrorIds = new Set<string>();
  for (const s of noErrorFailed) {
    // Skip if already re-queued from manual-review
    if (manualIds.has(s.sourceId)) continue;
    // Skip if already in postB-preC
    const precLines = readLines(PATHS.POSTB_PREC);
    const alreadyQueued = precLines.some(l => {
      try { return JSON.parse(l).sourceId === s.sourceId; } catch { return false; }
    });
    if (alreadyQueued) continue;

    noErrorIds.add(s.sourceId);
  }

  if (noErrorIds.size > 0) {
    const requeueEntries = Array.from(noErrorIds).map(sid => ({
      sourceId: sid,
      queueName: 'postB-preC',
      queuedAt: new Date().toISOString(),
      priority: 1,
      attempt: 1,
      queueReason: 'failed re-queue: no error recorded — reset casualty, fresh start',
      routingReason: 're-queued by 123-system: was ingestionStage=failed with no error',
    }));

    const existing = readLines(PATHS.POSTB_PREC);
    const allEntries = [...requeueEntries.map(e => JSON.stringify(e)), ...existing];
    writeFileSync(PATHS.POSTB_PREC, allEntries.join('\n') + (allEntries.length ? '\n' : ''));

    stats.requeuedFailedNoError = requeueEntries.length;
    log(`Re-queued ${requeueEntries.length} failed sources (no error recorded)`);
  }

  // 3. Also re-queue the retryable failures (JS-rendered, timeout)
  const retryableFailed = sources.filter(s =>
    s.ingestionStage === 'failed' &&
    s.lastError &&
    (s.lastError.toLowerCase().includes('html too small') ||
     s.lastError.toLowerCase().includes('js') ||
     s.lastError.toLowerCase().includes('timeout'))
  );

  const retryableIds = new Set<string>();
  for (const s of retryableFailed) {
    if (manualIds.has(s.sourceId)) continue;
    const precLines = readLines(PATHS.POSTB_PREC);
    const alreadyQueued = precLines.some(l => {
      try { return JSON.parse(l).sourceId === s.sourceId; } catch { return false; }
    });
    if (alreadyQueued) continue;
    retryableIds.add(s.sourceId);
  }

  if (retryableIds.size > 0) {
    const requeueEntries = Array.from(retryableIds).map(sid => ({
      sourceId: sid,
      queueName: 'postB-preC',
      queuedAt: new Date().toISOString(),
      priority: 1,
      attempt: 1,
      queueReason: 'retryable failure re-queue: JS-rendered or timeout — fresh attempt',
      routingReason: 're-queued by 123-system: retryable failure',
    }));

    const existing = readLines(PATHS.POSTB_PREC);
    const allEntries = [...requeueEntries.map(e => JSON.stringify(e)), ...existing];
    writeFileSync(PATHS.POSTB_PREC, allEntries.join('\n') + (allEntries.length ? '\n' : ''));

    stats.requeuedFailedRetryable = requeueEntries.length;
    log(`Re-queued ${requeueEntries.length} retryable failed sources`);
  }

  // 4. Clear the manual-review queue (sources are now re-queued)
  if (stats.requeuedManualReview > 0) {
    writeFileSync(PATHS.POSTC_MANUAL, '');
    log('Cleared postTestC-manual-review queue (sources re-queued)');
  }

  // 5. Report final postB-preC state
  const finalPrec = readLines(PATHS.POSTB_PREC).length;
  log(`postB-preC now has ${finalPrec} sources`);

  return stats;
}

// =============================================================================
// POOL STATE PARSING
// =============================================================================

function normalizeOutcome(decision: string | undefined): Outcome {
  if (!decision) return 'unknown';
  const d = decision.toLowerCase();
  if (d.includes('ui')) return 'UI';
  if (d.includes('a-signal') || d.includes('posttestc-a')) return 'A';
  if (d.includes('b-signal') || d.includes('posttestc-b')) return 'B';
  if (d.includes('d-signal') || d.includes('posttestc-d')) return 'D';
  if (d.includes('manual') || d.includes('review')) return 'manual-review';
  return 'unknown';
}

function diagnoseFailure(s: SourceResult): string {
  if (s.eventsFound > 0) return 'OK';
  if (s.c2Score > 80 && s.c3Attempted) return `C2_PROMISING_EXTRACTION_ZERO:c2=${s.c2Score}`;
  if (s.c0SwedishPatternMatches.length > 0 && s.outcome === 'D') {
    const paths = s.c0SwedishPatternMatches.slice(0, 2).join('|');
    return `SWEDISH_PATTERNS_BLOCKED_D_ROUTE:c0=${s.c0Candidates},swedish=${paths}`;
  }
  if (s.c0Candidates > 0 && s.c1LikelyJsRendered) return `C0_CANDIDATES_BLOCKED_BY_C1_LIKELY_JS:c0=${s.c0Candidates},c2=${s.c2Score}`;
  if (s.c2Score === 0 && s.c3Attempted) return `C2_ZERO_BUT_EXTRACTION_ATTEMPTED`;
  if (s.derivedRuleApplied && s.eventsFound === 0) {
    const paths = (s.derivedRulePaths || []).slice(0, 2).join('|');
    return `DERIVED_RULE_NO_HELP:paths=${paths}`;
  }
  if (s.c0Candidates === 0 && s.c0SwedishPatternMatches.length === 0) {
    return `C0_COMPLETE_FAILURE:c2=${s.c2Score},verdict=${s.c2Verdict}`;
  }
  if (s.c3Attempted) return `EXTRACTION_FAILED:c2=${s.c2Score}`;
  return `UNKNOWN:c0=${s.c0Candidates},c1js=${s.c1LikelyJsRendered},c2=${s.c2Score}`;
}

function parseSourceFromExited(ex: ExitedEntry, batchId: string): SourceResult {
  const srcId = ex.source?.sourceId || 'unknown';
  const r = ex.result || {};
  const c0 = (r.c0 as Record<string, unknown>) || {};
  const c1 = (r.c1 as Record<string, unknown>) || {};
  const c2 = (r.c2 as Record<string, unknown>) || {};
  const extract = (r.extract as Record<string, unknown>) || {};

  const s: SourceResult = {
    sourceId: srcId,
    batchId,
    round: (r.roundNumber as number) || 0,
    outcome: normalizeOutcome(ex.decision),
    eventsFound: (extract.eventsFound as number) || 0,
    failType: (r.failType as string) || 'unknown',
    outcomeType: (r.outcomeType as string) || 'unknown',
    c0Candidates: (c0.candidates as number) || 0,
    c0SwedishPatternMatches: (c0.swedishPatternMatches as string[]) || [],
    c0RuleAppliedPaths: (c0.ruleAppliedPaths as string[]) || [],
    c1LikelyJsRendered: (c1.likelyJsRendered as boolean) || false,
    c1TimeTagCount: (c1.timeTagCount as number) || 0,
    c2Score: (c2.score as number) || 0,
    c2Verdict: (c2.verdict as string) || 'unknown',
    c3Attempted: !!(extract.attempted),
    c3EventsFound: (extract.eventsFound as number) || 0,
    derivedRuleApplied: !!(r.derivedRuleApplied),
    derivedRulePaths: (r.derivedRulePaths as string[]) || [],
    failureReason: 'TBD',
  };

  s.failureReason = diagnoseFailure(s);
  return s;
}

function loadRecentBatchOutcomes(lastN = 5): BatchOutcome[] {
  const batchNums = readDirNums(REPORTS_DIR, 'batch');
  const recent = batchNums.slice(0, lastN);
  const outcomes: BatchOutcome[] = [];

  for (const num of recent) {
    const poolPath = join(REPORTS_DIR, `batch-${num}`, 'pool-state.json');
    const poolData = readJson<PoolStateData>(poolPath, { active: [], exited: [], failed: [] });
    if (!poolData.exited?.length) continue;

    const sources = poolData.exited
      .map(ex => parseSourceFromExited(ex, `batch-${num}`))
      .filter(s => s.sourceId !== 'unknown');

    if (sources.length) outcomes.push({ batchId: `batch-${num}`, sources });
  }

  return outcomes;
}

// =============================================================================
// PATTERN ANALYSIS — HTML-aware failure grouping
// =============================================================================

function uniqueSrcIds(sources: SourceResult[]): string[] {
  const seen = new Set<string>();
  for (const s of sources) seen.add(s.sourceId);
  return Array.from(seen);
}

function hashKey(key: string): string {
  return createHash('md5').update(key).digest('hex').substring(0, 12);
}

function buildPatterns(outcomes: BatchOutcome[]): FailurePattern[] {
  const patterns: FailurePattern[] = [];

  // Collect all failed manual-review sources
  const failedSources: SourceResult[] = [];
  for (const outcome of outcomes) {
    for (const s of outcome.sources) {
      if (s.eventsFound === 0 && s.outcome === 'manual-review') {
        failedSources.push(s);
      }
    }
  }

  if (failedSources.length === 0) {
    log('No failed manual-review sources in recent batches');
    return patterns;
  }

  log(`Analyzing ${failedSources.length} failed sources across ${outcomes.length} batches`);

  // PATTERN 1: C2 promising but extraction yielded 0
  // High confidence — C2 density > 80 means events ARE in the HTML
  const c2Promising = failedSources.filter(s => s.c2Score > 80);
  if (c2Promising.length >= 2) {
    patterns.push({
      patternId: 'C2_PROMISING_EXTRACTION_ZERO',
      patternKey: hashKey('C2_PROMISING_EXTRACTION_ZERO'),
      category: 'C3',
      htmlFingerprint: `C2 score > 80, verdict=${c2Promising[0]?.c2Verdict}`,
      hypothesis: `C2 density visar > 80 — events finns i HTML men C3 får 0. C3 använder C1 HTML (saknar events) istället för C2 HTML (har events).`,
      concreteFix: `I run-dynamic-pool.ts: när c2Score > 50, använd c2HtmlSnippet för extractFromHtml() istället för c1HtmlContent.`,
      affectedCStage: 'C3',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      confidence: 0.75,
      generalizationRisk: 'low',
      sources: uniqueSrcIds(c2Promising),
      examples: c2Promising.slice(0, 5),
    });
    log(`  + C2_PROMISING_EXTRACTION_ZERO: ${c2Promising.length} sources, conf=0.75`);
  }

  // PATTERN 2: Swedish patterns found but routed to D (likelyJsRendered)
  const swedishBlockedD = failedSources.filter(s =>
    s.c0SwedishPatternMatches.length > 0 && s.outcome === 'D'
  );
  if (swedishBlockedD.length >= 2) {
    patterns.push({
      patternId: 'SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE',
      patternKey: hashKey('SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE'),
      category: 'ROUTING',
      htmlFingerprint: `C0 hittade Swedish paths men C1-routing skickade till D`,
      hypothesis: `C0 hittar candidates via Swedish patterns men C1 säger likelyJsRendered=true och skickar till D. Men C2 density visar statisk HTML finns. Swedish subpages har inte samma JS-problem som root.`,
      concreteFix: `I run-dynamic-pool.ts: om c0.swedishPatternMatches.length > 0 ELLER c2Score > 50, skip D-route och gå till C3 extraction med C2 HTML.`,
      affectedCStage: 'C1',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      confidence: 0.70,
      generalizationRisk: 'medium',
      sources: uniqueSrcIds(swedishBlockedD),
      examples: swedishBlockedD.slice(0, 5),
    });
    log(`  + SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE: ${swedishBlockedD.length} sources, conf=0.70`);
  }

  // PATTERN 3: C0 found candidates via link discovery but C2 score = 0 (wrong entry)
  const c0CandidatesC2Zero = failedSources.filter(s =>
    s.c0Candidates > 0 && s.c2Score === 0
  );
  if (c0CandidatesC2Zero.length >= 2) {
    patterns.push({
      patternId: 'C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY',
      patternKey: hashKey('C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY'),
      category: 'C2',
      htmlFingerprint: `C0 hittade ${c0CandidatesC2Zero[0]?.c0Candidates} candidates men C2 score=0`,
      hypothesis: `C0 hittar korrekta candidates (via link discovery) men C2 analyserar fel URL (entry page). Events finns på C0's winner URL, inte på entry page. C2 borde använda C0's winner URL.`,
      concreteFix: `I run-dynamic-pool.ts: när c0Candidates > 0 och c2Score === 0, använd c0.winnerUrl för C2 analys istället för entryUrl. Ändra: const c2TargetUrl = c0?.winnerUrl ?? entryUrl.`,
      affectedCStage: 'C2',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      confidence: 0.70,
      generalizationRisk: 'low',
      sources: uniqueSrcIds(c0CandidatesC2Zero),
      examples: c0CandidatesC2Zero.slice(0, 5),
    });
    log(`  + C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY: ${c0CandidatesC2Zero.length} sources, conf=0.70`);
  }

  // PATTERN 4: C0 complete failure — no candidates, no Swedish patterns
  // Two sub-types: (a) JS-rendered root (timeout), (b) wrong URL
  const c0CompleteFailure = failedSources.filter(s =>
    s.c0Candidates === 0 && s.c0SwedishPatternMatches.length === 0
  );
  if (c0CompleteFailure.length >= 3) {
    patterns.push({
      patternId: 'C0_COMPLETE_FAILURE_NEEDS_BROADER_PROBING',
      patternKey: hashKey('C0_COMPLETE_FAILURE_NEEDS_BROADER_PROBING'),
      category: 'C0',
      htmlFingerprint: `C0 hittade 0 candidates, 0 Swedish paths. ${c0CompleteFailure.length} sources. Mix av timeout (JS) och statiska sidor utan event-links.`,
      hypothesis: `C0 probe:ar Swedish event paths (/events, /kalender, /program) men dessa sidor har events på andra paths (/besok, /aktiviteter, etc). C0 behöver bredda mönster-matchning OCH hantera JS-renderade rötter.`,
      concreteFix: `I C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts: lägg till bredare Swedish patterns: '/besok', '/aktiviteter', '/arrangemang', '/planditt', '/hitta'. För timeout-fall (c0.duration > 4000ms), flagga för D-renderGate istället för manual-review.`,
      affectedCStage: 'C0',
      affectedFile: join(C_HTML_GATE, 'C0-htmlFrontierDiscovery', 'C0-htmlFrontierDiscovery.ts'),
      confidence: 0.65,
      generalizationRisk: 'low',
      sources: uniqueSrcIds(c0CompleteFailure),
      examples: c0CompleteFailure.slice(0, 5),
    });
    log(`  + C0_COMPLETE_FAILURE_NEEDS_BROADER_PROBING: ${c0CompleteFailure.length} sources, conf=0.65`);
  }

  // PATTERN 5: C2 medium score (20-80), extraction attempted, 0 events
  // Could benefit from multi-page extraction
  const c2MediumFailed = failedSources.filter(s =>
    s.c2Score > 20 && s.c2Score <= 80 && s.c3Attempted && s.eventsFound === 0
  );
  if (c2MediumFailed.length >= 3) {
    patterns.push({
      patternId: 'C2_MEDIUM_EXTRACTION_FAILED_NEEDS_MULTIPAGE',
      patternKey: hashKey('C2_MEDIUM_EXTRACTION_FAILED_NEEDS_MULTIPAGE'),
      category: 'C3',
      htmlFingerprint: `C2 score ${c2MediumFailed[0]?.c2Score} (medium), extraction attempted, 0 events`,
      hypothesis: `C2 density är för låg för säker extraction men > 0. Events finns kanske på flera sidor. C3 behöver aggregera över multipla candidate URLs.`,
      concreteFix: `I run-dynamic-pool.ts: när c2Score mellan 20-80 och extraction ger 0 events, försök extrahera från ALLA c0.candidate URLs (ej bara winner) och aggregera results.`,
      affectedCStage: 'C3',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      confidence: 0.60,
      generalizationRisk: 'medium',
      sources: uniqueSrcIds(c2MediumFailed),
      examples: c2MediumFailed.slice(0, 5),
    });
    log(`  + C2_MEDIUM_EXTRACTION_FAILED_NEEDS_MULTIPAGE: ${c2MediumFailed.length} sources, conf=0.60`);
  }

  return patterns;
}

// =============================================================================
// CODE CHANGE ENGINE
// =============================================================================

const CODE_CHANGES: CodeChange[] = [
  // PATTERN 1: C2 promising → use C2 HTML for extraction
  {
    patternId: 'C2_PROMISING_EXTRACTION_ZERO',
    before: `    const extHtml = c1.html ?? c2.html ?? '';`,
    after: `    // v3 FIX: Prefer C2 HTML when density is high — C2 has already selected the best page
    const c2Score = c2.score ?? 0;
    const extHtml = (c2Score > 50 && c2.html) ? c2.html : (c1.html ?? c2.html ?? '');`,
  },
  // PATTERN 2: Swedish patterns → bypass D-route
  {
    patternId: 'SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE',
    before: `    const c1Dsignal =\n      c1.likelyJsRendered &&\n      (c1.timeTagCount === 0 || c1.dateCount === 0 || c1.categorization === 'noise') &&\n      !c0FoundSubpageWinner;`,
    after: `    // v3 FIX: Swedish pattern subpages and high-density C2 bypass D-route
    const swedishPatternFound = (c0?.ruleApplied?.source === 'swedish-patterns' || c0?.ruleApplied?.source === 'derived-rule');
    const highDensityC2 = (c2Score ?? 0) > 50;
    const c1Dsignal =\n      c1.likelyJsRendered &&\n      (c1.timeTagCount === 0 || c1.dateCount === 0 || c1.categorization === 'noise') &&\n      !c0FoundSubpageWinner &&\n      !swedishPatternFound &&\n      !highDensityC2;`,
  },
  // PATTERN 3: C0 candidates but C2 zero → use C0 winner URL for C2
  {
    patternId: 'C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY',
    before: `    const targetUrl = c0?.winner?.url || source.url;`,
    after: `    // v3 FIX: If C0 found candidates but C2 score is 0, use C0 winner URL for C2
    // C0's winner has event density — entry page may not
    const c0WinnerUrl = c0?.winner?.url;
    const c0FoundCandidates = (c0?.candidatesFound ?? 0) > 0;
    const targetUrl = (c0FoundCandidates && c0WinnerUrl) ? c0WinnerUrl : (c0?.winner?.url || source.url);`,
  },
];

function findCodeChange(patternId: string): CodeChange | undefined {
  return CODE_CHANGES.find(c => c.patternId === patternId);
}

function scopeCheck(filePath: string): boolean {
  if (!filePath.includes('C-htmlGate')) return false;
  const forbidden = ['scheduler.ts', 'D-renderGate', 'preUI', 'BullMQ', 'Supabase', 'services/', 'UI/'];
  for (const f of forbidden) {
    if (filePath.includes(f)) return false;
  }
  return true;
}

interface ApplyResult { success: boolean; applied: boolean; reason: string; backupPath?: string; }

function applyCodeChange(imp: ImprovementAttempt): ApplyResult {
  if (!existsSync(imp.affectedFile)) return { success: false, applied: false, reason: 'File not found' };
  if (!scopeCheck(imp.affectedFile)) return { success: false, applied: false, reason: 'Scope violation' };

  const change = findCodeChange(imp.experiment);
  if (!change) {
    log(`  No auto-apply for: ${imp.experiment}`);
    log(`  Fix: ${imp.concreteFix.substring(0, 150)}`);
    return { success: false, applied: false, reason: 'No auto-apply rule — manual code change required' };
  }

  const content = readFileSync(imp.affectedFile, 'utf8');

  if (!content.includes(change.before)) {
    warn(`Search string NOT found in ${imp.affectedFile.split('/').pop()}`);
    warn(`Looking for: ${change.before.substring(0, 80)}`);
    return { success: false, applied: false, reason: 'Search string not found — code may have changed' };
  }

  const backupPath = `${imp.affectedFile}.123-backup-${imp.id}`;
  writeFileSync(backupPath, content);
  log(`  Backup: ${backupPath.split('/').pop()}`);

  const newContent = content.replace(change.before, change.after);
  writeFileSync(imp.affectedFile, newContent);
  log(`  APPLIED: ${imp.experiment}`);

  return { success: true, applied: true, reason: 'Applied', backupPath };
}

function rollbackCodeChange(imp: ImprovementAttempt, backupPath?: string): void {
  if (!backupPath || !existsSync(backupPath)) {
    warn('No backup to restore');
    return;
  }
  const content = readFileSync(backupPath, 'utf8');
  writeFileSync(imp.affectedFile, content);
  log(`  ROLLED BACK: ${imp.experiment}`);
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

function loadState(): ImprovementStateFile {
  return readJson<ImprovementStateFile>(PATHS.IMPROVEMENT_STATE, {
    version: 1,
    lastUpdated: new Date().toISOString(),
    currentState: 'none',
    currentImprovement: null,
    completedImprovements: [],
    failedImprovements: [],
    blockedByBug: [
      { bugId: 'STEP3-CHAIN-BUG', description: 'Sources generating rules in round N are forced to stay in retry-pool via STEP3-CHAIN. When poolRoundNumber=3 is reached, loop terminates WITH these sources still in retry-pool.', status: 'acknowledged' },
      { bugId: '361-SOURCES-STUCK', description: '361 sources wrongly marked ingestionStage=failed. They were reset on 2026-04-08 but never re-processed. Re-queuer fixes this.', status: 'open' },
    ],
  });
}

function saveState(state: ImprovementStateFile): void {
  state.lastUpdated = new Date().toISOString();
  writeJson(PATHS.IMPROVEMENT_STATE, state);
}

function nextImpId(state: ImprovementStateFile): string {
  const used = new Set<string>();
  for (const i of state.completedImprovements) used.add(i.id);
  for (const i of state.failedImprovements) used.add(i.id);
  if (state.currentImprovement) used.add(state.currentImprovement.id);
  let n = 1;
  while (used.has('IMP-' + String(n).padStart(3, '0'))) n++;
  return 'IMP-' + String(n).padStart(3, '0');
}

function getCompletedKeys(state: ImprovementStateFile): Set<string> {
  const s = new Set<string>();
  for (const i of state.completedImprovements) { s.add(i.experiment); s.add(i.patternKey); }
  for (const i of state.failedImprovements) { s.add(i.experiment); s.add(i.patternKey); }
  return s;
}

function patternToImprovement(pattern: FailurePattern, state: ImprovementStateFile): ImprovementAttempt | null {
  const done = getCompletedKeys(state);
  if (done.has(pattern.patternId) || done.has(pattern.patternKey)) {
    log(`  Skipped (already done): ${pattern.patternId}`);
    return null;
  }

  const allSources = pattern.sources;
  return {
    id: nextImpId(state),
    experiment: pattern.patternId,
    patternKey: pattern.patternKey,
    description: pattern.htmlFingerprint,
    confidence: pattern.confidence >= 0.70 ? 'high' : pattern.confidence >= 0.65 ? 'medium' : 'low',
    generalizationRisk: pattern.generalizationRisk,
    hypothesis: pattern.hypothesis,
    concreteFix: pattern.concreteFix,
    affectedCStage: pattern.affectedCStage,
    affectedFile: pattern.affectedFile,
    verificationSources: allSources.slice(0, 5),
    regressionSources: allSources.filter(s => !allSources.slice(0, 5).includes(s)).slice(0, 5),
    createdAt: new Date().toISOString(),
  };
}

// =============================================================================
// BATCH RUNNER
// =============================================================================

function runDynamicBatch(): { success: boolean; batchId: string } {
  try {
    const cmd = `cd "${PROJECT_ROOT}" && npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts`;
    log(`Running batch: ${cmd.substring(0, 80)}...`);
    const output = execSync(cmd, { timeout: 600000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const match = output.match(/batch-(\d+)/);
    const batchId = match ? 'batch-' + match[1] : 'unknown';
    log(`Batch completed: ${batchId}`);
    return { success: true, batchId };
  } catch (e: unknown) {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    warn('Batch error: ' + (err.stdout || err.stderr || err.message || '').substring(0, 300));
    return { success: false, batchId: 'unknown' };
  }
}

// =============================================================================
// IMPACT ANALYSIS
// =============================================================================

function analyzeImpact(imp: ImprovementAttempt, batchId: string): {
  improved: string[]; unchanged: string[]; regressed: string[];
  net: number; decision: 'keep' | 'rollback';
} {
  const poolPath = join(REPORTS_DIR, batchId, 'pool-state.json');
  const poolData = readJson<PoolStateData>(poolPath, { active: [], exited: [], failed: [] });
  if (!poolData) return { improved: [], unchanged: [], regressed: [], net: 0, decision: 'rollback' };

  const improved: string[] = [];
  const unchanged: string[] = [];
  const regressed: string[] = [];
  const target = new Set<string>();
  for (const s of imp.verificationSources) target.add(s);

  for (const ex of poolData.exited) {
    const sid = ex.source?.sourceId || '';
    if (!target.has(sid)) continue;
    const events = ((ex.result as Record<string, unknown>)?.extract as Record<string, unknown>)?.eventsFound as number || 0;
    if (events > 0) {
      improved.push(sid);
      log(`    IMPROVED: ${sid} → ${events} events`);
    } else {
      unchanged.push(sid);
    }
  }

  const net = improved.length - regressed.length;
  const decision: 'keep' | 'rollback' = improved.length >= 1 && regressed.length === 0 ? 'keep' : 'rollback';
  log(`  Impact: improved=${improved.length} unchanged=${unchanged.length} net=${net} → ${decision}`);
  return { improved, unchanged, regressed, net, decision };
}

// =============================================================================
// AUTONOMOUS LOOP
// =============================================================================

interface LoopResult {
  iterations: number;
  activated: number;
  rolledBack: number;
  patternsFound: number;
  message: string;
}

function runAutonomousLoop(maxIter = 3): LoopResult {
  section('123 AUTONOMOUS LOOP');

  const state = loadState();
  log(`State: ${state.currentState}`);

  // Check postB-preC
  const precCount = readLines(PATHS.POSTB_PREC).length;
  log(`postB-preC: ${precCount} sources`);

  if (precCount === 0) {
    warn('postB-preC is empty. Run --requeue first to populate the queue.');
    return { iterations: 0, activated: 0, rolledBack: 0, patternsFound: 0, message: 'No sources in queue' };
  }

  // Run a fresh batch to get current data
  log('Running fresh batch for pattern analysis...');
  const br = runDynamicBatch();
  if (!br.success) {
    return { iterations: 0, activated: 0, rolledBack: 0, patternsFound: 0, message: 'Batch failed' };
  }

  // Load outcomes and build patterns
  const outcomes = loadRecentBatchOutcomes(5);
  log(`Loaded ${outcomes.length} batch outcomes`);

  const patterns = buildPatterns(outcomes);
  log(`Found ${patterns.length} failure patterns`);

  const result: LoopResult = {
    iterations: 0,
    activated: state.completedImprovements.length,
    rolledBack: state.failedImprovements.length,
    patternsFound: patterns.length,
    message: '',
  };

  // Eligible: conf >= 0.70, OR (conf >= 0.65 AND sources >= 4)
  const eligible = patterns.filter(p =>
    (p.confidence >= 0.70 || (p.confidence >= 0.65 && p.sources.length >= 4)) &&
    p.generalizationRisk !== 'high' &&
    !getCompletedKeys(state).has(p.patternId) &&
    !getCompletedKeys(state).has(p.patternKey)
  );

  log(`Eligible: ${eligible.length} patterns`);

  for (let i = 0; i < eligible.length && result.iterations < maxIter; i++) {
    const pattern = eligible[i];
    const imp = patternToImprovement(pattern, state);
    if (!imp) continue;

    log(`\n--- Iteration ${result.iterations}: ${pattern.patternId} ---`);
    log(`  Hypothesis: ${imp.hypothesis.substring(0, 100)}`);
    log(`  Stage: ${imp.affectedCStage} | Sources: ${imp.verificationSources.join(', ')}`);

    // Apply code change
    const codeResult = applyCodeChange(imp);
    if (!codeResult.applied) {
      log(`  SKIPPED: ${codeResult.reason}`);
      continue;
    }

    // Run verification batch
    log('  Running verification batch...');
    const br2 = runDynamicBatch();
    const batchId = br2.success ? br2.batchId : 'unknown';

    // Measure impact
    const impact = analyzeImpact(imp, batchId);

    if (impact.decision === 'keep') {
      // Mark improvement as active
      const newState = loadState();
      if (!newState.currentImprovement) {
        newState.currentImprovement = imp;
      }
      newState.currentState = 'active';
      imp.verifiedAt = new Date().toISOString();
      imp.activatedAt = new Date().toISOString();
      imp.verificationResult = {
        batchId,
        improvedSources: impact.improved,
        unchangedSources: impact.unchanged,
        regressedSources: impact.regressed,
        netImprovement: impact.net,
        decision: 'keep',
      };
      newState.completedImprovements.push(imp);
      saveState(newState);
      result.activated++;
      log(`  ACTIVATED: ${imp.id}`);
    } else {
      // Rollback
      rollbackCodeChange(imp, codeResult.backupPath);
      const newState = loadState();
      if (!newState.currentImprovement) {
        newState.currentImprovement = imp;
      }
      newState.currentState = 'rolled_back';
      imp.rolledBackAt = new Date().toISOString();
      imp.rollbackReason = 'no sources improved';
      imp.verificationResult = {
        batchId,
        improvedSources: impact.improved,
        unchangedSources: impact.unchanged,
        regressedSources: impact.regressed,
        netImprovement: impact.net,
        decision: 'rollback',
      };
      newState.failedImprovements.push(imp);
      saveState(newState);
      result.rolledBack++;
      log(`  ROLLED BACK: ${imp.id}`);
    }

    result.iterations++;
  }

  result.message = `iterations=${result.iterations}, activated=${result.activated}, rolledBack=${result.rolledBack}, patterns=${result.patternsFound}`;
  log(`\n${result.message}`);
  return result;
}

// =============================================================================
// MAIN CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.length === 0) {
    const d = diagnoseSystem();
    printDiagnostics(d);

    // Show improvement status
    const state = loadState();
    if (state.completedImprovements.length > 0 || state.failedImprovements.length > 0) {
      console.log('\n--- Improvements ---');
      for (const imp of state.completedImprovements.slice(-5)) {
        console.log(`  [OK] ${imp.id}: ${imp.experiment} (${imp.affectedCStage})`);
      }
      for (const imp of state.failedImprovements.slice(-3)) {
        console.log(`  [X] ${imp.id}: ${imp.experiment} — ${imp.rollbackReason}`);
      }
    }
    if (state.blockedByBug.filter(b => b.status === 'open').length > 0) {
      console.log('\n--- Open Bugs ---');
      for (const b of state.blockedByBug.filter(b => b.status === 'open')) {
        console.log(`  ! ${b.bugId}: ${b.description.substring(0, 80)}`);
      }
    }

    // Show recent batch patterns
    const outcomes = loadRecentBatchOutcomes(3);
    const patterns = buildPatterns(outcomes);
    console.log(`\n--- Patterns in recent batches: ${patterns.length} ---`);
    for (const p of patterns) {
      const eligible = (p.confidence >= 0.70 || (p.confidence >= 0.65 && p.sources.length >= 4)) && p.generalizationRisk !== 'high';
      console.log(`  ${eligible ? '[+]' : '[-]'} [${p.patternId}] ${p.category} conf=${p.confidence} — ${p.sources.length} sources`);
      console.log(`      Fix: ${p.concreteFix.substring(0, 100)}`);
    }
    return;
  }

  if (args.includes('--requeue')) {
    section('RE-QUEUING SOURCES');
    const stats = requeueSources();
    console.log('\n--- Requeue Summary ---');
    console.log(`  manual-review re-queued: ${stats.requeuedManualReview}`);
    console.log(`  failed (no error) re-queued: ${stats.requeuedFailedNoError}`);
    console.log(`  failed (retryable) re-queued: ${stats.requeuedFailedRetryable}`);
    console.log(`  total re-queued: ${stats.requeuedManualReview + stats.requeuedFailedNoError + stats.requeuedFailedRetryable}`);
    return;
  }

  if (args.includes('--dry-run')) {
    section('DRY RUN');
    const outcomes = loadRecentBatchOutcomes(5);
    const patterns = buildPatterns(outcomes);
    console.log(`\n${patterns.length} patterns detected:`);
    for (const p of patterns) {
      const change = findCodeChange(p.patternId);
      const eligible = (p.confidence >= 0.70 || (p.confidence >= 0.65 && p.sources.length >= 4)) && p.generalizationRisk !== 'high';
      console.log(`\n  ${eligible ? '[+]' : '[-]'} ${p.patternId} (${p.category}) conf=${p.confidence}`);
      console.log(`    Sources: ${p.sources.length}`);
      console.log(`    Auto-apply: ${change ? 'YES' : 'NO'}`);
      console.log(`    Fix: ${p.concreteFix.substring(0, 120)}`);
    }
    return;
  }

  if (args.includes('--loop')) {
    let maxIter = 3;
    for (const a of args) {
      if (a.startsWith('--max-iter=')) maxIter = parseInt(a.split('=')[1] || '3', 10);
    }
    section('123 AUTONOMOUS LOOP');
    const result = runAutonomousLoop(maxIter);
    section('LOOP COMPLETE');
    console.log(result.message);
    return;
  }

  if (args.includes('--batch')) {
    section('RUNNING SINGLE BATCH');
    const br = runDynamicBatch();
    console.log(br.success ? `Success: ${br.batchId}` : 'Failed');
    return;
  }

  if (args.includes('--reset')) {
    const state: ImprovementStateFile = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      currentState: 'none',
      currentImprovement: null,
      completedImprovements: [],
      failedImprovements: [],
      blockedByBug: [
        { bugId: 'STEP3-CHAIN-BUG', description: 'Sources generating rules in round N are forced to stay in retry-pool via STEP3-CHAIN. When poolRoundNumber=3 is reached, loop terminates WITH these sources still in retry-pool.', status: 'acknowledged' },
        { bugId: '361-SOURCES-STUCK', description: '361 sources wrongly marked ingestionStage=failed. They were reset on 2026-04-08 but never re-processed.', status: 'open' },
      ],
    };
    saveState(state);
    writeFileSync(PATHS.IMPROVEMENT_STATE, JSON.stringify(state, null, 2));
    console.log('State reset. Note: --reset only resets 123 loop state, not runtime queues.');
    return;
  }

  // Help
  console.log(`
123 System — Complete Source Processing Engine
==============================================
Usage:
  npx tsx 02-Ingestion/C-htmlGate/123-system.ts --status       # Full system diagnostics
  npx tsx 02-Ingestion/C-htmlGate/123-system.ts --requeue     # Re-queue stuck sources
  npx tsx 02-Ingestion/C-htmlGate/123-system.ts --loop        # Run improvement loop
  npx tsx 02-Ingestion/C-htmlGate/123-system.ts --dry-run     # Show what patterns exist
  npx tsx 02-Ingestion/C-htmlGate/123-system.ts --batch       # Run single batch
  npx tsx 02-Ingestion/C-htmlGate/123-system.ts --reset        # Reset loop state

Recommended workflow:
  1. --status     (see what's broken)
  2. --requeue    (fix the 361 stuck sources)
  3. --batch      (verify batch runs with re-queued sources)
  4. --loop       (run the improvement loop)
`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
