import type { SourceCandidateDecision, SourceCandidateDecisionInput } from './types.js';
import { assessLikeness, shouldBlockPromotion } from './eventLikeness.js';

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
    // 2026-11-01 — kvalitetsgate. "Det persisterats events" är sant för en
    // blogg också: kollaborationse lade in 10 artikelrubrikor som events.
    // Innan promote kontrolleras därför att raderna FÖRSTÅS som evenemang.
    // Gaten är avsiktligt konservativ: bara en klar majoritet artiklar
    // blockerar, okända rader blockerar aldrig.
    //
    // Prioritet: sidans EGNA deklarationer (JSON-LD) väger tyngre än titeln.
    // Mätt: titelmönstren fångar 4 av 8 artikelrubriker i kollaborationse,
    // medan sidans `Article`-deklaration fångar alla.
    const pageSignals = input.eventPageSignals ?? [];
    const titles = input.eventTitles ?? [];
    const rows = pageSignals.length > 0
      ? pageSignals
      : titles.map((title) => ({ title }));
    const assessment = assessLikeness(rows);
    const gate = shouldBlockPromotion(assessment);
    if (gate.blocked) {
      return {
        ...base,
        decision: 'reject',
        reason: `rows look like articles, not events — ${gate.reason}`,
        confidenceScore: REJECT_CONFIDENCE,
      };
    }
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
