/**
 * find_gaps — Phase 1 cold-start.
 *
 * Given an IntentBrief, decide whether the agent has enough signal to search.
 * If not, return up to MAX_QUESTIONS short clarifying questions the agent
 * can ask the user. The deterministic pipeline then waits for an answer
 * instead of guessing — better to ask than to flood the user with irrelevant
 * events.
 *
 * Priority order (most important slot first):
 *   1. category   — without it we return mixed events
 *   2. time_of_day — without it "now" is ambiguous
 *   3. party       — without it family/kid filters don't engage
 *
 * The questions are designed so the user's free-text reply can be parsed
 * by the existing parse_intent regex rules. The chip labels are short
 * Swedish/English triggers the regex already understands.
 *
 * Anti-noise: if the raw_query already contains a strong signal for one
 * of the slots (the parse layer would have picked it up), we skip that
 * slot. This file is purely a *display* layer; the truth lives in
 * IntentBrief.
 */

import type { ClarifyingQuestion, IntentBrief } from '../types';

const MAX_QUESTIONS = 3;

export function findGaps(intent: IntentBrief): ClarifyingQuestion[] {
  const questions: ClarifyingQuestion[] = [];
  const lang = intent.language;

  // ─── 1. Category ───────────────────────────────────────────────────────
  if (intent.categories.length === 0) {
    questions.push({
      id: 'category',
      text:
        lang === 'sv'
          ? 'Vad för typ av evenemang är du sugen på?'
          : 'What kind of event are you in the mood for?',
      options: [
        { label: lang === 'sv' ? 'Konsert'  : 'Concert',  value: 'konsert' },
        { label: lang === 'sv' ? 'Teater'   : 'Theater',  value: 'teater' },
        { label: lang === 'sv' ? 'Utställning' : 'Exhibition', value: 'utställning' },
        { label: lang === 'sv' ? 'Mat & dryck' : 'Food',   value: 'mat' },
        { label: lang === 'sv' ? 'Familj'   : 'Family',   value: 'familj' },
      ],
    });
  }

  // ─── 2. Time of day ────────────────────────────────────────────────────
  if (intent.time_of_day === 'anytime') {
    questions.push({
      id: 'time_of_day',
      text:
        lang === 'sv'
          ? 'När vill du gå?'
          : 'When do you want to go?',
      options: [
        { label: lang === 'sv' ? 'Ikväll'    : 'Tonight',    value: 'ikväll' },
        { label: lang === 'sv' ? 'I helgen'  : 'This weekend', value: 'i helgen' },
        { label: lang === 'sv' ? 'Nästa vecka' : 'Next week', value: 'nästa vecka' },
        { label: lang === 'sv' ? 'Spelar ingen roll' : 'Anytime', value: 'när som helst' },
      ],
    });
  }

  // ─── 3. Party ───────────────────────────────────────────────────────────
  if (intent.party === 'any') {
    questions.push({
      id: 'party',
      text:
        lang === 'sv'
          ? 'Vem ska du gå med?'
          : 'Who are you going with?',
      options: [
        { label: lang === 'sv' ? 'Solo'    : 'Solo',    value: 'solo' },
        { label: lang === 'sv' ? 'Dejt'    : 'Date',    value: 'dejt' },
        { label: lang === 'sv' ? 'Kompisar' : 'Friends', value: 'kompis' },
        { label: lang === 'sv' ? 'Familj'  : 'Family',  value: 'familj' },
      ],
    });
  }

  return questions.slice(0, MAX_QUESTIONS);
}

/**
 * True iff the intent is "searchable enough" — every critical slot filled.
 * Used as the gate: when this returns false, the agent asks instead of
 * searching.
 */
export function isIntentComplete(intent: IntentBrief): boolean {
  return findGaps(intent).length === 0;
}
