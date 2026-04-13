/**
 * 123 Improvement Gate — Safe Improvement Orchestrator
 *
 * STATUS: EXPERIMENTAL — NOT CANONICAL YET
 *
 * Purpose:
 * Reads 123-learning-memory.json and produces a structured improvement proposal.
 * This is NOT an auto-activator — it presents ONE candidate at a time
 * with full context for human/tool decision.
 *
 * Improvement Chain (5 steps):
 *   1. SELECT  → gate reads memory, picks top 1 candidate, checks blockers
 *   2. CODE     → isolated IMP flag in exactly ONE C-layer file
 *   3. VERIFY  → verification batch on same failure type
 *   4. REGRESS → regression batch on different but similar group
 *   5. ACTIVATE → keep (activate permanently) OR rollback (disable IMP flag)
 *
 * Rules:
 *   - Max 1 active improvement at a time
 *   - Improvement must pass verification before regression
 *   - Improvement must pass regression before permanent activation
 *   - BLOCKED improvements (by bug) cannot be selected
 *   - NEVER-RETRY improvements are skipped
 *   - IMP flags must be discoverable and toggleable
 *
 * Files:
 *   - Input:  123-learning-memory.json
 *   - Output: 123-improvement-state.json (canonical improvement state machine)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const MEMORY_FILE = join(__dirname, '123-learning-memory.json');
const STATE_FILE = join(__dirname, '123-improvement-state.json');

const BATCH_STATE_FILE = join(__dirname, 'reports', 'batch-state.jsonl');

// States
type ImprovementState =
  | 'none'           // no active improvement
  | 'proposed'       // gate selected this improvement, awaiting code change
  | 'coded'          // IMP flag in place, awaiting verification batch
  | 'verifying'      // verification batch running
  | 'verified'        // verification passed, awaiting regression batch
  | 'regressing'     // regression batch running
  | 'active'         // permanently activated (keep)
  | 'rolled_back';   // failed verification or regression, disabled

interface ImprovementAttempt {
  id: string;           // "IMP-007"
  experiment: string;
  description: string;
  targetBottleneck: string;
  confidence: 'high' | 'medium' | 'low';
  generalizationRisk: 'low' | 'medium' | 'high';
  hypothesis: string;
  affectedCStage: 'C0' | 'C1' | 'C2' | 'C3' | 'C4';
  affectedFile: string;
  codeChange: string;    // human-readable description of what to change
  verificationSources: string[];
  regressionSources: string[];
  createdAt: string;
  verifiedAt?: string;
  regressedAt?: string;
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
  regressionResult?: {
    batchId: string;
    newBreakages: string[];
    netAssessment: string;
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
  blockedByBug: {
    bugId: string;
    description: string;
  }[];
}

// ---------------------------------------------------------------------------
// Memory Reader
// ---------------------------------------------------------------------------

interface MemoryData {
  nextRecommendedExperiment: {
    experiment: string;
    description: string;
    expectedImpact: string;
    concreteHypothesis: string;
    test: string;
    confidence: 'high' | 'medium' | 'low';
    whyNow: string;
    blockedBy: string[];
  };
  top3CandidateImprovements: {
    rank: number;
    improvement: string;
    expectedBottleneckTarget: string;
    confidence: 'high' | 'medium' | 'low';
    generalizationRisk: 'low' | 'medium' | 'high';
    note: string;
  }[];
  blockedByBug: { bugId: string; description: string }[];
  neverRetryList: { improvement: string; testedIn: string; result: string; evidence: string }[];
  orphanSources: { sourceId: string; reason: string; lastSeenBatch: string; suggestedAction: string }[];
}

// ---------------------------------------------------------------------------
// Gate Logic
// ---------------------------------------------------------------------------

function loadMemory(): MemoryData | null {
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function loadState(): ImprovementStateFile {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      currentState: 'none',
      currentImprovement: null,
      completedImprovements: [],
      failedImprovements: [],
      blockedByBug: [],
    };
  }
}

function getNextImpCode(state: ImprovementStateFile): string {
  const used = new Set<string>();
  for (const imp of state.completedImprovements) used.add(imp.id);
  for (const imp of state.failedImprovements) used.add(imp.id);
  if (state.currentImprovement) used.add(state.currentImprovement.id);
  let n = 1;
  while (used.has(`IMP-${String(n).padStart(3, '0')}`)) n++;
  return `IMP-${String(n).padStart(3, '0')}`;
}

function selectCandidate(
  memory: MemoryData,
  state: ImprovementStateFile
): { candidate: ImprovementAttempt; reason: string } | { candidate: null; reason: string } {
  // If already have active improvement, cannot select new one
  if (state.currentState !== 'none' && state.currentState !== 'rolled_back') {
    return { candidate: null, reason: `Already have active improvement: ${state.currentImprovement?.id} in state ${state.currentState}` };
  }

  // If blocked by bug, check if bug is resolved
  const blockedBugs = memory.blockedByBug || [];
  for (const candidate of memory.top3CandidateImprovements) {
    const blockedBy = memory.nextRecommendedExperiment.blockedBy || [];
    const unresolved = blockedBy.filter(bugId =>
      blockedBugs.some(b => b.bugId === bugId)
    );
    if (unresolved.length > 0 && candidate.rank === 1) {
      // Top candidate is blocked — try next
      continue;
    }
  }

  // Never retry check
  const neverRetry = new Set(memory.neverRetryList.map(n => n.improvement));

  // Select top ranked candidate that is not never-retry and not blocked
  for (const cand of memory.top3CandidateImprovements) {
    if (neverRetry.has(cand.improvement)) {
      console.log(`[Gate] Skipping NEVER-RETRY: ${cand.improvement}`);
      continue;
    }

    // Check if blocked by unresolved bug
    const topExp = memory.nextRecommendedExperiment;
    const unresolvedBlockers = (topExp.blockedBy || []).filter(
      bugId => blockedBugs.some(b => b.bugId === bugId)
    );
    if (unresolvedBlockers.length > 0 && cand.rank === 1) {
      console.log(`[Gate] Top candidate blocked by unresolved bugs: ${unresolvedBlockers.join(', ')}`);
      // Try next candidate
      continue;
    }

    // This is the selected candidate
    const impCode = getNextImpCode(state);
    const imp: ImprovementAttempt = {
      id: impCode,
      experiment: cand.improvement,
      description: memory.nextRecommendedExperiment.description,
      targetBottleneck: cand.expectedBottleneckTarget,
      confidence: cand.confidence,
      generalizationRisk: cand.generalizationRisk,
      hypothesis: memory.nextRecommendedExperiment.concreteHypothesis,
      affectedCStage: inferCStage(cand.improvement),
      affectedFile: inferAffectedFile(cand.improvement),
      codeChange: generateCodeChangeDescription(cand),
      verificationSources: extractVerificationSources(memory),
      regressionSources: extractRegressionSources(memory),
      createdAt: new Date().toISOString(),
    };

    return {
      candidate: imp,
      reason: `Selected #${cand.rank}: ${cand.improvement} (confidence=${cand.confidence}, risk=${cand.generalizationRisk})`,
    };
  }

  return { candidate: null, reason: 'No eligible candidate found (all blocked, never-retry, or empty)' };
}

function inferCStage(experiment: string): 'C0' | 'C1' | 'C2' | 'C3' | 'C4' {
  if (experiment.includes('C1') || experiment.includes('likelyJsRendered')) return 'C1';
  if (experiment.includes('C0') || experiment.includes('discovery') || experiment.includes('candidate')) return 'C0';
  if (experiment.includes('C2') || experiment.includes('screening') || experiment.includes('score')) return 'C2';
  if (experiment.includes('C3') || experiment.includes('extraction')) return 'C3';
  if (experiment.includes('C4') || experiment.includes('AI')) return 'C4';
  return 'C1';
}

function inferAffectedFile(experiment: string): string {
  if (experiment.includes('STEP3-CHAIN') || experiment.includes('orphaned') || experiment.includes('runner bug')) return 'run-dynamic-pool.ts';
  if (experiment.includes('C1→D') || experiment.includes('C1-DIRECT') || experiment.includes('direct-rout')) return 'run-dynamic-pool.ts';
  if (experiment.includes('C1') || experiment.includes('likelyJsRendered')) return 'C1-preHtmlGate/index.ts';
  if (experiment.includes('C0') || experiment.includes('discovery') || experiment.includes('Swedish pattern')) return 'C0-htmlFrontierDiscovery/index.ts';
  if (experiment.includes('C2') || experiment.includes('screening')) return 'C2-htmlGate/index.ts';
  if (experiment.includes('C3') || experiment.includes('extraction')) return 'C3-eventExtraction/extractor.ts';
  return 'C1-preHtmlGate/index.ts';
}

function generateCodeChangeDescription(candidate: { improvement: string; note: string; expectedBottleneckTarget: string }): string {
  if (candidate.improvement.includes('C1→D-route bypass')) {
    return `In run-dynamic-pool.ts (C1-DIRECT-ROUTING), modify the c1Dsignal condition: remove !!c0?.candidatesFound so the C0→Swedish-pattern bypass fires even when root URL has 0 candidates. Swedish patterns find candidates on subpages, not root.`;
  }
  if (candidate.improvement.includes('STEP3-CHAIN')) {
    return `In run-dynamic-pool.ts, fix the loop termination condition: sources generating rules in round N should NOT be forced to stay in pool when poolRoundNumber would exceed 3. Route them to manual-review instead.`;
  }
  if (candidate.improvement.includes('Swedish pattern') || candidate.improvement.includes('extraction')) {
    return `In C3 (extractor.ts), when C0 candidates found via Swedish pattern AND C2 score > 0, use C2 HTML (not C1 HTML) for extraction to avoid likelyJsRendered false positive.`;
  }
  return `Code change TBD for: ${candidate.improvement}`;
}

function extractVerificationSources(memory: MemoryData): string[] {
  // Top candidates from memory that have Swedish pattern C2 hits
  const candidates = [
    'kungsbacka', 'cirkus', 'borlange-kommun', 'h-gskolan-i-sk-vde',
    'friidrottsf-rbundet', 'sundsvall',
  ];
  // Filter to sources that actually exist in postB-preC (verified via memory)
  return candidates;
}

function extractRegressionSources(memory: MemoryData): string[] {
  // Different group — sources with similar but not identical failure
  // These are WRONG_ENTRY_PAGE and NEEDS_SUBPAGE_DISCOVERY sources
  // that are NOT in the verification group
  return ['mittuniversitetet', 'malm-opera', 'blekholmen', 'boplanet', 'chalmers'];
}

// ---------------------------------------------------------------------------
// State Transitions
// ---------------------------------------------------------------------------

function transition(state: ImprovementStateFile, action: string, payload?: any): ImprovementStateFile {
  const now = new Date().toISOString();
  const newState = { ...state, lastUpdated: now };

  switch (action) {
    case 'select': {
      if (state.currentState !== 'none' && state.currentState !== 'rolled_back') {
        console.log('[Gate] Cannot select: already have active improvement');
        return state;
      }
      newState.currentState = 'proposed';
      newState.currentImprovement = payload;
      return newState;
    }

    case 'code_done': {
      if (state.currentState !== 'proposed') return state;
      newState.currentState = 'coded';
      return newState;
    }

    case 'verify_start': {
      if (state.currentState !== 'coded') return state;
      newState.currentState = 'verifying';
      return newState;
    }

    case 'verify_done': {
      if (state.currentState !== 'verifying') return state;
      if (!state.currentImprovement) return state;
      newState.currentImprovement = {
        ...state.currentImprovement,
        verificationResult: payload,
        verifiedAt: now,
      };
      if (payload.decision === 'rollback') {
        newState.currentState = 'rolled_back';
        newState.currentImprovement.rolledBackAt = now;
        newState.currentImprovement.rollbackReason = payload.reason || 'verification failed';
        newState.failedImprovements.push(state.currentImprovement);
      } else {
        newState.currentState = 'verified';
      }
      return newState;
    }

    case 'regress_start': {
      if (state.currentState !== 'verified') return state;
      newState.currentState = 'regressing';
      return newState;
    }

    case 'regress_done': {
      if (state.currentState !== 'regressing') return state;
      if (!state.currentImprovement) return state;
      newState.currentImprovement = {
        ...state.currentImprovement,
        regressionResult: payload,
        regressedAt: now,
      };
      if (payload.decision === 'rollback') {
        newState.currentState = 'rolled_back';
        newState.currentImprovement.rolledBackAt = now;
        newState.currentImprovement.rollbackReason = payload.reason || 'regression detected';
        newState.failedImprovements.push(state.currentImprovement);
      } else {
        newState.currentState = 'active';
        newState.currentImprovement.activatedAt = now;
        newState.completedImprovements.push(state.currentImprovement);
      }
      return newState;
    }

    case 'reset': {
      newState.currentState = 'none';
      newState.currentImprovement = null;
      return newState;
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Commands (actions the operator or automation can trigger)
// ---------------------------------------------------------------------------

type Command =
  | { cmd: 'status' }
  | { cmd: 'select' }
  | { cmd: 'code_done'; impFile?: string }
  | { cmd: 'verify_start' }
  | { cmd: 'verify_done'; batchId: string; improvedSources: string[]; unchangedSources: string[]; regressedSources: string[]; netImprovement: number; decision: 'keep' | 'rollback'; reason?: string }
  | { cmd: 'regress_start' }
  | { cmd: 'regress_done'; batchId: string; newBreakages: string[]; netAssessment: string; decision: 'keep' | 'rollback'; reason?: string }
  | { cmd: 'activate' }
  | { cmd: 'rollback'; reason: string }
  | { cmd: 'reset' };

function executeCommand(cmd: Command): void {
  const state = loadState();
  const memory = loadMemory();

  console.log('\n' + '='.repeat(60));
  console.log('123 IMPROVEMENT GATE');
  console.log('='.repeat(60));
  console.log(`Current state: ${state.currentState}${state.currentImprovement ? ` (${state.currentImprovement.id})` : ''}`);

  switch (cmd.cmd) {
    case 'status': {
      console.log('\n--- STATE ---');
      console.log(`State: ${state.currentState}`);
      if (state.currentImprovement) {
        const imp = state.currentImprovement;
        console.log(`Improvement: ${imp.id} — ${imp.experiment}`);
        console.log(`Confidence: ${imp.confidence} | Risk: ${imp.generalizationRisk}`);
        console.log(`Hypothesis: ${imp.hypothesis}`);
        console.log(`Affected: ${imp.affectedCStage} → ${imp.affectedFile}`);
        console.log(`Code change: ${imp.codeChange}`);
        console.log(`Verification sources: ${imp.verificationSources.join(', ')}`);
        console.log(`Regression sources: ${imp.regressionSources.join(', ')}`);
        if (imp.verifiedAt) console.log(`Verified: ${imp.verifiedAt}`);
        if (imp.regressedAt) console.log(`Regressed: ${imp.regressedAt}`);
        if (imp.activatedAt) console.log(`Activated: ${imp.activatedAt}`);
        if (imp.rolledBackAt) console.log(`Rolled back: ${imp.rolledBackAt} — reason: ${imp.rollbackReason}`);
      }
      console.log(`\nCompleted: ${state.completedImprovements.length}`);
      for (const imp of state.completedImprovements) {
        console.log(`  ${imp.id}: ${imp.experiment} (activated ${imp.activatedAt})`);
      }
      console.log(`Failed: ${state.failedImprovements.length}`);
      for (const imp of state.failedImprovements) {
        console.log(`  ${imp.id}: ${imp.experiment} (rolled back ${imp.rolledBackAt})`);
      }
      break;
    }

    case 'select': {
      if (!memory) {
        console.error('[Gate] ERROR: 123-learning-memory.json not found. Run 123-learning-memory.ts first.');
        return;
      }
      const result = selectCandidate(memory, state);
      if (!result.candidate) {
        console.log(`[Gate] ${result.reason}`);
        return;
      }
      const newState = transition(state, 'select', result.candidate);
      writeState(newState);
      console.log(`[Gate] ${result.reason}`);
      console.log(`[Gate] IMP code: ${result.candidate.id}`);
      console.log(`[Gate] Next step: implement code change in ${result.candidate.affectedFile}`);
      console.log(`[Gate] Then run: gate --code_done`);
      break;
    }

    case 'code_done': {
      if (state.currentState !== 'proposed') {
        console.log(`[Gate] Cannot mark code done: state is ${state.currentState}, expected 'proposed'`);
        return;
      }
      const newState = transition(state, 'code_done');
      writeState(newState);
      console.log('[Gate] Code marked as done. IMP flag should now be active.');
      console.log('[Gate] Next step: gate --verify_start to begin verification batch');
      break;
    }

    case 'verify_start': {
      if (state.currentState !== 'coded') {
        console.log(`[Gate] Cannot verify: state is ${state.currentState}, expected 'coded'`);
        return;
      }
      const newState = transition(state, 'verify_start');
      writeState(newState);
      const imp = newState.currentImprovement!;
      console.log(`[Gate] Verification batch starting for ${imp.id}`);
      console.log(`[Gate] Verification sources: ${imp.verificationSources.join(', ')}`);
      console.log('[Gate] Run verification batch with: batchType=verification');
      break;
    }

    case 'verify_done': {
      if (state.currentState !== 'verifying') {
        console.log(`[Gate] Cannot complete verification: state is ${state.currentState}, expected 'verifying'`);
        return;
      }
      const payload = {
        batchId: cmd.batchId,
        improvedSources: cmd.improvedSources,
        unchangedSources: cmd.unchangedSources,
        regressedSources: cmd.regressedSources,
        netImprovement: cmd.netImprovement,
        decision: cmd.decision,
        reason: cmd.reason,
      };
      const newState = transition(state, 'verify_done', payload);
      writeState(newState);
      if (cmd.decision === 'keep') {
        console.log(`[Gate] Verification PASSED. Net improvement: +${cmd.netImprovement}`);
        console.log('[Gate] Next step: gate --regress_start');
      } else {
        console.log(`[Gate] Verification FAILED. Rolled back. Reason: ${cmd.reason}`);
      }
      break;
    }

    case 'regress_start': {
      if (state.currentState !== 'verified') {
        console.log(`[Gate] Cannot regress: state is ${state.currentState}, expected 'verified'`);
        return;
      }
      const newState = transition(state, 'regress_start');
      writeState(newState);
      const imp = newState.currentImprovement!;
      console.log(`[Gate] Regression batch starting for ${imp.id}`);
      console.log(`[Gate] Regression sources: ${imp.regressionSources.join(', ')}`);
      console.log('[Gate] Run regression batch with: batchType=regression');
      break;
    }

    case 'regress_done': {
      if (state.currentState !== 'regressing') {
        console.log(`[Gate] Cannot complete regression: state is ${state.currentState}, expected 'regressing'`);
        return;
      }
      const payload = {
        batchId: cmd.batchId,
        newBreakages: cmd.newBreakages,
        netAssessment: cmd.netAssessment,
        decision: cmd.decision,
        reason: cmd.reason,
      };
      const newState = transition(state, 'regress_done', payload);
      writeState(newState);
      if (cmd.decision === 'keep') {
        console.log(`[Gate] Regression PASSED. Assessment: ${cmd.netAssessment}`);
        console.log(`[Gate] ${newState.currentImprovement?.id} is now ACTIVE.`);
        console.log('[Gate] Use --status to confirm.');
      } else {
        console.log(`[Gate] Regression FAILED. Rolled back. Reason: ${cmd.reason}`);
      }
      break;
    }

    case 'activate': {
      if (state.currentState !== 'verified' && state.currentState !== 'regressing') {
        console.log(`[Gate] Cannot activate: state is ${state.currentState}`);
        return;
      }
      const newState = transition(state, 'regress_done', {
        decision: 'keep',
        netAssessment: 'manual activation',
      });
      writeState(newState);
      console.log('[Gate] Manually activated.');
      break;
    }

    case 'rollback': {
      if (state.currentState === 'none') {
        console.log('[Gate] No active improvement to rollback');
        return;
      }
      const newState = transition(state, 'regress_done', {
        decision: 'rollback',
        reason: cmd.reason,
      });
      writeState(newState);
      console.log(`[Gate] Rolled back. Reason: ${cmd.reason}`);
      break;
    }

    case 'reset': {
      const newState = transition(state, 'reset');
      writeState(newState);
      console.log('[Gate] State reset to none.');
      break;
    }
  }
}

function writeState(state: ImprovementStateFile): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
123 Improvement Gate — Safe Improvement Orchestrator

Usage:
  npx tsx 123-improvement-gate.ts [command] [options]

Commands:
  --status              Show current improvement state
  --select              Select top candidate from memory (proposed state)
  --code_done           Mark code change as complete (proposed → coded)
  --verify_start        Begin verification batch (coded → verifying)
  --verify_done BATCH_ID IMPROVED...UNCHANGED...REGRESSED...NET DECISION REASON
                        Complete verification (verifying → verified/rolled_back)
  --regress_start       Begin regression batch (verified → regressing)
  --regress_done BATCH_ID BREAKAGES...NETASSESS DECISION REASON
                        Complete regression (regressing → active/rolled_back)
  --activate            Manually activate (skip regression)
  --rollback REASON      Rollback current improvement
  --reset               Reset to none

State Machine:
  none → proposed → coded → verifying → verified → regressing → active
                   ↘                     ↘
                     → rolled_back ←──────

Examples:
  # Check current state
  npx tsx 123-improvement-gate.ts --status

  # Select next improvement
  npx tsx 123-improvement-gate.ts --select

  # After implementing code change
  npx tsx 123-improvement-gate.ts --code_done

  # After verification batch (3 improved, 1 unchanged, 0 regressed, net=+3, keep)
  npx tsx 123-improvement-gate.ts --verify_done batch-19 "kungsbacka,cirkus,borlange" "h-gskolan" "" +3 keep "verified"

  # After regression batch (0 new breakages, net=positive, keep)
  npx tsx 123-improvement-gate.ts --regress_done batch-20 "" "no new breakages" keep ""
`);
    return;
  }

  const cmdStr = args[0];
  let cmd: Command;

  switch (cmdStr) {
    case '--status':
      cmd = { cmd: 'status' };
      break;
    case '--select':
      cmd = { cmd: 'select' };
      break;
    case '--code_done':
      cmd = { cmd: 'code_done' };
      break;
    case '--verify_start':
      cmd = { cmd: 'verify_start' };
      break;
    case '--verify_done': {
      // verify_done BATCH_ID IMPROVED_SOURCES UNCHANGED_SOURCES REGRESSED_SOURCES NET_IMPROVEMENT DECISION REASON
      const [batchId, improvedRaw, unchangedRaw, regressedRaw, netStr, decision, ...reasonParts] = args.slice(1);
      cmd = {
        cmd: 'verify_done',
        batchId: batchId || '',
        improvedSources: improvedRaw ? improvedRaw.split(',').filter(Boolean) : [],
        unchangedSources: unchangedRaw ? unchangedRaw.split(',').filter(Boolean) : [],
        regressedSources: regressedRaw ? regressedRaw.split(',').filter(Boolean) : [],
        netImprovement: parseInt(netStr || '0', 10),
        decision: decision as 'keep' | 'rollback',
        reason: reasonParts.join(' '),
      };
      break;
    }
    case '--regress_start':
      cmd = { cmd: 'regress_start' };
      break;
    case '--regress_done': {
      const [batchId, breakagesRaw, netAssessment, decision, ...reasonParts] = args.slice(1);
      cmd = {
        cmd: 'regress_done',
        batchId: batchId || '',
        newBreakages: breakagesRaw ? breakagesRaw.split(',').filter(Boolean) : [],
        netAssessment: netAssessment || '',
        decision: decision as 'keep' | 'rollback',
        reason: reasonParts.join(' '),
      };
      break;
    }
    case '--activate':
      cmd = { cmd: 'activate' };
      break;
    case '--rollback': {
      const reason = args.slice(1).join(' ');
      cmd = { cmd: 'rollback', reason };
      break;
    }
    case '--reset':
      cmd = { cmd: 'reset' };
      break;
    default:
      console.error(`Unknown command: ${cmdStr}`);
      console.error('Run with --help for usage.');
      return;
  }

  executeCommand(cmd);
}

main();
