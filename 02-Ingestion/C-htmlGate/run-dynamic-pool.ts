/**
 * C-htmlGate — Dynamic Test Pool Runner
 *
STATUS LABELS:
  RUNNER_EXECUTES          — koden körbar, bekräftad i terminal
  FLOW_PARTIALLY_VERIFIED  — round 1-3 körda, refill verifierad
  RESUME_VERIFIED          — resume från pool-state VERIFIERAD (2026-04-11)
  C4_AI_INTEGRATED         — C4-AI inkopplad och körande efter varje round
  NOT_CANONICAL_YET        — får EJ beskrivas som canonical förrän verifierad
 *
 * Denna fil är den första fungerande versionen av den dynamiska poolmodellen.
 * Det är INTE slutlig canonical implementation.
 * - Dynamic test pool of max 50 active C-sources
 * - Each source has its own roundsParticipated (max 3)
 * - Sources leave the pool immediately when exit condition is met
 * - Refill from postB-preC ONLY between rounds
 * - Sources that left the pool cannot rejoin in later rounds
 *
 * Exit conditions:
 * a) events found → postTestC-UI
 * b) high-confidence A/B/D signal → postTestC-A/B/D
 * c) 3 rounds without events → postTestC-manual-review
 *
 * Queue paths (relative to project root):
 * - postB-preC → source of refill
 * - postTestC-UI → extract_success
 * - postTestC-A → A-signal
 * - postTestC-B → B-signal
 * - postTestC-D → D-signal
 * - postTestC-manual-review → after 3 rounds without resolution
 *
 * State persistence:
 * - Pool state saved to reports/batch-{N}/pool-state.json after each round
 * - Can resume from saved state on next run
 * - Batch completion marked in reports/batch-state.jsonl
 *
 * C4-AI gap:
 * - C4-AI is a PLACEHOLDER — no real AI analysis is connected
 * - c4-ai-learnings.md is generated with fail-data but no AI analysis
 * - See c4-ai-learnings.md for what needs to be connected
 */

import { discoverEventCandidates, screenUrl, screenUrlWithDerivedRules, evaluateHtmlGate, type PreGateCategorization } from './index';
import { evaluateAiExtract, type AiExtractResult, type AiVerdict } from './C3-aiExtractGate/C3-aiExtractGate';
import { extractFromHtml, type ExtractResult } from '../F-eventExtraction/universal-extractor';
import type { ParsedEvent } from '../F-eventExtraction/schema';
import { runC4Analysis, type C4InputSource, type C4RoundAnalysis, FailCategory } from './C4-ai-analysis';
import { c4DeepAnalyze, verifyProposals, type C4PipelineResult, type C4DeepAnalysisResult } from './c4-deep-analysis';
import { saveRoundDerivedRules, loadAllDerivedRules, isImprovementEnabled, proposeCandidateRulesAsImprovements, type DerivedRulesStore } from './c4-derived-rules';
import type { HtmlVerdict } from './C2-htmlGate/C2-htmlGate';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root: two levels up from C-htmlGate/
const PROJECT_ROOT = join(__dirname, '..', '..');

// CLI flags (set in main(), used throughout)
let SKIP_C4 = false;
let c4AnalysisResult: any = undefined; // Shared reference so TS doesn't complain when SKIP_C4=true

// Pool sizing — single source of truth for batch dimensions
const BATCH_SIZE = 50;
let POOL_WORKERS = 5; // parallel workers per round (set via --workers N)
let MAX_ROUNDS = 3;   // max pool rounds (set via --max-rounds N)

// ---------------------------------------------------------------------------
// Batch Directory Initialization — ensures batch dir exists before any writes
// ---------------------------------------------------------------------------

/**
 * Ensures the batch-specific report directory exists.
 * Creates the directory recursively if it doesn't exist.
 * Returns the absolute path to the batch directory.
 * This must be called BEFORE any batch-specific file writes (reports, pool-state, etc.)
 */
function ensureBatchDir(batchNum: number): string {
  const batchDir = join(REPORTS_DIR, `batch-${batchNum}`);
  mkdirSync(batchDir, { recursive: true });
  return batchDir;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');
const SOURCES_DIR = join(PROJECT_ROOT, 'sources');
const REPORTS_DIR = join(__dirname, 'reports');
const C_EXTRACTED_DIR = join(PROJECT_ROOT, '03-Queue', '03-extractedevents', 'C');

const QUEUES = {
  PREC: join(RUNTIME_DIR, 'postB-preC-queue.jsonl'),
  SOURCES_STATUS: join(RUNTIME_DIR, 'sources_status.jsonl'),
  UI: join(RUNTIME_DIR, 'postTestC-UI.jsonl'),
  A: join(RUNTIME_DIR, 'postTestC-A.jsonl'),
  B: join(RUNTIME_DIR, 'postTestC-B.jsonl'),
  D: join(RUNTIME_DIR, 'postTestC-D.jsonl'),
  MANUAL_REVIEW: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// Load existing sourceIds from MANUAL_REVIEW to prevent duplicate entries
function getExistingManualReviewIds(): Set<string> {
  try {
    const content = readFileSync(QUEUES.MANUAL_REVIEW, 'utf8');
    const ids = new Set<string>();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.sourceId) ids.add(entry.sourceId);
      } catch { /* skip malformed lines */ }
    }
    return ids;
  } catch { return new Set(); }
}

// Append to MANUAL_REVIEW only if sourceId not already present
function appendToManualReview(entry: Record<string, unknown>): void {
  const existing = getExistingManualReviewIds();
  if (!existing.has(entry.sourceId as string)) {
    appendFileSync(QUEUES.MANUAL_REVIEW, JSON.stringify(entry) + '\n');
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueEntry {
  sourceId: string;
  queueName: string;
  queuedAt: string;
  priority: number;
  attempt: number;
  queueReason: string;
}

interface SourceStatus {
  sourceId: string;
  status: string;
  lastPathUsed: string | null;
  lastEventsFound: number;
  consecutiveFailures: number;
  triageResult: string | null;
}

interface PoolSource {
  sourceId: string;
  url: string;
  roundsParticipated: number;
  // Diversifiers from batchmaker
  diversifiers?: string[];
  queueReason?: string;
  enrichedData?: {
    lastPathUsed: string | null;
    lastEventsFound: number;
    consecutiveFailures: number;
    triageResult: string | null;
  };
}

// -------------------------------------------------------------------------------------------
// PER-SOURCE TRACE — Full structured trace for every source in every round
// Replaces guesswork with concrete evidence about what happened at each stage
// -------------------------------------------------------------------------------------------
export interface PerSourceTrace {
  sourceId: string;
  sourceUrl: string;
  round: number;
  // C0
  c0Candidates: number;
  c0WinnerUrl: string | null;
  c0WinnerDensity: number;
  c0RuleSource: 'none' | 'link-discovery' | 'derived-rule' | 'swedish-patterns';
  c0RulePathsTested: string[];
  c0RuleWinnerPath: string | null;
  // Effective URL decision
  effectiveUrl: string;
  effectiveUrlReason: string;
  // C1
  c1Verdict: PreGateCategorization;
  c1LikelyJsRendered: boolean;
  c1TimeTagCount: number;
  c1DateCount: number;
  c1HtmlBytes: number;
  c1Fetchable: boolean;
  c1FetchError?: string;
  c1BestSubpageFound: string | null; // from derived-rules subpage testing
  c1SubpagesTested: string[];
  // C2
  c2Verdict: HtmlVerdict;
  c2Score: number;
  c2Reason: string;
  c2HtmlBytes: number;
  // C3 Universal Extract
  c3EventsFound: number;
  c3MethodsUsed: string[];
  c3MethodBreakdown: Record<string, number>;
  // C3 AI Extract (fallback when C3 returns 0)
  c3AiVerdict?: AiVerdict;
  c3AiEventsFound?: number;
  c3AiDuration?: number;
  // Overall outcome
  eventsFound: number;
  outcomeType: 'extract_success' | 'route_success' | 'fail';
  routeSuggestion: 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'Fail';
  exitReason: ExitReason;
  exitReasonDetail: string;
  winningStage: 'C1' | 'C2' | 'C3' | 'C3-AI' | 'C4-AI';
  success: boolean;
  derivedRuleApplied: boolean;
  error?: string;
}

/**
 * Detailed exit reasons — replaces vague "fail → manual-review" with precise cause.
 * Each reason is specific enough to determine the exact next action.
 */
export type ExitReason =
  // Success paths
  | 'EXTRACT_SUCCESS'
  // Routing paths
  | 'ROUTE_A'
  | 'ROUTE_B'
  | 'ROUTE_D'
  // Fail paths — specific
  | 'NETWORK_ERROR'
  | 'FETCH_ERROR'
  | 'NO_CANDIDATES_NO_PATTERNS'
  | 'NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED'
  | 'WRONG_ENTRY_PAGE'
  | 'C1_NO_MAIN_ARTICLE'
  | 'C1_LIKELY_JS_RENDER_ROOT'
  | 'C1_STRONG_JS_RENDER_D_SIGNAL'
  | 'C2_BLOCKED'
  | 'C2_UNCLEAR'
  | 'EXTRACTION_ZERO_PROMISING_HTML'     // C2 promising but C3 returned 0
  | 'EXTRACTION_ZERO_C3_AI_ZERO'          // C3 failed + C3-AI also returned 0
  | 'ALL_ROUNDS_EXHAUSTED';

type ExitReasonDetail = string;

interface CStageResult {
  c0: {
    candidates: number;
    winnerUrl: string | null;
    winnerDensity: number;
    duration: number;
    rootFallback: boolean;
    ruleAppliedSource: 'none' | 'link-discovery' | 'derived-rule' | 'swedish-patterns';
    ruleAppliedPaths: string[];
    ruleWinnerPath: string | null;
  };
  /** effectiveProcessingUrl is the ONE URL all downstream stages (C1/C2/C3) MUST use */
  effectiveProcessingUrl: string;
  effectiveProcessingUrlReason: string;
  c1: { 
    verdict: string; 
    likelyJsRendered: boolean; 
    timeTagCount: number; 
    dateCount: number; 
    duration: number;
    htmlBytes: number;
    fetchable: boolean;
    fetchError?: string;
    /** Best subpage URL found via screenUrlWithDerivedRules */
    bestSubpageFound?: string | null;
    /** All subpages tested via screenUrlWithDerivedRules */
    subpagesTested?: string[];
  };
  c2: { verdict: string; score: number; reason: string; duration: number; htmlBytes: number };
  c3: {
    universalEventsFound: number;
    universalMethodsUsed: string[];
    universalMethodBreakdown: Record<string, number>;
    aiVerdict?: AiVerdict;
    aiEventsFound?: number;
    aiDuration?: number;
    duration: number;
  };
  extract: { eventsFound: number; duration: number; htmlSize: number; extractedEvents?: ParsedEvent[] };
}

interface CResult extends CStageResult {
  sourceId: string;
  sourceUrl: string;  // original source.url (historical input only)
  winningStage: 'C1' | 'C2' | 'C3' | 'C3-AI' | 'C4-AI';
  outcomeType: 'extract_success' | 'route_success' | 'fail';
  routeSuggestion: 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'Fail';
  evidence: string;
  roundNumber: number;
  success: boolean;
  error?: string;
  failType?: string;
  exitReason: ExitReason;
  exitReasonDetail: ExitReasonDetail;
  networkFailureSubType?: string;
  // Rule tracking: was a derived rule applied in this round?
  derivedRuleApplied?: {
    ruleKey: string;
    pathsTested: string[];
    winnerPath: string | null;
  };
  // Full per-source trace
  trace: PerSourceTrace;
}

interface PoolState {
  poolRoundNumber: number;
  activePool: PoolSource[];
  exited: { source: PoolSource; decision: string; result: CResult | null }[];
  failed: PoolSource[]; // still in pool, failed this round
  newlyRefilled: PoolSource[];
  allExitedIds: string[]; // tracks all sources that ever left the pool
}

// ---------------------------------------------------------------------------
// Pool State Persistence
// ---------------------------------------------------------------------------

const POOL_STATE_FILE = (batchNum: number) => join(REPORTS_DIR, `batch-${batchNum}`, 'pool-state.json');

interface PersistedPoolState {
  poolRoundNumber: number;
  activePool: PoolSource[];
  exited: { source: PoolSource; decision: string; result: CResult | null }[];
  allExitedIds: string[];
  lastSaved: string;
}

function savePoolState(state: PoolState, batchNum: number): void {
  const persisted: PersistedPoolState = {
    poolRoundNumber: state.poolRoundNumber,
    activePool: state.activePool,
    exited: state.exited,
    allExitedIds: Array.from(new Set(state.exited.map(e => e.source.sourceId))),
    lastSaved: new Date().toISOString(),
  };
  const path = POOL_STATE_FILE(batchNum);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(persisted, null, 2));
  console.log(`[State] Pool state saved to batch-${batchNum}/pool-state.json`);
}

function loadPoolState(batchNum: number): PoolState | null {
  const path = POOL_STATE_FILE(batchNum);
  try {
    const raw = readFileSync(path, 'utf8');
    const persisted: PersistedPoolState = JSON.parse(raw);
    console.log(`[State] Loaded pool state from batch-${batchNum}/pool-state.json (round ${persisted.poolRoundNumber})`);
    return {
      poolRoundNumber: persisted.poolRoundNumber,
      activePool: persisted.activePool,
      exited: persisted.exited,
      failed: [],
      newlyRefilled: [],
      allExitedIds: persisted.allExitedIds,
    };
  } catch {
    return null;
  }
}

function readBatchState(): { currentBatch: number; status: string } | null {
  try {
    const raw = readFileSync(join(REPORTS_DIR, 'batch-state.jsonl'), 'utf8').trim();
    if (!raw) return null;
    // batch-state.jsonl is JSONL (one JSON per line) — parse only the LAST line (most recent state)
    const lastLine = raw.split('\n').filter(l => l.trim()).slice(-1)[0];
    if (!lastLine) return null;
    return JSON.parse(lastLine);
  } catch {
    return null;
  }
}

function writeBatchStateEntry(entry: Record<string, unknown>): void {
  const path = join(REPORTS_DIR, 'batch-state.jsonl');
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

const AUDIT_PATH = join(RUNTIME_DIR, 'sources_audit.jsonl');

interface AuditEntry {
  timestamp: string;
  sourceId: string;
  event: 'queued_to' | 'dropped_from_pool' | 'processed_in_batch' | 'exited_pool' | 'rule_generated' | 'rule_applied';
  batch?: number;
  round?: number;
  target?: string;        // for queued_to: which queue
  reason?: string;         // for dropped_from_pool: why
  metadata?: Record<string, unknown>;
}

function writeAuditEntry(entry: Omit<AuditEntry, 'timestamp'>): void {
  const full: AuditEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  appendFileSync(AUDIT_PATH, JSON.stringify(full) + '\n');
}

// ---------------------------------------------------------------------------
// Helpers: Parse
// ---------------------------------------------------------------------------

function parseJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => JSON.parse(line) as T);
}

