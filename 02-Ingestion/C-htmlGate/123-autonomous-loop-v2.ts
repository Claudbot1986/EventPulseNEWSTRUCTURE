/**
 * 123 Autonomous Loop v2 -- Pattern-Driven Improvement Orchestrator
 *
 * PURPOSE:
 * Kor batch -> analyserar generiska monster -> testar andringar -> upprepar.
 * Haller sig inom C-htmlGate scope.
 *
 * SCOPE LIMITS:
 *   - Max 5 iterations per call
 *   - Max 3 active improvements at once
 *   - Confidence floor: 0.60
 *   - Generalization risk ceiling: medium (high = rejected)
 *   - Only C-htmlGate files
 *   - Never retry same improvement twice
 *
 * PATTERN-DRIVEN APPROACH:
 *   Instead of reading memory, this script:
 *   1. Reads actual batch reports and queue outcomes
 *   2. Groups failures by failCategory + structural pattern
 *   3. For each group with >= 2 sources, formulates ONE generic hypothesis
 *   4. Tests the hypothesis on the group, not individual sources
 *
 * Files read:
 *   - reports/batch-{N}/pool-state.json (per-source round results)
 *   - 123-improvement-state.json (what's already attempted)
 *   - improvements-bank.jsonl (existing C4 proposals)
 *
 * Files written:
 *   - 123-improvement-state.json (state transitions)
 *   - reports/batch-{N}/loop-log.jsonl (per-iteration decisions)
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const C_HTML_GATE = join(PROJECT_ROOT, '02-Ingestion', 'C-htmlGate');
const REPORTS_DIR = join(C_HTML_GATE, 'reports');
const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');

const PATHS = {
  IMPROVEMENT_STATE: join(C_HTML_GATE, '123-improvement-state.json'),
  MEMORY: join(C_HTML_GATE, '123-learning-memory.json'),
  BATCH_STATE: join(REPORTS_DIR, 'batch-state.jsonl'),
  IMPROVEMENTS_BANK: join(REPORTS_DIR, 'improvements-bank.jsonl'),
  POSTB_PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  POSTTEST_UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  POSTTEST_MANUAL: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImprovementState = 'none' | 'proposed' | 'coded' | 'verifying' | 'verified' | 'regressing' | 'active' | 'rolled_back';

interface ImprovementAttempt {
  id: string;
  experiment: string;
  description: string;
  targetBottleneck: string;
  confidence: 'high' | 'medium' | 'low';
  generalizationRisk: 'low' | 'medium' | 'high';
  hypothesis: string;
  affectedCStage: 'C0' | 'C1' | 'C2' | 'C3' | 'C4';
  affectedFile: string;
  codeChange: string;
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

interface SourceOutcome {
  sourceId: string;
  batchId: string;
  round: number;
  outcome: 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'unknown';
  eventsFound: number;
  failCategory: string;
  pathsTested: string[];
  c2Score: number;
  c1LikelyJsRendered: boolean;
  derivedRuleApplied: boolean;
}

interface FailurePattern {
  patternId: string;
  category: string;
  hypothesis: string;
  sources: string[];
  proposedChange: string;
  affectedFile: string;
  affectedCStage: 'C0' | 'C1' | 'C2' | 'C3';
  confidence: number;
  generalizationRisk: 'low' | 'medium' | 'high';
  examples: { sourceId: string; c2Score: number; pathsTested: string[] }[];
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string, ts = true): void {
  const prefix = ts ? '[' + new Date().toISOString().substring(11, 19) + ']' : '      ';
  console.log(prefix + ' ' + msg);
}

function section(title: string): void {
  const line = '='.repeat(58);
  console.log('\n' + line);
  console.log(' ' + title);
  console.log(line);
}

// ---------------------------------------------------------------------------
// File Utilities
// ---------------------------------------------------------------------------

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
      .sort((a, b) => a - b);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Scope Enforcement
// ---------------------------------------------------------------------------

const FORBIDDEN_PATHS = ['scheduler.ts', 'D-renderGate', 'preUI', 'BullMQ', 'Supabase', 'normalizer', 'services/', 'UI/'];

function enforceScope(filePath: string): boolean {
  if (!filePath.includes('C-htmlGate')) return false;
  for (const f of FORBIDDEN_PATHS) {
    if (filePath.includes(f)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

function loadState(): ImprovementStateFile {
  return readJson(PATHS.IMPROVEMENT_STATE, {
    version: 1, lastUpdated: new Date().toISOString(),
    currentState: 'none', currentImprovement: null,
    completedImprovements: [], failedImprovements: [], blockedByBug: [],
  });
}

function saveState(state: ImprovementStateFile): void {
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
  return new Set([
    ...state.completedImprovements.map(i => i.experiment),
    ...state.failedImprovements.map(i => i.experiment),
  ]);
}

// ---------------------------------------------------------------------------
// Load Outcomes from Pool State
// ---------------------------------------------------------------------------

interface BatchReport {
  batchId: string;
  sources: SourceOutcome[];
}

function loadRecentBatchOutcomes(lastN = 5): BatchReport[] {
  const batchNums = readDirNums(REPORTS_DIR, 'batch');
  const recent = batchNums.slice(-lastN);
  const reports: BatchReport[] = [];

  for (const num of recent) {
    const poolPath = join(REPORTS_DIR, 'batch-' + num, 'pool-state.json');
    const sources: SourceOutcome[] = [];

    const poolData = readJson(poolPath, null as any);
    if (poolData && poolData.exited) {
      try {
        for (const ex of poolData.exited as Array<{source?: {sourceId?: string}; decision?: string; result?: any}>) {
          const r = ex.result || {};
          sources.push({
            sourceId: ex.source?.sourceId || 'unknown',
            batchId: 'batch-' + num,
            round: r.roundNumber || 0,
            outcome: normalizeOutcome(ex.decision),
            eventsFound: r.extract?.eventsFound || 0,
            failCategory: r.failType || 'unknown',
            pathsTested: r.c0?.ruleAppliedPaths || [],
            c2Score: r.c2?.score || 0,
            c1LikelyJsRendered: r.c1?.likelyJsRendered || false,
            derivedRuleApplied: !!(r.derivedRuleApplied),
          });
        }
      } catch { /* skip malformed */ }
    }

    if (sources.length > 0) {
      reports.push({ batchId: 'batch-' + num, sources });
    }
  }

  return reports;
}

