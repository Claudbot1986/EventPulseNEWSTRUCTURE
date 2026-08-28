/**
 * find_gaps — Phase 1 mixed-initiative clarification (Workstream C).
 *
 * The agent's contract (MASTERPLAN §18.2 decision 1):
 *   - Results before questions. The chat handler ALWAYS runs the search
 *     pipeline; clarifying questions, if any, are ATTACHED alongside
 *     the cards — they never replace them.
 *   - At most ONE clarifying question per turn (`MAX_QUESTIONS = 1`).
 *   - Choice is driven by the same active-learning information-gain ranking
 *     (Settles 2009; Schein 2002) used by the original findGaps — we just
 *     cap the result at the highest-gain slot.
 *
 * Public API:
 *   pickClarifyingQuestion(intent) → single ClarifyingQuestion | null
 *   findGaps(intent)               → 0..MAX_QUESTIONS questions (legacy adapter)
 *   isIntentComplete(intent)       → boolean soft-check (NOT a search gate)
 *   slotGain(intent, slot)         → pure, exported for tests
 *
 * Research basis — unchanged from Phase 1.7:
 *   - Settles (2009), "Active Learning Literature Survey", §3 Information
 *     Density: when several labels are missing, query the one whose answer
 *     is most informative — measured by expected reduction in uncertainty.
 *   - Schein (2002): the contribution of a feature to model uncertainty
 *     scales with its discriminative power — a feature that splits the
 *     candidate space roughly evenly is more informative than one that
 *     leaves most candidates the same.
 *   - Conditional gain: time_of_day on a single-day window dominates the
 *     relevance signal, so its gain is bumped from 0.7 to 0.95.
 */

import type { ClarifyingQuestion, IntentBrief } from '../types';

/** Hard cap on the number of clarifying questions per turn. */
export const MAX_QUESTIONS = 1;

export type GapSlot = 'category' | 'time_of_day' | 'party';

/**
 * Expected information gain for asking about a given slot, given the
 * current intent state. Higher = ask first. Pure function (no I/O).
 */
export function slotGain(intent: IntentBrief, slot: GapSlot): number {
  switch (slot) {
    case 'category':
      // Most discriminating in event search. Selecting one category
      // (e.g. "music") typically reduces candidates by ~10× in our DB.
      return 1.0;
    case 'time_of_day': {
      // Medium gain by default. If the user pinned a single day
      // ("tomorrow", "on Friday"), time_of_day dominates the ranking —
      // so amplify the gain to put it second in priority only when the
      // date window is wide-open. For narrow windows, it's the highest
      // remaining signal after category.
      const isNarrowWindow =
        !!intent.date_from &&
        !!intent.date_to &&
        intent.date_from === intent.date_to;
      return isNarrowWindow ? 0.95 : 0.7;
    }
    case 'party':
      // Lowest gain — overlaps with category ("family" already constrains
      // categories). Still useful for solo/date/friends segmentation.
      return 0.5;
  }
}

// ─── Question builders ──────────────────────────────────────────────────────

function categoryQuestion(lang: IntentBrief['language']): ClarifyingQuestion {
  return {
    id: 'category',
    text:
      lang === 'sv'
        ? 'Vad för typ av evenemang är du sugen på?'
        : 'What kind of event are you in the mood for?',
    options: [
      { label: lang === 'sv' ? 'Konsert'     : 'Concert',   value: 'konsert' },
      { label: lang === 'sv' ? 'Teater'      : 'Theater',   value: 'teater' },
      { label: lang === 'sv' ? 'Utställning' : 'Exhibition', value: 'utställning' },
      { label: lang === 'sv' ? 'Mat & dryck' : 'Food',      value: 'mat' },
      { label: lang === 'sv' ? 'Familj'      : 'Family',    value: 'familj' },
    ],
  };
}