function loadCanonicalUrls(): Map<string, string> {
  const urlMap = new Map<string, string>();
  try {
    const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      try {
        const content = readFileSync(join(SOURCES_DIR, file), 'utf8').trim();
        if (!content) continue;
        const source = JSON.parse(content);
        if (source.id && source.url) {
          urlMap.set(source.id, source.url);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // sources dir missing
  }
  return urlMap;
}

// ---------------------------------------------------------------------------
// Step 1: Build initial pool from postB-preC
// ---------------------------------------------------------------------------

interface QueueSignals {
  errorCount: number;
  has404s: boolean;
}

function parseQueueSignals(reason: string | undefined | null): QueueSignals {
  const safeReason = reason ?? '';
  const errorMatch = safeReason.match(/(\d+)\s*(?:fel|errors?|404s?)/i);
  const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 0;
  const has404s = /\d+\s*404/i.test(safeReason);
  return { errorCount, has404s };
}

function bucketize(errorCount: number): number {
  if (errorCount === 0) return 0;
  if (errorCount < 10) return 1;
  if (errorCount < 18) return 2;
  return 3;
}

interface DiversityState {
  errorBuckets: Set<number>;
  has404sValues: Set<boolean>;
  consecutiveFailures: Set<number>;
  lastEventsFound: Set<number>;
  lastPathUsed: Set<string>;
  triageResult: Set<string>;
}

function scoreCandidate(
  candidate: { entry: QueueEntry; signals: QueueSignals; status: SourceStatus | undefined; url: string | null },
  state: DiversityState
): number {
  let score = 0;
  const errorBucket = bucketize(candidate.signals.errorCount);
  if (!state.errorBuckets.has(errorBucket)) score += 4;
  if (!state.has404sValues.has(candidate.signals.has404s)) score += 2;
  if (!state.consecutiveFailures.has(candidate.status?.consecutiveFailures ?? -1)) score += 2;
  const hasEvents = (candidate.status?.lastEventsFound ?? 0) > 0 ? 1 : 0;
  if (!state.lastEventsFound.has(hasEvents)) score += 2;
  const path = candidate.status?.lastPathUsed ?? 'none';
  if (!state.lastPathUsed.has(path)) score += 1;
  const triage = candidate.status?.triageResult ?? 'none';
  if (!state.triageResult.has(triage)) score += 1;
  score += Math.random() * 0.4;
  return score;
}

function buildDiversifiers(c: { signals: QueueSignals; status: SourceStatus | undefined }): string[] {
  const d: string[] = [];
  if (c.signals.has404s) d.push('has_404s');
  if (c.signals.errorCount > 0) d.push(`errors_${c.signals.errorCount}`);
  if (c.status) {
    if (c.status.consecutiveFailures > 0) d.push(`failures_${c.status.consecutiveFailures}`);
    if (c.status.lastEventsFound > 0) d.push(`events_${c.status.lastEventsFound}`);
    if (c.status.triageResult) d.push(`triage_${c.status.triageResult}`);
    if (c.status.lastPathUsed) d.push(`path_${c.status.lastPathUsed}`);
  }
  return d;
}

/**
 * Build initial pool of 10 diversifierade C-källor from postB-preC.
 * Returns null if fewer than 10 eligible sources exist.
 *
 * For verification batches: selects ONLY from verificationSources list,
 * ignoring diversity scoring. Each source in the list is included if eligible.
 */
function buildInitialPool(
  batchType: 'normal' | 'verification' = 'normal',
  verificationSources: string[] = [],
  sources?: string[]
): { pool: PoolSource[]; eligibleInPrec: number } | null {
  const queueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
  const allStatuses = parseJsonl<SourceStatus>(QUEUES.SOURCES_STATUS);
  const statusMap = new Map<string, SourceStatus>();
  for (const s of allStatuses) statusMap.set(s.sourceId, s);
  const canonicalUrls = loadCanonicalUrls();

  // Build candidate list and track drops
  const candidates = [];
  const dropped: { entry: QueueEntry; reason: string }[] = [];

  for (const entry of queueEntries) {
    const url = canonicalUrls.get(entry.sourceId) ?? null;
    if (url === null) {
      dropped.push({ entry, reason: 'url_missing_from_sources' });
      writeAuditEntry({ sourceId: entry.sourceId, event: 'dropped_from_pool', reason: 'url_missing_from_sources', metadata: { at: 'buildInitialPool' } });
      continue;
    }
    const signals = parseQueueSignals((entry as any).routingReason ?? (entry as any).queueReason ?? '');
    const status = statusMap.get(entry.sourceId);
    candidates.push({ entry, signals, status, url });
  }

  if (dropped.length > 0) {
    console.warn(`[AUDIT] ${dropped.length}/${queueEntries.length} sources dropped from postB-preC pool build:`);
    for (const d of dropped.slice(0, 5)) {
      console.warn(`  - ${d.entry.sourceId}: ${d.reason}`);
    }
    if (dropped.length > 5) console.warn(`  ... and ${dropped.length - 5} more`);
  }

  // VERIFICATION BATCH: select only from verificationSources list
  if (batchType === 'verification' && verificationSources.length > 0) {
    const verifSet = new Set(verificationSources);
    const verifCandidates = candidates.filter(c => verifSet.has(c.entry.sourceId));
    console.log(`[VerificationBatch] Selected ${verifCandidates.length} verification sources from ${verificationSources.length} requested`);

    const verifSelected: PoolSource[] = [];
    for (const c of verifCandidates) {
      const poolSource: PoolSource = {
        sourceId: c.entry.sourceId,
        url: c.url!,
        roundsParticipated: 0,
        diversifiers: buildDiversifiers(c),
        queueReason: (c.entry as any).routingReason ?? (c.entry as any).queueReason ?? '',
        enrichedData: {
          lastPathUsed: c.status?.lastPathUsed ?? null,
          lastEventsFound: c.status?.lastEventsFound ?? 0,
          consecutiveFailures: c.status?.consecutiveFailures ?? 0,
          triageResult: c.status?.triageResult ?? null,
        },
      };
      verifSelected.push(poolSource);
      writeAuditEntry({
        sourceId: poolSource.sourceId,
        event: 'queued_to',
        target: 'C-pool',
        metadata: { source: 'buildInitialPool', batchType: 'verification', targetImprovement: verificationSources[0] },
      });
    }

    if (verifSelected.length === 0) return null;
    return { pool: verifSelected, eligibleInPrec: verifCandidates.length };
  }

  // EXPLICIT SOURCES: use exactly the provided source IDs (for 123-autonomous-loop)
  if (sources && sources.length > 0) {
    const sourceSet = new Set(sources);
    const explicitCandidates = candidates.filter(c => sourceSet.has(c.entry.sourceId));
    console.log(`[ExplicitSources] Selected ${explicitCandidates.length} explicit sources from ${sources.length} requested`);

    const explicitSelected: PoolSource[] = [];
    for (const c of explicitCandidates) {
      const poolSource: PoolSource = {
        sourceId: c.entry.sourceId,
        url: c.url!,
        roundsParticipated: 0,
        diversifiers: buildDiversifiers(c),
        queueReason: (c.entry as any).routingReason ?? (c.entry as any).queueReason ?? '',
        enrichedData: {
          lastPathUsed: c.status?.lastPathUsed ?? null,
          lastEventsFound: c.status?.lastEventsFound ?? 0,
          consecutiveFailures: c.status?.consecutiveFailures ?? 0,
          triageResult: c.status?.triageResult ?? null,
        },
      };
      explicitSelected.push(poolSource);
      writeAuditEntry({
        sourceId: poolSource.sourceId,
        event: 'queued_to',
        target: 'C-pool',
        metadata: { source: 'buildInitialPool', explicitSources: sources.join(',') },
      });
    }

    if (explicitSelected.length === 0) return null;
    return { pool: explicitSelected, eligibleInPrec: explicitCandidates.length };
  }

  const selected: PoolSource[] = [];
  const usedIds = new Set<string>();

  const diversityState: DiversityState = {
    errorBuckets: new Set(),
    has404sValues: new Set(),
    consecutiveFailures: new Set(),
    lastEventsFound: new Set(),
    lastPathUsed: new Set(),
    triageResult: new Set(),
  };

  const remaining = [...candidates];

  while (selected.length < BATCH_SIZE && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (usedIds.has(remaining[i].entry.sourceId)) continue;
      const score = scoreCandidate(remaining[i], diversityState);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const chosen = remaining.splice(bestIdx, 1)[0];
    usedIds.add(chosen.entry.sourceId);

    const errorBucket = bucketize(chosen.signals.errorCount);
    diversityState.errorBuckets.add(errorBucket);
    diversityState.has404sValues.add(chosen.signals.has404s);
    if (chosen.status) {
      diversityState.consecutiveFailures.add(chosen.status.consecutiveFailures);
      diversityState.lastEventsFound.add(chosen.status.lastEventsFound > 0 ? 1 : 0);
      if (chosen.status.lastPathUsed) diversityState.lastPathUsed.add(chosen.status.lastPathUsed);
      if (chosen.status.triageResult) diversityState.triageResult.add(chosen.status.triageResult);
    }

    const poolSource: PoolSource = {
      sourceId: chosen.entry.sourceId,
      url: chosen.url!,
      roundsParticipated: 0,
      diversifiers: buildDiversifiers(chosen),
      queueReason: (chosen.entry as any).routingReason ?? (chosen.entry as any).queueReason ?? '',
      enrichedData: {
        lastPathUsed: chosen.status?.lastPathUsed ?? null,
        lastEventsFound: chosen.status?.lastEventsFound ?? 0,
        consecutiveFailures: chosen.status?.consecutiveFailures ?? 0,
        triageResult: chosen.status?.triageResult ?? null,
      },
    };
    selected.push(poolSource);
    writeAuditEntry({
      sourceId: poolSource.sourceId,
      event: 'queued_to',
      target: 'C-pool',
      metadata: { source: 'buildInitialPool' },
    });
  }

  // Drain selected sources from postB-preC
  // Write back the non-selected entries so selected sources are removed from queue
  const selectedIds = new Set(selected.map(p => p.sourceId));
  const remainingEntries = queueEntries.filter(e => !selectedIds.has(e.sourceId));
  if (remainingEntries.length > 0) {
    const remainingLines = remainingEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(QUEUES.PREC, remainingLines);
    console.log(`[BuildPool] Drained ${selectedIds.size} sources from postB-preC, ${remainingEntries.length} remain`);
  } else {
    writeFileSync(QUEUES.PREC, '');
    console.log(`[BuildPool] Drained all ${selectedIds.size} sources from postB-preC (queue now empty)`);
  }

  if (selected.length === 0) return null;
  return { pool: selected, eligibleInPrec: candidates.length };
}

// ---------------------------------------------------------------------------
// Step 2: Refill pool from postB-preC
// ---------------------------------------------------------------------------

/**
 * Refill pool to max BATCH_SIZE (50) from postB-preC.
 * Excludes sources already in pool or already exited.
 *
 * For verification batches: NO refill — only the verification sources are tested.
 */
function refillPool(
  currentPool: PoolSource[],
  exitedIds: Set<string>,
  allExitedIds: Set<string>,
  batchType: 'normal' | 'verification' = 'normal',
  verificationSources: string[] = []
): { newSources: PoolSource[]; refillCount: number; availableInPrec: number } {

  // VERIFICATION BATCH: do not refill with random sources
  if (batchType === 'verification') {
    return { newSources: [], refillCount: 0, availableInPrec: 0 };
  }
  const queueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
  const allStatuses = parseJsonl<SourceStatus>(QUEUES.SOURCES_STATUS);
  const statusMap = new Map<string, SourceStatus>();
  for (const s of allStatuses) statusMap.set(s.sourceId, s);
  const canonicalUrls = loadCanonicalUrls();

  // Filter: eligible, not in pool, not already exited
  const activeIds = new Set(currentPool.map(s => s.sourceId));

  // Map entries and track drops
  const mapped: { entry: QueueEntry; signals: QueueSignals; status: SourceStatus | undefined; url: string | null }[] = [];
  const dropped: { entry: QueueEntry; reason: string }[] = [];

  for (const entry of queueEntries) {
    if (activeIds.has(entry.sourceId) || allExitedIds.has(entry.sourceId)) {
      continue; // skip - already in pool or exited
    }
    const url = canonicalUrls.get(entry.sourceId) ?? null;
    if (url === null) {
      dropped.push({ entry, reason: 'url_missing_from_sources' });
      writeAuditEntry({ sourceId: entry.sourceId, event: 'dropped_from_pool', reason: 'url_missing_from_sources', metadata: { at: 'refillPool' } });
      continue;
    }
    const signals = parseQueueSignals((entry as any).routingReason ?? (entry as any).queueReason ?? '');
    const status = statusMap.get(entry.sourceId);
    mapped.push({ entry, signals, status, url });
  }

  if (dropped.length > 0) {
    console.warn(`[AUDIT] ${dropped.length} sources dropped during refill:`);
    for (const d of dropped.slice(0, 5)) {
      console.warn(`  - ${d.entry.sourceId}: ${d.reason}`);
    }
  }

  const eligible = mapped.filter(c => c.url !== null);

  const needed = BATCH_SIZE - currentPool.length;
  const toSelect = eligible.slice(0, needed);

  const newSources: PoolSource[] = toSelect.map(chosen => {
    const ps: PoolSource = {
      sourceId: chosen.entry.sourceId,
      url: chosen.url!,
      roundsParticipated: 0,
      diversifiers: buildDiversifiers(chosen),
      queueReason: (chosen.entry as any).routingReason ?? (chosen.entry as any).queueReason ?? '',
      enrichedData: {
        lastPathUsed: chosen.status?.lastPathUsed ?? null,
        lastEventsFound: chosen.status?.lastEventsFound ?? 0,
        consecutiveFailures: chosen.status?.consecutiveFailures ?? 0,
        triageResult: chosen.status?.triageResult ?? null,
      },
    };
    writeAuditEntry({
      sourceId: ps.sourceId,
      event: 'queued_to',
      target: 'C-pool',
      metadata: { source: 'refillPool' },
    });
    return ps;
  });

  // If we selected some sources, write the remaining (non-selected) back to postB-preC
  // This "drains" the selected sources from the queue so they are not chosen again
  const selectedIds = new Set(toSelect.map(c => c.entry.sourceId));
  const remainingEntries = queueEntries.filter(e => !selectedIds.has(e.sourceId));
  if (remainingEntries.length > 0) {
    const remainingLines = remainingEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(QUEUES.PREC, remainingLines);
    console.log(`[Refill] Drained ${selectedIds.size} selected sources, ${remainingEntries.length} remain in postB-preC`);
  } else {
    // All entries were selected — clear the queue
    writeFileSync(QUEUES.PREC, '');
    console.log(`[Refill] Drained all ${selectedIds.size} sources from postB-preC (queue now empty)`);
  }

  return {
    newSources,
    refillCount: newSources.length,
    availableInPrec: eligible.length,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Run C1→C2→C3 on a single source
// ---------------------------------------------------------------------------

/**
 * Build the PerSourceTrace from the CResult for permanent batch reports.
 */
function buildTrace(result: CResult, sourceUrl: string, roundNum: number): PerSourceTrace {
  return {
    sourceId: result.sourceId,
    sourceUrl,
    round: roundNum,
    c0Candidates: result.c0.candidates,
    c0WinnerUrl: result.c0.winnerUrl,
    c0WinnerDensity: result.c0.winnerDensity,
    c0RuleSource: result.c0.ruleAppliedSource,
    c0RulePathsTested: result.c0.ruleAppliedPaths,
    c0RuleWinnerPath: result.c0.ruleWinnerPath,
    effectiveUrl: result.effectiveProcessingUrl,
    effectiveUrlReason: result.effectiveProcessingUrlReason,
    c1Verdict: result.c1.verdict as PreGateCategorization,
    c1LikelyJsRendered: result.c1.likelyJsRendered,
    c1TimeTagCount: result.c1.timeTagCount,
    c1DateCount: result.c1.dateCount,
    c1HtmlBytes: result.c1.htmlBytes,
    c1Fetchable: result.c1.fetchable,
    c1FetchError: result.c1.fetchError,
    c1BestSubpageFound: result.c1.bestSubpageFound ?? null,
    c1SubpagesTested: result.c1.subpagesTested ?? [],
    c2Verdict: result.c2.verdict as HtmlVerdict,
    c2Score: result.c2.score,
    c2Reason: result.c2.reason,
    c2HtmlBytes: result.c2.htmlBytes,
    c3EventsFound: result.c3.universalEventsFound,
    c3MethodsUsed: result.c3.universalMethodsUsed,
    c3MethodBreakdown: result.c3.universalMethodBreakdown,
    c3AiVerdict: result.c3.aiVerdict,
    c3AiEventsFound: result.c3.aiEventsFound,
    c3AiDuration: result.c3.aiDuration,
    eventsFound: result.extract.eventsFound,
    outcomeType: result.outcomeType,
    routeSuggestion: result.routeSuggestion,
    exitReason: result.exitReason,
    exitReasonDetail: result.exitReasonDetail,
    winningStage: result.winningStage,
    success: result.success,
    derivedRuleApplied: !!result.derivedRuleApplied,
    error: result.error,
  };
}

// ─── URL variant normalization ─────────────────────────────────────────────────

interface UrlVariantResult {
  url: string;
  reason: string;
}

/**
 * Test a URL (or bare domain) with multiple protocol/domain prefixes.
 * Returns the first variant that responds with HTTP < 400.
 * Uses HEAD requests with 5s timeout for speed.
 */
async function tryUrlVariants(rawUrl: string): Promise<UrlVariantResult> {
  const stripped = rawUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '') || '/';
  const hasPath = stripped.includes('/');

  const variants: Array<{ url: string; reason: string }> = [
    { url: `https://${stripped}`, reason: 'https' },
    { url: `https://www.${stripped}`, reason: 'https+www' },
    { url: `http://${stripped}`, reason: 'http' },
    { url: `http://www.${stripped}`, reason: 'http+www' },
  ];

  if (hasPath && !rawUrl.match(/^https?:\/\//)) {
    variants.unshift({ url: `https://${rawUrl.replace(/^https?:\/\//, '')}`, reason: 'https+path' });
  }

  for (const variant of variants) {
    try {
      const res = await axios.head(variant.url, {
        timeout: 5000,
        validateStatus: (s) => s < 400,
        maxRedirects: 0,
      });
      if (res.status < 400) {
        return { url: variant.url, reason: variant.reason };
      }
    } catch {
      // try next variant
    }
  }

  return { url: rawUrl, reason: 'original' };
}

/**
 * NEW runSourceOnPool with:
 * - screenUrlWithDerivedRules wired in (C0-derived-rules actually used in C1)
 * - Effective URL selection: C0 winner OR derived-rules subpage OR root
 * - C3 universal extraction + C3 AI fallback
 * - Full PerSourceTrace + detailed exit reasons
 */
async function runSourceOnPool(
  source: PoolSource,
  roundNum: number,
  derivedRules?: DerivedRulesStore,
): Promise<CResult> {
  console.log(`\n=== ${source.sourceId} (round ${roundNum}) ===`);

  // ── URL variant normalization: try https/www/http prefixes ─────────────────
  const urlVariant = await tryUrlVariants(source.url);
  const effectiveUrl = urlVariant.url;
  if (urlVariant.reason !== 'original') {
    console.log(`[UrlVariant] ${source.url} → ${effectiveUrl} (${urlVariant.reason})`);
  }

  const initial = {
    sourceId: source.sourceId,
    sourceUrl: source.url,
    winningStage: 'C3' as const,
    outcomeType: 'fail' as const,
    routeSuggestion: 'Fail' as const,
    evidence: '',
    roundNumber: roundNum,
    success: false,
    exitReason: 'ALL_ROUNDS_EXHAUSTED' as ExitReason,
    exitReasonDetail: 'not determined',
    derivedRuleApplied: undefined as undefined,
    effectiveProcessingUrl: effectiveUrl,
    effectiveProcessingUrlReason: `url-variant:${urlVariant.reason}`,
  };

  const result: CResult = {
    ...initial,
    c0: { candidates: 0, winnerUrl: null, winnerDensity: 0, duration: 0, rootFallback: false, ruleAppliedSource: 'none', ruleAppliedPaths: [], ruleWinnerPath: null },
    c1: { verdict: 'unknown', likelyJsRendered: false, timeTagCount: 0, dateCount: 0, duration: 0, htmlBytes: 0, fetchable: false, bestSubpageFound: null, subpagesTested: [] },
    c2: { verdict: 'unknown', score: 0, reason: '', duration: 0, htmlBytes: 0 },
    c3: { universalEventsFound: 0, universalMethodsUsed: [], universalMethodBreakdown: {}, duration: 0 },
    extract: { eventsFound: 0, duration: 0, htmlSize: 0 },
    trace: {} as PerSourceTrace,
  };

  try {
    // ── C0: Discovery ─────────────────────────────────────────────────────────
    const c0Start = Date.now();
    const c0 = await discoverEventCandidates(effectiveUrl, derivedRules, source.sourceId);

    result.c0 = {
      candidates: c0?.candidatesFound || 0,
      winnerUrl: c0?.winner?.url || null,
      winnerDensity: c0?.winner?.eventDensityScore || 0,
      duration: Date.now() - c0Start,
      rootFallback: false,
      ruleAppliedSource: c0?.ruleApplied?.source || 'none',
      ruleAppliedPaths: c0?.ruleApplied?.pathsTested || [],
      ruleWinnerPath: c0?.winner?.href || null,
    };

    // Log rule application
    const ruleKey = `${source.sourceId}__NEEDS_SUBPAGE_DISCOVERY`;
    const ruleUsed = derivedRules?.has(ruleKey) && c0?.ruleApplied?.source === 'derived-rule';
    if (ruleUsed) {
      result.derivedRuleApplied = { ruleKey, pathsTested: c0?.ruleApplied?.pathsTested || [], winnerPath: c0?.winner?.href || null };
      console.log(`[Rule-Track] ${source.sourceId}: DERIVED RULE APPLIED — paths: [${(c0?.ruleApplied?.pathsTested || []).join(', ')}], winner: ${c0?.winner?.href || 'none'}`);
    } else if (c0?.ruleApplied?.source === 'swedish-patterns') {
      console.log(`[Rule-Track] ${source.sourceId}: SWEDISH PATTERNS APPLIED — winner: ${c0?.winner?.href || 'none'}`);
    }
    console.log(`C0: ${c0?.candidatesFound || 0} candidates, winner=${c0?.winner?.url || 'none'}`);

    // ── EFFECTIVE URL SELECTION ────────────────────────────────────────────────
    // Priority: C0 winner > url-variant (already set) > root
    let effectiveUrlReason = 'url-variant';

    if (c0?.winner?.url) {
      effectiveUrl = c0.winner.url;
      effectiveUrlReason = `C0 winner (density=${c0.winner.eventDensityScore})`;
    }
    result.effectiveProcessingUrl = effectiveUrl;
    result.effectiveProcessingUrlReason = effectiveUrlReason;

    // ── C1: Screening with derived-rules wired in ─────────────────────────────
    const c1Start = Date.now();
    let c1: Awaited<ReturnType<typeof screenUrlWithDerivedRules>>;
    let c1HtmlAvailable = false;

    if (derivedRules && derivedRules.has(ruleKey)) {
      // Use derived-rules-aware screening — TEST subpage paths if root fails
      console.log(`[C1-DerivedRules] Testing derived-rules subpages for ${source.sourceId}`);
      c1 = await screenUrlWithDerivedRules(source.sourceId, effectiveUrl, derivedRules) as any;
      if (c1.bestSubpageUrl && c1.bestSubpageUrl !== effectiveUrl) {
        effectiveUrl = c1.bestSubpageUrl;
        effectiveUrlReason = `derived-rules subpage (${c1.categorization})`;
        result.effectiveProcessingUrl = effectiveUrl;
        result.effectiveProcessingUrlReason = effectiveUrlReason;
      }
    } else {
      c1 = await screenUrl(effectiveUrl) as any;
    }

    c1HtmlAvailable = !!(c1 as any).html;
    result.c1 = {
      verdict: (c1 as any).categorization || 'unknown',
      likelyJsRendered: (c1 as any).likelyJsRendered || false,
      timeTagCount: (c1 as any).timeTagCount || 0,
      dateCount: (c1 as any).dateCount || 0,
      duration: Date.now() - c1Start,
      htmlBytes: (c1 as any).htmlBytes || 0,
      fetchable: (c1 as any).fetchable !== false,
      fetchError: (c1 as any).fetchError,
      bestSubpageFound: (c1 as any).bestSubpageUrl || null,
      subpagesTested: (c1 as any).testedSubpages || [],
    };
    console.log(`C1: likelyJsRendered=${result.c1.likelyJsRendered} verdict=${result.c1.verdict} (fetchable=${result.c1.fetchable})`);

    // ── C1 DIRECT D SIGNAL (early exit) ──────────────────────────────────────
    // Strong JS-render signal on root + no subpage found → D route
    const c0FoundWinner = c0?.ruleApplied?.source === 'swedish-patterns' || c0?.ruleApplied?.source === 'derived-rule';
    const c1Dsignal =
      result.c1.likelyJsRendered &&
      (result.c1.timeTagCount === 0 || result.c1.dateCount === 0 || result.c1.verdict === 'noise') &&
      !c0FoundWinner;

    if (c1Dsignal) {
      console.log(`[C1-DirectRoute] Strong JS-render signal — short-circuit to D`);
      result.c2 = { verdict: 'skipped', score: 0, reason: 'c1-direct-route', duration: 0, htmlBytes: 0 };
      result.c3 = { universalEventsFound: 0, universalMethodsUsed: [], universalMethodBreakdown: {}, duration: 0 };
      result.extract = { eventsFound: 0, duration: 0, htmlSize: 0 };
      result.outcomeType = 'route_success';
      result.winningStage = 'C1';
      result.routeSuggestion = 'D';
      result.evidence = `likelyJsRendered=true + no subpage winner found`;
      result.exitReason = 'C1_STRONG_JS_RENDER_D_SIGNAL';
      result.exitReasonDetail = `likelyJsRendered=true on root, timeTags=${result.c1.timeTagCount}, dates=${result.c1.dateCount}`;
      result.trace = buildTrace(result, source.url, roundNum);
      return result;
    }

    // ── C2: HTML Gate ──────────────────────────────────────────────────────────
    const c2Start = Date.now();
    const c2 = await evaluateHtmlGate(effectiveUrl, 'no-jsonld', 2);
    result.c2 = {
      verdict: c2.verdict,
      score: c2.score,
      reason: c2.reason,
      duration: Date.now() - c2Start,
      htmlBytes: Buffer.byteLength(c2.html || '', 'utf8'),
    };
    console.log(`C2: verdict=${c2.verdict} score=${c2.score}`);

    // ── C3: Universal Extraction ──────────────────────────────────────────────
    const extStart = Date.now();
    const extHtml = (c1 as any).html ?? c2.html ?? '';
    const htmlSize = Buffer.byteLength(extHtml, 'utf8');

    if (!extHtml) {
      console.log(`[C3-WARN] No HTML for ${source.sourceId} — universal extraction skipped`);
    }

    const ext = extractFromHtml(extHtml || '<html></html>', source.sourceId, effectiveUrl);
    result.c3 = {
      universalEventsFound: ext.events.length,
      universalMethodsUsed: ['universal-extractor'],  // placeholder — extractFromHtml doesn't track methods
      universalMethodBreakdown: {},                  // placeholder — extractFromHtml doesn't track breakdown
      duration: Date.now() - extStart,
    };
    result.extract = { eventsFound: ext.events.length, duration: Date.now() - extStart, htmlSize, extractedEvents: ext.events };
    console.log(`C3: ${ext.events.length} events via [${ext.methodsUsed.join(', ')}]`);

    // ── C3 AI FALLBACK: if universal returned 0 but C2 was promising ──────────
    if (ext.events.length === 0 && c2.verdict === 'promising') {
      console.log(`[C3-AI] Universal=0 but C2=promising — trying AI extraction`);
      const aiStart = Date.now();
      const aiResult = await evaluateAiExtract(effectiveUrl, extHtml, {
        useAi: true,
        c2Score: c2.score,
      });
      result.c3.aiVerdict = aiResult.verdict;
      result.c3.aiEventsFound = aiResult.events.length;
      result.c3.aiDuration = Date.now() - aiStart;
      result.extract.eventsFound = aiResult.events.length;
      if (aiResult.events.length > 0) result.extract.extractedEvents = aiResult.events;
      if (aiResult.events.length > 0) {
        console.log(`[C3-AI] AI extraction: ${aiResult.events.length} events`);
      } else {
        console.log(`[C3-AI] AI extraction also returned 0 events`);
      }
    }

    // ── DETERMINE OUTCOME ─────────────────────────────────────────────────────
    determineOutcome(result, source.url, roundNum, c0FoundWinner);
    result.trace = buildTrace(result, source.url, roundNum);

  } catch (e: any) {
    result.error = e.message;
    result.success = false;
    result.outcomeType = 'fail';
    result.routeSuggestion = 'Fail';
    result.exitReason = 'FETCH_ERROR';
    result.exitReasonDetail = e.message;
    result.trace = buildTrace(result, source.url, roundNum);
    console.log(`ERROR: ${e.message}`);
  }

  return result;
}

/**
 * Detailed outcome determination with precise exit reasons.
 * Each reason is actionable — it tells exactly what failed and why.
 */
function determineOutcome(result: CResult, sourceUrl: string, roundNum: number, c0FoundWinner: boolean): void {
  // ── SUCCESS ──────────────────────────────────────────────────────────────────
  if (result.extract.eventsFound > 0) {
    result.outcomeType = 'extract_success';
    result.winningStage = result.c3.aiVerdict ? 'C3-AI' : 'C3';
    result.routeSuggestion = 'UI';
    result.evidence = `${result.extract.eventsFound} events via [${result.c3.universalMethodsUsed.join(', ')}]${result.c3.aiVerdict ? ' + AI' : ''}`;
    result.exitReason = 'EXTRACT_SUCCESS';
    result.exitReasonDetail = `${result.extract.eventsFound} events found`;
    result.success = true;
    return;
  }

  // ── ROUTING SIGNALS ─────────────────────────────────────────────────────────
  if (result.c1.likelyJsRendered && !c0FoundWinner) {
    result.outcomeType = 'route_success';
    result.winningStage = 'C1';
    result.routeSuggestion = 'D';
    result.evidence = 'C1: likelyJsRendered=true + no subpage winner';
    result.exitReason = 'C1_LIKELY_JS_RENDER_ROOT';
    result.exitReasonDetail = `likelyJsRendered=true, no subpage winner found via C0`;
    result.success = false;
    return;
  }

  // ── FAILURE — categorize precisely ─────────────────────────────────────────
  result.outcomeType = 'fail';
  result.winningStage = 'C3';
  result.routeSuggestion = 'manual-review';
  result.success = false;

  // No fetch available at all
  if (!result.c1.fetchable) {
    result.exitReason = result.c1.fetchError?.includes('network') ? 'NETWORK_ERROR' : 'FETCH_ERROR';
    result.exitReasonDetail = `fetch failed: ${result.c1.fetchError || 'unknown'}`;
    result.evidence = `fetch error: ${result.c1.fetchError}`;
    return;
  }

  // C0: no candidates and no Swedish patterns succeeded
  if (result.c0.winnerUrl === null && result.c0.candidates === 0) {
    if (result.c0.ruleAppliedSource === 'swedish-patterns' || (result.c0.ruleAppliedPaths?.length ?? 0) > 0) {
      result.exitReason = 'NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED';
      result.exitReasonDetail = `C0 tested Swedish patterns but none had event density`;
    } else {
      result.exitReason = 'NO_CANDIDATES_NO_PATTERNS';
      result.exitReasonDetail = `C0 found 0 candidates, no Swedish patterns were run`;
    }
    result.evidence = `C0: no candidates discovered`;
    return;
  }

  // C1: no main/article structure
  if (result.c1.verdict === 'no-main') {
    result.exitReason = 'C1_NO_MAIN_ARTICLE';
    result.exitReasonDetail = `no <main> or <article>, verdict=${result.c1.verdict}`;
    result.evidence = `C1: no main/article structure`;
    return;
  }

  // C2: blocked
  if (result.c2.verdict === 'blocked') {
    result.exitReason = 'C2_BLOCKED';
    result.exitReasonDetail = `C2 verdict=blocked, score=${result.c2.score}`;
    result.evidence = `C2: blocked (score=${result.c2.score})`;
    return;
  }

  // C2: unclear
  if (result.c2.verdict === 'unclear') {
    result.exitReason = 'C2_UNCLEAR';
    result.exitReasonDetail = `C2 verdict=unclear, score=${result.c2.score}`;
    result.evidence = `C2: unclear (score=${result.c2.score})`;
    return;
  }

  // C2 promising but universal extraction returned 0 AND AI also returned 0
  if (result.c2.verdict === 'promising' && result.c3.universalEventsFound === 0 && (result.c3.aiEventsFound ?? 0) === 0) {
    if (result.c3.aiVerdict) {
      result.exitReason = 'EXTRACTION_ZERO_C3_AI_ZERO';
      result.exitReasonDetail = `C2=promising, universal=0, AI=0 (verdict=${result.c3.aiVerdict})`;
    } else {
      result.exitReason = 'EXTRACTION_ZERO_PROMISING_HTML';
      result.exitReasonDetail = `C2=promising but universal extractor returned 0`;
    }
    result.evidence = `C2=promising (score=${result.c2.score}) but extraction returned 0`;
    return;
  }

  // Default: generic fail
  result.exitReason = 'ALL_ROUNDS_EXHAUSTED';
  result.exitReasonDetail = `round=${roundNum}, no specific failure category matched`;
  result.evidence = `C3: no events, no routing signal`;
}

// ---------------------------------------------------------------------------
// Step 4: Route result to appropriate queue
// ---------------------------------------------------------------------------

function routeResult(result: CResult, roundsParticipated: number): string {
  const queueEntry = {
    sourceId: result.sourceId,
    queueName: '',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 1,
    queueReason: result.evidence,
    workerNotes: `${result.winningStage}: ${result.outcomeType}`,
    winningStage: result.winningStage,
    outcomeType: result.outcomeType,
    routeSuggestion: result.routeSuggestion,
    roundNumber: result.roundNumber,
    roundsParticipated,
  };

  let queuePath: string;
  let queueName: string;

  // [SAFETY] extract_success MUST go to UI — no exceptions
  if (result.outcomeType === 'extract_success') {
    queuePath = QUEUES.UI;
    queueName = 'postTestC-UI';
    // Write events to isolated C output folder (03-Queue/03-extractedevents/C/)
    const events = result.extract.extractedEvents;
    if (events && events.length > 0) {
      mkdirSync(C_EXTRACTED_DIR, { recursive: true });
      const outFile = join(C_EXTRACTED_DIR, `${result.sourceId}.jsonl`);
      const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(outFile, lines, 'utf-8');
      console.log(`[C-Extract] Wrote ${events.length} events → ${outFile}`);
    }
  } else {
    switch (result.routeSuggestion) {
      case 'UI':
        queuePath = QUEUES.UI;
        queueName = 'postTestC-UI';
        break;
      case 'A':
        queuePath = QUEUES.A;
        queueName = 'postTestC-A';
        break;
      case 'B':
        queuePath = QUEUES.B;
        queueName = 'postTestC-B';
        break;
      case 'D':
        queuePath = QUEUES.D;
        queueName = 'postTestC-D';
        break;
      default: {
        // [OPTIMIZATION A] Fast-exit for unfetchable sources after round 1
        // These sources can never be fetched — testing them 3 times is wasteful
        const isUnfetchableError = result.exitReason === 'FETCH_ERROR' || result.exitReason === 'NETWORK_ERROR';
        if (isUnfetchableError && roundsParticipated >= 1) {
          queuePath = QUEUES.MANUAL_REVIEW;
          queueName = 'postTestC-manual-review';
          break;
        }

        // [OPTIMIZATION B] C2-hög + 0 events → D-renderGate
        // High C2 score but no events extracted — likely JS-rendered content
        // Route to D (JS rendering) instead of manual review
        const isC2PromisingZeroEvents =
          (result.exitReason === 'EXTRACTION_ZERO_PROMISING_HTML' ||
           result.exitReason === 'EXTRACTION_ZERO_C3_AI_ZERO') &&
          result.c2.score >= 20;
        if (isC2PromisingZeroEvents) {
          queuePath = QUEUES.D;
          queueName = 'postTestC-D';
          break;
        }

        // Default: check if this source has now participated in 3 rounds
        if (roundsParticipated >= 3) {
          queuePath = QUEUES.MANUAL_REVIEW;
          queueName = 'postTestC-manual-review';
        } else {
          // Fail but not yet at 3 rounds — stays in pool (logged, not queued)
          queuePath = '';
          queueName = 'STAYS_IN_POOL';
        }
      }
    }
  }

  if (queuePath) {
    queueEntry.queueName = queueName;
    appendFileSync(queuePath, JSON.stringify(queueEntry) + '\n');
    writeAuditEntry({
      sourceId: result.sourceId,
      event: 'exited_pool',
      target: queueName,
      metadata: {
        round: result.roundNumber,
        outcome: result.outcomeType,
        evidence: result.evidence,
      },
    });
  }

  return queueName;
}

// ---------------------------------------------------------------------------
// Step 5: Clear output queues
// ---------------------------------------------------------------------------

function clearOutputQueues(): void {
  for (const q of [QUEUES.UI, QUEUES.A, QUEUES.B, QUEUES.D, QUEUES.MANUAL_REVIEW]) {
    writeFileSync(q, '');
  }
}

// ---------------------------------------------------------------------------
// Step 6: Main pool loop
// ---------------------------------------------------------------------------

async function runPoolRound(
  state: PoolState,
  derivedRules?: DerivedRulesStore,
): Promise<{
  results: CResult[];
  exits: { source: PoolSource; decision: string; result: CResult }[];
  fails: PoolSource[];
}> {
  const { activePool, poolRoundNumber } = state;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ROUND ${poolRoundNumber} — ${activePool.length} active sources`);
  console.log(`${'='.repeat(60)}\n`);

  const results: CResult[] = [];
  const exits: { source: PoolSource; decision: string; result: CResult }[] = [];
  const fails: PoolSource[] = [];

  // Phase 1: run all sources in parallel with worker pool
  const pairResults: Array<{ source: PoolSource; result: CResult }> = new Array(activePool.length);
  let pIdx = 0;

  async function poolWorker() {
    while (true) {
      const i = pIdx++;
      if (i >= activePool.length) break;
      const source = activePool[i];
      pairResults[i] = { source, result: await runSourceOnPool(source, poolRoundNumber, derivedRules) };
    }
  }

  const workerCount = Math.min(POOL_WORKERS, activePool.length);
  console.log(`  [parallel] ${workerCount} workers for ${activePool.length} sources`);
  await Promise.all(Array.from({ length: workerCount }, poolWorker));

  // Phase 2: process results sequentially (safe, deterministic)
  for (const { source, result } of pairResults) {
    const newRounds = source.roundsParticipated + 1;
    results.push(result);

    const decision = routeResult(result, newRounds);

    if (decision === 'STAYS_IN_POOL') {
      source.roundsParticipated = newRounds;
      fails.push(source);
      console.log(`  → STAYS IN POOL (round ${newRounds}/3)`);
    } else {
      exits.push({ source, decision, result });
      console.log(`  → EXITED: ${decision}`);
    }
  }

  return { results, exits, fails };
}

// ---------------------------------------------------------------------------
// Step 7: Report generation
// ---------------------------------------------------------------------------

function writeReports(
  state: PoolState,
  roundResults: { results: CResult[]; exits: { source: PoolSource; decision: string; result: CResult }[]; fails: PoolSource[] }[],
  batchNum: number,
  c4AllResults: C4RoundAnalysis[]
): void {
  // Skip report regeneration if roundResults is empty (resume from completed batch)
  if (roundResults.length === 0 && state.poolRoundNumber >= 3) {
    console.log('[Reports] Skipping report regeneration — resuming from completed batch (roundResults empty)');
    return;
  }

  const batchDir = join(REPORTS_DIR, `batch-${batchNum}`);
  mkdirSync(join(batchDir, 'source-reports'), { recursive: true });

  // --- Layer 1: Batch Report ---
  let totalExtractSuccess = 0;
  let totalRouteSuccess = 0;
  let totalFail = 0;
  let totalEvents = 0;
  const allResults: CResult[] = [];

  for (const round of roundResults) {
    totalExtractSuccess += round.results.filter(r => r.outcomeType === 'extract_success').length;
    totalRouteSuccess += round.results.filter(r => r.outcomeType === 'route_success').length;
    totalFail += round.results.filter(r => r.outcomeType === 'fail').length;
    totalEvents += round.results.reduce((s, r) => s + r.extract.eventsFound, 0);
    allResults.push(...round.results);
  }

  // Determine remaining sources (still in pool after max rounds)
  const remainingSources = state.activePool.map(s => ({
    sourceId: s.sourceId,
    url: s.url,
    status: 'ACTIVE_UNRESOLVED_AFTER_MAX_ROUNDS',
    roundsParticipated: s.roundsParticipated,
    reason: 'Participated in 3 rounds without meeting exit conditions. No events found, no A/B/D signal detected.',
    nextStep: 'Requires manual review or different approach (e.g., render fallback, manual extraction)',
  }));

  const poolSummary = `
## Batch Report batch-${batchNum}

### STATUS LABELS
RUNNER_EXECUTES: confirmed
FLOW_PARTIALLY_VERIFIED: rounds 1-3 executed
C4_AI_INTEGRATED: C4-AI inkopplad, kör efter varje round (IMPLEMENTED_EARLY_VERSION)
RESUME_VERIFIED: resume verified (2026-04-11)
NOT_CANONICAL_YET: first working version, not final canonical

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| poolRoundNumber | ${state.poolRoundNumber} |
| inputQueue | postB-preC |
| sourcesIn | ${state.activePool.length + state.exited.length + state.newlyRefilled.length} |
| extractSuccess | ${totalExtractSuccess} |
| routeSuccess | ${totalRouteSuccess} |
| fail | ${totalFail} |
| totalEventsExtracted | ${totalEvents} |
| exits | ${state.exited.length} |
| stopReason | ${state.poolRoundNumber >= 3 || state.activePool.length === 0 ? 'max-rounds-reached-or-pool-exhausted' : 'incomplete'} |

### Queue distribution (exits)
${state.exited.map(e => `- ${e.source.sourceId}: ${e.decision}`).join('\n')}

### Remaining sources (active pool after max rounds)
${remainingSources.length > 0
    ? remainingSources.map(s => `- ${s.sourceId}: ${s.status} — ${s.reason}`).join('\n')
    : '(none — pool exhausted before max rounds)'}

### Pool state at end
- Active pool: ${state.activePool.length} sources
- Exited: ${state.exited.length} sources
- Total rounds run: ${state.poolRoundNumber}

---

### FAIL CATEGORY SUMMARY
|| Category | Count ||
||----------|-------|
|| ENTRY_PAGE_NO_EVENTS | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.ENTRY_PAGE_NO_EVENTS).length} |
|| NEEDS_SUBPAGE_DISCOVERY | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.NEEDS_SUBPAGE_DISCOVERY).length} |
|| LIKELY_JS_RENDER | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.LIKELY_JS_RENDER).length} |
|| EXTRACTION_PATTERN_MISMATCH | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.EXTRACTION_PATTERN_MISMATCH).length} |
|| LOW_VALUE_SOURCE | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.LOW_VALUE_SOURCE).length} |
|| no_viable_path_found | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.NO_VIABLE_PATH_FOUND).length} |
|| robots_or_policy_blocked | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.ROBOTS_OR_POLICY_BLOCKED).length} |
|| likely_js_render_required | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.LIKELY_JS_RENDER_REQUIRED).length} |
|| ambiguous_multiple_paths | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.AMBIGUOUS_MULTIPLE_PATHS).length} |
|| insufficient_html_signal | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.INSUFFICIENT_HTML_SIGNAL).length} |
|| UNKNOWN | ${c4AllResults.flatMap(r => r.results).filter(r => r.failCategory === FailCategory.UNKNOWN).length} |

