/**
 * Moods — Fas D (2026-09-23): the "Stämningsfullt" Utforska tile.
 *
 * A mood is a STATIC lexicon: words/categories that recognize events whose
 * copy carries the mood. The term list was generated ONCE with MiniMax-M3
 * (tools/generate-mood-terms.mjs, 2026-09-23) and then curated by hand —
 * see the curation notes below. No runtime LLM: matching is a pure
 * case-insensitive substring test over title + description, plus a small
 * category anchor list for inherently atmospheric categories.
 *
 * Curation pass (MiniMax output → committed list), 2026-09-23:
 *   REMOVED 'öm'      — substring-matches "berömd" (famous), not tender.
 *   REMOVED 'kör'     — substring-matches "körkort"/"provkör". The compounds
 *                       körmusik/körkonsert stay (no false superstrings).
 *   REMOVED 'visor'   — substring-matches "barnvisor" (kids' songs).
 *   REMOVED 'romans'  — ambiguous with the novel sense in book-talk copy.
 *   'mörklagd'       → 'mörklag'  — base form covers -d/-t/-da inflections.
 *   'andliga sånger' → 'andlig'   — base form covers all inflections and
 *                       more copy ("andlig musik", "andlig afton").
 * Broad single words (musik, kväll, konsert, teater) are deliberately
 * FORBIDDEN as terms — pinned by moods.test.ts.
 */

import type { EventCard } from '../types';

export interface MoodDefinition {
  /** Lowercase substrings matched against title + description. */
  terms: string[];
  /** category_slug anchors: inherently mood-carrying categories. */
  categories: string[];
}

export const MOODS: Record<string, MoodDefinition> = {
  stamningsfullt: {
    terms: [
      // ── core mood words (best first) ──────────────────────────────
      'stämningsfull',
      'intim',
      'magisk',
      'melankolisk',
      'atmosfärisk',
      'vemodig',
      'poetisk',
      'drömsk',
      'suggestiv',
      // ── candlelight / light imagery ───────────────────────────────
      'stearinljus',
      'levande ljus',
      'mörklag',
      'candlelight',
      'ljusinstallation',
      'skymning',
      'novemberljus',
      'dagsljus',
      // ── venues that carry the mood by themselves ──────────────────
      'kyrka',
      'katedral',
      'kapell',
      'jazzklubb',
      // ── intimate classical / sacred forms ────────────────────────
      'kammarmusik',
      'stråkkvartett',
      'körmusik',
      'körkonsert',
      'pianorecital',
      'cellokonsert',
      'aftonkonsert',
      'middagskonsert',
      'lunchkonsert',
      'serenad',
      'a cappella',
      'psalmer',
      'andlig',
      'sakral',
      'requiem',
      'barock',
      'sopran',
      'mezzosopran',
      'baryton',
      'recitation',
      // ── acoustic / folk / ambient ─────────────────────────────────
      'akustisk',
      'folkmusik',
      'ambient',
      // ── evening art contexts ──────────────────────────────────────
      'vernissage',
      'kvällsöppet',
      'konstutställning',
    ],
    // Opera and dance carry the mood structurally even when the copy is
    // plain ("La Bohème"). Measured against events_public 2026-09-23:
    // 'art-exhibitions' was tried and REMOVED — misfiled rows (a MAMMA MIA
    // party, a Magnus Betnér standup show) swept in under that slug, and
    // genuine atmospheric exhibitions still match via their copy
    // (vernissage/konstutställning/ljusinstallation/kvällsöppet). Broad
    // categories (music, culture, theatre-comedy, community) are
    // deliberately NOT anchors either.
    categories: ['opera', 'dance'],
  },
};

/** Known mood ids — server-side gate for ?mood= (unknown → ignored). */
export const MOOD_IDS = Object.keys(MOODS);

/**
 * Does this card carry the mood? Pure, deterministic, no I/O.
 * Match = the card's category is a mood anchor, OR any term appears as a
 * substring of the (lowercased) title + description. Unknown moods match
 * nothing — the caller never guesses.
 */
export function matchMood(
  card: Pick<EventCard, 'title' | 'description' | 'category_slug'>,
  mood: string,
): boolean {
  const def = MOODS[mood];
  if (!def) return false;
  if (def.categories.includes(card.category_slug)) return true;
  const haystack = `${card.title ?? ''} ${card.description ?? ''}`.toLowerCase();
  return def.terms.some((term) => haystack.includes(term));
}