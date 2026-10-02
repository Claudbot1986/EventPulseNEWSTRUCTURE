/**
 * categoryKeywords.test.ts — Tests for the shared keyword detection module.
 *
 * Verifies:
 1. detectCategory returns the most specific matching category for each test case
 2. Music bucket is broad ('music') and intentionally does NOT pre-classify
    into rock/pop/jazz/electronic/hip-hop (those live in tagToCategory.ts)
 3. Default fallback is 'community' (genuine semantic), not 'culture'
 4. detectCategoryFromUrl matches the new slugs
 5. detectCategoryFromContainerClass matches the new slugs
 6. Substring collisions are handled by rule ordering
    (e.g. 'musik' in 'musikal' → musical-theatre, not music)
 */

import { describe, it, expect } from 'vitest';
import {
  detectCategory,
  detectCategoryFromUrl,
  detectCategoryFromContainerClass,
  NON_MUSIC_CATEGORY_SLUGS,
} from './categoryKeywords';

describe('categoryKeywords — detectCategory', () => {
  it('classifies musical events correctly (most specific first)', () => {
    expect(detectCategory('Cats - musikalen')).toBe('musical-theatre');
    expect(detectCategory('Hamilton Broadway show')).toBe('musical-theatre');
    expect(detectCategory('Operett gala')).toBe('musical-theatre');
  });
  // Note: 'Chicago' (the musical) is intentionally NOT a global keyword — too
  // risky (city name vs Broadway show). Eventbrite Stockholm adapter handles
  // venue context if needed. Per Generalization Protection Rule.

  it('classifies opera events correctly', () => {
    expect(detectCategory('Don Giovanni', 'opera av Mozart')).toBe('opera');
    expect(detectCategory('Operans vårpremiär')).toBe('opera');
  });

  it('classifies theatre events correctly', () => {
    expect(detectCategory('Standup med Björn Gustafsson')).toBe('theatre-comedy');
    expect(detectCategory('Improvisationskväll')).toBe('theatre-comedy');
    expect(detectCategory('Dramatiska pjäser - Hamlet')).toBe('theatre-drama');
    expect(detectCategory('Talteater: En monolog')).toBe('theatre-drama');
  });

  it('classifies exhibition events correctly', () => {
    expect(detectCategory('Modern konstutställning')).toBe('exhibition');
    expect(detectCategory('Vernissage på galleri')).toBe('exhibition');
    expect(detectCategory('Fotoutställning, museum')).toBe('exhibition');
  });

  it('classifies niche categories correctly', () => {
    expect(detectCategory('Loppmarknad i Tanto')).toBe('flea-market');
    expect(detectCategory('Vinprovning för nybörjare')).toBe('wine-tasting');
    expect(detectCategory('Cirkus Scott')).toBe('circus');
    expect(detectCategory('Nycirkus med akrobatik')).toBe('circus');
    expect(detectCategory('Matfestival i Stadsträdgården')).toBe('food');
    expect(detectCategory('Filmvisning på biograf')).toBe('film');
    expect(detectCategory('Föreläsning om AI')).toBe('talks-lectures');
    expect(detectCategory('Bokrelease med författarsamtal')).toBe('talks-lectures');
    expect(detectCategory('Workshop i keramik')).toBe('workshop');
    expect(detectCategory('Prova-på yoga')).toBe('workshop');
  });

  it('classifies kids/family correctly (kids must be more specific than family)', () => {
    expect(detectCategory('Barnteater: Nötknäpparen')).toBe('kids');
    expect(detectCategory('Sagostund för barn')).toBe('kids');
    expect(detectCategory('Familjekonsert: Hela familjen välkommen')).toBe('family');
    expect(detectCategory('Familjeföreställning')).toBe('family');
  });

  it('classifies sports correctly', () => {
    expect(detectCategory('Fotboll: AIK mot Hammarby')).toBe('sports');
    expect(detectCategory('Hockeymatch i Globen')).toBe('sports');
    expect(detectCategory('Löpartävling i Hagaparken')).toBe('sports');
  });

  it('classifies dance correctly (more specific than before)', () => {
    expect(detectCategory('Balett: Svansjön')).toBe('dance');
    expect(detectCategory('Streetdance show')).toBe('dance');
    expect(detectCategory('Dansföreställning på Dansens Hus')).toBe('dance');
  });

  it('falls back to broad music for music without specific genre (then MB refines)', () => {
    // Music taxonomy v3 + tagToCategory refines these downstream.
    // detectCategory returns the broad 'music' slug only.
    expect(detectCategory('Jazz på Fasching')).toBe('music');
    expect(detectCategory('Rockkonsert med In Flames')).toBe('music');
    expect(detectCategory('Konsert ikväll')).toBe('music');
    expect(detectCategory('Musikupplevelse')).toBe('music');
    // 'Hip-hop' is a specific sub-genre — owned by tagToCategory.ts.
    // detectCategory returns 'community' and lets MB+Last.fm reclassify.
    expect(detectCategory('Hip-hop show')).toBe('community');
  });

  it('handles substring collisions correctly (musik → musical, opera → operan)', () => {
    // 'musik' is a substring of 'musikal' but musical-theatre comes first.
    expect(detectCategory('Musikal: Cats')).toBe('musical-theatre');
    expect(detectCategory('En musikal om musik')).toBe('musical-theatre');
    // 'opera' substring of 'operan'
    expect(detectCategory('Operan öppnar')).toBe('opera');
  });

  it('returns "community" as fallback for unclassifiable titles (genuine semantic)', () => {
    expect(detectCategory('Generell träff')).toBe('community');
    expect(detectCategory('Öppet hus på biblioteket')).toBe('community');
    expect(detectCategory('Okategoriserad sak')).toBe('community');
  });

  it('uses description when title is ambiguous', () => {
    expect(detectCategory('Kväll på stan', 'workshop i kodning')).toBe('workshop');
    expect(detectCategory('Stockholm', 'litteratur — författarsamtal')).toBe('talks-lectures');
    expect(detectCategory('Evenemang', 'loppmarknad')).toBe('flea-market');
  });

  it('does NOT pre-classify into music sub-genres (rock/pop/jazz/electronic/hip-hop)', () => {
    // tagToCategory.ts owns these. detectCategory returns 'music' (broad) when
    // a broad music term like 'konsert' is in the title, so the downstream
    // tagToCategory.ts + MusicBrainz + Last.fm pipeline can refine to the
    // specific sub-genre (rock/pop/jazz/electronic/hip-hop/etc.).
    // When ONLY a sub-genre name is in the title (no broad music term), we
    // return 'community' (genuine fallback) since there's no 'music' for the
    // downstream pipeline to refine.
    expect(detectCategory('Heavy metal konsert')).toBe('music'); // 'konsert' broad → tagToCategory → 'rock'
    expect(detectCategory('Synth-pop afton')).toBe('community');   // no broad term; tagToCategory can't refine
    expect(detectCategory('Hip-hop show')).toBe('community');       // no broad term; tagToCategory can't refine
    expect(detectCategory('House music night')).toBe('music');      // 'music' (English) is a keyword
  });
});