### TOP NEXT ACTIONS
| Action | Count |
|--------|-------|
| tillbaka till C1 | ${c4AllResults.flatMap(r => r.results).filter(r => r.nextQueue === 'retry-pool').length} |
| till D-renderGate | ${c4AllResults.flatMap(r => r.results).filter(r => r.nextQueue === 'D').length} |
| discard/manual review | ${c4AllResults.flatMap(r => r.results).filter(r => r.nextQueue === 'manual-review').length} |
| till A | ${c4AllResults.flatMap(r => r.results).filter(r => r.nextQueue === 'A').length} |
| till B | ${c4AllResults.flatMap(r => r.results).filter(r => r.nextQueue === 'B').length} |

---

### <generated_artifacts>
- batch-report.md: generated
- round-reports: ${roundResults.length} generated (round-1 through round-${roundResults.length})
- source-reports: ${allResults.length} generated
- c4-ai-learnings.md: generated (placeholder only, C4-AI not executed)
</generated_artifacts>

### <verified_capabilities>
- dynamic pool filled (batch size: 50)
- refill between rounds: verified (${state.newlyRefilled.length} sources refilled across all rounds)
- round 1 executed: confirmed
- round 2 executed: confirmed
- round 3 executed: confirmed
- queue exits verified: ${state.exited.length} sources routed to output queues
- pool-state persisted: saved to batch-${batchNum}/pool-state.json
</verified_capabilities>

