/**
 * categoryDefinitions.ts — Kanonska definitioner för EventPulse's 23 v3-kategorier.
 *
 * Syfte
 * -----
 * Detta är *den enda* källan till sanning för hur varje kategori ska beskrivas
 * när en LLM (MiniMax-M2.7 idag, Jev för audit/högre nivå) ska klassificera
 * events. Innan denna modul fanns levde definitionerna i prompts i olika
 * retag-script — samma slug kunde ha olika formulering i olika batcher, och
 * canonicalize-migrationen (20260927-0001) flyttade 1265 events utan att vi
 * visste hur de egentligen skulle beskrivas för framtida retag.
 *
 * Vad den innehåller
 * ------------------
 * • slug  — den kanonska slug som persistas i `events.category_slug`
 * • short — en mening för UI-etiketter och kompakta listor
 * • full  — fullständig definition inklusive "Inkluderar" och "Exkludera",
 *           formulerad för att ge LLM tydliga kantfall
 *
 * Pipeline-kontrakt
 * -----------------
 *   raw.categories (array, ev. deprecated)
 *     │
 *     ▼
 *   canonicalizeCategorySlug()             ← categoryCanonicalize.ts
 *     │
 *     ▼
 *   resolveCategoryIds()                   ← category-mapping/
 *     │
 *     ▼
 *   category_slug = canonicalized ?? sourceDefault ?? 'community'
 *     │
 *     ▼   (senare, asynkront, endast community-events med description)
 *   MiniMax-M2.7 med definitionerna här → förslag till mänsklig granskning
 *
 * Vid ändring
 * -----------
 * • Uppdatera definitionen och bumpa VERSION.
 * • Kör _retag-batch-v3.ts mot community-högen på nytt (fas 4-ramp).
 * • Gamla events persisterade med denna kategori behöver INTE omtaggas —
 *   definitionen styr bara framtida klassificering.
 *
 * Generalization Protection Rule: Dessa definitioner är *generella* —
 *   de gäller alla källor. Om en enskild källa kräver en smalare tolkning
 *   (t.ex. "Operan-source → alltid opera") hör det hemma i
 *   sourceCategoryDefaults.ts, inte här.
 *
 * @module 04-Normalizer/categoryDefinitions
 */

/** En kanonsk kategoridefinition. */
export interface CategoryDefinition {
  /** Den kanonska slug som persistas i events.category_slug. */
  slug: string;
  /** Kort beskrivning (≤ 60 tecken) för UI-listor och kompakta prompts. */
  short: string;
  /** Fullständig definition inkl. Inkluderar/Exkludera för LLM-prompts. */
  full: string;
}

/** Bumpas vidje gång definitionerna ändras — loggas i decision_logs. */
export const VERSION = '2026-09-30.1';

/**
 * Kanonska definitioner — ordningen är stabil och styr UI:t (Utforska-grupperna).
 * Fryst för att förhindra oavsiktlig mutation vid import.
 */
