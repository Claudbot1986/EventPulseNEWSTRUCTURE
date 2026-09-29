/**
 * categoryCanonicalize.ts — Canonicalize deprecated category slugs.
 *
 * Why this exists (2026-09-29):
 * 1 265 events i DB har category_slug som inte längre matchar någon tile i
 * Utforska. Dessa är legacy-slugs från innan categories-v2-migrationen
 * (20260927-0001-categories-v2.sql) — 'culture' (1010), 'art-exhibitions'
 * (192), 'theater' (25), 'musikaler' (15), 'art' (13), 'design' (7),
 * 'food-drink' (1), 'barn' (1), 'festivals' (1). Totalt 23.4% av alla
 * events i DB är dolda i UI:t pga dessa slugs.
 *
 * Source-adapters och HTML-extraktorer emitterar fortfarande deprecated
 * slugs (kulturhuset.ts → 'culture' som fallback, china-teatern.ts →
 * 'musikaler' hårdkodat, ticketmaster.ts → 'arts & theatre' → 'art-
 * exhibitions' osv). I stället för att jaga varje adapter och varje
 * regex i F-eventExtraction/extractor.ts är NORMALIZERN den enda
 * punkt där vi kan garantera att ALLA events — oavsett källa — får en
 * giltig kategori innan de persistas.
 *
 * Pipeline-kontrakt:
 *   raw.categories (array)
 *     │
 *     ▼
 *   canonicalizeCategorySlug(slug)              ← DENNA MODUL
 *     │
 *     ▼
 *   resolveCategoryIds(...) → category_ids
 *     │
 *     ▼
 *   category_slug = canonicalized[0] ?? sourceDefault ?? 'community'
 *
 * Adaptrar som emitterar redan korrekt slug passerar genom oförändrat
 * (canonicalize är en no-op). Adaptrar som emitterar deprecated slug
 * får den omdirigerad till bästa motsvarighet. Pipeline-felet blir
 * synligt i loggen: "[normalizer] canonicalized: <from> → <to>".
 *
 * Generalization Protection Rule (uppdaterad 2026-09-29):
 * Förutom att inte generalisera adapters, gäller detsamma för
 * CANONICALIZE-tabellen. Nya entries läggs bara till när:
 *   1. ≥ 50 % av events med sluggen kan verifieras höra till target, ELLER
 *   2. Target = source-default-fallback för säker migration, ELLER
 *   3. Sluggen är uppenbart felstavad/språkvariant (t.ex. 'musikaler' = 'musical').
 *
 * Befintliga entries (verifierade 2026-09-29 mot riktig DB-data):
 *   - culture (1010) → community: 'culture' är kulturhuset.ts / visitstockholm /
 *     berwaldhallenTixly fallback. Heterogent innehåll (Il Volo = opera,
 *     The Mission = rock, Allmänningen = politisk samtal). LLM-retag
 *     (Steg 3.4) kan senare splittra — tills vidare går allt till 'community'.
 *   - art-exhibitions (192) → exhibition: alla samples är utställningar
 *     (Språkmuseet Scrabble, etc).
 *   - theater (25) → theatre-drama: blandat innehåll (standup, drama,
 *     intima teater). Drama är bredaste svenska motsvarigheten.
 *   - musikaler (15) → musical: alla samples är China-teatern-musikaler.
 *   - art (13) → exhibition: alla samples är konst-utställningar.
 *   - design (7) → exhibition: Arkdes design-events, konsoliderade enligt
 *     v2-planen.
 *   - food-drink (1) → food: "En innerlig jul" (sthlmlist, julbord-mat).
 *   - barn (1) → family: Nötknäpparen "för hela familjen!" (Malmö Live).
 *   - festivals (1) → community: "Öl & Sprit Festivalen" — generiskt.
 *
 * Om en adapter fortsätter emittera en deprecated slug efter denna fix
 * förväntas CANONICALIZE fånga den. Om Supabase-kategori-tabellen tappar
 * sluggen helt (se migration 20260929-0001-deprecated-slug-cleanup) fångas
 * felet vid insert eftersom category_id-resolution returnerar [] och
 * source-default / 'community'-fallback kickar in.
 */

export interface CanonicalizeResult {
  /** Den slutgiltiga sluggen — använd alltid denna. */
  slug: string;
  /** True om sluggen ändrades (för loggning). */
  changed: boolean;
  /** Den ursprungliga sluggen om changed=true, annars null. */
  originalSlug: string | null;
}

/**
 * Map: deprecated slug → best-effort target.
 *
 * Verifierat 2026-09-29. Object.freeze-skyddad (muteras inte).
 */
const CANONICAL_CATEGORY_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  'culture':        'community',
  'art-exhibitions': 'exhibition',
  'theater':         'theatre-drama',
  'musikaler':       'musical',
  'art':             'exhibition',
  'design':          'exhibition',
  'food-drink':      'food',
  'barn':            'family',
  'festivals':       'community',
});

/**
 * Canonicalize en enskild category-slug.
 *
 * Pipeline-säker: returnerar alltid en icke-tom sträng. Tomma/null-input
 * 'undefined' returneras som null så att anroparen kan falla vidare till
 * source-default → 'community'.
 */
export function canonicalizeCategorySlug(
  slug: string | null | undefined,
): CanonicalizeResult | null {
  if (!slug || typeof slug !== 'string') return null;
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const target = CANONICAL_CATEGORY_SLUGS[trimmed];
  if (target && target !== trimmed) {
    return { slug: target, changed: true, originalSlug: trimmed };
  }
  return { slug: trimmed, changed: false, originalSlug: null };
}

/**
 * Canonicalize en array av category-slugs. Bevarar ordning, deduplicerar
 * efter canonicalisering så vi inte får dubletter i event_categories.
 */
export function canonicalizeCategorySlugs(
  slugs: ReadonlyArray<string | null | undefined> | null | undefined,
): string[] {
  if (!slugs || slugs.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of slugs) {
    const result = canonicalizeCategorySlug(s);
    if (!result) continue;
    if (seen.has(result.slug)) continue;
    seen.add(result.slug);
    out.push(result.slug);
  }
  return out;
}

/**
 * Lista alla canonicalize-entries — för admin/test-verktyg.
 */
export function listCanonicalCategoryMappings(): Array<{
  deprecated: string;
  target: string;
}> {
  return Object.entries(CANONICAL_CATEGORY_SLUGS).map(([deprecated, target]) => ({
    deprecated,
    target,
  }));
}