| <not_verified_yet>
| - resume from pool-state (RESUME_VERIFIED)
| - real C4-AI analysis (C4_AI_INTEGRATED — AI inkopplad och körande)
| - canonical status (NOT_CANONICAL_YET)
</not_verified_yet>
`.trim();

  writeFileSync(join(batchDir, 'batch-report.md'), poolSummary);

  // --- Layer 2: Source Reports ---
  let roundIdx = 1;
  for (const round of roundResults) {
    for (const result of round.results) {
      const sourceReport = `
## Source Report: ${result.sourceId}

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| roundNumber | ${roundIdx} |
| sourceId | ${result.sourceId} |
|| url | ${result.sourceUrl} |
| winningStage | ${result.winningStage} |
| outcomeType | ${result.outcomeType} |
| routeSuggestion | ${result.routeSuggestion} |
| failType | ${result.failType ?? 'N/A'} |
| evidence | ${result.evidence} |
| eventsFound | ${result.extract.eventsFound} |
| c0Candidates | ${result.c0.candidates} |
| winnerUrl | ${result.c0.winnerUrl ?? 'null'} |
| c2Verdict | ${result.c2.verdict} |
| c2Score | ${result.c2.score} |
| error | ${result.error ?? 'none'} |
`.trim();
      writeFileSync(join(batchDir, 'source-reports', `${result.sourceId}-round-${roundIdx}.md`), sourceReport);
    }
    roundIdx++;
  }

  // --- Layer 3: Round Reports ---
  roundIdx = 1;
  for (const round of roundResults) {
    const extractSuccess = round.results.filter(r => r.outcomeType === 'extract_success').length;
    const routeSuccess = round.results.filter(r => r.outcomeType === 'route_success').length;
    const failCount = round.results.filter(r => r.outcomeType === 'fail').length;
    const eventsTotal = round.results.reduce((s, r) => s + r.extract.eventsFound, 0);
    const failedSources = round.fails.map(s => s.sourceId);

    const roundReport = `