describe('categoryKeywords — detectCategoryFromUrl', () => {
  it('matches URL-based categories', () => {
    expect(detectCategoryFromUrl('/opera/season-2026')).toBe('opera');
    expect(detectCategoryFromUrl('/musikal/cats')).toBe('musical-theatre');
    expect(detectCategoryFromUrl('/teater/forestallning/abc')).toBe('theatre-drama');
    expect(detectCategoryFromUrl('/utstallning/modern-konst')).toBe('exhibition');
    expect(detectCategoryFromUrl('/loppis/tanto')).toBe('flea-market');
    expect(detectCategoryFromUrl('/konsert/jazzkvall')).toBe('music');
    expect(detectCategoryFromUrl('/forelasning/ai')).toBe('talks-lectures');
    expect(detectCategoryFromUrl('/workshop/keramik')).toBe('workshop');
  });

  it('falls back to community for non-category URLs', () => {
    expect(detectCategoryFromUrl('/event/abc123')).toBe('community');
    expect(detectCategoryFromUrl('/random-page')).toBe('community');
    expect(detectCategoryFromUrl('')).toBe('community');
  });
});

describe('categoryKeywords — detectCategoryFromContainerClass', () => {
  it('matches common container-class patterns', () => {
    expect(detectCategoryFromContainerClass('match-item event-row')).toBe('sports');
    expect(detectCategoryFromContainerClass('konsert-card musik-event')).toBe('music');
    expect(detectCategoryFromContainerClass('teater-item')).toBe('theatre-drama');
    expect(detectCategoryFromContainerClass('utstallning-event')).toBe('exhibition');
    expect(detectCategoryFromContainerClass('barn-events')).toBe('kids');
    expect(detectCategoryFromContainerClass('familj-event-card')).toBe('family');
  });

  it('falls back to community for ambiguous classes', () => {
    expect(detectCategoryFromContainerClass('random-class')).toBe('community');
    expect(detectCategoryFromContainerClass('')).toBe('community');
  });
});

describe('categoryKeywords — NON_MUSIC_CATEGORY_SLUGS export', () => {
  it('exposes all expected non-music sub-genre slugs', () => {
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('opera');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('musical-theatre');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('theatre-comedy');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('theatre-drama');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('exhibition');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('flea-market');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('wine-tasting');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('family');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('kids');
    expect(NON_MUSIC_CATEGORY_SLUGS).toContain('community');
  });

  it('does NOT expose music sub-genres (those are in tagToCategory.ts)', () => {
    expect(NON_MUSIC_CATEGORY_SLUGS).not.toContain('rock');
    expect(NON_MUSIC_CATEGORY_SLUGS).not.toContain('pop');
    expect(NON_MUSIC_CATEGORY_SLUGS).not.toContain('jazz');
    expect(NON_MUSIC_CATEGORY_SLUGS).not.toContain('electronic');
    expect(NON_MUSIC_CATEGORY_SLUGS).not.toContain('hip-hop');
  });
});