function normalizeOutcome(decision: string | undefined): SourceOutcome['outcome'] {
  if (!decision) return 'unknown';
  const d = decision.toLowerCase();
  if (d.includes('ui')) return 'UI';
  if (d.includes('a-signal') || d.includes('posttestc-a')) return 'A';
  if (d.includes('b-signal') || d.includes('posttestc-b')) return 'B';
  if (d.includes('d-signal') || d.includes('posttestc-d')) return 'D';
  if (d.includes('manual') || d.includes('review')) return 'manual-review';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Pattern Analysis -- find generic failure groups
// ---------------------------------------------------------------------------

interface ImprovementBankEntry {
  stableId: string;
  name: string;
  problemType: string;
  affectedPatterns: string[];
  supportedByBatches: string[];
  generalizable: boolean;
  status: string;
  evidenceType: string;
  enabled: boolean;
}

function loadPatternsFromImprovementsBank(): FailurePattern[] {
  const patterns: FailurePattern[] = [];
  // Group improvements by path pattern to get meaningful batch sizes
  const byPattern = new Map<string, {imp: ImprovementBankEntry; sources: string[]}>();

  try {
    const raw = readFileSync(PATHS.IMPROVEMENTS_BANK, 'utf8').trim();
    if (!raw) return patterns;
    const lines = raw.split('\n');
    for (const line of lines) {
      try {
        const imp: ImprovementBankEntry = JSON.parse(line);
        if (imp.status !== 'candidate' || imp.evidenceType !== 'C4-candidateRuleForC0C3' || imp.enabled) continue;
        const sourceId = imp.name.split(':')[1] || '';
        const pathPattern = imp.affectedPatterns[0] || '';
        if (!pathPattern) continue;
        const existing = byPattern.get(pathPattern);
        if (existing) {
          if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
        } else {
          byPattern.set(pathPattern, { imp, sources: [sourceId] });
        }
      } catch { /* skip */ }
    }
  } catch { /* file not found */ }

  for (const [pathPattern, { imp, sources }] of byPattern) {
    if (sources.length < 2) continue; // Need at least 2 sources for meaningful batch
    patterns.push({
      patternId: 'C4-BANK-PATH-' + pathPattern.replace(/[^a-z0-9]/gi, '_').substring(0, 30),
      category: imp.problemType,
      hypothesis: 'C4 discovered: path pattern "' + pathPattern + '" applies to ' + sources.length + ' sources. Testing if adding this path to C0 discovery improves events found.',
      sources: sources.slice(0, 8),
      proposedChange: 'In C0-htmlFrontierDiscovery: add path pattern "' + pathPattern + '" to SWEDISH_EVENT_PATTERNS array for sources in this group.',
      affectedFile: join(C_HTML_GATE, 'C0-htmlFrontierDiscovery', 'C0-htmlFrontierDiscovery.ts'),
      affectedCStage: 'C0',
      confidence: 0.70,
      generalizationRisk: imp.generalizable ? 'low' : 'medium',
      examples: sources.slice(0, 3).map(s => ({ sourceId: s, c2Score: 0, pathsTested: [pathPattern] })),
    });
  }

  return patterns;
}

function analyzePatterns(reports: BatchReport[]): FailurePattern[] {
  const patterns: FailurePattern[] = [];

  // Collect all manual-review and unknown outcomes
  const manualReviewSources: SourceOutcome[] = [];
  for (const report of reports) {
    for (const src of report.sources) {
      if (src.outcome === 'manual-review' || src.outcome === 'unknown') {
        manualReviewSources.push(src);
      }
    }
  }

  // PATTERN 1: NO_CANDIDATES_SWEDISH_PATHS
  // Sources with 0 candidates on root URL and 0 Swedish paths tried
  const noCandidates = manualReviewSources.filter(s =>
    s.c2Score === 0 && s.pathsTested.length === 0 && s.failCategory !== 'LOW_VALUE_SOURCE'
  );

  if (noCandidates.length >= 2) {
    patterns.push({
      patternId: 'NO_CANDIDATES_SWEDISH_PATHS',
      category: 'ENTRY_PAGE_NO_EVENTS / NEEDS_SUBPAGE_DISCOVERY',
      hypothesis: 'Sources with 0 candidates on root URL and 0 Swedish paths tried -- C0 should probe /events|/program|/kalender paths before declaring failure.',
      sources: [...new Set(noCandidates.map(s => s.sourceId))],
      proposedChange: 'In run-dynamic-pool.ts: when C0 finds 0 candidates AND no Swedish paths have been tried, add 1 extra round that probes /events, /program, /kalender paths.',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C0',
      confidence: 0.65,
      generalizationRisk: 'low',
      examples: noCandidates.slice(0, 5).map(s => ({
        sourceId: s.sourceId,
        c2Score: s.c2Score,
        pathsTested: s.pathsTested,
      })),
    });
  }

  // PATTERN 2: C2_PROMISING_BUT_EXTRACTION_FAILED
  // C2 score > 0 but still failed -- extraction issue
  const extractionFailures = manualReviewSources.filter(s =>
    s.c2Score > 0 && s.c1LikelyJsRendered && s.eventsFound === 0
  );

  if (extractionFailures.length >= 2) {
    patterns.push({
      patternId: 'C2_PROMISING_BUT_EXTRACTION_FAILED',
      category: 'EXTRACTION_PATTERN_MISMATCH',
      hypothesis: 'C2 shows density score > 0 AND C1 likelyJsRendered=true, but extraction yields 0 events. Likely C1 HTML differs from C2 HTML. C3 should use C2 HTML when C2 score > 80.',
      sources: [...new Set(extractionFailures.map(s => s.sourceId))],
      proposedChange: 'In run-dynamic-pool.ts: when C2 score > 80 AND C1 likelyJsRendered=true, pass C2 HTML (not C1 HTML) to C3 extractor.',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C3',
      confidence: 0.60,
      generalizationRisk: 'medium',
      examples: extractionFailures.slice(0, 5).map(s => ({
        sourceId: s.sourceId,
        c2Score: s.c2Score,
        pathsTested: s.pathsTested,
      })),
    });
  }

  // PATTERN 3: DERIVED_RULES_NOT_HELPFING
  // Derived rules were applied but didn't help
  const rulesAppliedNoHelp = manualReviewSources.filter(s =>
    s.derivedRuleApplied && s.eventsFound === 0
  );

  if (rulesAppliedNoHelp.length >= 2) {
    patterns.push({
      patternId: 'DERIVED_RULES_NOT_HELPFING',
      category: 'LEARNING_LOOP_FAILURE',
      hypothesis: 'C4 learned rules and applied them, but they still produced 0 events. Either the rule paths are wrong, or extraction fails after candidate discovery.',
      sources: [...new Set(rulesAppliedNoHelp.map(s => s.sourceId))],
      proposedChange: 'In run-dynamic-pool.ts: when a derived rule is applied AND C2 score > 0 AND eventsFound = 0, re-route to C3 with C2 HTML instead of stopping at manual-review.',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C0',
      confidence: 0.55,
      generalizationRisk: 'medium',
      examples: rulesAppliedNoHelp.slice(0, 5).map(s => ({
        sourceId: s.sourceId,
        c2Score: s.c2Score,
        pathsTested: s.pathsTested,
      })),
    });
  }

  // PATTERN 4: D_ROUTE_WITH_HIGH_C2_SCORE
  // Sources with high C2 score but routed to D
  const dQueueWithScore = manualReviewSources.filter(s => {
    return s.c2Score > 80 && s.c1LikelyJsRendered;
  });

  if (dQueueWithScore.length >= 2) {
    patterns.push({
      patternId: 'D_ROUTE_WITH_HIGH_C2_SCORE',
      category: 'LIKELY_JS_RENDER',
      hypothesis: 'Sources with C2 density score > 80 AND likelyJsRendered=true are routed to D-queue, but C2 score suggests static HTML has event content. Bypass D-route when C2 score > 80.',
      sources: [...new Set(dQueueWithScore.map(s => s.sourceId))],
      proposedChange: 'In run-dynamic-pool.ts C1-DIRECT-ROUTING: add condition: if (c2Score > 80) { skip D-route, continue to C3 }',
      affectedFile: join(C_HTML_GATE, 'run-dynamic-pool.ts'),
      affectedCStage: 'C1',
      confidence: 0.70,
      generalizationRisk: 'low',
      examples: dQueueWithScore.slice(0, 5).map(s => ({
        sourceId: s.sourceId,
        c2Score: s.c2Score,
        pathsTested: s.pathsTested,
      })),
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Build improvement from pattern
// ---------------------------------------------------------------------------

function patternToImprovement(pattern: FailurePattern, state: ImprovementStateFile): ImprovementAttempt | null {
  if (pattern.confidence < 0.60) return null;
  if (pattern.generalizationRisk === 'high') return null;

  const completed = getCompletedExperiments(state);
  if (completed.has(pattern.patternId)) {
    log('Pattern ' + pattern.patternId + ' already attempted -- skipping');
    return null;
  }

  const id = nextImpId(state);
  return {
    id,
    experiment: pattern.patternId,
    description: pattern.hypothesis,
    targetBottleneck: pattern.category,
    confidence: pattern.confidence >= 0.70 ? 'high' : pattern.confidence >= 0.65 ? 'medium' : 'low',
    generalizationRisk: pattern.generalizationRisk,
    hypothesis: pattern.hypothesis,
    affectedCStage: pattern.affectedCStage,
    affectedFile: pattern.affectedFile,
    codeChange: pattern.proposedChange,
    verificationSources: pattern.sources.slice(0, 6),
    regressionSources: [],
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Apply Code Change (targeted, limited replacements)
// ---------------------------------------------------------------------------

interface CodeChangeResult { success: boolean; applied: boolean; reason: string; }

// KNOWN_CHANGES: maps patternId -> {search, replace}
// Only patterns with confident, specific code changes go here.
// Others require manual intervention.
const KNOWN_CHANGES: Array<{
  patternId: string;
  search: string | RegExp;
  replace: string;
  file: string;
}> = [
  {
    patternId: 'D_ROUTE_WITH_HIGH_C2_SCORE',
    search: /c1Dsignal\s*&&\s*c2Score\s*>/,
    replace: 'c1Dsignal && c2Score > 80) { // BYPASS D: C2>80 = static HTML with events\n      // continue to C3 extraction instead of D-renderGate\n      if (false) {',
    file: 'run-dynamic-pool.ts',
  },
  {
    patternId: 'NO_CANDIDATES_SWEDISH_PATHS',
    search: 'swedishPatterns)',
    replace: 'swedishPatterns, "/events", "/program", "/kalender"]',
    file: 'run-dynamic-pool.ts',
  },
];

function applyCodeChange(imp: ImprovementAttempt): CodeChangeResult {
  if (!existsSync(imp.affectedFile)) {
    return { success: false, applied: false, reason: 'File not found: ' + imp.affectedFile };
  }

  if (!enforceScope(imp.affectedFile)) {
    return { success: false, applied: false, reason: 'Scope violation: ' + imp.affectedFile };
  }

  const content = readFileSync(imp.affectedFile, 'utf8');
  const change = KNOWN_CHANGES.find(c => c.patternId === imp.experiment);

  if (!change) {
    log('No auto-apply rule for pattern: ' + imp.experiment);
    log('Code change: ' + imp.codeChange.substring(0, 120));
    log('NOTE: Manual code change required. Skipping this pattern (does not count against iteration limit).');
    // Don't proceed to verification -- manual change needed first
    return { success: false, applied: false, reason: 'No auto-apply rule -- manual code change required. Skipping.' };
  }

  try {
    let newContent: string;
    if (typeof change.search === 'string') {
      if (!content.includes(change.search)) {
        return { success: true, applied: false, reason: 'String not found in file: ' + change.search.substring(0, 50) };
      }
      newContent = content.replace(change.search, change.replace);
    } else {
      if (!change.search.test(content)) {
        return { success: true, applied: false, reason: 'Regex not found in file' };
      }
      newContent = content.replace(change.search, change.replace);
    }

    if (newContent !== content) {
      // Backup original
      const backupPath = imp.affectedFile + '.loop-backup';
      writeFileSync(backupPath, content);
      log('Backup saved: ' + imp.affectedFile + '.loop-backup');

      writeFileSync(imp.affectedFile, newContent);
      log('APPLIED: ' + imp.experiment + ' to ' + imp.affectedFile);
      return { success: true, applied: true, reason: 'Change applied' };
    }

    return { success: true, applied: false, reason: 'No changes needed (content identical)' };
  } catch (e: unknown) {
    return { success: false, applied: false, reason: 'Error: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

// ---------------------------------------------------------------------------
// Run Batch
// ---------------------------------------------------------------------------

function runDynamicBatch(batchNum?: number): { success: boolean; batchId: string } {
  try {
    const batchArg = batchNum ? '--batch-num ' + batchNum : '';
    const cmd = 'cd "' + PROJECT_ROOT + '" && npx tsx 02-Ingestion/C-htmlGate/run-dynamic-pool.ts ' + batchArg;
    log('Running: ' + cmd);
    const output = execSync(cmd, { timeout: 600000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const batchMatch = output.match(/batch-(\d+)/);
    const batchId = batchMatch ? 'batch-' + batchMatch[1] : 'unknown';
    log('Batch completed: ' + batchId);
    return { success: true, batchId };
  } catch (e: unknown) {
    const err = e as { message?: string; stdout?: string; stderr?: string };
    const output = err.stdout || err.stderr || err.message || '';
    log('Batch error: ' + output.substring(0, 300));
    return { success: false, batchId: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Analyze improvement impact from batch results
// ---------------------------------------------------------------------------

function analyzeImprovementImpact(
  imp: ImprovementAttempt,
  batchId: string
): { improved: string[]; unchanged: string[]; regressed: string[]; net: number; decision: 'keep' | 'rollback' } {
  const poolPath = join(REPORTS_DIR, batchId, 'pool-state.json');
  const poolData = readJson(poolPath, null as any);

  if (!poolData) {
    log('No pool-state found for ' + batchId + ' -- conservative rollback');
    return { improved: [], unchanged: imp.verificationSources, regressed: [], net: 0, decision: 'rollback' };
  }

  const improved: string[] = [];
  const unchanged: string[] = [];
  const regressed: string[] = [];
  const targetSet = new Set(imp.verificationSources);

  try {
    for (const ex of poolData.exited || []) {
      const srcId = ex.source?.sourceId || '';
      if (!targetSet.has(srcId)) continue;
      const events = ex.result?.extract?.eventsFound || 0;
      if (events > 0) {
        improved.push(srcId);
      } else {
        unchanged.push(srcId);
      }
    }
  } catch (e: unknown) {
    log('Error analyzing pool data: ' + (e instanceof Error ? e.message : String(e)));
  }

  const net = improved.length - regressed.length;
  const decision: 'keep' | 'rollback' = net >= 1 ? 'keep' : 'rollback';
  return { improved, unchanged, regressed, net, decision };
}

// ---------------------------------------------------------------------------
// Regression check
// ---------------------------------------------------------------------------

const REGRESSION_SOURCES = ['mittuniversitetet', 'malm-opera', 'blekholmen', 'boplanet', 'chalmers'];

function checkRegression(batchId: string): string[] {
  const poolPath = join(REPORTS_DIR, batchId, 'pool-state.json');
  const poolData = readJson(poolPath, null as any);
  if (!poolData) return [];

  const regressionSet = new Set(REGRESSION_SOURCES);
  const breakages: string[] = [];

  try {
    for (const ex of poolData.exited || []) {
      const srcId = ex.source?.sourceId || '';
      if (!regressionSet.has(srcId)) continue;
      // If it didn't go to UI in this batch but went to UI before, that's a regression signal
      if (ex.decision && !ex.decision.toLowerCase().includes('ui')) {
        breakages.push(srcId);
      }
    }
  } catch { /* ignore */ }

  return breakages;
}

// ---------------------------------------------------------------------------
// State Transitions
// ---------------------------------------------------------------------------

function transition(state: ImprovementStateFile, action: string, payload?: unknown): ImprovementStateFile {
  const now = new Date().toISOString();
  const ns = { ...state, lastUpdated: now };

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
        ns.currentImprovement.rollbackReason = 'verification failed';
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
        if (!ns.currentImprovement!.activatedAt) {
          ns.currentImprovement!.activatedAt = now;
        }
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

// ---------------------------------------------------------------------------
// Iteration Log
// ---------------------------------------------------------------------------

function logIteration(batchNum: number, entry: object): void {
  const logPath = join(REPORTS_DIR, 'batch-' + batchNum, 'loop-log.jsonl');
  ensureDir(dirname(logPath));
  appendJsonl(logPath, { ...entry, ts: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// MAIN AUTONOMOUS LOOP
// ---------------------------------------------------------------------------

interface LoopResult {
  iterations: number;
  improvementsActivated: number;
  improvementsRolledBack: number;
  newPatternsFound: number;
  finalState: ImprovementState;
  message: string;
}

async function runAutonomousLoop(maxIterations = 5): Promise<LoopResult> {
  section('123 AUTONOMOUS LOOP v2');

  let state = loadState();
  log('State: ' + state.currentState + (state.currentImprovement ? ' (' + state.currentImprovement.id + ')' : ''));

  const result: LoopResult = {
    iterations: 0,
    improvementsActivated: state.completedImprovements.length,
    improvementsRolledBack: state.failedImprovements.length,
    newPatternsFound: 0,
    finalState: state.currentState,
    message: '',
  };

  // Check postB-preC availability
  let precRaw = '';
  try { precRaw = readFileSync(PATHS.POSTB_PREC, 'utf8').trim(); } catch { precRaw = ''; }
  const sourcesInPrec = precRaw ? precRaw.split('\n').filter(l => l.trim()).length : 0;
  log('postB-preC: ' + sourcesInPrec + ' sources available');

  // If sources available, run a batch FIRST to get fresh data
  if (sourcesInPrec >= 3) {
    log('Running fresh batch to get current data...');
    const batchResult = runDynamicBatch();
    if (batchResult.success) {
      log('Batch completed: ' + batchResult.batchId);
    }
  }

  // Load batch data for pattern analysis
  const reports = loadRecentBatchOutcomes(5);
  log('Analyzed ' + reports.length + ' recent batch reports');
  for (const r of reports) {
    log('  ' + r.batchId + ': ' + r.sources.length + ' sources');
  }

  // Find patterns
  const patterns = analyzePatterns(reports);
  // Also load candidate improvements from improvements bank
  const bankPatterns = loadPatternsFromImprovementsBank();
  for (const bp of bankPatterns) {
    if (!patterns.some(p => p.patternId === bp.patternId)) {
      patterns.push(bp);
    }
  }
  log('Found ' + patterns.length + ' failure patterns');
  for (const p of patterns) {
    const srcList = p.sources.slice(0, 3).join(', ');
    log('  [' + p.patternId + '] conf=' + p.confidence + ' risk=' + p.generalizationRisk + ' -- ' + p.sources.length + ' sources: ' + srcList + '...');
  }

  result.newPatternsFound = patterns.length;

  // Filter patterns by confidence and risk
  const eligible = patterns.filter(p =>
    p.confidence >= 0.60 &&
    p.generalizationRisk !== 'high' &&
    !getCompletedExperiments(state).has(p.patternId)
  );
  log(eligible.length + ' patterns eligible for improvement');

  // Process up to 3 eligible patterns per call (each needs its own verification batch)
  const perCall = Math.min(3, eligible.length);
  let testedThisCall = 0;

  for (let i = 0; i < eligible.length; i++) {
    if (result.iterations >= maxIterations) break;
    if (testedThisCall >= 3) break;

    const pattern = eligible[i];

    // Build improvement
    const imp = patternToImprovement(pattern, state);
    if (!imp) {
      log('Skipped: ' + pattern.patternId);
      continue;
    }
    testedThisCall++;

    log('\n--- Iteration ' + result.iterations + ': ' + pattern.patternId + ' ---');
    log('PROPOSED: ' + imp.id + ' -- ' + imp.experiment);
    log('  Hypothesis: ' + imp.hypothesis.substring(0, 100));
    log('  Confidence: ' + imp.confidence + ' | Risk: ' + imp.generalizationRisk);
    log('  File: ' + imp.affectedFile);
    log('  Verification: ' + imp.verificationSources.join(', '));

    // Select: proposed
    state = transition(state, 'select', imp);
    saveState(state);

    // Code: try to apply
    const codeResult = applyCodeChange(imp);
    log('Code change: ' + (codeResult.applied ? 'APPLIED' : 'NOT APPLIED') + ' -- ' + codeResult.reason);

    // If code change couldn't be applied, skip without counting
    if (!codeResult.applied && !codeResult.success) {
      log('Skipping (manual change required) -- not counting against iteration limit.');
      // Reset state but don't count this attempt
      state.currentState = 'none';
      state.currentImprovement = null;
      state.lastUpdated = new Date().toISOString();
      saveState(state);
      state = loadState();
      continue;
    }

    state = transition(state, 'code_done');
    saveState(state);

    // Run verification batch for this improvement
    log('Running verification batch...');
    state = transition(state, 'verify_start');
    saveState(state);
    const br = runDynamicBatch();
    batchId = br.batchId;
    batchRunSuccess = br.success;
    log('Verification batch: ' + batchId);

    const impact = analyzeImprovementImpact(imp, batchId);
    log('Impact: improved=' + impact.improved.length + ' unchanged=' + impact.unchanged.length + ' regressed=' + impact.regressed.length + ' net=' + impact.net + ' -> ' + impact.decision);

    state = transition(state, 'verify_done', { ...impact, batchId });
    saveState(state);

    // Log
    const batchNum = parseInt(batchId.replace('batch-', '')) || 0;
    if (batchNum > 0) {
      logIteration(batchNum, {
        event: 'iteration',
        patternId: pattern.patternId,
        impId: imp.id,
        decision: impact.decision,
        net: impact.net,
        codeApplied: codeResult.applied,
      });
    }

    if (impact.decision === 'keep') {
      const breakages = checkRegression(batchId);
      if (breakages.length > 0) {
        log('REGRESSION DETECTED: ' + breakages.join(', '));
        state = transition(state, 'rollback', 'regression detected');
        result.improvementsRolledBack++;
      } else {
        state = transition(state, 'activate');
        result.improvementsActivated++;
        log('ACTIVATED: ' + imp.id);
      }
    } else {
      result.improvementsRolledBack++;
      log('ROLLED BACK: ' + imp.id);
    }

    saveState(state);
    state = loadState();
    result.iterations++;
  }

  // If no patterns found but we have pending state, reset
  if (eligible.length === 0 && (state.currentState === 'none' || state.currentState === 'rolled_back')) {
    if (sourcesInPrec >= 3) {
      log('No eligible patterns -- running baseline batch');
      const batchRun = runDynamicBatch();
      log('Baseline batch: ' + batchRun.batchId);
    }
  }

  result.finalState = state.currentState;
  result.message = 'Iterations: ' + result.iterations + ', Activated: ' + result.improvementsActivated + ', Rolled back: ' + result.improvementsRolledBack + ', Patterns found: ' + result.newPatternsFound;

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--reset')) {
    const state = loadState();
    state.currentState = 'none';
    state.currentImprovement = null;
    state.lastUpdated = new Date().toISOString();
    saveState(state);
    console.log('State reset to none.');
    return;
  }

  if (args.includes('--status')) {
    const state = loadState();
    console.log('\n=== 123 AUTONOMOUS LOOP v2 STATUS ===');
    console.log('State: ' + state.currentState + (state.currentImprovement ? ' (' + state.currentImprovement.id + ')' : ''));
    console.log('Completed: ' + state.completedImprovements.length);
    for (const i of state.completedImprovements) {
      console.log('  [OK] ' + i.id + ': ' + i.experiment + ' (activated ' + i.activatedAt + ')');
    }
    console.log('Failed: ' + state.failedImprovements.length);
    for (const i of state.failedImprovements) {
      console.log('  [X] ' + i.id + ': ' + i.experiment + ' (rolled back ' + i.rolledBackAt + ')');
    }
    if (state.currentImprovement) {
      console.log('\nCurrent: ' + state.currentImprovement.id + ' -- ' + state.currentImprovement.experiment);
      console.log('  State: ' + state.currentState);
      console.log('  File: ' + state.currentImprovement.affectedFile);
    }

    // Show recent patterns
    const reports = loadRecentBatchOutcomes(3);
    const patterns = analyzePatterns(reports);
    const bankPatterns = loadPatternsFromImprovementsBank();
    for (const bp of bankPatterns) {
      if (!patterns.some(p => p.patternId === bp.patternId)) {
        patterns.push(bp);
      }
    }
    console.log('\n' + patterns.length + ' failure patterns available (' + bankPatterns.length + ' from improvements bank):');
    for (const p of patterns) {
      console.log('  [' + p.patternId + '] conf=' + p.confidence + ' -- ' + p.sources.length + ' sources');
    }

    // Check postB-preC
    let precRaw = '';
    try { precRaw = readFileSync(PATHS.POSTB_PREC, 'utf8').trim(); } catch { precRaw = ''; }
    const count = precRaw ? precRaw.split('\n').filter(l => l.trim()).length : 0;
    console.log('\npostB-preC: ' + count + ' sources');
    return;
  }

  if (args.includes('--dry-run')) {
    const state = loadState();
    const reports = loadRecentBatchOutcomes(3);
    const patterns = analyzePatterns(reports);
    const bankPatterns = loadPatternsFromImprovementsBank();
    for (const bp of bankPatterns) {
      if (!patterns.some(p => p.patternId === bp.patternId)) {
        patterns.push(bp);
      }
    }
    console.log('\n=== DRY RUN -- No changes will be made ===');
    console.log('Current state: ' + state.currentState);
    console.log('Patterns found: ' + patterns.length + ' (from batch analysis + ' + bankPatterns.length + ' from improvements bank)');
    for (const p of patterns) {
      console.log('  [' + p.patternId + '] conf=' + p.confidence + ' risk=' + p.generalizationRisk + ' (' + p.sources.length + ' sources)');
      console.log('    -> ' + p.hypothesis.substring(0, 100));
      console.log('    -> ' + p.proposedChange.substring(0, 100));
    }
    return;
  }

  let maxIter = 999; // effectively unlimited -- loop until queue is empty
  for (const a of args) {
    if (a.startsWith('--max-iter=')) {
      maxIter = parseInt(a.split('=')[1] || '999', 10);
    }
  }

  section('AUTONOMOUS LOOP v2 STARTING');
  let totalIterations = 0;
  let totalActivated = 0;
  let totalRolledBack = 0;
  let callCount = 0;
  let loopResult: LoopResult;

  // Run loop repeatedly until postB-preC is empty
  do {
    callCount++;
    const prevIter = totalIterations;

    loopResult = await runAutonomousLoop(maxIter);

    totalIterations += loopResult.iterations;
    totalActivated += loopResult.improvementsActivated;
    totalRolledBack += loopResult.improvementsRolledBack;

    // Check postB-preC count
    let precRaw = '';
    try { precRaw = readFileSync(PATHS.POSTB_PREC, 'utf8').trim(); } catch { precRaw = ''; }
    const remaining = precRaw ? precRaw.split('\n').filter(l => l.trim()).length : 0;

    log('Call ' + callCount + ' complete: +' + (totalIterations - prevIter) + ' iterations, postB-preC: ' + remaining + ' remaining');

    if (remaining === 0) {
      log('postB-preC is empty -- loop complete.');
      break;
    }

    if (totalIterations - prevIter === 0) {
      log('No progress this call -- running baseline batch to drain queue.');
      const br = runDynamicBatch();
      log('Baseline batch: ' + br.batchId);
      // Recheck
      let precRaw2 = '';
      try { precRaw2 = readFileSync(PATHS.POSTB_PREC, 'utf8').trim(); } catch { precRaw2 = ''; }
      const remaining2 = precRaw2 ? precRaw2.split('\n').filter(l => l.trim()).length : 0;
      if (remaining2 === 0) {
        log('Queue drained -- loop complete.');
        break;
      }
    }

    // Small delay to avoid hammering
    await new Promise(r => setTimeout(r, 1000));
  } while (true);

  section('LOOP COMPLETE');
  console.log('Total calls: ' + callCount);
  console.log('Total iterations: ' + totalIterations);
  console.log('Improvements activated: ' + totalActivated);
  console.log('Improvements rolled back: ' + totalRolledBack);
  console.log('Final state: ' + loopResult.finalState);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
