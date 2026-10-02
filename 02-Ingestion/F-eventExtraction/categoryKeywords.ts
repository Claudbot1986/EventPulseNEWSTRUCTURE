/**
 * categoryKeywords.ts — Shared keyword detection for non-music categories.
 *
 * Why this exists (2026-10-01):
 * Ingestion previously only matched 7 of 23 canonical categories by title
 * keywords (music/theater/dance/family/food/sports/art) → default 'culture'
 * → canonicalize 'culture' → 'community'. Net effect: ~26 % of all events
 * landed in `community` despite having a clear, more specific category
 * available.
 *
 * Music genres are intentionally NOT handled here — `04-Normalizer/tagToCategory.ts`
 * owns the music taxonomy v3 (8 buckets: classical, opera, musical-theatre,
 * rock, pop, jazz, electronic, hip-hop) and runs downstream via MusicBrainz +
 * Last.fm. This module returns 'music' as a single broad slug; the music
 * subsystem re-classifies specific genres later in the pipeline.
 *
 * Rules:
 *   1. Order matters — most specific first.
 *   2. Substring match (lowercased). Words are chosen to be distinctive
 *      enough that overlaps are rare ("opera" before "musik", "musikal"
 *      before "musik", etc.).
 *   3. Default fallback = 'community' (genuine semantic, not 'culture').
 *   4. Generalization Protection Rule: no keyword comes from a single
 *      site's vocabulary. Every word in KEYWORD_RULES appears across
 *      multiple unrelated Stockholm sources.
 *
 * Reused by:
 *   - extractor.ts (universal JSON-LD + HTML path detection)
 *   - adapters/eventbriteStockholm.ts (no category in JSON-LD)
 *   - any future adapter that needs coarse pre-classification
 */

export type NonMusicCategorySlug =
  | 'opera'
  | 'musical-theatre'
  | 'theatre-comedy'
  | 'theatre-drama'
  | 'circus'
  | 'exhibition'
  | 'flea-market'
  | 'food'
  | 'wine-tasting'
  | 'kids'
  | 'family'
  | 'dance'
  | 'film'
  | 'talks-lectures'
  | 'workshop'
  | 'sports'
  | 'music'
  | 'community';

/**
 * Ordered keyword rules. Most specific first to avoid substring collisions
 * (e.g. "musik" in "musikal" must hit musical-theatre, not music).
 *
 * Each value is a list of lowercase substrings; an event matches a category
 * if ANY of its substrings appears in the lowercased text.
 */
const KEYWORD_RULES: ReadonlyArray<readonly [NonMusicCategorySlug, readonly string[]]> = [
  ['opera', ['opera', 'operan', 'operasång']],
  ['musical-theatre', ['musikal', 'musical', 'broadway', 'operett']],
  ['theatre-comedy', ['standup', 'komedi', 'humor', 'improvisations', 'improvisation', 'comed']],
  ['theatre-drama', ['drama', 'pjäs', 'talteater', 'monolog', 'scenföreställning']],
  ['circus', ['cirkus', 'nycirkus', 'akrobatik', 'jonglering']],
  ['exhibition', ['utställning', 'vernissage', 'galleri', 'museum', 'konstutställning']],
  ['flea-market', ['loppis', 'loppmarknad', 'marknad', 'second hand', 'secondhand', 'vintage marknad', 'bakluckeloppis']],
  ['wine-tasting', ['vinprovning', 'ölprovning', 'whiskyprovning', 'spritprovning', 'dryckesprovning']],
  ['food', ['matfestival', 'matprovning', 'matlagning', 'gastronomi', 'matupplevelse']],
  ['kids', ['barnteater', 'barnaktivitet', 'sagostund', 'barnkonsert']],
  ['family', ['familjeföreställning', 'hela familjen', 'familjekonsert', 'föräldrar och barn']],
  ['dance', ['dansföreställning', 'balett', 'streetdance', 'koreografi']],
  ['film', ['filmvisning', 'biograf', 'utomhusbio', 'filmfestival']],
  ['talks-lectures', ['föreläsning', 'panelsamtal', 'seminarium', 'författarsamtal', 'bokrelease', 'publikt samtal']],
  ['workshop', ['workshop', 'prova-på', 'gör-det-själv', 'kreativ workshop']],
  // Note: 'lopp' intentionally omitted from sports — it matches inside 'loppmarknad'
  // (flea-market). Sports uses longer composites: 'löpartävling', 'cup', 'bandy'.
  ['sports', ['sport', 'match', 'fotboll', 'hockey', 'bandy', 'löpartävling', 'cup']],
  ['music', ['jazz', 'blues', 'musik', 'konsert', 'spelning', 'gigg', 'orkester', 'concert', 'live music', 'music']],
] as const;