function timeOfDayQuestion(lang: IntentBrief['language']): ClarifyingQuestion {
  return {
    id: 'time_of_day',
    text:
      lang === 'sv' ? 'När vill du gå?' : 'When do you want to go?',
    options: [
      { label: lang === 'sv' ? 'Ikväll'           : 'Tonight',      value: 'ikväll' },
      { label: lang === 'sv' ? 'I helgen'         : 'This weekend', value: 'i helgen' },
      { label: lang === 'sv' ? 'Nästa vecka'      : 'Next week',    value: 'nästa vecka' },
      { label: lang === 'sv' ? 'Spelar ingen roll' : 'Anytime',     value: 'när som helst' },
    ],
  };
}

function partyQuestion(lang: IntentBrief['language']): ClarifyingQuestion {
  return {
    id: 'party',
    text:
      lang === 'sv' ? 'Vem ska du gå med?' : 'Who are you going with?',
    options: [
      { label: lang === 'sv' ? 'Solo'    : 'Solo',    value: 'solo' },
      { label: lang === 'sv' ? 'Dejt'    : 'Date',    value: 'dejt' },
      { label: lang === 'sv' ? 'Kompisar' : 'Friends', value: 'kompis' },
      { label: lang === 'sv' ? 'Familj'  : 'Family',  value: 'familj' },
    ],
  };
}

// ─── Internal candidate builder ────────────────────────────────────────────

type Candidate = { slot: GapSlot; gain: number; question: ClarifyingQuestion };

/**
 * Collect candidate clarifying questions, ordered by information gain
 * (highest first). Internal helper — exported only via the legacy
 * `findGaps` adapter and the new `pickClarifyingQuestion` below.
 */
function rankCandidates(intent: IntentBrief): Candidate[] {
  const candidates: Candidate[] = [];

  if (intent.categories.length === 0) {
    candidates.push({
      slot: 'category',
      gain: slotGain(intent, 'category'),
      question: categoryQuestion(intent.language),
    });
  }
  if (intent.time_of_day === 'anytime') {
    candidates.push({
      slot: 'time_of_day',
      gain: slotGain(intent, 'time_of_day'),
      question: timeOfDayQuestion(intent.language),
    });
  }
  if (intent.party === 'any') {
    candidates.push({
      slot: 'party',
      gain: slotGain(intent, 'party'),
      question: partyQuestion(intent.language),
    });
  }

  // Sort by gain descending. Stable sort preserves insertion order for
  // ties (which preserves our intent: when gains are equal, the order is
  // category → time_of_day → party).
  candidates.sort((a, b) => b.gain - a.gain);
  return candidates;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Pick the single highest-gain clarifying question for this intent, or
 * `null` when the intent is already complete enough to search as-is.
 *
 * The chat handler calls this AFTER running search_events. The returned
 * question is ATTACHED to the response envelope so the user sees results
 * AND a nudge to refine — never one OR the other.
 *
 * Pure: no I/O, deterministic for a given intent.
 */
export function pickClarifyingQuestion(
  intent: IntentBrief
): ClarifyingQuestion | null {
  const candidates = rankCandidates(intent);
  return candidates.length > 0 ? candidates[0].question : null;
}

/**
 * Legacy adapter. Returns up to MAX_QUESTIONS (=1) clarifying questions,
 * ordered by information gain. Kept for backward compatibility with
 * existing callers and any test that still wants an array.
 *
 * New code should prefer `pickClarifyingQuestion` — the server-side contract
 * is "at most one question, attached alongside results", and that contract
 * is easier to enforce with a function that returns 0 or 1.
 */
export function findGaps(intent: IntentBrief): ClarifyingQuestion[] {
  const candidates = rankCandidates(intent);
  return candidates.slice(0, MAX_QUESTIONS).map((c) => c.question);
}

/**
 * Soft completeness check. True when every critical slot is filled.
 *
 * The chat handler does NOT use this as a hard gate (see MASTERPLAN §18.2
 * decision 1). It is exposed so other tools and tests can reason about
 * intent quality without it ever blocking the search pipeline.
 */
export function isIntentComplete(intent: IntentBrief): boolean {
  return findGaps(intent).length === 0;
}