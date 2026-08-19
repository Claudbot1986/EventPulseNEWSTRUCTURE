/**
 * find_gaps — Phase 1 cold-start with active-learning question ordering.
 *
 * Given an IntentBrief, decide whether the agent has enough signal to search.
 * If not, return up to MAX_QUESTIONS short clarifying questions the agent
 * can ask the user. The deterministic pipeline then waits for an answer
 * instead of guessing — better to ask than to flood the user with irrelevant
 * events.
 *
 * ─── Research basis ────────────────────────────────────────────────────────
 *
 * Active learning (Settles 2009, "Active Learning Literature Survey",
 * §3 Information Density): when several labels are missing, query the one
 * whose answer is most informative — measured by expected reduction in
 * uncertainty over the downstream task. For event search this means: the
 * slot whose filled value would most change which events we surface.
 *
 * Logistic regression active learning (Schein 2002): the contribution of a
 * feature to model uncertainty scales with its discriminative power — a
 * feature that splits the candidate space roughly evenly is more
 * informative than one that leaves most candidates the same.
 *
 * Heuristic mapping for v1:
 *   - category   gain = 1.0   (highest — selecting a category cuts the
 *                              candidate set ~10× in our data)
 *   - time_of_day gain = 0.7  (medium — narrows the candidate set ~2×)
 *                              Raised to 0.95 if the date window is a
 *                              single day (user said "tomorrow"): on a
 *                              one-day window, time-of-day dominates the
 *                              relevance signal.
 *   - party      gain = 0.5   (lowest — narrows the set less and overlaps
 *                              with category for "family" vs "kids")
 *
 * These weights are static for now. A future v2 can swap slotGain() for a
 * function that reads aggregate event counts from the DB (the canonical
 * "entropy over candidate space" estimator). The current implementation
 * keeps cold-start free of I/O — every chat request must respond in
 * well under a second even with cache miss.
 *
 * The chip options are designed so the user's free-text reply (or chip
 * tap) can be parsed by the existing parse_intent regex rules — chip
 * values are short Swedish/English triggers the regex already understands.
 */

import type { ClarifyingQuestion, IntentBrief } from '../types';

const MAX_QUESTIONS = 3;

export type GapSlot = 'category' | 'time_of_day' | 'party';

/**
 * Expected information gain for asking about a given slot, given the
 * current intent state. Higher = ask first. Pure function (no I/O).
 *
 * Settles 2009: information density. Schein 2002: most-informative
 * feature. The conditional logic on date window reflects a Settles
 * insight — informativeness of a question depends on context.
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

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Decide whether the intent is "searchable enough". Returns the
 * clarifying questions, ordered by expected information gain (highest
 * first). Capped at MAX_QUESTIONS.
 *
 * When this returns an empty array, isIntentComplete() is true and the
 * chat handler runs the search pipeline. Otherwise the agent asks the
 * questions instead of guessing.
 */
export function findGaps(intent: IntentBrief): ClarifyingQuestion[] {
  type Candidate = { slot: GapSlot; gain: number; question: ClarifyingQuestion };

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
  return candidates.slice(0, MAX_QUESTIONS).map((c) => c.question);
}

/**
 * True iff the intent is "searchable enough" — no missing critical slot.
 * Used as the gate: when this returns false, the agent asks instead of
 * searching.
 */
export function isIntentComplete(intent: IntentBrief): boolean {
  return findGaps(intent).length === 0;
}