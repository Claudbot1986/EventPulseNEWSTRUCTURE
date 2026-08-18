/**
 * rank_events — deterministic feature-based ranker.
 *
 * Phase 0: no LLM re-ranking. Weights below are the *initial* baseline;
 * they will be tuned against the golden eval set in Phase 1.
 *
 * Output is `reasons: RankReason[]` — an enum only — never free text.
 * This keeps the contract verifiable and prevents the model from inventing
 * rationale that we cannot trace.
 */

import type {
  EventCard,
  IntentBrief,
  RankedEvent,
  RankReason,
} from '../types';

export const RANK_WEIGHTS = {
  time_fit:           25,
  under_budget:       20,
  over_budget:       -30,
  category_match:     30,
  exclude_match:     -50,
  not_ended:           5,
  high_confidence:    15,
  low_confidence:    -10,
  stale:             -15,
} as const;

/** Confidence threshold for the `high_confidence` ranker reason. */
export const CONFIDENCE_HIGH = 70;
/** Confidence below this triggers the `low_confidence` reason. */
export const CONFIDENCE_LOW = 50;
/** Freshness older than this (ms) triggers the `stale` reason. Default 14d. */
export const STALE_AFTER_MS = 14 * 24 * 3600_000;

export interface RankOptions {
  /** override default topN. Default 5. */
  topN?: number;
  /** ISO "now" — tests inject a deterministic value */
  now?: Date;
}

export function rankEvents(
  cards: EventCard[],
  intent: IntentBrief,
  opts: RankOptions = {}
): RankedEvent[] {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const topN = opts.topN ?? 5;

  const scored: RankedEvent[] = cards.map((c) => {
    const reasons: RankReason[] = [];
    let score = 0;

    // not_ended
    if (new Date(c.start_time).getTime() > nowMs) {
      score += RANK_WEIGHTS.not_ended;
      reasons.push('not_ended');
    }

    // time_fit (rough hour bucket vs intent.time_of_day)
    const hour = new Date(c.start_time).getHours();
    if (
      (intent.time_of_day === 'morning'   && hour >= 6  && hour < 12) ||
      (intent.time_of_day === 'afternoon' && hour >= 12 && hour < 17) ||
      (intent.time_of_day === 'evening'   && hour >= 17 && hour < 22) ||
      (intent.time_of_day === 'night'     && (hour >= 22 || hour < 6))
    ) {
      score += RANK_WEIGHTS.time_fit;
      reasons.push('time_fit');
    }

    // budget
    if (intent.budget === 'free' && c.is_free) {
      score += RANK_WEIGHTS.under_budget;
      reasons.push('under_budget');
    } else if (intent.budget === 'free' && !c.is_free) {
      score += RANK_WEIGHTS.over_budget;
      reasons.push('over_budget');
    }

    // category match
    if (intent.categories.length > 0 && intent.categories.includes(c.category_slug)) {
      score += RANK_WEIGHTS.category_match;
      reasons.push('category_match');
    }

    // exclude
    if (intent.exclude_categories.length > 0 && intent.exclude_categories.includes(c.category_slug)) {
      score += RANK_WEIGHTS.exclude_match;
      reasons.push('exclude_match');
    }

    // confidence (only if score is known — null/undefined is "no signal yet")
    if (typeof c.confidence_score === 'number') {
      if (c.confidence_score >= CONFIDENCE_HIGH) {
        score += RANK_WEIGHTS.high_confidence;
        reasons.push('high_confidence');
      } else if (c.confidence_score < CONFIDENCE_LOW) {
        score += RANK_WEIGHTS.low_confidence;
        reasons.push('low_confidence');
      }
    }

    // freshness — ISO timestamp older than STALE_AFTER_MS triggers `stale`
    if (c.freshness_at) {
      const freshMs = new Date(c.freshness_at).getTime();
      if (Number.isFinite(freshMs) && nowMs - freshMs > STALE_AFTER_MS) {
        score += RANK_WEIGHTS.stale;
        reasons.push('stale');
      }
    }

    return { card: c, score, reasons };
  });

  // Stable sort: score desc, then earliest start_time, then id.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = new Date(a.card.start_time).getTime();
    const tb = new Date(b.card.start_time).getTime();
    if (ta !== tb) return ta - tb;
    return a.card.id.localeCompare(b.card.id);
  });

  return scored.slice(0, topN);
}
