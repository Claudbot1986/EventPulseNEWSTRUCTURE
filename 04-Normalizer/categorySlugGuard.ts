/**
 * categorySlugGuard.ts — väljer den kategori-slug som FAKTISKT får persistas.
 *
 * Varför detta finns (2026-11-07):
 * DB-constrainten `events_category_slug_valid` kräver att `category_slug`
 * finns i `categories`-tabellen (`is_valid_event_category_slug()` →
 * `EXISTS (SELECT 1 FROM categories WHERE slug = p_slug)`). Men normalizern
 * skrev adapterns råa etikett rakt vidare:
 *
 *   visitstockholm.ts:130 → `category: category.toLowerCase() || undefined`
 *
 * Sidan skickar visningsetiketter som "Christmas & New Year's" och
 * "Eat & Drink" → "christmas & new year's" / "eat & drink". Varken finns i
 * `categories` (31 giltiga slugs, bl.a. `community` — men varken `christmas`
 * eller `eat`), så Postgres avvisade raden:
 *
 *   new row for relation "events" violates check constraint
 *   "events_category_slug_valid"
 *
 * Följd: `worker-drain` har fallit med exit 70 i **5 nätter i rad**
 * (2026-11-03 → 11-07), 2 events per natt. Kedjan märkte hela körningen
 * som fel fastän 1 253 events gick att spara.
 *
 * VARFÖR INTE EN NY RAD I CANONICALIZE-TABELLEN:
 * `christmas & new year's` har ingen giltig måttarget — `christmas` finns
 * inte i `categories`. Att mappa dit vore fel. Och att lägga etiketter i en
 * tabell löser inte grundproblemet: nästa källa som skickar en ny etikett
 * faller igen. Rätt fix är att **validera** mot `categories` och falla tillbaka
 * — precis som `categoryCanonicalize.ts` är den enda punkten där alla events
 * garanteras en giltig kategori.
 *
 * Generalization Protection Rule: detta är en GENERELL regel, inte en fix för
 * en enskild källa. Varje källa som skickar en etikett som inte är en slug
 * fångas av samma regel. Ingen adapter, ingen scoring-vikt och ingen
 * IGNORE_PATTERNS ändras.
 *
 * Kedjan i normalizern blir:
 *   adapter-slug (bara om den finns i `categories`)
 *     → MusicBrainz-slug (bara om den finns i `categories`)
 *     → source-default (bara om den finns i `categories`)
 *     → 'community'
 *
 * `community` är reserverad fallback eftersom den är en kärnkategori och
 * alltid finns — utan den skulle raden inte kunna persistas alls.
 */

/** Reservad fallback-slug. Finns alltid i `categories` (kärnkategori). */
export const FALLBACK_CATEGORY_SLUG = 'community';

export type CategorySlugReason =
  /** Adapterns slug — den användes. */
  | 'adapter'
  /** MusicBrainz + Last.fm — adapterns slug var ogiltig. */
  | 'musicbrainz'
  /** Källa med känd default-kategori (t.ex. berwaldhallen → music). */
  | 'source-default'
  /** Sista utväg. */
  | 'fallback';

export interface CategorySlugChoice {
  /** Slugen som ska persistas. */
  slug: string;
  /** Varför just den slugen valdes. */
  reason: CategorySlugReason;
  /**
   * Slugs som underkändes (fanns inte i `categories`). Loggas så att en
   * trasig adapter inte kan försvinna tyst.
   */
  rejected: string[];
}

export interface CategorySlugInput {
  /** Adapterns första kategori (kan vara en rå etikett). */
  adapterSlug: string | null | undefined;
  /** Slugs som FAKTISKT finns i `categories`-tabellen. */
  validSlugs: string[];
  /** MusicBrainz + Last.fm-slug, om det finns. */
  musicbrainzSlug?: string | null;
  /** Källa med känd default-kategori. */
  sourceDefaultSlug?: string | null;
}

function usable(slug: string | null | undefined, valid: Set<string>): string | null {
  if (!slug) return null;
  const trimmed = slug.trim();
  if (!trimmed) return null;
  return valid.has(trimmed) ? trimmed : null;
}

/**
 * Väljer den slug som får persistas.
 *
 * Ren funktion — testas utan DB. DB-anropet (vilka slugs som finns) görs av
 * anroparen, som passerar in `validSlugs`.
 */
export function choosePersistableCategorySlug(input: CategorySlugInput): CategorySlugChoice {
  const valid = new Set(input.validSlugs);
  const rejected: string[] = [];

  const adapter = usable(input.adapterSlug, valid);
  if (adapter) return { slug: adapter, reason: 'adapter', rejected };
  if (input.adapterSlug && input.adapterSlug.trim()) {
    rejected.push(input.adapterSlug.trim());
  }

  const musicbrainz = usable(input.musicbrainzSlug, valid);
  if (musicbrainz) return { slug: musicbrainz, reason: 'musicbrainz', rejected };
  if (input.musicbrainzSlug && input.musicbrainzSlug.trim()) {
    rejected.push(input.musicbrainzSlug.trim());
  }

  const sourceDefault = usable(input.sourceDefaultSlug, valid);
  if (sourceDefault) return { slug: sourceDefault, reason: 'source-default', rejected };
  if (input.sourceDefaultSlug && input.sourceDefaultSlug.trim()) {
    rejected.push(input.sourceDefaultSlug.trim());
  }

  return { slug: FALLBACK_CATEGORY_SLUG, reason: 'fallback', rejected };
}