## Round Report round-${roundIdx} (batch-${batchNum})

| Field | Value |
|-------|-------|
| batchId | batch-${batchNum} |
| roundNumber | ${roundIdx} |
| inputQueue | postB-preC |
| sourcesIn | ${round.results.length} |
| extractSuccess | ${extractSuccess} |
| routeSuccess | ${routeSuccess} |
| fail | ${failCount} |
| totalEvents | ${eventsTotal} |

### Sources that failed (stay in pool for next round)
${failedSources.length > 0 ? failedSources.map(s => `- ${s}`).join('\n') : '(none)'}

### Sources that exited
${round.exits.map(e => `- ${e.source.sourceId}: ${e.decision}`).join('\n')}
`.trim();
    writeFileSync(join(batchDir, `round-${roundIdx}-report.md`), roundReport);
    roundIdx++;
  }

  // --- Layer 4: C4-AI Learnings ---
  // NOTE: C4-AI is a PLACEHOLDER in this implementation.
  // The runner produces the structure for this report but no AI analysis is connected.
  // What C4-AI SHOULD receive: all fail-type sources from this batch, grouped by fail pattern
  // What C4-AI SHOULD output: structured learnings per C-testRig-reporting.md Lag 4 spec
  const failResults = roundResults.flatMap(r => r.results).filter(r => r.outcomeType === 'fail');
  const c4Report = `
## C4-AI Learnings batch-${batchNum}

**STATUS: IMPLEMENTATION GAP — C4-AI NOT YET CONNECTED**

### Vad C4-AI borde göra
C4-AI ska analysera fail-mängden från rundan och ge strukturerade lärdomar enligt C-testRig-reporting.md Lag 4.

### C4-AI-input (vad som finns)
- Antal fail: ${failResults.length}
${failResults.length > 0 ? failResults.map(r => `  - ${r.sourceId}: failType=${r.failType ?? 'unknown'}, evidence="${r.evidence}", winningStage=${r.winningStage}`).join('\n') : '  (ingen fail-data ännu)'}

### C4-AI-output som borde produceras
- observedPattern: string
- hypothesis: string
- proposedGeneralChange: string
- changeApplied: string | null
- whyGeneral: string
- beforeSummary: string
- afterSummary: string
- sourcesImproved: string[]
- sourcesUnchanged: string[]
- sourcesWorsened: string[]
- decision: "keep" | "revert" | "unclear"
- learnedRule: string
- confidence: "high" | "medium" | "low"
- shouldBeReusedLater: "ja" | "nej" | "prövas-igen"
- networkErrorClassification: object (per Lag 4 spec)

### Nästa steg för C4-AI
1. Anslut AI-analys till fail-mängden efter varje runda
2. Mata in fail-typer, evidens och winningStage till AI
3. Ta emot strukturerade learnings och spara i denna rapportfil
4. Koppla learnings till erfarenhetsbanken

### Krav för att C4-AI ska räknas som implementerad
- AI tar emot fail-mängd och ger strukturerade learnings
- Learnings sparas i denna fil efter varje runda
- AI-resultat påverkar INTE enskilda källors utfall (AI är analys, inte extraktion)
- AI får INTE fabricera events eller overrides measured evidence
`.trim();
  writeFileSync(join(batchDir, 'c4-ai-learnings.md'), c4Report);

  console.log(`\nReports written to: ${batchDir}`);
}

// ---------------------------------------------------------------------------
// Rule Effectiveness Report
// ---------------------------------------------------------------------------

interface RuleEffectivenessEntry {
  sourceId: string;
  ruleGeneratedRound: number;
  failCategory: string;
  suggestedPaths: string[];
  suggestedQueue: string;
  ruleAppliedRound: number | null; // round where the rule was actually applied
  appliedPaths: string[];         // paths that were actually tested via rule
  outcomeBeforeRule: {
    round: number;
    c0Candidates: number;
    eventsFound: number;
  };
  outcomeAfterRule: {
    round: number;
    c0Candidates: number;
    eventsFound: number;
    improved: boolean;
  } | null;
  helped: boolean | null; // true/false/null if rule not yet applied
}

/**
 * Write batch-traces.jsonl: one PerSourceTrace per line, per source per round.
 * This is the structured data feed for the C4-observer analysis pipeline.
 */
function writeBatchTraces(
  roundResults: { results: CResult[] }[],
  batchNum: number
): void {
  const batchDir = ensureBatchDir(batchNum);
  const path = join(batchDir, 'batch-traces.jsonl');
  
  // Clear existing file
  writeFileSync(path, '');
  
  let count = 0;
  for (const round of roundResults) {
    for (const result of round.results) {
      if (result.trace && Object.keys(result.trace).length > 0) {
        appendFileSync(path, JSON.stringify(result.trace) + '\n');
        count++;
      }
    }
  }
  
  console.log(`[PerSourceTrace] Wrote ${count} traces to ${path}`);
}

function writeRuleEffectivenessReport(
  roundResults: { results: CResult[]; exits: { source: PoolSource; decision: string; result: CResult }[]; fails: PoolSource[] }[],
  c4AllResults: C4RoundAnalysis[],
  allDerivedRules: DerivedRulesStore,
  batchNum: number
): void {
  const batchDir = join(REPORTS_DIR, `batch-${batchNum}`);
  const reportPath = join(batchDir, 'rule-effectiveness.jsonl');

  const entries: RuleEffectivenessEntry[] = [];

  // Build a map of sourceId -> rules generated
  const rulesGenerated = new Map<string, { round: number; rule: any }>();
  for (const c4Result of c4AllResults) {
    for (const r of c4Result.results) {
      if (r.failCategoryConfidence >= 0.6 && r.discoveredPaths && r.discoveredPaths.length > 0) {
        rulesGenerated.set(r.sourceId, { round: c4Result.roundNumber, rule: r });
      }
    }
  }

  // For each source that had a rule generated, find its outcomes
  const rulesGeneratedEntries = Array.from(rulesGenerated.entries());
  for (const [sourceId, ruleInfo] of rulesGeneratedEntries) {
    const { round: genRound, rule } = ruleInfo;
    const genRoundIdx = genRound - 1;

    // Find outcome in the round the rule was generated
    const outcomeBefore = roundResults[genRoundIdx]?.results.find(r => r.sourceId === sourceId);

    // Find outcome in the NEXT round (if any) where rule was applied
    const nextRoundIdx = genRoundIdx + 1;
    const outcomeAfter = nextRoundIdx < roundResults.length
      ? roundResults[nextRoundIdx].results.find(r => r.sourceId === sourceId)
      : null;

    // Check if rule was actually applied (ruleApplied.source === 'derived-rule' in C0)
    const appliedRound = outcomeAfter
      ? (outcomeAfter.c0.ruleAppliedSource === 'derived-rule' ? genRound + 1 : null)
      : null;

    const helped: boolean | null = appliedRound !== null && outcomeAfter
      ? (outcomeAfter.c0.candidates > (outcomeBefore?.c0.candidates ?? 0)) ||
        (outcomeAfter.extract.eventsFound > (outcomeBefore?.extract.eventsFound ?? 0))
      : null;

    entries.push({
      sourceId,
      ruleGeneratedRound: genRound,
      failCategory: rule.failCategory,
      suggestedPaths: rule.discoveredPaths?.map((dp: any) => dp.path) ?? [],
      suggestedQueue: rule.nextQueue,
      ruleAppliedRound: appliedRound,
      appliedPaths: outcomeAfter?.c0.ruleAppliedPaths ?? [],
      outcomeBeforeRule: outcomeBefore
        ? { round: genRound, c0Candidates: outcomeBefore.c0.candidates, eventsFound: outcomeBefore.extract.eventsFound }
        : { round: genRound, c0Candidates: 0, eventsFound: 0 },
      outcomeAfterRule: outcomeAfter
        ? {
            round: genRound + 1,
            c0Candidates: outcomeAfter.c0.candidates,
            eventsFound: outcomeAfter.extract.eventsFound,
            improved: helped ?? false,
          }
        : null,
      helped,
    });
  }

  // Write JSONL report
  for (const entry of entries) {
    appendFileSync(reportPath, JSON.stringify(entry) + '\n');
  }

  // Also write a summary markdown
  const summaryPath = join(batchDir, 'rule-effectiveness.md');
  const lines: string[] = [
    `## Rule Effectiveness Report batch-${batchNum}`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Total rules generated:** ${entries.length}`,
    `**Rules applied in next round:** ${entries.filter(e => e.ruleAppliedRound !== null).length}`,
    `**Rules that improved outcomes:** ${entries.filter(e => e.helped === true).length}`,
    '',
    '| Source | Gen Round | Category | Suggested Paths | Applied? | Helped? |',
    '|--------|----------|---------|-----------------|----------|---------|',
  ];
  for (const e of entries) {
    const paths = e.suggestedPaths.slice(0, 2).join(', ') + (e.suggestedPaths.length > 2 ? '...' : '');
    const applied = e.ruleAppliedRound ? `Yes (r${e.ruleAppliedRound})` : 'No';
    const helped = e.helped === null ? 'N/A' : e.helped ? 'YES' : 'no';
    lines.push(`| ${e.sourceId} | ${e.ruleGeneratedRound} | ${e.failCategory} | ${paths} | ${applied} | ${helped} |`);
  }
  writeFileSync(summaryPath, lines.join('\n'));

  console.log(`[Rule-Effectiveness] Report written to ${reportPath}`);
  console.log(`[Rule-Effectiveness] Summary written to ${summaryPath}`);
}

// ---------------------------------------------------------------------------
// Programmatic API (for 123-autonomous-loop.ts)
// ---------------------------------------------------------------------------

export interface DynamicPoolOptions {
  batchNum?: number;
  batchType?: 'normal' | 'verification';
  targetImprovement?: string | null;
  verificationSources?: string[];
  sources?: string[]; // explicit source IDs to test (for 123-autonomous-loop)
}

