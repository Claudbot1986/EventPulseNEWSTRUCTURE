import type { SourceCandidateDecision, SourceCandidateDecisionInput } from './types.js';

const LOW_CONFIDENCE = 45;
const PROMOTE_CONFIDENCE = 90;
const MANUAL_REVIEW_CONFIDENCE = 65;
const REJECT_CONFIDENCE = 80;

export function decideSourceCandidateOutcome(input: SourceCandidateDecisionInput): SourceCandidateDecision {
  const base = {
    sourceCandidateId: input.candidate.id,
    evidenceRunId: null,
    promotedSourceId: null,
  };

  if (input.duplicateCanonicalSource) {
    return {
      ...base,
      decision: 'reject',
      reason: 'duplicate canonical source URL',
      confidenceScore: REJECT_CONFIDENCE,
    };
  }

  if (input.errors.some((error) => /404|dead|dns|irrelevant|blocked/i.test(error))) {
    return {
      ...base,
      decision: 'reject',
      reason: `source failed with terminal error: ${input.errors[0]}`,
      confidenceScore: REJECT_CONFIDENCE,
    };
  }

  if (input.eventsFoundTotal === 0 && input.winningPath === 'none') {
    return {
      ...base,
      decision: 'reject',
      reason: 'no event signal after ordered source test',
      confidenceScore: Math.max(REJECT_CONFIDENCE, input.candidate.confidenceScore),
    };
  }

  if (!input.reportComplete) {
    return {
      ...base,
      decision: 'manual_review',
      reason: 'test report incomplete; requires human review before any promotion',
      confidenceScore: MANUAL_REVIEW_CONFIDENCE,
    };
  }

  if (input.riskFlags.some((flag) => /venue|mapping|ambiguous|render_cost/i.test(flag))) {
    return {
      ...base,
      decision: 'manual_review',
      reason: `risk flags require review: ${input.riskFlags.join(', ')}`,
      confidenceScore: MANUAL_REVIEW_CONFIDENCE,
    };
  }

  if (input.phase !== 'smoke') {
    if (input.eventsFoundTotal > 0 || input.winningPath !== 'none') {
      return {
        ...base,
        decision: 'manual_review',
        reason: `phase ${input.phase} passed signal but requires smoke before promote`,
        confidenceScore: MANUAL_REVIEW_CONFIDENCE,
      };
    }
    return {
      ...base,
      decision: 'reject',
      reason: `phase ${input.phase} did not produce a usable event signal`,
      confidenceScore: LOW_CONFIDENCE,
    };
  }

  if (input.eventsPersisted > 0 && input.eventsAfterNormalization > 0) {
    return {
      ...base,
      decision: 'promote',
      reason: 'smoke passed with persisted events and complete evidence path',
      confidenceScore: Math.max(PROMOTE_CONFIDENCE, input.candidate.confidenceScore),
    };
  }

  return {
    ...base,
    decision: 'manual_review',
    reason: 'smoke did not persist events; do not promote automatically',
    confidenceScore: MANUAL_REVIEW_CONFIDENCE,
  };
}
