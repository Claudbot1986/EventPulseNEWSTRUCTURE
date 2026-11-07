/**
 * Regressionstester för categorySlugGuard — väljer den kategori-slug som
 * faktiskt får persistas.
 *
 * Bakgrund (2026-11-07): `worker-drain` föll med exit 70 i 5 nätter i rad
 * (2026-11-03 → 11-07). Orsak: adaptern för Visit Stockholm skickar
 * visningsetiketter ("Christmas & New Year's", "Eat & Drink") rakt vidare som
 * kategori, och DB-constrainten `events_category_slug_valid` avvisar dem:
 *
 *   new row for relation "events" violates check constraint
 *   "events_category_slug_valid"
 *
 * Varken `christmas` eller `eat` finns i `categories` (31 giltiga slugs), så
 * det finns ingen giltig måttarget att mappa till — endast "validera och
 * falla tillbaka" fungerar.
 */

import { describe, expect, it } from 'vitest';
import {
  choosePersistableCategorySlug,
  FALLBACK_CATEGORY_SLUG,
} from './categorySlugGuard';

// De 31 giltiga slugs som finns i live-DB (utdrag — de som används här).
const VALID = [
  'community',
  'music',
  'rock',
  'food',
  'wine-tasting',
  'exhibition',
  'family',
  'theatre-drama',
];

describe('choosePersistableCategorySlug', () => {
  it('använder adapterns slug när den finns i categories', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: 'music',
      validSlugs: VALID,
    });
    expect(choice.slug).toBe('music');
    expect(choice.reason).toBe('adapter');
    expect(choice.rejected).toEqual([]);
  });

  it('faller tillbaka till community för en visningsetikett som inte är en slug', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: "christmas & new year's",
      validSlugs: VALID,
    });
    expect(choice.slug).toBe(FALLBACK_CATEGORY_SLUG);
    expect(choice.reason).toBe('fallback');
    expect(choice.rejected).toEqual(["christmas & new year's"]);
  });

  it('faller tillbaka till community för "eat & drink"', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: 'eat & drink',
      validSlugs: VALID,
    });
    expect(choice.slug).toBe(FALLBACK_CATEGORY_SLUG);
    expect(choice.reason).toBe('fallback');
    expect(choice.rejected).toEqual(['eat & drink']);
  });

  it('använder source-default när adapter-sluggen är ogiltig', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: "christmas & new year's",
      validSlugs: VALID,
      sourceDefaultSlug: 'food',
    });
    expect(choice.slug).toBe('food');
    expect(choice.reason).toBe('source-default');
    expect(choice.rejected).toEqual(["christmas & new year's"]);
  });

  it('använder MusicBrainz-slug innan source-default', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: 'ogiltig',
      validSlugs: VALID,
      musicbrainzSlug: 'rock',
      sourceDefaultSlug: 'food',
    });
    expect(choice.slug).toBe('rock');
    expect(choice.reason).toBe('musicbrainz');
  });

  it('underkänner även en ogiltig source-default', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: null,
      validSlugs: VALID,
      sourceDefaultSlug: 'finns-inte',
    });
    expect(choice.slug).toBe(FALLBACK_CATEGORY_SLUG);
    expect(choice.reason).toBe('fallback');
    expect(choice.rejected).toEqual(['finns-inte']);
  });

  it('tom adapter-slug är inte ett fel — bara ingen kandidat', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: '   ',
      validSlugs: VALID,
    });
    expect(choice.slug).toBe(FALLBACK_CATEGORY_SLUG);
    expect(choice.rejected).toEqual([]);
  });

  it('ingen adapter, ingen MB, ingen default → community', () => {
    const choice = choosePersistableCategorySlug({
      adapterSlug: null,
      validSlugs: VALID,
    });
    expect(choice.slug).toBe(FALLBACK_CATEGORY_SLUG);
    expect(choice.reason).toBe('fallback');
  });

  it('respekterar att endast slugs i validSlugs får användas', () => {
    // 'christmas' eller 'eat' finns INTE i categories — en måttarget som
    // sådan skulle fortfarande avvisas av constrainten.
    const choice = choosePersistableCategorySlug({
      adapterSlug: 'christmas',
      validSlugs: VALID,
    });
    expect(choice.slug).toBe(FALLBACK_CATEGORY_SLUG);
    expect(choice.rejected).toEqual(['christmas']);
  });
});
