/**
 * Tests for moods — Fas D (2026-09-23): the "Stämningsfullt" Utforska tile.
 *
 * The mood lexicon is STATIC DATA, generated once with MiniMax-M3
 * (tools/generate-mood-terms.mjs), curated and committed — no runtime LLM.
 * matchMood is a pure substring/word match over title + description plus a
 * category anchor. These tests pin the match semantics AND the lexicon's
 * false-positive guards (terms deliberately removed during curation must
 * stay removed).
 *
 * Run: npx vitest run 08-Agent/tests/moods.test.ts
 */

import { describe, expect, it } from 'vitest';

import { MOODS, matchMood, MOOD_IDS } from '../tools/moods';
import type { EventCard } from '../types';

function card(over: Partial<EventCard>): EventCard {
  return {
    id: 'mood-card-1',
    title: 'Konsert',
    start_time: '2099-01-01T19:00:00Z',
    venue_name: 'Scen X',
    city: 'Stockholm',
    category_slug: 'music',
    is_free: true,
    ...over,
  };
}

describe('matchMood — term matching (title + description)', () => {
  it('matches an atmospheric title', () => {
    expect(matchMood(card({ title: 'Stämningsfull konsert i Mariakyrkan' }), 'stamningsfullt')).toBe(true);
  });

  it('matches via the description when the title is neutral', () => {
    expect(
      matchMood(card({ title: 'Afton med toner', description: 'En stämningsfull kväll i skymningen.' }), 'stamningsfullt'),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchMood(card({ title: 'STÄMNINGSFULL KONSERT' }), 'stamningsfullt')).toBe(true);
    expect(matchMood(card({ title: 'Candlelight Concert' }), 'stamningsfullt')).toBe(true);
  });

  it('a plain loud event does not match', () => {
    expect(
      matchMood(card({ title: 'Styckets bowlingturnering', description: 'Kom och bowl!', category_slug: 'sports' }), 'stamningsfullt'),
    ).toBe(false);
  });

  it('false-positive guards stay guarded: curation-removed terms must not creep back', () => {
    // 'öm' was removed: it substring-matches "berömd" (famous).
    expect(matchMood(card({ title: 'En berömd rockkonsert', category_slug: 'music' }), 'stamningsfullt')).toBe(false);
    // 'kör' was removed: it substring-matches "körkort" / "provkör".
    expect(matchMood(card({ title: 'Provkör elcykeln i stan', category_slug: 'community' }), 'stamningsfullt')).toBe(false);
    // 'visor' was removed: it substring-matches "barnvisor" (kids' songs).
    expect(matchMood(card({ title: 'Sånglek och barnvisor', category_slug: 'family' }), 'stamningsfullt')).toBe(false);
  });
});

describe('matchMood — category anchor', () => {
  it('an opera event matches even without any term in title/description', () => {
    expect(matchMood(card({ title: 'La Bohème', category_slug: 'opera' }), 'stamningsfullt')).toBe(true);
  });

  it('broad categories are NOT anchors (music/sports/community never sweep in)', () => {
    expect(matchMood(card({ title: 'Höstens stora match' }), 'stamningsfullt')).toBe(false);
    expect(matchMood(card({ title: 'Okänd tillställning', category_slug: 'community' }), 'stamningsfullt')).toBe(false);
  });
});

describe('matchMood — unknown / edge input', () => {
  it('an unknown mood id matches nothing', () => {
    expect(matchMood(card({ title: 'Stämningsfull konsert' }), 'whatever')).toBe(false);
    expect(matchMood(card({ title: 'Stämningsfull konsert' }), '')).toBe(false);
  });

  it('null/undefined title and description never crash', () => {
    expect(matchMood(card({ title: undefined as unknown as string }), 'stamningsfullt')).toBe(false);
  });
});

describe('MOODS — lexicon data sanity', () => {
  it('has the stamningsfullt mood', () => {
    expect(MOOD_IDS).toContain('stamningsfullt');
    expect(Array.isArray(MOODS.stamningsfullt.terms)).toBe(true);
    expect(MOODS.stamningsfullt.terms.length).toBeGreaterThanOrEqual(25);
    expect(Array.isArray(MOODS.stamningsfullt.categories)).toBe(true);
  });

  it('terms are lowercase, non-empty and unique', () => {
    const terms = MOODS.stamningsfullt.terms;
    for (const t of terms) {
      expect(t.length).toBeGreaterThan(0);
      expect(t).toBe(t.toLowerCase());
    }
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('no term may be an overly broad single word that would sweep in everything', () => {
    const forbidden = ['musik', 'music', 'kväll', 'konsert', 'concert', 'event', 'festival', 'teater'];
    const overlap = MOODS.stamningsfullt.terms.filter((t) => forbidden.includes(t));
    expect(overlap).toEqual([]);
  });

  it('categories are real events_public slugs', () => {
    const validSlugs = new Set([
      'community', 'music', 'culture', 'family', 'art-exhibitions', 'sports',
      'theatre-comedy', 'opera', 'food', 'dance', 'art', 'musikaler', 'theater',
      'design', 'festivals',
    ]);
    for (const slug of MOODS.stamningsfullt.categories) {
      expect(validSlugs.has(slug)).toBe(true);
    }
  });
});