export const CATEGORY_DEFINITIONS: ReadonlyArray<CategoryDefinition> = Object.freeze([
  {
    slug: 'opera',
    short: 'Opera och operaföreställningar.',
    full: 'Opera och operaföreställningar där operasång och sceniskt berättande är huvudformen. Inkluderar konsertant opera. Exkludera musikal och vanlig klassisk konsert.',
  },
  {
    slug: 'theatre-comedy',
    short: 'Scenföreställningar där humor är huvudsyftet.',
    full: 'Scenföreställningar där humor är huvudsyftet. Inkluderar standup, humorproduktioner, improvisationskomedi och komiska teaterföreställningar.',
  },
  {
    slug: 'theatre-drama',
    short: 'Teater och dramatiska pjäser.',
    full: 'Teater och sceniska pjäser där dramatik/berättande är huvudformen. Inkluderar seriös teater, drama och talteater. Exkludera musikal, opera och renodlad komedi.',
  },
  {
    slug: 'dance',
    short: 'Scenföreställningar där dans är huvudformen.',
    full: 'Scenföreställningar där dans är huvudformen. Inkluderar modern dans, balett, streetdance och koreograferade dansföreställningar. Exkludera sociala dansevent och musikal.',
  },
  {
    slug: 'circus',
    short: 'Cirkus och akrobatik.',
    full: 'Föreställningar där cirkuskonst är huvudformen. Inkluderar akrobatik, nycirkus, jonglering och traditionell cirkus.',
  },
  {
    slug: 'musical-theatre',
    short: 'Musikal — sång och dans i pjäsform.',
    full: 'Sceniska berättelser där sång, musik och vanligtvis dans är centrala delar. Exkludera opera, konserter och vanlig teater.',
  },
  {
    slug: 'classical',
    short: 'Klassisk musik — orkester, kammarmusik, symfoni.',
    full: 'Konserter där klassisk musik är huvudformen. Inkluderar orkester, symfoni, kammarmusik, klassisk körmusik, instrumental- och sångrecital. Exkludera opera och musikal.',
  },
  {
    slug: 'rock',
    short: 'Rock, indie, punk, metal.',
    full: 'Musik med rötter i rock, indie, punk, metal eller alternative. Inkluderar hårdrock, klassisk rock, progressiv rock, grunge och shoegaze. Exkludera pop, elektroniskt och hip-hop.',
  },
  {
    slug: 'pop',
    short: 'Pop, dansmusik, schlager.',
    full: 'Popmusik och lättare konsertformer. Inkluderar synth-pop, dansband, schlager, k-pop, j-pop, europop och singer-songwriter. Exkludera rock, hip-hop och elektroniskt.',
  },
  {
    slug: 'jazz',
    short: 'Jazz, blues, soul, funk.',
    full: 'Musik med rötter i jazz, blues, soul eller funk. Inkluderar bebop, swing, fusion, smooth jazz, contemporary jazz, neo-soul och R&B. Exkludera hip-hop, rock och klassiskt.',
  },
  {
    slug: 'electronic',
    short: 'Elektronisk musik — house, techno, ambient.',
    full: 'Elektronisk musik och dansmusik producerad med synthar, datorer eller trummaskiner. Inkluderar house, techno, ambient, EDM, drum & bass, trance, industrial, IDM och electronica. Exkludera pop, hip-hop och rock.',
  },
  {
    slug: 'hip-hop',
    short: 'Hip-hop, rap, trap.',
    full: 'Hip-hop, rap och relaterade genrer. Inkluderar gangster rap, trap, southern hip hop, east/west coast hip hop och underground hip hop. Inkluderar även svensk hip-hop. Exkludera R&B (den ligger under jazz), pop och rock.',
  },
  {
    slug: 'exhibition',
    short: 'Konst-, design- och fotoutställningar.',
    full: 'Utställningar där konst, fotografi, design eller liknande verk visas för publik. Inkludera vernissage när huvudsyftet är en utställning.',
  },
  {
    slug: 'flea-market',
    short: 'Loppis, vintage och second hand-marknad.',
    full: 'Marknader vars huvudsakliga syfte är försäljning av begagnade, vintage- eller second hand-varor. Inkluderar loppis och bakluckeloppis.',
  },
  {
    slug: 'food',
    short: 'Matfestivaler, matprovningar och matupplevelser.',
    full: 'Event där mat eller gastronomi är huvudupplevelsen. Inkluderar matfestivaler, matprovningar, särskilda matupplevelser och matlagningsevent. Exkludera vanlig restaurangservering och event där mat endast finns tillgänglig.',
  },
  {
    slug: 'wine-tasting',
    short: 'Vin-, öl-, whisky- och spritprovningar.',
    full: 'Event där organiserad provning av vin eller andra alkoholhaltiga drycker är huvudaktiviteten. Inkluderar vin-, öl-, whisky- och spritprovningar. Exkludera event där dryck endast serveras.',
  },
  {
    slug: 'kids',
    short: 'Aktiviteter skapade huvudsakligen för barn.',
    full: 'Event som uttryckligen är skapat huvudsakligen för barn. Exempel: barnteater, barnaktivitet, sagostund och skapande för barn. Att barn får delta är inte tillräckligt.',
  },
  {
    slug: 'family',
    short: 'Aktiviteter för barn och vuxna tillsammans.',
    full: 'Event som uttryckligen riktar sig till både barn och vuxna/familjer tillsammans. Exkludera event som huvudsakligen riktar sig till barn även om föräldrar följer med.',
  },
  {
    slug: 'film',
    short: 'Filmvisning, bio, filmfestivaler.',
    full: 'Event där filmvisning är huvudaktiviteten. Inkluderar bio, specialvisningar, filmfestivaler och utomhusbio.',
  },
  {
    slug: 'talks-lectures',
    short: 'Föreläsningar, panelsamtal och publika samtal.',
    full: 'Event där huvudaktiviteten är att lyssna på eller delta i ett kunskaps- eller samtalsformat. Inkluderar föreläsningar, panelsamtal, författarsamtal, seminarier och publika samtal. Exkludera praktiska workshops.',
  },
  {
    slug: 'workshop',
    short: 'Kurser, workshops och gör-det-själv.',
    full: 'Deltagande event där besökaren själv aktivt lär sig, skapar eller utför något. Inkluderar workshops, praktiska kurser, prova-på och DIY. Exkludera event där publiken huvudsakligen lyssnar.',
  },
  {
    slug: 'sports',
    short: 'Sport, tävling och motionsaktivitet.',
    full: 'Event där organiserad sport, fysisk tävling eller motionsaktivitet är huvudaktiviteten. Inkluderar matcher, turneringar, lopp och sporttävlingar.',
  },
  {
    slug: 'community',
    short: 'Lokalt/samhällsinriktat event utan tydlig specifik kategori.',
    full: 'Lokalt eller samhällsinriktat event som inte tydligt passar någon mer specifik kategori. Använd endast som fallback — inte bara för att klassificeringen är osäker.',
  },
]);

/** Map: slug → definition. Använd i LLM-prompter och UI. */
export const CATEGORY_BY_SLUG: ReadonlyMap<string, CategoryDefinition> = new Map(
  CATEGORY_DEFINITIONS.map((c) => [c.slug, c]),
);

/** Hämta definition för en slug. Returnerar undefined om slugen inte finns. */
export function getCategoryDefinition(slug: string): CategoryDefinition | undefined {
  return CATEGORY_BY_SLUG.get(slug);
}

/** Lista alla kanonska slugs (i stabil ordning). */
export function listCategorySlugs(): string[] {
  return CATEGORY_DEFINITIONS.map((c) => c.slug);
}

/**
 * Bygg en LLM-prompt-fragment som listar alla definitioner med Inkluderar/Exkludera.
 * Använd i system-prompts för retag-pipelines.
 *
 * Exempel:
 *   buildLlmCriteriaPrompt()
 *     → "opera: Opera och operaföreställningar...\ntheatre-comedy: ..."
 */
export function buildLlmCriteriaPrompt(): string {
  return CATEGORY_DEFINITIONS
    .map((c) => `${c.slug}: ${c.full}`)
    .join('\n');
}