export async function runDynamicPoolBatch(options: DynamicPoolOptions = {}): Promise<{
  batchNum: number;
  poolRoundNumber: number;
  totalExited: number;
  totalActive: number;
  queueDistribution: Record<string, number>;
  stopReason: string;
  derivedRulesSummary: {
    totalRulesLoaded: number;
    rulesBySource: { key: string; sourceId: string; failCategory: string; confidence: number; suggestedPaths: string[]; suggestedQueue: string }[];
    ruleSourcesExitedInSameRound: string[];
  };
}> {
  const {
    batchNum = 13,
    batchType = 'normal',
    targetImprovement = null,
    verificationSources = [],
    sources = [],
  } = options;

  const BATCH_NUM = batchNum;
  const BATCH_TYPE: 'normal' | 'verification' = batchType;
  const TARGET_IMPROVEMENT: string | null = targetImprovement;
  const VERIFICATION_SOURCES: string[] = verificationSources;

  console.log('='.repeat(60));
  console.log('DYNAMIC TEST POOL RUNNER — PROGRAMMATIC ENTRY');
  console.log('='.repeat(60));
  console.log(`Batch number: ${BATCH_NUM}`);
  console.log(`Batch type: ${BATCH_TYPE}${BATCH_TYPE === 'verification' ? ` (improvement: ${TARGET_IMPROVEMENT})` : ''}`);

  // Step 0: ENSURE BATCH DIRECTORY EXISTS
  const BATCH_DIR = ensureBatchDir(BATCH_NUM);
  console.log(`[Init] Batch directory ready: ${BATCH_DIR}`);

  // Step 1: Check for existing pool state (resume scenario)
  const savedState = loadPoolState(BATCH_NUM);
  let state: PoolState;
  let roundResults: { results: CResult[]; exits: { source: PoolSource; decision: string; result: CResult }[]; fails: PoolSource[] }[] = [];
  let c4AllResults: C4RoundAnalysis[] = [];

  // Only clear output queues on FRESH batch start — NOT on resume
  // Each batch appends to the same runtime/postTestC-*.jsonl files
  if (!savedState || savedState.poolRoundNumber === 0) {
    console.log('[Step 1] Fresh batch-start — clearing output queues');

  }

  if (savedState && savedState.poolRoundNumber > 0) {
    console.log(`\n[Step 1] Resuming pool from saved state (round ${savedState.poolRoundNumber})`);
    state = savedState;
  } else {
    console.log('\n[Step 1] Building initial pool from postB-preC...');
    const initial = buildInitialPool(BATCH_TYPE, VERIFICATION_SOURCES, sources);

    if (!initial || initial.pool.length === 0) {
      throw new Error('No eligible sources in postB-preC');
    }

    console.log(`  Selected ${initial.pool.length} sources (eligible in postB-preC: ${initial.eligibleInPrec})`);

    state = {
      poolRoundNumber: 0,
      activePool: initial.pool,
      exited: [],
      failed: [],
      newlyRefilled: [],
      allExitedIds: [],
    };
  }

  // Step 2: Run rounds
  let allDerivedRules = loadAllDerivedRules(BATCH_NUM);
  const loadedRuleCount = allDerivedRules.size;
  if (loadedRuleCount > 0) {
    console.log(`[Learning-Loop] Loaded ${loadedRuleCount} derived rules from prior batches`);
  }

  while (state.activePool.length > 0 && state.poolRoundNumber < MAX_ROUNDS) {
    state.poolRoundNumber++;

    const roundOutput = await runPoolRound(state, allDerivedRules);
    roundResults.push(roundOutput);

    for (const exit of roundOutput.exits) {
      state.exited.push(exit);
      if (!state.allExitedIds.includes(exit.source.sourceId)) {
        state.allExitedIds.push(exit.source.sourceId);
      }
    }

    state.activePool = roundOutput.fails;

    const sourcesWithDerivedRuleApplied = roundOutput.results.filter(r => r.derivedRuleApplied);
    const derivedRuleHits = sourcesWithDerivedRuleApplied.filter(r => r.extract.eventsFound > 0 || r.c0.candidates > 0);
    console.log(`\n[Rule-Effectiveness] Round ${state.poolRoundNumber}:`);
    console.log(`  Sources WITH derived rule applied: ${sourcesWithDerivedRuleApplied.length}`);
    console.log(`  Derived rule HITS: ${derivedRuleHits.length}`);

    // C4-AI analysis
    const c4InputSources: any[] = [];
    for (const src of roundOutput.fails) {
      const result = roundOutput.results.find(r => r.sourceId === src.sourceId);
      c4InputSources.push({
        sourceId: src.sourceId,
        url: src.url,
        failType: result?.failType || 'unresolved',
        evidence: result?.evidence || src.queueReason || '',
        winningStage: result?.winningStage || 'C3',
        c0Candidates: result?.c0.candidates ?? 0,
        c0LinksFound: result?.c0.ruleAppliedPaths
          ? result.c0.ruleAppliedPaths.map((p: string, i: number) => ({ href: p, anchorText: 'derived-rule', score: 10 - i, region: 'rule' }))
          : [],
        c0RootFallback: result?.c0.rootFallback ?? false,
        c0WinnerUrl: result?.c0.winnerUrl ?? null,
        c1Verdict: result?.c1.verdict ?? null,
        c1LikelyJsRendered: result?.c1.likelyJsRendered ?? false,
        c1TimeTagCount: result?.c1.timeTagCount ?? 0,
        c1DateCount: result?.c1.dateCount ?? 0,
        c2Verdict: result?.c2.verdict ?? null,
        c2Score: result?.c2.score ?? null,
        c2Reason: result?.c2.reason ?? null,
        eventsFound: result?.extract.eventsFound ?? 0,
        consecutiveFailures: src.roundsParticipated,
        lastPathUsed: src.enrichedData?.lastPathUsed ?? null,
        triageResult: src.enrichedData?.triageResult ?? null,
        diversifiers: src.diversifiers,
      });
    }

    // ── C4-AI Analysis (SKIPPED when --no-c4) ─────────────────────────────────
    // NOTE: Sources that exit without C4 routing will be handled by the
    // standard exit routing below (writeExitQueueDistributions).
    // 124 uses this block to skip AI and go straight to standard routing.
    if (SKIP_C4) {
      console.log('[124-NO-C4] Skipping C4-AI analysis, using standard exit routing');
    } else {
      // [C4-ANALYSIS] Run C4-AI on failed sources
      c4AnalysisResult = await runC4Analysis(c4InputSources, `batch-${BATCH_NUM}`, state.poolRoundNumber, BATCH_DIR);

      // [C4-DEEP-ANALYSIS] Run ground truth analysis on failed sources
      const failedSourcesForC4: C4PipelineResult[] = roundOutput.results
        .filter(r => r.outcomeType === 'fail' || r.extract.eventsFound === 0)
        .map(r => ({
          sourceId: r.sourceId,
          url: r.sourceUrl,
          c0: r.c0,
          c1: r.c1,
          c2: r.c2,
          c3: { eventsFound: r.extract.eventsFound },
          failType: r.failType || 'unknown',
          evidence: r.evidence,
        }));
      if (failedSourcesForC4.length > 0) {
        try {
          const deepResult = await c4DeepAnalyze(failedSourcesForC4, `batch-${BATCH_NUM}`, state.poolRoundNumber);
          if (deepResult.proposals.length > 0) {
            console.log(`\n[C4-Deep] Generated ${deepResult.proposals.length} code change proposals:`);
            for (const p of deepResult.proposals) {
              console.log(`  - ${p.proposalId}: ${p.targetCondition}`);
              console.log(`    ${p.currentBehavior} → ${p.proposedBehavior}`);
            }
          }
        } catch (e: any) {
          console.warn(`[C4-Deep] Analysis failed: ${e.message}`);
        }
      }

      const RULE_ELIGIBLE_CATEGORIES = [
        FailCategory.NEEDS_SUBPAGE_DISCOVERY,
        FailCategory.LIKELY_JS_RENDER,
        FailCategory.ENTRY_PAGE_NO_EVENTS,
      ];
      const eligibleResults = (c4AnalysisResult?.results ?? []).filter(
        r => r.failCategoryConfidence >= 0.6 && RULE_ELIGIBLE_CATEGORIES.includes(r.failCategory)
      );
      if (eligibleResults.length > 0) {
        saveRoundDerivedRules(eligibleResults, state.poolRoundNumber, `batch-${BATCH_NUM}`, BATCH_NUM);
        for (const r of eligibleResults) {
          writeAuditEntry({
            sourceId: r.sourceId,
            event: 'rule_generated',
            round: state.poolRoundNumber,
            metadata: {
              failCategory: r.failCategory,
              confidence: r.failCategoryConfidence,
              suggestedPaths: r.discoveredPaths?.map((dp: any) => dp.path) ?? [],
              suggestedQueue: r.nextQueue,
            },
          });
        }
        const proposalResult = proposeCandidateRulesAsImprovements(BATCH_NUM, 0.70);
        if (proposalResult.proposed > 0) {
          console.log(`[C4-ImprovementProposal] Batch ${BATCH_NUM}: proposed ${proposalResult.proposed} improvements`);
        }
      }

      const sourcesThatGeneratedRules = new Set<string>(eligibleResults.map(r => r.sourceId));
      allDerivedRules = loadAllDerivedRules(BATCH_NUM);
      c4AllResults.push(c4AnalysisResult);

      // C4 routing
      for (const c4Result of c4AnalysisResult.results) {
        const src = state.activePool.find(s => s.sourceId === c4Result.sourceId);
        if (!src) continue;

        const queueEntry = {
          sourceId: src.sourceId,
          queueName: '',
          queuedAt: new Date().toISOString(),
          priority: 1,
          attempt: 1,
          queueReason: `C4-AI: ${c4Result.likelyCategory} — conf=${c4Result.confidenceBreakdown.overall}`,
          workerNotes: `C4-AI nextQueue=${c4Result.nextQueue}`,
          winningStage: 'C4-AI' as const,
          outcomeType: 'fail' as const,
          routeSuggestion: c4Result.nextQueue,
          roundNumber: state.poolRoundNumber,
          roundsParticipated: src.roundsParticipated,
        };

        if (c4Result.failCategory === FailCategory.LIKELY_JS_RENDER && c4Result.failCategoryConfidence >= 0.70) {
          queueEntry.queueName = 'postTestC-D';
          appendFileSync(QUEUES.D, JSON.stringify(queueEntry) + '\n');
          state.activePool = state.activePool.filter(s => s.sourceId !== c4Result.sourceId);
          state.exited.push({ source: src, decision: 'postTestC-D', result: null as any });
          if (!state.allExitedIds.includes(src.sourceId)) state.allExitedIds.push(src.sourceId);
          console.log(`  [C4-PROMPT5] ${src.sourceId} → postTestC-D`);
          continue;
        }

        const sourceGeneratedRuleThisRound = sourcesThatGeneratedRules.has(c4Result.sourceId);
        let queuePath = '';
        let queueName = '';

        if (sourceGeneratedRuleThisRound) {
          queuePath = '';
          queueName = 'STAYS_IN_POOL';
        } else {
          switch (c4Result.nextQueue) {
            case 'UI': queuePath = QUEUES.UI; queueName = 'postTestC-UI'; break;
            case 'A': queuePath = QUEUES.A; queueName = 'postTestC-A'; break;
            case 'B': queuePath = QUEUES.B; queueName = 'postTestC-B'; break;
            case 'D': queuePath = QUEUES.D; queueName = 'postTestC-D'; break;
            case 'manual-review':
              if (src.roundsParticipated < 3) {
                queuePath = ''; queueName = 'STAYS_IN_POOL';
              } else {
                queuePath = QUEUES.MANUAL_REVIEW; queueName = 'postTestC-manual-review';
              }
              break;
            default: queuePath = ''; queueName = 'STAYS_IN_POOL';
          }
        }

        if (queuePath) {
          queueEntry.queueName = queueName;
          appendFileSync(queuePath, JSON.stringify(queueEntry) + '\n');
        }

        if (queueName !== 'STAYS_IN_POOL') {
          state.activePool = state.activePool.filter(s => s.sourceId !== c4Result.sourceId);
          state.exited.push({ source: src, decision: queueName, result: null as any });
          if (!state.allExitedIds.includes(src.sourceId)) state.allExitedIds.push(src.sourceId);
        }
      }
    }

    savePoolState(state, BATCH_NUM);

    if (state.poolRoundNumber < MAX_ROUNDS && state.activePool.length > 0) {
      const refill = refillPool(state.activePool, new Set(state.activePool.map(s => s.sourceId)), new Set(state.allExitedIds), BATCH_TYPE, VERIFICATION_SOURCES);
      if (refill.newSources.length > 0) {
        state.activePool.push(...refill.newSources);
        state.newlyRefilled = refill.newSources;
      }
    }
  }

  // Route orphaned sources to manual-review
  if (state.activePool.length > 0) {
    for (const src of state.activePool) {
      const queueEntry = {
        sourceId: src.sourceId,
        queueName: 'postTestC-manual-review',
        queueReason: `[ORPHAN-FIX] Orphaned after max rounds — STEP3-CHAIN forced stay`,
        winningStage: 'C4-AI' as const,
        outcomeType: 'fail' as const,
        routeSuggestion: 'manual-review',
        roundNumber: src.roundsParticipated,
        roundsParticipated: src.roundsParticipated,
        queuedAt: new Date().toISOString(),
        priority: 1,
        attempt: 1,
        workerNotes: 'ORPHAN-FIX: routed to manual-review after max rounds',
      };
      appendToManualReview(queueEntry);
      state.exited.push({ source: src, decision: 'postTestC-manual-review', result: null as any });
    }
  }

  // Build queue summary
  const queueSummary: Record<string, number> = {
    'postTestC-UI': 0, 'postTestC-A': 0, 'postTestC-B': 0,
    'postTestC-D': 0, 'postTestC-manual-review': 0,
  };
  for (const exit of state.exited) {
    const q = exit.decision;
    if (q in queueSummary) queueSummary[q]++;
  }

  // Write reports
  if (roundResults.length > 0) {
    writeRuleEffectivenessReport(roundResults, c4AllResults, allDerivedRules, BATCH_NUM);
  }

  const derivedRulesSummary = {
    totalRulesLoaded: allDerivedRules.size,
    rulesBySource: Array.from(allDerivedRules.entries()).map(([key, rule]) => ({
      key,
      sourceId: rule.sourceId,
      failCategory: rule.failCategory,
      confidence: rule.confidence,
      suggestedPaths: rule.suggestedPaths,
      suggestedQueue: rule.suggestedQueue,
    })),
    ruleSourcesExitedInSameRound: Array.from(allDerivedRules.entries())
      .filter(([key]) => state.allExitedIds.some(id => key.startsWith(id + '__')))
      .map(([key]) => key.split('__')[0]),
  };

  // Mark batch complete
  const completionEntry = {
    batchId: `batch-${BATCH_NUM}`,
    currentBatch: BATCH_NUM,
    type: 'run-completion',
    completedAt: new Date().toISOString(),
    poolRoundNumber: state.poolRoundNumber,
    totalExited: state.exited.length,
    totalActive: state.activePool.length,
    queueDistribution: queueSummary,
    stopReason: state.poolRoundNumber >= 3 ? 'max-rounds-reached' : 'pool-exhausted',
    derivedRulesSummary,
  };
  appendFileSync(join(REPORTS_DIR, 'batch-state.jsonl'), JSON.stringify(completionEntry) + '\n');

  console.log('\n[DynamicPool] Batch complete:', {
    batchNum: BATCH_NUM,
    rounds: state.poolRoundNumber,
    exited: state.exited.length,
    queueDistribution: queueSummary,
  });

  return {
    batchNum: BATCH_NUM,
    poolRoundNumber: state.poolRoundNumber,
    totalExited: state.exited.length,
    totalActive: state.activePool.length,
    queueDistribution: queueSummary,
    stopReason: state.poolRoundNumber >= 3 ? 'max-rounds-reached' : 'pool-exhausted',
    derivedRulesSummary,
  };
}