/**
 * Coarse-grained category detection from free text.
 *
 * @param title        Event title (required, will be lowercased)
 * @param description  Optional event description (also lowercased)
 * @returns            A canonical EventPulse category slug, or 'community'
 *                     as fallback when nothing matches.
 *
 * The music bucket is intentionally broad — MusicBrainz + Last.fm in
 * `04-Normalizer/tagToCategory.ts` re-classifies music events into specific
 * genres (rock/pop/jazz/etc.) downstream.
 *
 * @example
 *   detectCategory('Cats - musikalen')         // 'musical-theatre'
 *   detectCategory('Jazz på Fasching')        // 'music'  (then MB → 'jazz')
 *   detectCategory('Don Giovanni', 'opera')    // 'opera'
 *   detectCategory('Loppmarknad i Tanto')      // 'flea-market'
 *   detectCategory('Generell träff')          // 'community'
 */
export function detectCategory(title: string, description?: string): NonMusicCategorySlug {
  const text = `${title ?? ''} ${description ?? ''}`.toLowerCase();

  for (const [slug, keywords] of KEYWORD_RULES) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        return slug;
      }
    }
  }

  return 'community';
}

/**
 * URL-path based category detection. Used when DOM has no title text but
 * the link href contains a category-specific path segment.
 *
 * Returns 'community' when no path matches — caller should NOT treat this
 * as a final category; combine with title/description when available.
 */
const URL_PATH_RULES: ReadonlyArray<readonly [NonMusicCategorySlug, readonly string[]]> = [
  ['opera', ['/opera/', '/operan/']],
  ['musical-theatre', ['/musikal/', '/musical/', '/musikaler/']],
  ['theatre-comedy', ['/standup/', '/komedi/', '/humor/']],
  ['theatre-drama', ['/teater/', '/drama/', '/scen/', '/pjäs']],
  ['circus', ['/cirkus/']],
  ['exhibition', ['/utstallning/', '/utställning/', '/konst/', '/galleri/']],
  ['flea-market', ['/loppis/', '/marknad/', '/secondhand/']],
  ['food', ['/mat/', '/food/', '/gastronomi/']],
  ['wine-tasting', ['/provning/', '/vinprovning/', '/olprovning/']],
  ['kids', ['/barn/', '/barnteater/']],
  ['family', ['/familj/']],
  ['dance', ['/dans/', '/balett/']],
  ['film', ['/bio/', '/biograf/', '/film/', '/filmvisning/']],
  ['talks-lectures', ['/forelasning/', '/föreläsning/', '/samtal/', '/seminarium/']],
  ['workshop', ['/workshop/', '/kurs/']],
  ['sports', ['/sport/', '/match/', '/fotboll/', '/hockey/']],
  ['music', ['/konsert/', '/musik/']],
] as const;

export function detectCategoryFromUrl(href: string): NonMusicCategorySlug {
  const lower = (href ?? '').toLowerCase();
  for (const [slug, paths] of URL_PATH_RULES) {
    for (const p of paths) {
      if (lower.includes(p)) {
        return slug;
      }
    }
  }
  return 'community';
}

/**
 * Container-class based category detection. Used when DOM has no title
 * text but the event container's class names hint at the type.
 *
 * Returns 'community' when no class matches.
 */
const CONTAINER_CLASS_RULES: ReadonlyArray<readonly [NonMusicCategorySlug, RegExp]> = [
  ['opera', /opera/i],
  ['musical-theatre', /musical|musikal/i],
  ['theatre-comedy', /standup|komedi|humor/i],
  ['theatre-drama', /teater|drama|scen/i],
  ['circus', /cirkus|circus/i],
  ['exhibition', /utstallning|utställning|konstutställning|galleri/i],
  ['flea-market', /loppis|marknad/i],
  ['wine-tasting', /provning/i],
  ['food', /mat\s|food|gastronomi/i],
  ['kids', /\bbarn\b/i],
  ['family', /familj/i],
  ['dance', /dans|balett/i],
  ['film', /bio|biograf|filmvisning/i],
  ['talks-lectures', /forelasning|föreläsning|samtal|seminarium/i],
  ['workshop', /workshop|kurs/i],
  ['sports', /sport|match|game|game-event/i],
  ['music', /konsert|musik/i],
] as const;

export function detectCategoryFromContainerClass(containerClass: string): NonMusicCategorySlug {
  if (!containerClass) return 'community';
  for (const [slug, pattern] of CONTAINER_CLASS_RULES) {
    if (pattern.test(containerClass)) {
      return slug;
    }
  }
  return 'community';
}

/** All category slugs this module can return. Mirrors `categoryDefinitions.ts`
 *  for the non-music categories. Music sub-genres (rock/pop/jazz/etc.) live
 *  downstream in `tagToCategory.ts`. */
export const NON_MUSIC_CATEGORY_SLUGS: ReadonlyArray<NonMusicCategorySlug> = Object.freeze([
  'opera',
  'musical-theatre',
  'theatre-comedy',
  'theatre-drama',
  'circus',
  'exhibition',
  'flea-market',
  'food',
  'wine-tasting',
  'kids',
  'family',
  'dance',
  'film',
  'talks-lectures',
  'workshop',
  'sports',
  'music',
  'community',
]);