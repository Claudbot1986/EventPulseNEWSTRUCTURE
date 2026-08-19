/**
 * parse_intent — turn a free-text query into a deterministic IntentBrief.
 *
 * Phase 0: regex + keyword extraction only (sv/en). No LLM call.
 * Phase 1 may swap in a model router behind parseIntent().
 */

import { z } from 'zod';
import type {
  IntentBrief,
  IntentBudget,
  IntentLanguage,
  IntentParty,
  IntentTimeOfDay,
} from '../types';

export const IntentBriefSchema = z.object({
  raw_query: z.string(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time_of_day: z.enum(['morning', 'afternoon', 'evening', 'night', 'anytime']),
  budget:       z.enum(['free', 'low', 'medium', 'high', 'any']),
  party:        z.enum(['solo', 'couple', 'friends', 'family', 'any']),
  categories:   z.array(z.string()),
  city:         z.string(),
  language:     z.enum(['sv', 'en']),
  exclude_categories: z.array(z.string()),
});

const TIME_OF_DAY_RULES: Array<[RegExp, IntentTimeOfDay]> = [
  [/\b(förmiddag|morgon|fm)\b/i,        'morning'],
  [/\b(eftermiddag|em)\b/i,             'afternoon'],
  [/\b(kväll|kvällen|ikväll|tonight)\b/i, 'evening'],
  [/\b(natt|nattetid)\b/i,              'night'],
];

const BUDGET_RULES: Array<[RegExp, IntentBudget]> = [
  [/\b(gratis|free|kostnadsfritt)\b/i, 'free'],
  [/\b(billigt|budget|under\s?200)\b/i, 'low'],
  [/\b(mellan\s?\d|måttligt)\b/i, 'medium'],
  [/\b(lyx|premium|dyrt)\b/i, 'high'],
];

// "max X kr" / "under X kr" / "högst X kr" — mapped to budget enum by amount.
// <200 → low, <500 → medium, else high.
const AMOUNT_BUDGET_RE = /\b(?:max|under|högst|upp\s*till|upp\s*til|max\s*\.|maxst)\s+(\d+)\s*(?:kr|:-|sek)\b/i;

function budgetFromAmount(query: string): IntentBudget | null {
  const m = query.match(AMOUNT_BUDGET_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 200) return 'low';
  if (n < 500) return 'medium';
  return 'high';
}

const PARTY_RULES: Array<[RegExp, IntentParty]> = [
  [/\b(solo|själv|ensam)\b/i,                  'solo'],
  [/\b(dejt|date|partner|käresta|med\s+en\s+vän|tillsammans\s+med\s+en|min\s+vän)\b/i, 'couple'],
  [/\b(kompis|vänner|gänget|gäng|kollegor|kollega|polarna|afterwork)\b/i, 'friends'],
  [/\b(familj|barn|unga|kids)\b/i,             'family'],
];

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(musik|konsert|orkester|band|concert|music|jazz|live)\b/i, 'music'],
  [/\b(teater|drama|skådespel|theater|play|show)\b/i,            'theater'],
  [/\b(dans|balett|dance)\b/i,                                   'dance'],
  [/\b(film|bio|cinema|movie)\b/i,                               'film'],
  [/\b(konst|galleri|utställning|art|gallery|exhibition)\b/i,     'art'],
  [/\b(föreläsning|lecture|talk|seminar)\b/i,                    'lecture'],
  [/(?:mat|food|festival|street\s*food|matfestival|food\s*festival)/i, 'food'],
  [/\b(familj|barn|family|kids|unga)\b/i,                        'family'],
];

const EXCLUDE_RULES: Array<[RegExp, string]> = [
  [/\b(inte\s+musik|no\s+music|ej\s+musik)\b/i, 'music'],
  [/\b(inte\s+teater|no\s+theater)\b/i,         'theater'],
  // Negative venue/category tokens. These land in exclude_categories even
  // when no current category matches the slug — the downstream filter is
  // best-effort. Phase 1 ranking + DB filter is the source of truth.
  [/\b(inte\s+arena|inte\s+arenor|no\s+arena|ej\s+arena|utan\s+arena)\b/i, 'arena'],
];

const DATE_RANGE_RULES: Array<[RegExp, (match: RegExpMatchArray, today: Date) => { from?: string; to?: string }]> = [
  // "denna helg" / "this weekend"
  [/\b(denna\s+helg|this\s+weekend)\b/i, (_m, today) => {
    const day = today.getDay(); // 0=Sun..6=Sat
    const sat = new Date(today);
    sat.setDate(today.getDate() + ((6 - day + 7) % 7));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    return { from: iso(sat), to: iso(sun) };
  }],
  // "ikväll" / "tonight"
  [/\b(ikväll|tonight|i\s+kväll)\b/i, (_m, today) => {
    return { from: iso(today), to: iso(today) };
  }],
  // "nästa vecka" / "next week"
  [/\b(nästa\s+vecka|next\s+week)\b/i, (_m, today) => {
    const mon = new Date(today); mon.setDate(today.getDate() + ((1 - today.getDay() + 7) % 7 || 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: iso(mon), to: iso(sun) };
  }],
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pickFirst<T>(text: string, rules: Array<[RegExp, T]>, fallback: T): T {
  for (const [re, val] of rules) {
    if (re.test(text)) return val;
  }
  return fallback;
}

function pickAll<T>(text: string, rules: Array<[RegExp, T]>): T[] {
  const out = new Set<T>();
  for (const [re, val] of rules) {
    if (re.test(text)) out.add(val);
  }
  return [...out];
}

export function parseIntentDeterministic(query: string, today: Date = new Date()): IntentBrief {
  const text = query.trim();
  // Swedish stopwords — used as a fallback when no å/ä/ö is present.
  const SV_STOPWORDS = /\b(hej|tack|gratis|ikväll|konsert|teater|biljett|föreställning|utställning|föreläsning|ikväll|ikvällens|mat|film|bio|dans|konst|familj|barn|unga|kompis|vänner|gratis|kostar|öppnar|stänger|fredag|lördag|söndag|måndag|tisdag|onsdag|torsdag|helg|vecka|kväll|morgon|ikväll|ikvällens|ikvällen|vad\s+finns|hittar|hjälp)\b/i;
  const language: IntentLanguage =
    /[åäöÅÄÖ]/.test(text) || SV_STOPWORDS.test(text) ? 'sv' : 'en';

  const time_of_day   = pickFirst(text, TIME_OF_DAY_RULES, 'anytime');
  // Budget: amount-based ("max X kr") wins over keyword (more specific).
  const budgetKeyword = pickFirst(text, BUDGET_RULES, 'any');
  const budgetAmount  = budgetFromAmount(text);
  const budget        = budgetAmount ?? budgetKeyword;
  const party         = pickFirst(text, PARTY_RULES, 'any');
  const categories    = pickAll(text, CATEGORY_RULES);
  const exclude       = pickAll(text, EXCLUDE_RULES);

  let date_from: string | undefined;
  let date_to:   string | undefined;
  for (const [re, fn] of DATE_RANGE_RULES) {
    const m = text.match(re);
    if (m) {
      const r = fn(m, today);
      date_from = r.from;
      date_to   = r.to;
      break;
    }
  }

  return {
    raw_query:     text,
    date_from,
    date_to,
    time_of_day,
    budget,
    party,
    categories,
    city:          'Stockholm',
    language,
    exclude_categories: exclude,
  };
}

/**
 * Phase 1 hook. For now this is just deterministic.
 */
export async function parseIntent(query: string, today: Date = new Date()): Promise<IntentBrief> {
  return parseIntentDeterministic(query, today);
}
