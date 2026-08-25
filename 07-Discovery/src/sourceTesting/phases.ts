import type { SourceCandidateTestPhase, SourceCandidateToolEvidence } from './types.js';

export function phaseEvidenceComplete(phase: SourceCandidateTestPhase, evidence: SourceCandidateToolEvidence): boolean {
  if (!evidence.reportComplete) return false;
  if (phase === 'sanity') {
    return evidence.eventsFoundTotal > 0 || evidence.winningPath !== 'none';
  }
  if (phase === 'breadth') {
    return evidence.eventsFoundTotal > 0 && evidence.winningPath !== 'none';
  }
  return evidence.eventsPersisted > 0 && evidence.eventsAfterNormalization > 0;
}
