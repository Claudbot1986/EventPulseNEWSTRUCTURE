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
 *   - musikaler (15) → musical-theatre: alla samples är China-teatern-musikaler.
 *   - art (13) → exhibition: alla samples är konst-utställningar.
 *   - design (7) → exhibition: Arkdes design-events, konsoliderade enligt
 *     v2-planen.
 *   - food-drink (1) → food: "En innerlig jul" (sthlmlist, julbord-mat).
 *   - barn (1) → family: Nötknäpparen "för hela familjen!" (Malmö Live).
 *   - festivals (1) → community: "Öl & Sprit Festivalen" — generiskt.
 *
 * Round 2 (verifierade 2026-10-18 — 388 events i ovrigt-investigation):
 *   - 388 events hade OGILTIGA slugs totalt (ovrigt 183, barn-familj 91,
 *     humor 30, dans 25, musikal 24, standup 15, festival 9, sport 7,
 *     livepodd 2, theater 2). Mappning sattes i
 *     runtime/ovrigt-investigation/propose_mapping.ts. DB applicerad (0
 *     events med ogiltig slug kvar). Dessa entries är FRAMTIDA skydd —
 *     om någon adapter/normalizer fortsätter emittera legacy-slugs
 *     fångas de automatiskt vid insert.
 *
 * Round 3 (verifierade 2026-10-29 — 1026 events i DB):
 *   17 slugs som INTE fanns i categories-tabellen skrevs rakt in i DB
 *   eftersom migrationen 20261018-0001 (CHECK-constraint på
 *   events.category_slug) aldrig applicerades i live-DB. Slugs kommer från
 *   källornas egna taxonomier (Zita → 'cinema', Nalen → 'concert',
 *   Livrustkammaren → 'Lov'/'Temavisning', Waldemarsudde → 'Utställning').
 *   Plus 831 events med NULL (före normalizerns fallback infördes).
 *   DB-migration: 05-Supabase/migrations/
 *   20261029-0001-normalize-legacy-category-slugs.sql (data + den
 *   saknade constrainten).
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
  // Round 1 (verifierade 2026-09-29)
  'culture':        'community',
  'art-exhibitions': 'exhibition',
  'theater':         'theatre-drama',
  'musikaler':       'musical-theatre',
  'art':             'exhibition',
  'design':          'exhibition',
  'food-drink':      'food',
  'barn':            'family',
  'festivals':       'community',
  // Round 2 (verifierade 2026-10-18 — 388 events i ovrigt-investigation)
  // Alla täckta av mappning i runtime/ovrigt-investigation/propose_mapping.ts.
  // Dessa entries fångar adaptrar/normalisern som fortfarande emitterar
  // legacy-slugs efter städningen.
  'ovrigt':         'community',     // livespot-stockholm fallback ("vet inte"-fack)
  'barn-familj':    'kids',          // barn-specifik
  'humor':          'theatre-comedy',// alla samples är standup/humor
  'dans':           'dance',
  'musikal':        'musical-theatre',
  'standup':        'comedy',
  'livepodd':       'talks-lectures',
  'festival':       'community',     // generisk festival
  'sport':          'sports',        // singularis → pluralis (nuvarande riktiga slug)
  // Round 3 (verifierade 2026-10-29 — 1026 events i DB + live-katalog)
  //
  // Bakgrund: 20261018-0001-events-category-slug-validation.sql (CHECK-constraint
  // på events.category_slug) hade ALDRIG applicerats i live-DB — varken
  // funktionen is_valid_event_category_slug eller constrainten fanns. Därför
  // kunde källornas egna kategoritaxonomier skrivas rakt in i DB:
  //   cinema (72, Zita-filmvisningar), concert (63, Nalen), Utställning (17,
  //   Waldemarsudde), exhibitions (10), musical (10, China Teatern),
  //   hip-hop (5), Konsert (3), sports & wellbeing (3), stage & film (3),
  //   guided tours & lectures (2), Musik på Historiska (2), Temavisning (1),
  //   Barn och familj (1), Föreläsning (1), Lov (1), networking & community (1)
  //   samt 831 events med NULL (före normalizerns fallback infördes).
  //
  // Slugs nedan kommer FRÅN KÄLLORNA (Zita → 'cinema', Nalen → 'concert',
  // Livrustkammaren → 'Lov'/'Temavisning', Waldemarsudde → 'Utställning'),
  // inte från EventPulses egen taxonomi. De är därför inte "deprecated" i
  // vanlig mening — de är källtaxonomier som behöver översättas.
  //
  // Motsvarande DB-migration: 05-Supabase/migrations/
  // 20261029-0001-normalize-legacy-category-slugs.sql
  'cinema':                  'film',            // 72/72 samples = Zita-filmvisningar
  'concert':                 'music',           // 63/63 samples = Nalen-konserter
  'Konsert':                 'music',           // språkvariant av 'concert'
  'Utställning':             'exhibition',      // språkvariant av 'exhibition'
  'exhibitions':             'exhibition',      // pluralform
  'Temavisning':             'exhibition',      // 1/1 sample = guidad visning på museum
  'musical':                 'musical-theatre', // 10/10 samples = China Teatern-musikaler
  'sports & wellbeing':      'sports',          // 3/3 samples = sport/upplevelser
  'stage & film':            'theatre-drama',   // samma resonemang som 'theater' → 'theatre-drama'
  'guided tours & lectures': 'talks-lectures',  // 2/2 samples = bokklubb/city walk
  'Föreläsning':             'talks-lectures',  // språkvariant av föreläsning
  'Musik på Historiska':     'classical',       // 2/2 samples = kammarmusik på Historiska
  'Barn och familj':         'kids',            // svensk variant av 'barn-familj' → kids
  'Lov':                     'family',          // 1/1 sample = lovaktivitet för familjen
  'networking & community':  'community',       // 1/1 sample = community-format
  'hip-hop':                 'community',       // 5/5 samples är FELMÄRKT (tech-konferens,
                                                // bokprat, webinar, rockkonsert, party) —
                                                // ingen verifierbar koppling till hip-hop,
                                                // så source-default-fallbacken 'community'
                                                // används (Generalization-regel 2 + 3).
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