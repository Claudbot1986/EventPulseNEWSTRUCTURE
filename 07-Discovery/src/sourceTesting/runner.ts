import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { decideSourceCandidateOutcome } from './decision.js';
import { phaseEvidenceComplete } from './phases.js';
import { createSandboxSource, hasCanonicalSourceUrl, promoteSourceCandidate, removeSandboxSource } from './sandbox.js';
import type {
  SourceCandidate,
  SourceCandidateDecision,
  SourceCandidateTestPhase,
  SourceCandidateTestRepository,
  SourceCandidateTestRun,
  SourceCandidateToolRunner,
} from './types.js';

export interface RunSourceCandidateTestOptions {
  candidate: SourceCandidate;
  phase: SourceCandidateTestPhase;
  projectRoot: string;
  repository: SourceCandidateTestRepository;
  toolRunner: SourceCandidateToolRunner;
  sandboxRoot?: string;
  promotionRoot?: string;
}

export interface RunSourceCandidateTestResult {
  runId: string;
  decision: SourceCandidateDecision;
}

export async function runSourceCandidateTest(options: RunSourceCandidateTestOptions): Promise<RunSourceCandidateTestResult> {
  const sandboxRoot = options.sandboxRoot ?? mkdtempSync(path.join(tmpdir(), 'eventpulse-source-candidate-'));
  const ownsSandbox = !options.sandboxRoot;
  const sandboxSource = createSandboxSource(sandboxRoot, options.candidate);

  try {
    const evidence = await options.toolRunner.run({
      candidate: options.candidate,
      phase: options.phase,
      projectRoot: options.projectRoot,
      sandboxRoot,
      sandboxSourceId: sandboxSource.sourceId,
    });

    const run: SourceCandidateTestRun = {
      ...evidence,
      sourceCandidateId: options.candidate.id,
      phase: options.phase,
      sandboxSourceId: sandboxSource.sourceId,
    };
    const runId = await options.repository.insertRun(run);
    const promotionRoot = options.promotionRoot ?? options.projectRoot;
    const decision = {
      ...decideSourceCandidateOutcome({
        candidate: options.candidate,
        phase: options.phase,
        eventsFoundTotal: evidence.eventsFoundTotal,
        eventsAfterNormalization: evidence.eventsAfterNormalization,
        eventsPersisted: evidence.eventsPersisted,
        winningPath: evidence.winningPath,
        errors: evidence.errors,
        riskFlags: evidence.riskFlags,
        reportComplete: phaseEvidenceComplete(options.phase, evidence),
        duplicateCanonicalSource: hasCanonicalSourceUrl(promotionRoot, options.candidate.candidateUrl),
      }),
      evidenceRunId: runId,
    };
    if (decision.decision === 'promote') {
      decision.promotedSourceId = promoteSourceCandidate(promotionRoot, options.candidate, {
        preferredPath: evidence.winningPath,
        preferredPathReason: decision.reason,
        testRunId: runId,
        evidenceSummary: `${evidence.eventsPersisted} persisted events via ${evidence.winningPath}`,
      });
    }

    await options.repository.insertDecision(decision);
    await options.repository.updateCandidateStatus(options.candidate.id, statusForDecision(decision.decision));
    return { runId, decision };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await options.repository.updateCandidateStatus(options.candidate.id, 'failed', message);
    throw error;
  } finally {
    removeSandboxSource(sandboxRoot, sandboxSource.sourceId);
    if (ownsSandbox) rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

function statusForDecision(decision: SourceCandidateDecision['decision']) {
  if (decision === 'promote') return 'passed';
  if (decision === 'reject') return 'failed';
  return 'manual_review';
}