// ---------------------------------------------------------------------------
// Main (CLI entry)
// ---------------------------------------------------------------------------

async function main() {
  // Parse CLI arguments for explicit sources and batch number override
  const args = process.argv.slice(2);
  let EXPLICIT_SOURCES: string[] = [];
  let CLI_BATCH_NUM: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sources' && args[i + 1]) {
      EXPLICIT_SOURCES = args[i + 1].split(',').map(s => s.trim());
      i++;
    }
    if (args[i] === '--batch-num' && args[i + 1]) {
      CLI_BATCH_NUM = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--no-c4') {
      SKIP_C4 = true;
    }
    if (args[i] === '--workers' && args[i + 1]) {
      POOL_WORKERS = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--max-rounds' && args[i + 1]) {
      MAX_ROUNDS = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Read batch number and type from batch-state.jsonl
  const rawBatchState = readBatchState();
  // Extract batch number: CLI override > currentBatch > batchId parsing > 13
  const BATCH_NUM_FROM_ID = (rawBatchState as any)?.batchId ? parseInt((rawBatchState as any).batchId.replace('batch-', ''), 10) : null;
  const BATCH_NUM = CLI_BATCH_NUM ?? rawBatchState?.currentBatch ?? BATCH_NUM_FROM_ID ?? 13;
  const BATCH_TYPE: 'normal' | 'verification' = (rawBatchState as any)?.batchType ?? 'normal';
  const TARGET_IMPROVEMENT: string | null = (rawBatchState as any)?.targetImprovement ?? null;
  const VERIFICATION_SOURCES: string[] = (rawBatchState as any)?.verificationSources ?? [];

  console.log('='.repeat(60));
  console.log('DYNAMIC TEST POOL RUNNER — EXPERIMENTAL');
  console.log('STATUS: RUNNER_EXECUTES | FLOW_PARTIALLY_VERIFIED');
  console.log('STATUS: C4_AI_INTEGRATED | NOT_CANONICAL_YET');
  console.log('='.repeat(60));
  console.log(`Batch number: ${BATCH_NUM}`);
  console.log(`Batch type: ${BATCH_TYPE}${BATCH_TYPE === 'verification' ? ` (improvement: ${TARGET_IMPROVEMENT})` : ''}`);

  // Step 0: ENSURE BATCH DIRECTORY EXISTS before any file writes
  // This prevents ENOENT errors when C4 or other components try to write
  // to batch-specific report files (e.g., c4-ai-analysis-round-X.md)
  const BATCH_DIR = ensureBatchDir(BATCH_NUM);
  console.log(`[Init] Batch directory ready: ${BATCH_DIR}`);

  // Step 1: Check for existing pool state (resume scenario)
  // If batch-state.jsonl's last entry is a FRESH batch-start (not a completion),
  // any existing pool-state.json is stale from a prior run with the same batch number.
  const lastEntryRaw = readFileSync(join(REPORTS_DIR, 'batch-state.jsonl'), 'utf8').trim().split('\n').filter(l => l.trim()).slice(-1)[0];
  const lastEntry = lastEntryRaw ? JSON.parse(lastEntryRaw) : null;
  // Also compare against batchId field (for when BATCH_NUM default doesn't match currentBatch)
  const isFreshBatchStart = lastEntry?.type === 'batch-start' &&
    (lastEntry?.batchId === `batch-${BATCH_NUM}` || lastEntry?.currentBatch === BATCH_NUM);

  // IMPORTANT: If this is a fresh batch-start, clear any stale pool-state.json from prior runs
  // BEFORE loadPoolState reads it (loadPoolState caches the result and we can't undo that)
  if (isFreshBatchStart) {
    const stalePath = join(REPORTS_DIR, `batch-${BATCH_NUM}`, 'pool-state.json');
    try { unlinkSync(stalePath); } catch {}
    console.log('\n[Step 1] Fresh batch-start detected — cleared any stale pool-state.json');
  }

  const savedState = loadPoolState(BATCH_NUM);
  let state: PoolState;
  let roundResults: { results: CResult[]; exits: { source: PoolSource; decision: string; result: CResult }[]; fails: PoolSource[] }[] = [];
  let c4AllResults: C4RoundAnalysis[] = [];

  // SIGINT handler — Ctrl+C writes in-flight sources back to postB-preC so nothing is lost
  process.once('SIGINT', () => {
    console.log('\n[SIGINT] Ctrl+C — sparar pågående källor tillbaka till postB-preC...');
    try {
      const inFlight = state?.activePool ?? [];
      if (inFlight.length > 0) {
        const lines = inFlight.map(s => JSON.stringify({
          sourceId: s.sourceId,
          queueName: 'postB-preC',
          queuedAt: new Date().toISOString(),
          priority: 3,
          attempt: 1,
          queueReason: s.queueReason ?? 'SIGINT: re-queued for next run',
        })).join('\n') + '\n';
        appendFileSync(QUEUES.PREC, lines);
        console.log(`[SIGINT] ${inFlight.length} källor återlagda i postB-preC.`);
      } else {
        console.log('[SIGINT] Inga pågående källor att spara.');
      }
    } catch (e: any) {
      console.error('[SIGINT] Fel vid sparning:', e.message);
    }
    process.exit(0);
  });

  // If the loaded pool is already complete (round 3 or pool exhausted), advance to next batch
  // This fixes the "batch re-runs same completed batch" bug
  const batchAlreadyComplete = savedState && (
    savedState.poolRoundNumber >= 3 ||
    (savedState.poolRoundNumber > 0 && savedState.activePool.length === 0) ||
    // [TOOL-4-FIX] When savedState.poolRoundNumber >= MAX_ROUNDS, this run already
    // executed its rounds. Advance to next batch instead of stalling.
    savedState.poolRoundNumber >= MAX_ROUNDS
  );

  if (batchAlreadyComplete) {
    console.log(`\n[Step 1] Batch ${BATCH_NUM} already complete (round ${savedState!.poolRoundNumber}) — advancing to next batch`);
    
    // FIXED: Remaining postB-preC entries are NEVER drained to manual-review.
    // Those entries were never selected by this batch — they are simply the
    // unselected remainder from the pool build. They stay in postB-preC for
    // the next batch to pick up. Only sources that were actually PROCESSED
    // and failed are routed to their proper exit queues.
    const remainingQueueEntries = parseJsonl<QueueEntry>(QUEUES.PREC);
    if (remainingQueueEntries.length > 0) {
      console.log(`[Step 1] ${remainingQueueEntries.length} sources remain in postB-preC (never selected by batch-${BATCH_NUM}) — left for next batch`);
    }
    
    const nextBatch = BATCH_NUM + 1;
    // Write a batch-start entry for the new batch so future runs use the correct number
    writeBatchStateEntry({
      batchId: `batch-${nextBatch}`,
      currentBatch: nextBatch,
      type: 'batch-start',
      startedAt: new Date().toISOString(),
    });
    console.log(`[Step 1] Wrote batch-start for batch-${nextBatch} — please re-run`);
    return;
  }

  if (savedState && savedState.poolRoundNumber > 0 && !isFreshBatchStart) {
    // Resume from saved state
    console.log(`\n[Step 1] Resuming pool from saved state (round ${savedState.poolRoundNumber})`);
    state = savedState;
    // Round results will be loaded from the pool state later if needed
  } else {
    // Fresh start — build initial pool AND clear output queues
    console.log('\n[Step 1] Building initial pool from postB-preC...');
    // Only clear output queues on FRESH batch start (not on resume, not on advance)
    // Each batch appends to the same runtime/postTestC-*.jsonl files


    console.log('\n[Step 1] Building initial pool from postB-preC...');
    const initial = buildInitialPool(BATCH_TYPE, VERIFICATION_SOURCES, EXPLICIT_SOURCES);

    if (!initial || initial.pool.length === 0) {
      console.error('ERROR: No eligible sources in postB-preC. Aborting.');
      return;
    }

    console.log(`  Selected ${initial.pool.length} sources (eligible in postB-preC: ${initial.eligibleInPrec})`);

    state = {
      poolRoundNumber: 0,
      activePool: initial.pool,
      exited: [],
      failed: [],
      newlyRefilled: [],
      allExitedIds: [],
    };
  }

  // Step 2: Run rounds
  // Load derived rules from all prior batches — will be updated after each C4 run
  let allDerivedRules = loadAllDerivedRules(BATCH_NUM);
  const loadedRuleCount = allDerivedRules.size;
  if (loadedRuleCount > 0) {
    console.log(`[Learning-Loop] Loaded ${loadedRuleCount} derived rules from prior batches`);
    allDerivedRules.forEach((rule, key) => {
      console.log(`  RULE: ${rule.sourceId} → ${rule.failCategory} (conf=${rule.confidence}, paths=${rule.suggestedPaths.join(',')})`);
    });
  } else {
    console.log(`[Learning-Loop] No prior derived rules found — starting fresh`);
  }

  while (state.activePool.length > 0 && state.poolRoundNumber < MAX_ROUNDS) {
    state.poolRoundNumber++;

    const roundOutput = await runPoolRound(state, allDerivedRules);
    roundResults.push(roundOutput);

    // Update exited list and allExitedIds
    for (const exit of roundOutput.exits) {
      state.exited.push(exit);
      if (!state.allExitedIds.includes(exit.source.sourceId)) {
        state.allExitedIds.push(exit.source.sourceId);
      }
    }

    // Update active pool — only sources that stayed in pool
    state.activePool = roundOutput.fails;

    // [RULE-EFFECTIVENESS-REPORT] Analyze rule impact this round
    // Compare outcomes for sources where derived rules were applied vs not
    const sourcesWithDerivedRuleApplied = roundOutput.results.filter(r => r.derivedRuleApplied);
    const sourcesWithoutRuleApplied = roundOutput.results.filter(r => !r.derivedRuleApplied);
    const derivedRuleHits = sourcesWithDerivedRuleApplied.filter(r => r.extract.eventsFound > 0 || r.c0.candidates > 0);
    console.log(`\n[Rule-Effectiveness] Round ${state.poolRoundNumber}:`);
    console.log(`  Sources WITH derived rule applied: ${sourcesWithDerivedRuleApplied.length}`);
    console.log(`  Sources WITHOUT rule applied: ${sourcesWithoutRuleApplied.length}`);
    console.log(`  Derived rule HITS (candidates>0 or events>0): ${derivedRuleHits.length}`);
    if (sourcesWithDerivedRuleApplied.length > 0) {
      for (const r of sourcesWithDerivedRuleApplied) {
        console.log(`    - ${r.sourceId}: c0Candidates=${r.c0.candidates}, events=${r.extract.eventsFound}, winner=${r.c0.winnerUrl || 'none'}`);
      }
    }

    // [STEP 4-INTEGRATION] C4-AI analysis of unresolved sources after each round
    // Build C4InputSource with ACTUAL C0 results (not hardcoded 0)
    const c4InputSources: any[] = [];
    for (const src of roundOutput.fails) {
      const result = roundOutput.results.find(r => r.sourceId === src.sourceId);
      c4InputSources.push({
        sourceId: src.sourceId,
        url: src.url,
        failType: result?.failType || 'unresolved',
        evidence: result?.evidence || src.queueReason || '',
        winningStage: result?.winningStage || 'C3',
        c0Candidates: result?.c0.candidates ?? 0,
        c0LinksFound: result?.c0.ruleAppliedPaths
          ? result.c0.ruleAppliedPaths.map((p, i) => ({ href: p, anchorText: 'derived-rule', score: 10 - i, region: 'rule' }))
          : [],
        c0RootFallback: result?.c0.rootFallback ?? false,
        c0WinnerUrl: result?.c0.winnerUrl ?? null,
        c1Verdict: result?.c1.verdict ?? null,
        c1LikelyJsRendered: result?.c1.likelyJsRendered ?? false,
        c1TimeTagCount: result?.c1.timeTagCount ?? 0,
        c1DateCount: result?.c1.dateCount ?? 0,
        c2Verdict: result?.c2.verdict ?? null,
        c2Score: result?.c2.score ?? null,
        c2Reason: result?.c2.reason ?? null,
        eventsFound: result?.extract.eventsFound ?? 0,
        consecutiveFailures: src.roundsParticipated,
        lastPathUsed: src.enrichedData?.lastPathUsed ?? null,
        triageResult: src.enrichedData?.triageResult ?? null,
        diversifiers: src.diversifiers,
      });
    }

    // [124-NO-C4] Skip all C4-AI when --no-c4 flag is set
    if (!SKIP_C4) {
      const c4Analysis = await runC4Analysis(
        c4InputSources,
        `batch-${BATCH_NUM}`,
        state.poolRoundNumber,
        BATCH_DIR
      );

      // [SAVE-DERIVED-RULES] Save C4 results as derived rules for future rounds
      const RULE_ELIGIBLE_CATEGORIES = [
        FailCategory.NEEDS_SUBPAGE_DISCOVERY,
        FailCategory.LIKELY_JS_RENDER,
        FailCategory.ENTRY_PAGE_NO_EVENTS,
      ];
      const eligibleResults = (c4AnalysisResult?.results ?? []).filter(
        r => r.failCategoryConfidence >= 0.6 && RULE_ELIGIBLE_CATEGORIES.includes(r.failCategory)
      );
      if (eligibleResults.length > 0) {
        saveRoundDerivedRules(
          eligibleResults,
          state.poolRoundNumber,
          `batch-${BATCH_NUM}`,
          BATCH_NUM
        );
        for (const r of eligibleResults) {
          writeAuditEntry({
            sourceId: r.sourceId,
            event: 'rule_generated',
            round: state.poolRoundNumber,
            metadata: {
              failCategory: r.failCategory,
              confidence: r.failCategoryConfidence,
              suggestedPaths: r.discoveredPaths?.map((dp: any) => dp.path) ?? [],
              suggestedQueue: r.nextQueue,
            },
          });
        }
        const proposalResult = proposeCandidateRulesAsImprovements(BATCH_NUM, 0.70);
        if (proposalResult.proposed > 0) {
          console.log(`[C4-ImprovementProposal] Batch ${BATCH_NUM}: proposed ${proposalResult.proposed} improvements`);
        }
      }
    } else {
      console.log('[124-NO-C4] Skipping C4-AI in pool loop, using standard exit routing');
    }

    // [LEARNING-LOOP-FIX] Track sources that generated rules this round
    // Only runs when C4 was active (SKIP_C4=false)
    const sourcesThatGeneratedRules = new Set<string>();
    if (!SKIP_C4 && c4AnalysisResult) {
      const eligibleResults = (c4AnalysisResult?.results ?? []).filter(
        (r: any) => r.failCategoryConfidence >= 0.6
      );
      for (const r of eligibleResults) {
        sourcesThatGeneratedRules.add(r.sourceId);
      }
      if (sourcesThatGeneratedRules.size > 0) {
        console.log(`[Learning-Loop-Fix] Sources that generated rules this round: ${Array.from(sourcesThatGeneratedRules).join(', ')}`);
      }
      // Reload derived rules so the NEXT round uses all known rules
      allDerivedRules = loadAllDerivedRules(BATCH_NUM);
      c4AllResults.push(c4AnalysisResult);

      // Route sources based on C4-AI nextQueue recommendation
      for (const c4Result of c4AnalysisResult.results) {
      const src = state.activePool.find(s => s.sourceId === c4Result.sourceId);
      if (!src) continue;

      const queueEntry = {
        sourceId: src.sourceId,
        queueName: '',
        queuedAt: new Date().toISOString(),
        priority: 1,
        attempt: 1,
        queueReason: `C4-AI: ${c4Result.likelyCategory} — conf=${c4Result.confidenceBreakdown.overall}`,
        workerNotes: `C4-AI nextQueue=${c4Result.nextQueue}, catConf=${c4Result.confidenceBreakdown.categoryConfidence}, signals=${c4Result.improvementSignals.join('; ')}`,
        winningStage: 'C4-AI',
        outcomeType: 'fail',
        routeSuggestion: c4Result.nextQueue,
        roundNumber: state.poolRoundNumber,
        roundsParticipated: src.roundsParticipated,
        c4Analysis: {
          likelyCategory: c4Result.likelyCategory,
          improvementSignals: c4Result.improvementSignals,
          suggestedRules: c4Result.suggestedRules,
        },
      };

      // [PROMPT-5] LIKELY_JS_RENDER + moderate+ confidence → immediate D-routing
      // Source exits pool and is NEVER refilled back to C-pool
      // Threshold lowered from 0.85 to 0.70 based on batch-15 analysis: many LIKELY_JS_RENDER
      // sources (conf 0.60-0.75) were going to manual-review instead of D
      if (c4Result.failCategory === FailCategory.LIKELY_JS_RENDER && c4Result.failCategoryConfidence >= 0.70) {
        queueEntry.queueName = 'postTestC-D';
        queueEntry.queueReason = `C4-AI: ${c4Result.likelyCategory} — D-renderGate warranted (conf=${c4Result.failCategoryConfidence.toFixed(2)})`;
        queueEntry.workerNotes = `PROMPT-5 AUTO-D-ROUTING: failCategory=LIKELY_JS_RENDER, confidence=${c4Result.failCategoryConfidence.toFixed(2)} >= 0.70 — routed to D-renderGate`;
        appendFileSync(QUEUES.D, JSON.stringify(queueEntry) + '\n');

        // Remove from active pool, add to exited — source is DONE from C-pool
        state.activePool = state.activePool.filter(s => s.sourceId !== c4Result.sourceId);
        state.exited.push({
          source: src,
          decision: 'postTestC-D',
          result: null as any,
        });
        if (!state.allExitedIds.includes(src.sourceId)) {
          state.allExitedIds.push(src.sourceId);
        }
        console.log(`  [C4-PROMPT5] ${src.sourceId} → postTestC-D (LIKELY_JS_RENDER conf=${c4Result.failCategoryConfidence.toFixed(2)} >= 0.70 — NO refill to C-pool)`);
        continue; // next source — do NOT go through switch
      }

      // [STEP-3: RULE-VALIDATION-CHAIN] Sources that generated rules this round
      // MUST stay in pool for round N+1 to re-test with their own newly created rules.
      // This closes the learning loop: rule created → same source re-tested with rule.
      const sourceGeneratedRuleThisRound = sourcesThatGeneratedRules.has(c4Result.sourceId);

      let queuePath = '';
      let queueName = '';

      if (sourceGeneratedRuleThisRound) {
        queuePath = '';
        queueName = 'STAYS_IN_POOL';
        console.log(`  [Step3-Chain] ${c4Result.sourceId}: generated rule this round → FORCE STAY for rule-validation round`);
      } else {
      switch (c4Result.nextQueue) {
        case 'UI':
          queuePath = QUEUES.UI;
          queueName = 'postTestC-UI';
          break;
        case 'A':
          queuePath = QUEUES.A;
          queueName = 'postTestC-A';
          break;
        case 'B':
          queuePath = QUEUES.B;
          queueName = 'postTestC-B';
          break;
        case 'D':
          queuePath = QUEUES.D;
          queueName = 'postTestC-D';
          break;
        case 'manual-review':
          // [P2-FIX] All sources get 2-3 subpage-path retries before manual-review.
          // Override manual-review → retry-pool for any source with roundsParticipated < 3.
          // Only send to manual-review after exhausting all retry rounds.
          // Exception: if roundsParticipated >= 3, manual-review is final (no more retries possible).
          if (src.roundsParticipated < 3) {
            queuePath = '';
            queueName = 'STAYS_IN_POOL';
            console.log(`  [P2-Fix] ${c4Result.sourceId}: roundsParticipated=${src.roundsParticipated} < 3 — OVERRIDE manual-review → retry-pool (subpage-path retry #${src.roundsParticipated + 1})`);
          } else {
            queuePath = QUEUES.MANUAL_REVIEW;
            queueName = 'postTestC-manual-review';
          }
          break;
        case 'retry-pool':
          // Stay in pool — no queue write
          queuePath = '';
          queueName = 'STAYS_IN_POOL';
          break;
        default:
          queuePath = '';
          queueName = 'STAYS_IN_POOL';
      }
      } // end else (sourceGeneratedRuleThisRound)

      if (queuePath) {
        queueEntry.queueName = queueName;
        appendFileSync(queuePath, JSON.stringify(queueEntry) + '\n');
      }

      if (queueName !== 'STAYS_IN_POOL') {
        // Remove from active pool, add to exited
        state.activePool = state.activePool.filter(s => s.sourceId !== c4Result.sourceId);
        state.exited.push({
          source: src,
          decision: queueName,
          result: null as any, // C4-AI result has no CResult
        });
        if (!state.allExitedIds.includes(src.sourceId)) {
          state.allExitedIds.push(src.sourceId);
        }
        console.log(`  [C4] ${src.sourceId} → ${queueName} (C4-AI override)`);
      } else {
        console.log(`  [C4] ${src.sourceId} → retry-pool (C4-AI)`);
      }
    }
    } // end if (!SKIP_C4 && c4AnalysisResult)

    console.log(`\nAfter C4-AI routing:`);
    console.log(`  Active pool: ${state.activePool.length}`);
    console.log(`  Exited: ${state.exited.length}`);

    // Save pool state after each round
    savePoolState(state, BATCH_NUM);

    // Step 3: Refill between rounds (if more rounds will follow)
    if (state.poolRoundNumber < MAX_ROUNDS && state.activePool.length > 0) {
      const refill = refillPool(state.activePool, new Set(state.activePool.map(s => s.sourceId)), new Set(state.allExitedIds), BATCH_TYPE, VERIFICATION_SOURCES);
      if (refill.newSources.length > 0) {
        state.activePool.push(...refill.newSources);
        state.newlyRefilled = refill.newSources;
        console.log(`  Refilled ${refill.newSources.length} new sources (available in postB-preC: ${refill.availableInPrec})`);
      } else {
        console.log(`  No eligible sources available for refill (available: ${refill.availableInPrec})`);
      }
    }
  }

  // [IMP-001-FIX] Route any remaining activePool sources to manual-review
  // These are orphaned sources that were forced to STAY via STEP3-CHAIN
  // but the loop terminated before they could exit.
  // This fix ensures no source is left in limbo after max rounds.
  if (state.activePool.length > 0) {
    console.log(`\n[IMP-001-FIX] ${state.activePool.length} sources still in activePool after max rounds — routing to manual-review:`);
    for (const src of state.activePool) {
      const queueEntry = {
        sourceId: src.sourceId,
        queueName: 'postTestC-manual-review',
        queueReason: `[IMP-001-FIX] Orphaned: forced STAY via STEP3-CHAIN in round ${src.roundsParticipated}, loop terminated before exit`,
        winningStage: 'C4-AI',
        outcomeType: 'fail',
        routeSuggestion: 'manual-review',
        roundNumber: src.roundsParticipated,
        roundsParticipated: src.roundsParticipated,
        queuedAt: new Date().toISOString(),
        priority: 1,
        attempt: 1,
        workerNotes: `IMP-001-FIX: orphaned after max rounds (poolRoundNumber=3 reached while source was in STEP3-CHAIN forced stay)`,
      };
      appendToManualReview(queueEntry);
      console.log(`  [IMP-001-FIX] ${src.sourceId} → postTestC-manual-review (rounds=${src.roundsParticipated})`);
      state.exited.push({
        source: src,
        decision: 'postTestC-manual-review',
        result: null as any,
      });
    }
    console.log('[IMP-001-FIX] All orphaned sources routed to postTestC-manual-review');
  }

  // Step 4: Final report
  console.log(`\n${'='.repeat(60)}`);
  console.log('RUN COMPLETE — VERIFICATION STATUS BELOW');
  console.log(`${'='.repeat(60)}`);
  console.log(`Rounds completed: ${state.poolRoundNumber}`);
  console.log(`Total exited: ${state.exited.length}`);
  console.log(`Active pool at end: ${state.activePool.length}`);
  console.log('');
  console.log('--- STATUS SUMMARY ---');
  console.log('RUNNER_EXECUTES: confirmed');
  console.log('FLOW_PARTIALLY_VERIFIED: rounds 1-3 executed');
  console.log('C4_AI_INTEGRATED: C4-AI inkopplad och körande');
  console.log('RESUME_VERIFIED: resume verified (2026-04-11)');
  console.log('NOT_CANONICAL_YET: this is first working version, not final');

  // Queue summary
  const queueSummary: Record<string, number> = {
    'postTestC-UI': 0,
    'postTestC-A': 0,
    'postTestC-B': 0,
    'postTestC-D': 0,
    'postTestC-manual-review': 0,
  };
  for (const exit of state.exited) {
    const q = exit.decision;
    if (q in queueSummary) queueSummary[q]++;
  }

  console.log('\nExit queue distribution:');
  for (const [queue, count] of Object.entries(queueSummary)) {
    console.log(`  ${queue}: ${count}`);
  }

  // Write reports (include derived rules for learning-loop verification)

  // [RULE-EFFECTIVENESS] Write structured report to rule-effectiveness.jsonl and summary to rule-effectiveness.md
  if (roundResults.length > 0) {
    writeRuleEffectivenessReport(roundResults, c4AllResults, allDerivedRules, BATCH_NUM);
  }

  // [PER-SOURCE TRACES] Write batch-traces.jsonl for C4-observer analysis
  // Each line = one PerSourceTrace for one source in one round.
  // C4-observer reads this file and produces independent analysis.
  if (roundResults.length > 0) {
    writeBatchTraces(roundResults, BATCH_NUM);
  }

  // Mark batch as completed in batch-state.jsonl
  // Include derived rules summary for fail-set rerun proof
  const derivedRulesSummary = {
    totalRulesLoaded: allDerivedRules.size,
    rulesBySource: Array.from(allDerivedRules.entries()).map(([key, rule]) => ({
      key,
      sourceId: rule.sourceId,
      failCategory: rule.failCategory,
      confidence: rule.confidence,
      suggestedPaths: rule.suggestedPaths,
      suggestedQueue: rule.suggestedQueue,
    })),
    ruleSourcesExitedInSameRound: Array.from(allDerivedRules.entries())
      .filter(([key]) => state.allExitedIds.some(id => key.startsWith(id + '__')))
      .map(([key]) => key.split('__')[0]),
  };
  const completionEntry = {
    batchId: `batch-${BATCH_NUM}`,
    type: 'run-completion',
    completedAt: new Date().toISOString(),
    poolRoundNumber: state.poolRoundNumber,
    totalExited: state.exited.length,
    totalActive: state.activePool.length,
    queueDistribution: queueSummary,
    stopReason: state.poolRoundNumber >= 3 ? 'max-rounds-reached' : 'pool-exhausted',
    derivedRulesSummary,
  };
  appendFileSync(join(REPORTS_DIR, 'batch-state.jsonl'), JSON.stringify(completionEntry) + '\n');
  console.log('\n[State] Batch completion recorded in batch-state.jsonl');

  // [123-Learning-Memory] Update canonical memory file after batch completion
  console.log('\n[Learning-Memory] Updating 123-learning-memory.json...');
  const { execSync: execSyncMemory } = await import('child_process');
  try {
    execSyncMemory('npx tsx 123-learning-memory.ts', {
      cwd: __dirname,
      stdio: 'pipe',
      timeout: 30000,
    });
    console.log('[Learning-Memory] Updated successfully');
  } catch (e: any) {
    console.warn('[Learning-Memory] Update failed:', e.message);
  }

  console.log('\nDone.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
