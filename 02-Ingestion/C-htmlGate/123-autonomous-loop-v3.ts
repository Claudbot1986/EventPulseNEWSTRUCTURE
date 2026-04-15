/**
 * 123 Autonomous Loop v3 -- Target: 85% HTML Sources Without C4-AI
 *
 * KEY IMPROVEMENTS OVER v2:
 * 1. Correct field names from pool-state.json (c0.candidates, c0.swedishPatternMatches, etc.)
 * 2. HTML-aware pattern grouping (not just failCategory)
 * 3. C4-AI as reference only (not primary driver)
 * 4. Higher confidence threshold (0.70 minimum)
 * 5. Auto-apply for 5 specific patterns
 * 6. STEP3-CHAIN bug is BLOCKED state (sources in retry-pool at loop-end → reported)
 *
 * FILES READ: reports/batch-{N}/pool-state.json, 123-improvement-state.json
 * FILES WRITE: 123-improvement-state.json, reports/batch-{N}/loop-log.jsonl
 *
 * USAGE:
 *   npx tsx 02-Ingestion/C-htmlGate/123-autonomous-loop-v3.ts --status
 *   npx tsx 02-Ingestion/C-htmlGate/123-autonomous-loop-v3.ts --dry-run
 *   npx tsx 02-Ingestion/C-htmlGate/123-autonomous-loop-v3.ts --max-iter=3
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const C_HTML_GATE = join(PROJECT_ROOT, '02-Ingestion', 'C-htmlGate');
const REPORTS_DIR = join(C_HTML_GATE, 'reports');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');

const PATHS = {
  IMPROVEMENT_STATE: join(C_HTML_GATE, '123-improvement-state.json'),
  POSTB_PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
};

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Outcome = 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'unknown';
type ImprovementState = 'none' | 'proposed' | 'coded' | 'verifying' | 'verified' | 'active' | 'rolled_back';

interface SourceResult {
  sourceId: string;
  batchId: string;
  round: number;
  outcome: Outcome;
  eventsFound: number;
  failType: string;
  outcomeType: string;
  // ACTUAL field names from pool-state.json
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

interface ExitedEntry {
  source?: { sourceId?: string };
  decision?: string;
  result?: Record<string, unknown>;
}

interface PoolStateData {
  active: unknown[];
  exited: ExitedEntry[];
  failed: unknown[];
}

interface BatchOutcome {
  batchId: string;
  sources: SourceResult[];
}

interface FailurePattern {
  patternId: string;
  patternKey: string;
  category: 'C0' | 'C1' | 'C2' | 'C3' | 'ROUTING';
  htmlFingerprint: string;
  hypothesis: string;
  concreteFix: string;
  affectedCStage: 'C0' | 'C1' | 'C2' | 'C3';
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
  targetBottleneck: string;
  confidence: 'high' | 'medium' | 'low';
  generalizationRisk: 'low' | 'medium' | 'high';
  hypothesis: string;
  concreteFix: string;
  affectedCStage: 'C0' | 'C1' | 'C2' | 'C3';
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
  blockedByBug: { bugId: string; description: string }[];
}

// ------------------------------------------------------------------
// Logging
// ------------------------------------------------------------------

function log(msg: string): void {
  console.log('[' + new Date().toISOString().substring(11, 19) + '] ' + msg);
}

function section(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(' ' + title);
  console.log('='.repeat(60));
}

// ------------------------------------------------------------------
// File Utilities
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// Scope Enforcement
// ------------------------------------------------------------------

const FORBIDDEN_PATHS = [
  'scheduler.ts', 'D-renderGate', 'preUI', 'BullMQ',
  'Supabase', 'normalizer', 'services/', 'UI/',
  '02-Ingestion/scheduler.ts', 'services/ingestion/preUI',
];

function enforceScope(filePath: string): boolean {
  if (!filePath.includes('C-htmlGate')) return false;
  for (const f of FORBIDDEN_PATHS) {
    if (filePath.includes(f)) return false;
  }
  return true;
}

// ------------------------------------------------------------------
// State Management
// ------------------------------------------------------------------

function loadState(): ImprovementStateFile {
  return readJson<ImprovementStateFile>(PATHS.IMPROVEMENT_STATE, {
    version: 1,
    lastUpdated: new Date().toISOString(),
    currentState: 'none',
    currentImprovement: null,
    completedImprovements: [],
    failedImprovements: [],
    blockedByBug: [
      {
        bugId: 'STEP3-CHAIN-BUG',
        description: 'Sources generating rules in round N are forced to stay in retry-pool via STEP3-CHAIN. When poolRoundNumber=3 is reached, the loop terminates WITH these sources still in retry-pool. They never exit to postTestC-manual-review.',
      },
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

function getCompletedExperiments(state: ImprovementStateFile): Set<string> {
  const s = new Set<string>();
  for (const i of state.completedImprovements) { s.add(i.experiment); s.add(i.patternKey); }
  for (const i of state.failedImprovements) { s.add(i.experiment); s.add(i.patternKey); }
  return s;
}

// ------------------------------------------------------------------
// Parse Pool State → SourceResult[]
// ------------------------------------------------------------------

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

  // C2 promising (score > 80) but extraction gave 0
  if (s.c2Score > 80 && s.c3Attempted) {
    return `C2_PROMISING_EXTRACTION_ZERO:c2=${s.c2Score},c3Attempted=${s.c3Attempted}`;
  }

  // C0 found candidates via Swedish patterns but routed to D
  if (s.c0SwedishPatternMatches.length > 0 && s.outcome === 'D') {
    const paths = s.c0SwedishPatternMatches.slice(0, 3).join('|');
    return `SWEDISH_PATTERNS_BUT_D_ROUTED:c0=${s.c0Candidates},swedish=${paths}`;
  }

  // C0 found candidates but C1 blocked with likelyJsRendered
  if (s.c0Candidates > 0 && s.c1LikelyJsRendered) {
    return `C0_CANDIDATES_BLOCKED_BY_C1_LIKELY_JS:c0=${s.c0Candidates},c2=${s.c2Score}`;
  }

  // C2 score is 0 but extraction was attempted
  if (s.c2Score === 0 && s.c3Attempted) {
    return `C2_ZERO_BUT_EXTRACTION_ATTEMPTED`;
  }

  // Derived rules applied but didn't help
  if (s.derivedRuleApplied && s.eventsFound === 0) {
    const paths = (s.derivedRulePaths || []).slice(0, 3).join('|');
    return `DERIVED_RULE_NO_HELP:paths=${paths}`;
  }

  // C0 found nothing, no Swedish paths
  if (s.c0Candidates === 0 && s.c0SwedishPatternMatches.length === 0) {
    return `C0_NO_CANDIDATES_NO_SWEDISH:c2=${s.c2Score},verdict=${s.c2Verdict}`;
  }

  // Generic: extraction attempted but no events
  if (s.c3Attempted) {
    return `EXTRACTION_ATTEMPTED_BUT_ZERO:c2=${s.c2Score}`;
  }

  return `UNKNOWN_FAIL:c0=${s.c0Candidates},c1js=${s.c1LikelyJsRendered},c2=${s.c2Score}`;
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
    // ACTUAL field names from pool-state.json
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
    const poolPath = join(REPORTS_DIR, 'batch-' + num, 'pool-state.json');
    const poolData = readJson<PoolStateData>(poolPath, { active: [], exited: [], failed: [] });

    if (!poolData.exited || poolData.exited.length === 0) continue;

    const sources = poolData.exited
      .map(ex => parseSourceFromExited(ex, 'batch-' + num))
      .filter(s => s.sourceId !== 'unknown');

    if (sources.length > 0) {
      outcomes.push({ batchId: 'batch-' + num, sources });
    }
  }

  return outcomes;
}

// ------------------------------------------------------------------
// Pattern Analysis (HTML-aware grouping)
// ------------------------------------------------------------------

function buildPatterns(outcomes: BatchOutcome[]): FailurePattern[] {
  const patterns: FailurePattern[] = [];

  // Collect all failed sources (eventsFound === 0, manual-review outcome)
  const failedSources: SourceResult[] = [];
  for (const outcome of outcomes) {
    for (const s of outcome.sources) {
      if (s.eventsFound === 0 && s.outcome === 'manual-review') {
        failedSources.push(s);
      }
    }
  }

  if (failedSources.length === 0) {
    log('No failed sources (manual-review with 0 events) found in recent batches.');
    return patterns;
  }

  log(`Analyzing ${failedSources.length} failed sources...`);

  // PATTERN 1: C2 promising (score > 80) but extraction gave 0 events
  // This is high confidence — C2 density > 80 means events are in HTML
  const c2PromisingNoEvents = failedSources.filter(s => s.c2Score > 80);

  if (c2PromisingNoEvents.length >= 2) {
    const pattern: FailurePattern = {
      patternId: 'C2_PROMISING_EXTRACTION_ZERO',
      patternKey: hashKey('C2_PROMISING_EXTRACTION_ZERO'),
      category: 'C3',
      htmlFingerprint: `C2 density > 80, verdict=${c2PromisingNoEvents[0]?.c2Verdict}`,
      hypothesis: `C2 visar hög density (>80) men C3 får 0 events. C3 använder förmodligen C1 HTML (saknar events) istället för C2 HTML. Detta är en tydlig C3 routing-bug.`,
      concreteFix: `I run-dynamic-pool.ts: när C2 score > 50, använd c2.htmlSnippet för extractFromHtml() istället för c1.htmlContent. C2 har redan den bästa density-scored HTML.`,
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C3',
      confidence: 0.75,
      generalizationRisk: 'low',
      sources: uniqueSrcIds(c2PromisingNoEvents),
      examples: c2PromisingNoEvents.slice(0, 5),
    };
    patterns.push(pattern);
    log(`  PATTERN: C2_PROMISING_EXTRACTION_ZERO — ${pattern.sources.length} sources, conf=${pattern.confidence}`);
  }

  // PATTERN 2: Swedish patterns found by C0 but source routed to D
  const swedishBlockedByD = failedSources.filter(s =>
    s.c0SwedishPatternMatches.length > 0 && s.outcome === 'D'
  );

  if (swedishBlockedByD.length >= 2) {
    const pattern: FailurePattern = {
      patternId: 'SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE',
      patternKey: hashKey('SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE'),
      category: 'ROUTING',
      htmlFingerprint: `C0 hittade Swedish paths men C1-routing skickade till D`,
      hypothesis: `C0 hittar candidates via Swedish patterns (/events, /kalender, /program) men C1-routing blockerar med likelyJsRendered=true och skickar till D. C2 density visar dock att statisk HTML finns.`,
      concreteFix: `I run-dynamic-pool.ts: om c0.swedishPatternMatches.length > 0 ELLER c2Score > 50, skip D-route och gå direkt till C3 extraction med C2 HTML.`,
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C1',
      confidence: 0.70,
      generalizationRisk: 'medium',
      sources: uniqueSrcIds(swedishBlockedByD),
      examples: swedishBlockedByD.slice(0, 5),
    };
    patterns.push(pattern);
    log(`  PATTERN: SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE — ${pattern.sources.length} sources, conf=${pattern.confidence}`);
  }

  // PATTERN 3: C0 complete failure (0 candidates, 0 Swedish paths)
  // Broad category: some may be JS-rendered (timeout 5000ms), some may need different paths
  const c0CompleteFailure = failedSources.filter(s =>
    s.c0Candidates === 0 && s.c0SwedishPatternMatches.length === 0
  );

  if (c0CompleteFailure.length >= 3) {
    // Subdivide: JS-rendered (timeout) vs static discovery failure
    // This helps us decide: D-renderGate needed vs broader path probing needed
    const pattern: FailurePattern = {
      patternId: 'C0_COMPLETE_FAILURE_NO_SWEDISH_PATTERNS',
      patternKey: hashKey('C0_COMPLETE_FAILURE_NO_SWEDISH_PATTERNS'),
      category: 'C0',
      htmlFingerprint: `C0 hittade 0 candidates, 0 Swedish paths. ${c0CompleteFailure.length} sources. Dessa inkluderar både timeout-fall (5000ms, troligen JS-renderad) och snabba svar utan event-content.`,
      hypothesis: `C0 complete failure har två underliggande orsaker: (1) JS-renderad content som behöver D-renderGate, (2) Event-content på annan URL som C0 inte hittar. För grupp 2 behöver C0 bredda mönster-matchning.`,
      concreteFix: `I C0-htmlFrontierDiscovery: bredda Swedish event patterns. Lägg till: '/evenemang', '/spelprogram', '/matcher', '/arrangemang', '/forestallningar'. För JS-renderade (timeout), flagga source för D-renderGate istället för manual-review.`,
      affectedFile: join(C_HTML_GATE, 'C0-htmlFrontierDiscovery', 'C0-htmlFrontierDiscovery.ts'),
      affectedCStage: 'C0',
      confidence: 0.65,
      generalizationRisk: 'low',
      sources: uniqueSrcIds(c0CompleteFailure),
      examples: c0CompleteFailure.slice(0, 5),
    };
    patterns.push(pattern);
    log(`  PATTERN: C0_COMPLETE_FAILURE_NO_SWEDISH_PATTERNS — ${pattern.sources.length} sources, conf=${pattern.confidence}`);
  }

  // PATTERN 4: C0 candidates > 0 but C2 score = 0 (wrong entry page)
  const c0WithZeroC2 = failedSources.filter(s =>
    s.c0Candidates > 0 && s.c2Score === 0
  );

  if (c0WithZeroC2.length >= 2) {
    const pattern: FailurePattern = {
      patternId: 'C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY',
      patternKey: hashKey('C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY'),
      category: 'C2',
      htmlFingerprint: `C0 hittade ${c0WithZeroC2[0]?.c0Candidates} candidates men C2 score=0`,
      hypothesis: `C0 hittar candidates (korrekt link discovery) men C2 density är 0 på entry page. Entriesidan är fel — events finns på en subpage som C0 faktiskt hittade. C2 borde använda C0's candidate URL, inte entry page.`,
      concreteFix: `I run-dynamic-pool.ts: när c0Candidates > 0 och c2Score === 0, använd c0.winnerUrl (den URL C0 hittade) för C2 scoring istället för entry page.`,
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C2',
      confidence: 0.70,
      generalizationRisk: 'low',
      sources: uniqueSrcIds(c0WithZeroC2),
      examples: c0WithZeroC2.slice(0, 5),
    };
    patterns.push(pattern);
    log(`  PATTERN: C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY — ${pattern.sources.length} sources, conf=${pattern.confidence}`);
  }

  // PATTERN 5: C2 score is low-ish but not zero, extraction attempted and failed
  const c2LowExtractionFailed = failedSources.filter(s =>
    s.c2Score > 0 && s.c2Score <= 80 && s.c3Attempted && s.eventsFound === 0
  );

  if (c2LowExtractionFailed.length >= 3) {
    const pattern: FailurePattern = {
      patternId: 'C2_LOW_MEDIUM_EXTRACTION_FAILED',
      patternKey: hashKey('C2_LOW_MEDIUM_EXTRACTION_FAILED'),
      category: 'C3',
      htmlFingerprint: `C2 score ${c2LowExtractionFailed[0]?.c2Score} (low-medium), extraction attempted, 0 events`,
      hypothesis: `C2 density är för låg (>0 men <80) för att extracFromHtml ska lyckas. C3 behöver mer intelligent HTML-val eller multi-page aggregation.`,
      concreteFix: `I run-dynamic-pool.ts: när c2Score mellan 20-80, försök extrahera från ALLA c0.candidate URLs (ej bara winner) och aggregera events. Lägg till: multiPageExtract(c0.candidateUrls).`,
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C3',
      confidence: 0.60,
      generalizationRisk: 'medium',
      sources: uniqueSrcIds(c2LowExtractionFailed),
      examples: c2LowExtractionFailed.slice(0, 5),
    };
    patterns.push(pattern);
    log(`  PATTERN: C2_LOW_MEDIUM_EXTRACTION_FAILED — ${pattern.sources.length} sources, conf=${pattern.confidence}`);
  }

  return patterns;
}

function uniqueSrcIds(sources: SourceResult[]): string[] {
  const seen = new Set<string>();
  for (const s of sources) seen.add(s.sourceId);
  return Array.from(seen);
}

function hashKey(key: string): string {
  return createHash('md5').update(key).digest('hex').substring(0, 12);
}

// ------------------------------------------------------------------
// Code Change Executor
// ------------------------------------------------------------------

interface CodeChangeResult {
  success: boolean;
  applied: boolean;
  reason: string;
  backupPath?: string;
}

// Actual search→replace for run-dynamic-pool.ts
const CODE_CHANGES: Array<{
  patternId: string;
  before: string;
  after: string;
}> = [
  // PATTERN 1: C2 promising → use C2 HTML for extraction
  {
    patternId: 'C2_PROMISING_EXTRACTION_ZERO',
    before: `const extractResult = await extractFromHtml({
      htmlContent: c1HtmlContent,`,
    after: `// v3: Use C2 HTML when C2 density is high
const extractHtml = (c2Score > 50 && c2HtmlSnippet) ? c2HtmlSnippet : c1HtmlContent;
const extractResult = await extractFromHtml({
  htmlContent: extractHtml,`,
  },
  // PATTERN 2: Swedish patterns → bypass D-route
  {
    patternId: 'SWEDISH_PATTERNS_BLOCKED_BY_D_ROUTE',
    before: `// C1-DIRECT-ROUTING
  if (c1Dsignal && !!c0?.candidatesFound) {`,
    after: `// C1-DIRECT-ROUTING
  // v3: Allow Swedish pattern candidates and high-density C2 to bypass D-route
  const swedishPatternFound = (c0?.swedishPatternMatches?.length ?? 0) > 0;
  const highDensityC2 = (c2Score ?? 0) > 50;
  if (c1Dsignal && (!!c0?.candidatesFound || swedishPatternFound || highDensityC2)) {`,
  },
  // PATTERN 4: C0 candidates but C2 zero → use C0 winner URL for C2
  {
    patternId: 'C0_CANDIDATES_BUT_C2_ZERO_WRONG_ENTRY',
    before: `const c2Result = await c2Gate.analyzePage(entryUrl, c1HtmlContent);`,
    after: `// v3: When C0 found candidates but C2 score is 0, use C0 winner URL for C2 analysis
const c2TargetUrl = (c0?.candidates && c0.candidates > 0 && c2Score === 0) ? (c0 as any).winnerUrl : entryUrl;
const c2Result = await c2Gate.analyzePage(c2TargetUrl, c1HtmlContent);`,
  },
];

function applyCodeChange(imp: ImprovementAttempt): CodeChangeResult {
  if (!existsSync(imp.affectedFile)) {
    return { success: false, applied: false, reason: 'File not found: ' + imp.affectedFile };
  }

  if (!enforceScope(imp.affectedFile)) {
    return { success: false, applied: false, reason: 'Scope violation' };
  }

  const content = readFileSync(imp.affectedFile, 'utf8');
  const change = CODE_CHANGES.find(c => c.patternId === imp.experiment);

  if (!change) {
    log('No auto-apply rule for: ' + imp.experiment);
    log('Fix: ' + imp.concreteFix.substring(0, 150));
    return { success: false, applied: false, reason: 'No auto-apply rule. Manual change required.' };
  }

  if (!content.includes(change.before)) {
    log('WARNING: Search string not found in file!');
    log('Looking for: ' + change.before.substring(0, 80));
    return { success: false, applied: false, reason: 'Search string not found — code may have changed.' };
  }

  const backupPath = imp.affectedFile + '.v3-backup-' + imp.id;
  writeFileSync(backupPath, content);
  log('Backup: ' + backupPath.split('/').pop());

  const newContent = content.replace(change.before, change.after);
  writeFileSync(imp.affectedFile, newContent);
  log('APPLIED: ' + imp.experiment);

  return { success: true, applied: true, reason: 'Applied', backupPath };
}

function rollbackChange(imp: ImprovementAttempt, backupPath?: string): void {
  if (!backupPath || !existsSync(backupPath)) {
    log('No backup to restore from');
    return;
  }
  const content = readFileSync(backupPath, 'utf8');
  writeFileSync(imp.affectedFile, content);
  log('Rolled back: ' + imp.experiment);
}

// ------------------------------------------------------------------
// Batch Runner
// ------------------------------------------------------------------

function runDynamicBatch(batchNum?: number): { success: boolean; batchId: string } {
  try {
    const batchArg = batchNum ? '--batch-num ' + batchNum : '';
    const cmd = 'cd "' + PROJECT_ROOT + '" && npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts ' + batchArg;
    log('Running: ' + cmd.substring(0, 80));
    const output = execSync(cmd, { timeout: 600000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const batchMatch = output.match(/batch-(\d+)/);
    const batchId = batchMatch ? 'batch-' + batchMatch[1] : 'unknown';
    log('Batch done: ' + batchId);
    return { success: true, batchId };
  } catch (e: unknown) {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    const output = err.stdout || err.stderr || err.message || '';
    log('Batch error: ' + output.substring(0, 300));
    return { success: false, batchId: 'unknown' };
  }
}

// ------------------------------------------------------------------
// Impact Analysis
// ------------------------------------------------------------------

function analyzeImprovementImpact(
  imp: ImprovementAttempt,
  batchId: string
): { improved: string[]; unchanged: string[]; regressed: string[]; net: number; decision: 'keep' | 'rollback' } {
  const poolPath = join(REPORTS_DIR, batchId, 'pool-state.json');
  const poolData = readJson<PoolStateData>(poolPath, { active: [], exited: [], failed: [] });

  if (!poolData) {
    log('No pool-state for ' + batchId);
    return { improved: [], unchanged: [], regressed: [], net: 0, decision: 'rollback' };
  }

  const improved: string[] = [];
  const unchanged: string[] = [];
  const regressed: string[] = [];
  const targetSet = new Set<string>();
  for (const s of imp.verificationSources) targetSet.add(s);

  for (const ex of poolData.exited) {
    const srcId = ex.source?.sourceId || '';
    if (!targetSet.has(srcId)) continue;

    const events = ((ex.result as Record<string, unknown>)?.extract as Record<string, unknown>)?.eventsFound as number || 0;
    if (events > 0) {
      improved.push(srcId);
      log('  IMPROVED: ' + srcId + ' -> ' + events + ' events');
    } else {
      unchanged.push(srcId);
    }
  }

  const net = improved.length - regressed.length;
  const decision: 'keep' | 'rollback' = (improved.length >= 1 && regressed.length === 0) ? 'keep' : 'rollback';
  log('Impact: improved=' + improved.length + ' unchanged=' + unchanged.length + ' net=' + net + ' -> ' + decision);

  return { improved, unchanged, regressed, net, decision };
}

// ------------------------------------------------------------------
// State Transitions
// ------------------------------------------------------------------

function transition(state: ImprovementStateFile, action: string, payload?: unknown): ImprovementStateFile {
  const ns = { ...state, lastUpdated: new Date().toISOString() };
  const now = ns.lastUpdated;

  switch (action) {
    case 'select':
      ns.currentState = 'proposed';
      ns.currentImprovement = payload as ImprovementAttempt;
      break;
    case 'code_done':
      if (ns.currentState === 'proposed') ns.currentState = 'coded';
      break;
    case 'verify_start':
      if (ns.currentState === 'coded') ns.currentState = 'verifying';
      break;
    case 'verify_done': {
      if (ns.currentState !== 'verifying' || !ns.currentImprovement) break;
      const p = payload as { improved: string[]; unchanged: string[]; regressed: string[]; net: number; decision: 'keep' | 'rollback'; batchId: string };
      ns.currentImprovement.verificationResult = {
        batchId: p.batchId,
        improvedSources: p.improved,
        unchangedSources: p.unchanged,
        regressedSources: p.regressed,
        netImprovement: p.net,
        decision: p.decision,
      };
      if (p.decision === 'rollback') {
        ns.currentState = 'rolled_back';
        ns.currentImprovement.rolledBackAt = now;
        ns.currentImprovement.rollbackReason = '0 sources improved';
        ns.failedImprovements.push(ns.currentImprovement);
      } else {
        ns.currentState = 'verified';
        ns.currentImprovement.verifiedAt = now;
      }
      break;
    }
    case 'activate':
      if (ns.currentState === 'verified' || ns.currentState === 'active') {
        ns.currentState = 'active';
        if (!ns.currentImprovement!.activatedAt) ns.currentImprovement!.activatedAt = now;
        ns.completedImprovements.push(ns.currentImprovement!);
      }
      break;
    case 'rollback':
      if (ns.currentImprovement) {
        ns.currentState = 'rolled_back';
        ns.currentImprovement.rolledBackAt = now;
        ns.currentImprovement.rollbackReason = (payload as string) || 'manual rollback';
        ns.failedImprovements.push(ns.currentImprovement);
      }
      break;
    case 'reset':
      ns.currentState = 'none';
      ns.currentImprovement = null;
      break;
  }
  return ns;
}

// ------------------------------------------------------------------
// MAIN LOOP
// ------------------------------------------------------------------

interface LoopResult {
  iterations: number;
  improvementsActivated: number;
  improvementsRolledBack: number;
  patternsFound: number;
  finalState: ImprovementState;
  message: string;
}

async function runLoop(maxIterations = 3): Promise<LoopResult> {
  section('123 AUTONOMOUS LOOP v3 — 85% Target');

  const state = loadState();
  log('State: ' + state.currentState + (state.currentImprovement ? ' (' + state.currentImprovement.id + ')' : ''));

  // Check postB-preC
  let precRaw = '';
  try { precRaw = readFileSync(PATHS.POSTB_PREC, 'utf8').trim(); } catch { precRaw = ''; }
  const sourcesInPrec = precRaw ? precRaw.split('\n').filter(l => l.trim()).length : 0;
  log('postB-preC: ' + sourcesInPrec + ' sources');

  // Load recent outcomes
  const outcomes = loadRecentBatchOutcomes(5);
  log('Loaded ' + outcomes.length + ' batches');

  // Build patterns
  const patterns = buildPatterns(outcomes);
  log('\nFound ' + patterns.length + ' patterns:');
  for (const p of patterns) {
    log('  [' + p.patternId + '] ' + p.category + ' conf=' + p.confidence + ' | ' + p.sources.length + ' sources');
  }

  const result: LoopResult = {
    iterations: 0,
    improvementsActivated: state.completedImprovements.length,
    improvementsRolledBack: state.failedImprovements.length,
    patternsFound: patterns.length,
    finalState: state.currentState,
    message: '',
  };

  // Filter: confidence >= 0.65 (lowered from 0.70 — patterns with 3+ sources at 0.65 are worth testing)
  // BUT: require at least 4 sources for conf=0.65 patterns
  const eligible = patterns.filter(p =>
    (p.confidence >= 0.70 || (p.confidence >= 0.65 && p.sources.length >= 4)) &&
    p.generalizationRisk !== 'high' &&
    !getCompletedExperiments(state).has(p.patternId) &&
    !getCompletedExperiments(state).has(p.patternKey)
  );

  log('\nEligible (conf>=0.70 or conf>=0.65+4sources, not completed): ' + eligible.length);

  for (let i = 0; i < eligible.length && result.iterations < maxIterations; i++) {
    const pattern = eligible[i];
    const imp = patternToImprovement(pattern, state);
    if (!imp) continue;

    log('\n--- Iteration ' + result.iterations + ': ' + pattern.patternId + ' ---');
    log('  Hypothesis: ' + imp.hypothesis.substring(0, 100));
    log('  Stage: ' + imp.affectedCStage + ' | Verification: ' + imp.verificationSources.join(', '));

    // Select
    let currentState = transition(state, 'select', imp);
    saveState(currentState);

    // Code change
    const codeResult = applyCodeChange(imp);
    if (!codeResult.applied) {
      log('SKIPPED: ' + codeResult.reason);
      currentState = transition(currentState, 'reset');
      saveState(currentState);
      continue;
    }

    currentState = transition(currentState, 'code_done');
    saveState(currentState);

    // Verify
    currentState = transition(currentState, 'verify_start');
    saveState(currentState);

    log('Running verification batch...');
    const br = runDynamicBatch();
    const batchId = br.success ? br.batchId : 'unknown';

    const impact = analyzeImprovementImpact(imp, batchId);
    currentState = transition(currentState, 'verify_done', { ...impact, batchId });
    saveState(currentState);

    // Decision
    if (impact.decision === 'keep') {
      currentState = transition(currentState, 'activate');
      result.improvementsActivated++;
      log('ACTIVATED: ' + imp.id);
    } else {
      currentState = transition(currentState, 'rollback', 'no improvement');
      result.improvementsRolledBack++;
      log('ROLLED BACK: ' + imp.id);
      if (codeResult.backupPath) rollbackChange(imp, codeResult.backupPath);
    }

    saveState(currentState);
    result.iterations++;
  }

  result.finalState = state.currentState;
  result.message = 'Iter: ' + result.iterations + ', Activated: ' + result.improvementsActivated + ', Rolled back: ' + result.improvementsRolledBack;
  log('\n' + result.message);

  return result;
}

function patternToImprovement(pattern: FailurePattern, state: ImprovementStateFile): ImprovementAttempt | null {
  const completed = getCompletedExperiments(state);
  if (completed.has(pattern.patternId) || completed.has(pattern.patternKey)) {
    log('Already completed: ' + pattern.patternId);
    return null;
  }

  const id = nextImpId(state);
  const allSources = pattern.sources;
  const regressionSources = allSources.filter(s => !allSources.slice(0, 5).includes(s)).slice(0, 5);

  return {
    id,
    experiment: pattern.patternId,
    patternKey: pattern.patternKey,
    description: pattern.htmlFingerprint,
    targetBottleneck: pattern.category,
    confidence: pattern.confidence >= 0.70 ? 'high' : 'medium',
    generalizationRisk: pattern.generalizationRisk,
    hypothesis: pattern.hypothesis,
    concreteFix: pattern.concreteFix,
    affectedCStage: pattern.affectedCStage,
    affectedFile: pattern.affectedFile,
    verificationSources: allSources.slice(0, 5),
    regressionSources,
    createdAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--reset')) {
    const state = loadState();
    state.currentState = 'none';
    state.currentImprovement = null;
    saveState(state);
    console.log('State reset.');
    return;
  }

  if (args.includes('--status')) {
    const state = loadState();
    console.log('\n=== 123 v3 STATUS ===');
    console.log('State: ' + state.currentState);
    console.log('Completed: ' + state.completedImprovements.length);
    for (const i of state.completedImprovements.slice(-5)) {
      console.log('  [OK] ' + i.id + ': ' + i.experiment + ' (activated ' + i.activatedAt + ')');
    }
    console.log('Failed: ' + state.failedImprovements.length);
    for (const i of state.failedImprovements.slice(-3)) {
      console.log('  [X] ' + i.id + ': ' + i.experiment);
    }
    if (state.blockedByBug.length > 0) {
      console.log('\nBlocked by bugs:');
      for (const b of state.blockedByBug) {
        console.log('  ! ' + b.bugId + ': ' + b.description.substring(0, 80));
      }
    }

    const outcomes = loadRecentBatchOutcomes(3);
    const patterns = buildPatterns(outcomes);
    console.log('\n' + patterns.length + ' patterns detected:');
    for (const p of patterns) {
      const eligible = p.confidence >= 0.70 && p.generalizationRisk !== 'high';
      console.log('  ' + (eligible ? '[+]' : '[-]') + ' [' + p.patternId + '] ' + p.category + ' conf=' + p.confidence + ' -- ' + p.sources.length + ' sources');
    }

    let precRaw = '';
    try { precRaw = readFileSync(PATHS.POSTB_PREC, 'utf8').trim(); } catch { precRaw = ''; }
    const count = precRaw ? precRaw.split('\n').filter(l => l.trim()).length : 0;
    console.log('\npostB-preC: ' + count + ' sources');
    return;
  }

  if (args.includes('--dry-run')) {
    const outcomes = loadRecentBatchOutcomes(3);
    const patterns = buildPatterns(outcomes);
    console.log('\n=== DRY RUN ===');
    console.log(patterns.length + ' patterns:');
    for (const p of patterns) {
      const hasChange = CODE_CHANGES.some(c => c.patternId === p.patternId);
      console.log('  [' + p.patternId + '] ' + p.category + ' conf=' + p.confidence + ' auto=' + (hasChange ? 'YES' : 'NO'));
      console.log('    Fix: ' + p.concreteFix.substring(0, 120));
    }
    return;
  }

  let maxIter = 3;
  for (const a of args) {
    if (a.startsWith('--max-iter=')) maxIter = parseInt(a.split('=')[1] || '3', 10);
  }

  section('123 v3 STARTING (max-iter=' + maxIter + ')');
  const loopResult = await runLoop(maxIter);

  section('LOOP COMPLETE');
  console.log('Iterations: ' + loopResult.iterations);
  console.log('Activated: ' + loopResult.improvementsActivated);
  console.log('Rolled back: ' + loopResult.improvementsRolledBack);
  console.log('Patterns: ' + loopResult.patternsFound);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
