/**
 * sourceCategoryDefaults.ts — Source-level category defaults for known sources.
 *
 * Why this exists (2026-09-29):
 * 562 community-events satt fast i `category_slug='community'` trots att
 * källan själv avslöjade kategorin. Berwaldhallen är alltid klassiskt,
 * Debaser är musikscen, lulea-hf-2/downtown-2/globen-3/halmstad-konserthus-2
 * är alla samma biljettshop.se Chicago-musikal-scrape. Dessa slutsatser är
 * verifierade mot riktig DB-data (se vault-rapport
 * `04-Sources/community-events-by-source-2026-09-29.md`).
 *
 * Pipeline-kontraktet i normalizer.ts är:
 *   raw.categories (array) → raw.category (singular) → source-default → 'community'
 * Source-defaulten lägger sig precis FÖRE 'community'-fallbacken. Om en
 * adapter redan har klassificerat eventet korrekt (categories eller
 * category är satta) tar det FÖRTUR — source-defaulten är bara en
 * sista-chansen-lookup för källor som alltid producerar samma typ.
 *
 * Generalization Protection Rule:
 * Source-default-tabellen är SITE-SPECIFIK. Varje ny entry kräver:
 *   1. Verifiering att ≥ 50 % av events från källan har samma kategori
 *      (eller att källans identitet ÄR den kategorin, t.ex. Berwaldhallen
 *      som konserthall).
 *   2. En kommenterad motivering i SOURCE_CATEGORY_DEFAULTS nedan.
 *   3. Ingen entry läggs till baserat på en enda dags data — vänta tills
 *      mönstret återkommer över flera dagar/veckor.
 *
 * Det är INTE tillåtet att lägga till entries baserat på en enda event-rad.
 */

export interface SourceCategoryDefault {
  /** Kategori-slug (måste matcha `categories.slug` i Supabase). */
  slug: string;
  /** Kort motivering — varför denna källa får en default. */
  reason: string;
  /**
   * När defaulten lades till (YYYY-MM-DD). Används som "minst denna
   * dags data" — verifiera att mönstret kvarstår innan tillägg.
   */
  verifiedSince: string;
}

/**
 * Source-id → default category mapping.
 *
 * Verifierat 2026-09-29 mot riktig data:
 *   - berwaldhallen (125 events): uteslutande klassiska konserter →
 *     'classical' (även om description_sv är tom → LLM säger 'community').
 *   - lulea-hf-2/downtown-2/globen-3/halmstad-konserthus-2 (4 × 57 = 228
 *     events): alla Chicago-musikal på Oscarsteatern → 'musical'. Dessa
 *     är 4 source-adapters som skrapar samma biljettshop.se-URL och
 *     skapar duplicerade event-rader. Kors-source dedup (se normalizer.ts)
 *     konsoliderar dem till 57 unika shower.
 *   - sthlmlist (104 events): Stockholm music listings via Rival,
 *     Fasching etc. → 'music'. Genre-specifik kräver Steg 3.5
 *     (artist-tillägg).
 *   - debaser (2 events, men source = dedikerad musikscen): 'music'.
 */
const SOURCE_CATEGORY_DEFAULTS: Readonly<Record<string, SourceCategoryDefault>> = Object.freeze({
  berwaldhallen: {
    slug: 'classical',
    reason: 'Sveriges Radios symfonihall — uteslutande klassisk konsert (orkester, Radiokören, solister). 125 events, alla med denna identitet.',
    verifiedSince: '2026-09-29',
  },
  'lulea-hf-2': {
    slug: 'musical',
    reason: 'Source scrapar biljettshop.se Chicago-musikal på Oscarsteatern — 57/57 events är samma show.',
    verifiedSince: '2026-09-29',
  },
  'downtown-2': {
    slug: 'musical',
    reason: 'Source scrapar biljettshop.se Chicago-musikal på Oscarsteatern — 57/57 events är samma show.',
    verifiedSince: '2026-09-29',
  },
  'globen-3': {
    slug: 'musical',
    reason: 'Source scrapar biljettshop.se Chicago-musikal på Oscarsteatern — 57/57 events är samma show.',
    verifiedSince: '2026-09-29',
  },
  'halmstad-konserthus-2': {
    slug: 'musical',
    reason: 'Source scrapar biljettshop.se Chicago-musikal på Oscarsteatern — 57/57 events är samma show.',
    verifiedSince: '2026-09-29',
  },
  sthlmlist: {
    slug: 'music',
    reason: 'Stockholm music listings (Rival, Fasching m.fl.) — etablerade musikscener. Genre-specifik kräver Steg 3.5 (artist-tillägg).',
    verifiedSince: '2026-09-29',
  },
  debaser: {
    slug: 'music',
    reason: 'Debaser = dedikerad musikscen (Strand + Hornstull).',
    verifiedSince: '2026-09-29',
  },
});

/**
 * Return the default category for a given source, or null if unknown.
 *
 * Pipeline-säker: returnerar null för källor som inte finns i tabellen —
 * anroparen ska då falla tillbaka till befintlig logik (categories →
 * category → 'community').
 *
 * Exported så admins/tester kan lista entries utanför produktion.
 */
export function getDefaultCategoryForSource(
  source: string | null | undefined,
): SourceCategoryDefault | null {
  if (!source) return null;
  return SOURCE_CATEGORY_DEFAULTS[source] ?? null;
}

/**
 * Return only the slug (string) or null. Convenience för pipeline-kod som
 * bara behöver sluggen — slipper destructuring.
 */
export function getDefaultCategorySlugForSource(
  source: string | null | undefined,
): string | null {
  return getDefaultCategoryForSource(source)?.slug ?? null;
}

/** Lista alla entries — för admin/test-verktyg. */
export function listSourceCategoryDefaults(): Array<{ source: string } & SourceCategoryDefault> {
  return Object.entries(SOURCE_CATEGORY_DEFAULTS).map(([source, def]) => ({
    source,
    ...def,
  }));
}