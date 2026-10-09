/**
 * factualityCheck.ts — verifierar att alla materiella påståenden i draft
 * stöds av EventProfile + EventPulse-data, claim-by-claim.
 *
 * Pipeline-steg 5 av 6 i EventPulse Editorial Description Engine (P7).
 *
 * Approach (deterministisk, ingen LLM):
 *
 *   GENERATED DESCRIPTION
 *     → extract claims (substantiella ord och fraser)
 *     → map each claim to structured evidence
 *     → SUPPORTED | INFERRED | UNSUPPORTED
 *
 * Stödregler (claim matchas om):
 *   - SUPPORTED  : claim-ordet/frasen finns DIREKT i Profile, event-fält
 *                  eller category-hints (artist, genre, venue, etc.)
 *   - INFERRED   : claim är en semantisk konsekvens av category_slug
 *                  ("konsert" för music, "utställning" för exhibition)
 *                  eller typisk målgrupp/språk
 *   - UNSUPPORTED: claim kan inte härledas till något stödfält
 *
 * Pipeline-regler:
 *   - Alla icke-stödda claims listas ut (för loggning + fallback)
 *   - PASS endast om inga UNSUPPORTED claims finns
 *   - INFERRED claims accepteras (om claimet är rimligt för kategorin)
 *
 * Varför claim-by-claim istället för "hela texten mot Profile":
 *   - Writer får vara kreativ med språk och komposition.
 *   - "Intim miljö" för jazz-konsert på klubbscen = OK (INFERRED från
 *     experience_characteristics).
 *   - "Community och samhörighet" för ett konsert-event UTAN stöd i
 *     Profile = INTE OK (UNSUPPORTED).
 *
 * Steg 5/15 i P7 Definition of Done. Skriven om 2026-10-08 efter att
 * användaren identifierade att gamla extractClaims() bara fångade versaler
 * + siffror, vilket gjorde factuality=PASS i praktiken meningslös.
 */

import type { EventProfile, FactualityResult } from './types';
import {
  durationNormalForms,
  dateNormalForms,
  timeNormalForms,
  priceNormalForms,
  ageNormalForms,
  normalizeName,
  numberUnitNormalForms,
} from './claimNormalizer';

// ─── Stopwords & claim-ignore ────────────────────────────────────────────────

/** Funktion-ord och småord som inte är claims i sig. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'i', 'och', 'att', 'det', 'är', 'som', 'för', 'av', 'med', 'till', 'på',
  'en', 'ett', 'den', 'de', 'dem', 'så', 'men', 'eller', 'har', 'kan',
  'ska', 'vid', 'från', 'om', 'sig', 'sin', 'sina', 'the', 'a', 'an', 'of',
  'to', 'in', 'for', 'and', 'or', 'but',
  'får', 'ges', 'bli', 'blir', 'vara', 'varit', 'kommer', 'gör', 'göra',
  'där', 'här', 'när', 'hur', 'vad', 'vem', 'vilka', 'vilken',
  'ta', 'tar', 'tog', 'ger', 'gav', 'finns', 'fanns',
  'redan', 'även', 'också', 'bara',
  'utan', 'inom', 'genom', 'mellan', 'bland',
  'denna', 'detta', 'dessa',
  'den', 'det', 'man', 'sig', 'sitt', 'sina',
  // [FAS 5 2026-10-08] REVERTED: 'flera/många/fler/stor/stort/längre/kort/kortare/litet/liten'
  // är materiella claims — får inte hoppas över som stopwords.
]);

/**
 * Generiska "scen-beskrivande" adjektiv som INTE är claims.
 * De kan användas fritt oavsett Profile (jfr Coding-style: immutability).
 */
const STYLISTIC_ADJECTIVES: ReadonlySet<string> = new Set([
  'unikt', 'unik', 'unika',
  'magiskt', 'magisk', 'magiska',
  'spektakulärt', 'spektakulär', 'spektakulära',
  'fantastiskt', 'fantastisk', 'fantastiska',
  'helt', 'fullständigt', 'totalt',
  'stämningsfullt', 'stämningsfull', 'stämningsfulla',
  'mysigt', 'mysig', 'mysiga',
  'storslaget', 'storslagen', 'storslagna',
  'exklusivt', 'exklusiv', 'exklusiva',
  'legendariskt', 'legendarisk', 'legendariska',
  'modernt', 'modern', 'moderna',
  'nyskapande',
  'populärt', 'populär', 'populära',
  'känd', 'kända', 'känt',
  'namnkunniga', 'namnkunnig',
  'lokal', 'lokala', 'lokalt',
  'kulturellt', 'kulturell', 'kulturella',
  'intim', 'intimt', 'intima',
  'publiknära', 'publiknärt',
  'gemensam', 'gemensamt', 'gemensamma',
  'inbjuder', 'inbjudande',
  'trevlig', 'trevligt', 'trevliga',
  'härlig', 'härligt', 'härliga',
  'spännande', 'spännande',
  'stämningsfull', 'stämningsfullt',
  'överraskande',
  'avkopplande', 'avslappnad', 'avslappnat',
  'energisk', 'energiskt', 'energi',
  'svängig', 'svängigt',
  'karakteristisk', 'karakteristiskt',
  'typisk', 'typiskt',
  'välkänd', 'välkänt',
  'hela', 'hel', 'helg', 'helgen', 'helgerna',
  // [FAS 5 2026-10-08] REVERTED 'flera/fler' — materiella count-claims.
  'lika', 'samma', 'samma',
  // [FAS 5 2026-10-08] REVERTED 'stora/stort' — stor kan vara materiellt.
  // Kvar: 'liten/lilla/lille' (små adjektiv, ofta dekorativa).
  'liten', 'lilla', 'lille',
  'gamla', 'gammal', 'ny', 'nytt', 'nya',
  'länge',
  // [FAS 5 2026-10-08] REVERTED 'längre/kort/korta' — kan vara materiella duration-claims.
  'bästa', 'bäst', 'sämsta', 'sämst',
  'första', 'sista',
  'egna', 'egen',
  'samtida', 'samtid', 'samtidigt',
  'verklig', 'verkliga', 'faktisk', 'faktiska', 'faktiskt',
  'specifik', 'specifika', 'specifikt',
  'konstig', 'konstiga', 'konstigt',
  'säregen', 'säreget', 'säregna',
  'annorlunda', 'särskild', 'särskilda', 'särskilt',
  'vis', 'viss', 'visst', 'vissa',
  'möjlig', 'möjligt', 'möjliga',
  'trolig', 'troligt', 'troliga',
  'sannolik', 'sannolikt', 'sannolika',
  // [FAS 5 2026-10-08] REVERTED duration/kvantitet-adjektiv.
  // Risken är hög att materiella claims ("lång konsert" när duration=30 min,
  // "många artister" utan stöd, "stor orkester" när Profile säger kammarensemble)
  // slinker igenom som "stilistiskt". Användaren flaggade explicit:
  // "Var försiktig med att lägga ord som 'stor', 'många', 'få', 'lång', 'kort',
  //  'flera' i en global stylistic/ignore-list. De kan vara materiella claims."
  //
  // Kvar (låg risk): liten/litet/lilla (små adjektiv, ofta dekorativa),
  // mindre (komparativ, neutral), cirka/ca/ungefärlig/t (hedging — t.ex.
  // "ca 2 timmar & 10 minuter" matchar duration_minutes).
]);

/** Pronomen/pekare som inte är claims. */
const PRONOUNS: ReadonlySet<string> = new Set([
  'den', 'det', 'de', 'denna', 'detta', 'dessa', 'denne', 'dett',
  'artisten', 'bandet', 'gruppen', 'trion', 'ensemblen', 'publiken',
  'scenen', 'lokalens', 'salen', 'kvällen', 'konserten', 'föreställningen',
  'upplevelsen', 'evenemanget', 'programmet', 'innehållet',
]);

/** Generiska tids-/platssubstantiv (inte claims). */
const GENERIC_TIME_NOUNS: ReadonlySet<string> = new Set([
  'kväll', 'kvällen', 'natt', 'natten', 'dag', 'dagen', 'morgon', 'morgonen',
  'förmiddag', 'eftermiddag', 'kvällstid', 'nattetid',
  'tid', 'tiden', 'stund', 'stunden', 'tidpunkt', 'tidpunkten',
  'helg', 'helgen', 'vardag', 'vardagen', 'veckodag',
  'lokal', 'lokalen', 'plats', 'platsen', 'rum', 'rummet', 'sal', 'salen',
  'scen', 'scenen', 'lokal', 'hus', 'huset',
]);

/** Tids-/kvantitetsord (inte claims om ensamma). */
const QUANTITY_TIME: ReadonlySet<string> = new Set([
  // [FAS 5 2026-10-08] REVERTED 'längre/kort/kortare/fler/flera/många' — materiella claims.
  'länge', 'tidigt', 'sent',
  'mer', 'minst',
  'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio',
  'första', 'andra', 'tredje', 'fjärde',
  'idag', 'ikväll', 'imorgon', 'imorse',
  'år', 'månad', 'månader', 'vecka', 'veckor', 'dag', 'dagar',
  'timme', 'timmar', 'minuter', 'min', 'tim', 'kr', 'sek', 'st', 'personer',
  'decennier', 'decennium',
]);

/**
 * Mappa ISO 3166-1 alpha-2 country-code till svenska nationalitetsord.
 *
 * Används av buildEvidenceBase för att stödja claims som 'kanadensiska',
 * 'norska', 'holländska' när Profile.performer_metadata har country.
 *
 * Fler språkformer (pluralis bestämd, "från X") kan läggas till vid behov —
 * det viktiga är att alla rimliga former av nationalitetsordet täcks.
 */
function countryToSwedish(country: string): string[] {
  const map: Record<string, string[]> = {
    CA: ['kanadensiska', 'kanadensisk', 'kanadensiskt', 'canadensiska', 'canadensisk'],
    SE: ['svenska', 'svensk', 'svenskt', 'svenskar'],
    US: ['amerikanska', 'amerikansk', 'amerikanskt'],
    NO: ['norska', 'norsk', 'norskt'],
    DK: ['danska', 'dansk', 'danskt'],
    FI: ['finska', 'finsk', 'finskt'],
    NL: ['holländska', 'holländsk', 'holländskt', 'nederländska', 'nederländsk'],
    DE: ['tyska', 'tysk', 'tyskt'],
    GB: ['brittiska', 'brittisk', 'brittiskt', 'engelska', 'engelsk', 'engelskt'],
    UK: ['brittiska', 'brittisk', 'brittiskt', 'engelska', 'engelsk', 'engelskt'],
    FR: ['franska', 'fransk', 'franskt'],
    IT: ['italienska', 'italiensk', 'italienskt'],
    ES: ['spanska', 'spansk', 'spanskt'],
    CH: ['schweiziska', 'schweizisk', 'schweiziskt'],
    AT: ['österrikiska', 'österrikisk', 'österrikiskt'],
    IE: ['irländska', 'irländsk', 'irländskt'],
    IS: ['isländska', 'isländsk', 'isländskt'],
    PL: ['polska', 'polsk', 'polskt'],
    RU: ['ryska', 'rysk', 'ryskt'],
    JP: ['japanska', 'japansk', 'japanskt'],
    CN: ['kinesiska', 'kinesisk', 'kinesiskt'],
    AU: ['australiska', 'australisk', 'australiskt'],
    NZ: ['nyzeeländska', 'nyzeeländsk', 'nyzeeländskt'],
    BO: ['bolivianska', 'boliviansk', 'bolivianskt'],
    MX: ['mexikanska', 'mexikansk', 'mexikanskt'],
  };
  return map[country.toUpperCase()] ?? [];
}

/**
 * Mappa MusicBrainz 'type' (Person/Group/Orchestra/Choir) till svenska termer.
 *
 * Används för att stödja claims som 'kör', 'körsång', 'orkester', 'grupp'
 * när Profile.performer_metadata har type.
 */
function typeToSwedish(type: string): string[] {
  const lower = type.toLowerCase();
  switch (lower) {
    case 'person':
      return [];
    case 'group':
      return ['grupp', 'band'];
    case 'orchestra':
      return ['orkester', 'filharmoniker', 'symfoniker'];
    case 'choir':
      return ['kör', 'körsång', 'körsångare', 'kören'];
    case 'ensemble':
      return ['ensemble'];
    default:
      return [];
  }
}

function isStylisticOrCommon(w: string): boolean {
  const lower = w.toLowerCase().replace(/[.,;:!?]$/, '');
  if (lower.length < 4) return true;
  if (STOPWORDS.has(lower)) return true;
  if (STYLISTIC_ADJECTIVES.has(lower)) return true;
  if (PRONOUNS.has(lower)) return true;
  if (QUANTITY_TIME.has(lower)) return true;
  if (GENERIC_TIME_NOUNS.has(lower)) return true;
  return false;
}

// ─── Claim extraction ────────────────────────────────────────────────────────

/**
 * Extrahera substantiella claims från text. En claim är:
 *   - Ett ord med ≥5 tecken som INTE är funktions-/stil-ord
 *   - En 2-3-ords nominalfras (adjektiv + substantiv, eller två substantiv)
 *
 * Vi fångar INTE:
 *   - "Hus" (1 kort substantiv utan adjektiv — ofta stopword)
 *   - "Stockholm" (1 egennamn — fångas separat)
 *   - "intim" (stilord)
 *
 * Vi FÅNGAR:
 *   - "community" (innehållsbärande substantiv)
 *   - "intim miljö" (adj + subst nominalfras)
 *   - "lokalt förankrat innehåll" (adj + perf-part + subst)
 *   - "thrash metal" (genre-sammansättning)
 *   - "gemensam konsertupplevelse" (adj + adj + subst)
 */
export function extractClaims(text: string): string[] {
  const claims = new Set<string>();
  const lowered = text.toLowerCase();
  const sentences = lowered.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).map(w => w.replace(/[.,;:!?()"]/g, ''));
    if (words.length < 2) continue;

    // Hitta 1-ords claims (innehållsbärande substantiv/adjektiv, ej funktionsord)
    for (const w of words) {
      if (w.length >= 4 && !isStylisticOrCommon(w)) {
        claims.add(w);
      }
    }

    // Hitta 2-ords claims (adj + subst, subst + subst, "X Y"-fraser)
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i];
      const b = words[i + 1];
      if (!a || !b) continue;
      if (a.length < 3 || b.length < 3) continue;
      // Skippa om båda är funktionsord
      if (isStylisticOrCommon(a) && isStylisticOrCommon(b)) continue;
      // Skippa om BARA adjektiv (vi vill ha substantiv-anknytning)
      claims.add(`${a} ${b}`);
    }

    // Hitta 3-ords claims
    for (let i = 0; i < words.length - 2; i++) {
      const a = words[i];
      const b = words[i + 1];
      const c = words[i + 2];
      if (!a || !b || !c) continue;
      if (a.length < 3 || b.length < 3 || c.length < 3) continue;
      // Skippa om alla tre är funktionsord
      const allFunctional = isStylisticOrCommon(a) && isStylisticOrCommon(b) && isStylisticOrCommon(c);
      if (allFunctional) continue;
      // Skippa om det är enbart pronomen+rörelseverb
      claims.add(`${a} ${b} ${c}`);
    }
  }

  // Kapitaliserade fraser (2+ ord kapitaliserade) — för artistnamn/verk
  const capPhraseRx = /\b([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = capPhraseRx.exec(text)) !== null) {
    claims.add(m[1].toLowerCase());
  }
  // Enskilda kapitaliserade ord (ej i meningens början) — för artistnamn
  const singleCapRx = /(?<![.!?]\s)(?<!^)\b([A-ZÅÄÖ][a-zåäö]{2,})\b/g;
  while ((m = singleCapRx.exec(text)) !== null) {
    claims.add(m[1].toLowerCase());
  }

  // Siffror med enhet
  const numberRx = /\b(\d+\s*(?:min|tim|minuter|timmar|kr|sek|personer|st|år|års|åring))\b/gi;
  while ((m = numberRx.exec(text)) !== null) {
    claims.add(m[1].toLowerCase());
  }

  return Array.from(claims);
}

// ─── Profile → evidence base ─────────────────────────────────────────────────

interface EvidenceBase {
  /** Direkt-stödda fraser (normalized). */
  direct: Set<string>;
  /** Inferred-stödda (semantiska konsekvenser av category). */
  inferred: Set<string>;
  /** Alla fält som bidrar (för loggning). */
  sources: Array<{ field: string; value: string }>;
}

interface FactualityCheckOptions {
  categorySlug?: string | null;
}

/**
 * Bygg stödbas av allt som Profile + EventPulse-data stödjer.
 *
 * @param profile EventProfile (semantisk extraktion)
 * @param event Strukturerade event-fält
 * @param options.categorySlug För INFERRED-stöd (category-hints)
 */
function buildEvidenceBase(
  profile: EventProfile,
  event: { title?: string; venue_name?: string | null; city?: string | null; start_time?: string | null; end_time?: string | null; price_min_sek?: number | null },
  options: FactualityCheckOptions = {},
): EvidenceBase {
  const direct = new Set<string>();
  const inferred = new Set<string>();
  const sources: Array<{ field: string; value: string }> = [];

  /**
   * Lägg till en sträng + alla dess normaliserade former.
   * Om strängen parsar som duration/datum/tid/pris/ålder → lägg även till
   * alla semantiskt ekvivalenta former (så "2 tim 10 min" stöds när Profile
   * har duration_minutes: 130).
   */
  const add = (s: string | null | undefined, kind: 'direct' | 'inferred', field: string) => {
    if (!s) return;
    const norm = s.toLowerCase().trim();
    if (norm.length < 2) return;
    (kind === 'direct' ? direct : inferred).add(norm);
    sources.push({ field, value: s });
  };

  /** Lägg till sträng + normaliserade former (duration/date/time/price/age/number). */
  const addWithNormalForms = (s: string | null | undefined, kind: 'direct' | 'inferred', field: string) => {
    if (!s) return;
    add(s, kind, field);
    const norm = s.toLowerCase().trim();
    // Lägg till alla duration-former (så "130 min" stödjer "2 tim 10 min")
    for (const f of durationNormalForms(norm)) add(f, kind, `${field}:norm:duration`);
    for (const f of dateNormalForms(norm)) add(f, kind, `${field}:norm:date`);
    for (const f of timeNormalForms(norm)) add(f, kind, `${field}:norm:time`);
    for (const f of priceNormalForms(norm)) add(f, kind, `${field}:norm:price`);
    for (const f of ageNormalForms(norm)) add(f, kind, `${field}:norm:age`);
    for (const f of numberUnitNormalForms(norm)) add(f, kind, `${field}:norm:number`);
  };

  /** Lägg till namn + alla alias/lastname/firstname-former. */
  const addName = (s: string | null | undefined, kind: 'direct' | 'inferred', field: string) => {
    if (!s) return;
    add(s, kind, field);
    for (const f of normalizeName(s)) add(f, kind, `${field}:norm:name`);
  };

  // ── DIRECT: performers, support, ensemble ──────────────────────────────
  for (const p of profile.performers) addName(p, 'direct', 'profile.performers');
  for (const s of profile.support_acts ?? []) addName(s, 'direct', 'profile.support_acts');
  if (profile.ensemble) addWithNormalForms(profile.ensemble, 'direct', 'profile.ensemble');

  // ── DIRECT: genres, subgenres ──────────────────────────────────────────
  for (const g of profile.genres) add(g, 'direct', 'profile.genres');
  for (const sg of profile.subgenres ?? []) add(sg, 'direct', 'profile.subgenres');

  // ── DIRECT: setting, content, experience_characteristics, themes ──────
  if (profile.setting) add(profile.setting, 'direct', 'profile.setting');
  for (const c of profile.content) addWithNormalForms(c, 'direct', 'profile.content');
  for (const ec of profile.experience_characteristics) addWithNormalForms(ec, 'direct', 'profile.experience_characteristics');
  for (const t of profile.themes ?? []) add(t, 'direct', 'profile.themes');

  // ── DIRECT: tour, festival, special_guests ─────────────────────────────
  if (profile.tour) add(profile.tour, 'direct', 'profile.tour');
  if (profile.festival_context) add(profile.festival_context, 'direct', 'profile.festival_context');
  for (const sg of profile.special_guests ?? []) addName(sg, 'direct', 'profile.special_guests');

  // ── DIRECT: performance_style, audience_participation, target_audience ──
  if (profile.performance_style) add(profile.performance_style, 'direct', 'profile.performance_style');
  for (const ap of profile.audience_participation ?? []) add(ap, 'direct', 'profile.audience_participation');
  for (const ta of profile.target_audience ?? []) add(ta, 'direct', 'profile.target_audience');

  // ── DIRECT: practical_information, accessibility, family ───────────────
  for (const pi of profile.practical_information ?? []) addWithNormalForms(pi, 'direct', 'profile.practical_information');
  for (const a of profile.accessibility ?? []) add(a, 'direct', 'profile.accessibility');
  for (const f of profile.family_characteristics ?? []) add(f, 'direct', 'profile.family_characteristics');

  // ── DIRECT: duration_minutes (numeriskt) ──────────────────────────────
  // Profile lagrar duration_minutes som number. Vi konverterar till sträng-
  // former ("130 min", "2 tim 10 min") så att alla format stödjer varandra.
  if (typeof profile.duration_minutes === 'number' && profile.duration_minutes > 0) {
    for (const f of durationNormalForms(`${profile.duration_minutes} min`)) {
      add(f, 'direct', 'profile.duration_minutes');
    }
  }

  // ── DIRECT: event-fält ──────────────────────────────────────────────────
  if (event.title) addName(event.title, 'direct', 'event.title');
  if (event.venue_name) addName(event.venue_name, 'direct', 'event.venue_name');
  if (event.city) add(event.city, 'direct', 'event.city');

  // ── DIRECT: performer_metadata (gazetteer, FAS 3.1) ──────────────────────
  // Map country-codes och type till svenska adjektiv/substantiv som Writer
  // rimligen kan använda när den namnger en performer. Detta gör att
  // claims som 'kanadensiska singer-songwriter Donovan Woods' (som
  // striktare Writer V2 prompt tenderar att producera) blir SUPPORTED
  // istället för UNSUPPORTED.
  if (profile.performer_metadata) {
    for (const [name, meta] of Object.entries(profile.performer_metadata)) {
      if (!meta) continue;
      // Country → språkliga former
      if (meta.country) {
        for (const term of countryToSwedish(meta.country)) {
          add(term, 'direct', `performer_metadata:country:${name}`);
        }
      }
      // Type → språkliga former
      if (meta.type) {
        for (const term of typeToSwedish(meta.type)) {
          add(term, 'direct', `performer_metadata:type:${name}`);
        }
      }
      // Genres → direktorden
      if (meta.genres) {
        for (const g of meta.genres) {
          add(g, 'direct', `performer_metadata:genre:${name}`);
        }
      }
    }
  }

  // ── DIRECT: start_time / end_time (datum + tid) ───────────────────────
  if (event.start_time) {
    // start_time är ISO 8601 — "2026-10-08T19:00:00+02:00"
    // Extrahera datum och tid separat
    const isoDate = event.start_time.split('T')[0] ?? '';
    const isoTime = event.start_time.split('T')[1]?.slice(0, 5) ?? '';
    if (isoDate) for (const f of dateNormalForms(isoDate)) add(f, 'direct', 'event.start_time:date');
    if (isoTime) for (const f of timeNormalForms(isoTime)) add(f, 'direct', 'event.start_time:time');
  }
  if (event.end_time) {
    const isoTime = event.end_time.split('T')[1]?.slice(0, 5) ?? '';
    if (isoTime) for (const f of timeNormalForms(isoTime)) add(f, 'direct', 'event.end_time:time');
  }

  // ── DIRECT: price_min_sek (numeriskt) ─────────────────────────────────
  if (typeof event.price_min_sek === 'number' && event.price_min_sek > 0) {
    for (const f of priceNormalForms(`${event.price_min_sek} kr`)) {
      add(f, 'direct', 'event.price_min_sek');
    }
  }

  // ── INFERRED: category-typiska benämningar ─────────────────────────────
  const slug = options.categorySlug ?? null;
  // Universella event-verb (tid, start, äga rum, kosta) — gäller alla events
  add('börjar', 'inferred', 'event_universal:verb');
  add('startar', 'inferred', 'event_universal:verb');
  add('inleds', 'inferred', 'event_universal:verb');
  add('avslutas', 'inferred', 'event_universal:verb');
  add('slutar', 'inferred', 'event_universal:verb');
  add('varar', 'inferred', 'event_universal:verb');
  add('pägar', 'inferred', 'event_universal:verb'); // felstavad försvar
  add('pågår', 'inferred', 'event_universal:verb');
  add('äger', 'inferred', 'event_universal:verb');
  add('äger rum', 'inferred', 'event_universal:verb');
  add('arrangeras', 'inferred', 'event_universal:verb');
  // Universella event-substantiv
  add('inträde', 'inferred', 'event_universal:noun');
  add('biljetter', 'inferred', 'event_universal:noun');
  add('biljett', 'inferred', 'event_universal:noun');
  add('kostnad', 'inferred', 'event_universal:noun');
  add('entré', 'inferred', 'event_universal:noun');
  // Universella event-adjektiv
  add('gratis', 'inferred', 'event_universal:adj');
  add('kostnadsfritt', 'inferred', 'event_universal:adj');
  add('kostnadsfri', 'inferred', 'event_universal:adj');
  if (typeof event.price_min_sek === 'number' && event.price_min_sek > 0) {
    add('kostar', 'inferred', 'event_paid:verb');
    add('kostar', 'inferred', 'event_paid:verb');
  }

  if (slug === 'music' || slug === 'concert' || slug === 'pop' || slug === 'rock' ||
      slug === 'jazz' || slug === 'classical' || slug === 'electronic' || slug === 'hip-hop' ||
      slug === 'folk' || slug === 'world') {
    add('konsert', 'inferred', 'category_slug:music');
    add('musik', 'inferred', 'category_slug:music');
    add('framträdande', 'inferred', 'category_slug:music');
    add('artister', 'inferred', 'category_slug:music');
    add('scen', 'inferred', 'category_slug:music');
    add('live', 'inferred', 'category_slug:music:adj');
    add('framförande', 'inferred', 'category_slug:music:noun');
    add('bjuder', 'inferred', 'category_slug:music:verb');
    add('inbjuder', 'inferred', 'category_slug:music:verb');
    // Verb som är inneboende i musik-event
    add('spelar', 'inferred', 'category_slug:music:verb');
    add('sjunger', 'inferred', 'category_slug:music:verb');
    add('rapp', 'inferred', 'category_slug:music:verb');
    add('rappar', 'inferred', 'category_slug:music:verb');
    add('framträder', 'inferred', 'category_slug:music:verb');
    add('intar', 'inferred', 'category_slug:music:verb');
    add('gästar', 'inferred', 'category_slug:music:verb');
    // Orkester — INFERRED om Profile har stora ensembler (95-musiker etc)
    if (profile.content.some(c => /orkester|ensemble|musiker|artister/i.test(c)) ||
        profile.experience_characteristics.some(c => /orkester|ensemble|musiker/i.test(c))) {
      add('orkester', 'inferred', 'category_slug:music:orchestra_signal');
    }
  }
  if (slug === 'theater' || slug === 'theatre-drama' || slug === 'theatre-comedy' || slug === 'dance') {
    add('teater', 'inferred', 'category_slug:theater');
    add('föreställning', 'inferred', 'category_slug:theater');
    add('scenframställan', 'inferred', 'category_slug:theater');
    add('spelar', 'inferred', 'category_slug:theater:verb');
    add('framför', 'inferred', 'category_slug:theater:verb');
    add('uppträder', 'inferred', 'category_slug:theater:verb');
  }
  if (slug === 'standup' || slug === 'comedy' || slug === 'theatre-comedy') {
    add('standup', 'inferred', 'category_slug:standup');
    add('humor', 'inferred', 'category_slug:standup');
  }
  if (slug === 'exhibition' || slug === 'art-exhibitions' || slug === 'gallery') {
    add('utställning', 'inferred', 'category_slug:exhibition');
    add('verk', 'inferred', 'category_slug:exhibition');
    add('curaterad', 'inferred', 'category_slug:exhibition');
  }
  if (slug === 'festival') {
    add('festival', 'inferred', 'category_slug:festival');
  }
  if (slug === 'workshop') {
    add('workshop', 'inferred', 'category_slug:workshop');
  }
  if (slug === 'film' || slug === 'screening') {
    add('visning', 'inferred', 'category_slug:screening');
    add('film', 'inferred', 'category_slug:screening');
  }
  if (slug === 'community' || slug === 'family' || slug === 'kids' || slug === 'food') {
    add('evenemang', 'inferred', 'category_slug:community');
    add('aktivitet', 'inferred', 'category_slug:community');
  }

  // ── INFERRED: category-typiska experience-vokabulär (för smalare claims) ─
  if (slug === 'jazz') {
    add('improviserat', 'inferred', 'category_slug:jazz:experience');
    add('lyssning', 'inferred', 'category_slug:jazz:experience');
  }
  if (slug === 'rock' || slug === 'metal' || slug === 'punk') {
    add('ljudvolym', 'inferred', 'category_slug:rock:experience');
    add('publikrespons', 'inferred', 'category_slug:rock:experience');
  }
  if (slug === 'classical' || slug === 'opera') {
    add('orkester', 'inferred', 'category_slug:classical:experience');
    add('kammarmusik', 'inferred', 'category_slug:classical:experience');
  }
  if (slug === 'electronic') {
    add('ljusshow', 'inferred', 'category_slug:electronic:experience');
  }
  if (slug === 'workshop') {
    add('instruktion', 'inferred', 'category_slug:workshop:experience');
    add('övning', 'inferred', 'category_slug:workshop:experience');
  }
  if (slug === 'sports') {
    add('sport', 'inferred', 'category_slug:sports');
    add('match', 'inferred', 'category_slug:sports');
    add('tävling', 'inferred', 'category_slug:sports');
    add('tävlan', 'inferred', 'category_slug:sports');
    add('fysisk', 'inferred', 'category_slug:sports');
    add('tävlan', 'inferred', 'category_slug:sports:experience');
  }

  return { direct, inferred, sources };
}

// ─── Claim → evidence mapping ────────────────────────────────────────────────

export type ClaimStatus = 'SUPPORTED' | 'INFERRED' | 'UNSUPPORTED';

export interface ClaimEvidence {
  claim: string;
  status: ClaimStatus;
  /** Vilka Profile-fält som stödjer claimet (tomt för UNSUPPORTED). */
  evidence: Array<{ field: string; value: string }>;
  /** Om claimet är en sub-fras av en stödfras, eller stödfras är sub-fras. */
  match_type: 'exact' | 'substring' | 'word-overlap' | 'none';
}

function matchClaim(claim: string, base: EvidenceBase): ClaimEvidence {
  const norm = claim.toLowerCase().trim();
  if (norm.length < 3) {
    return { claim, status: 'SUPPORTED', evidence: [], match_type: 'exact' };
  }

  // Generera alla normaliserade former av claimen (så "250:-" matchar
  // "250 kr" i evidens när price_normalForms genererar båda).
  const claimVariants = new Set<string>([norm]);
  for (const f of priceNormalForms(norm)) claimVariants.add(f);
  for (const f of durationNormalForms(norm)) claimVariants.add(f);
  for (const f of timeNormalForms(norm)) claimVariants.add(f);
  for (const f of dateNormalForms(norm)) claimVariants.add(f);
  for (const f of ageNormalForms(norm)) claimVariants.add(f);
  for (const f of numberUnitNormalForms(norm)) claimVariants.add(f);

  // 1) Direkt träff (någon variant)
  for (const variant of claimVariants) {
    if (base.direct.has(variant)) {
      const evidence = base.sources.filter(s => s.value.toLowerCase().trim() === variant);
      return { claim, status: 'SUPPORTED', evidence, match_type: 'exact' };
    }
  }

  // 2) Substring-träff (claim-variant finns i stödfras eller tvärtom)
  for (const variant of claimVariants) {
    for (const supported of base.direct) {
      if (supported.includes(variant) || variant.includes(supported)) {
        const evidence = base.sources.filter(s => s.value.toLowerCase().trim() === supported);
        return { claim, status: 'SUPPORTED', evidence, match_type: 'substring' };
      }
    }
  }

  // 3) Ord-överlapp (≥50% av claim-orden finns i någon stödfras)
  const claimWords = norm.split(/\s+/).filter(w => w.length >= 4);
  if (claimWords.length >= 1) {
    for (const supported of base.direct) {
      const supportedWords = new Set(supported.split(/\s+/).filter(w => w.length >= 4));
      const overlap = claimWords.filter(w => supportedWords.has(w)).length;
      if (overlap > 0 && overlap / claimWords.length >= 0.5) {
        const evidence = base.sources.filter(s => s.value.toLowerCase().trim() === supported);
        return { claim, status: 'SUPPORTED', evidence, match_type: 'word-overlap' };
      }
    }
  }

  // 4) INFERRED (category-typisk vokabulär)
  for (const variant of claimVariants) {
    if (base.inferred.has(variant)) {
      const evidence = base.sources.filter(s => s.value.toLowerCase().trim() === variant);
      return { claim, status: 'INFERRED', evidence, match_type: 'exact' };
    }
  }
  for (const variant of claimVariants) {
    for (const inf of base.inferred) {
      if (inf.includes(variant) || variant.includes(inf)) {
        const evidence = base.sources.filter(s => s.value.toLowerCase().trim() === inf);
        return { claim, status: 'INFERRED', evidence, match_type: 'substring' };
      }
    }
  }
  // Ords-överlapp mot inferred
  if (claimWords.length >= 1) {
    for (const inf of base.inferred) {
      const infWords = new Set(inf.split(/\s+/).filter(w => w.length >= 4));
      const overlap = claimWords.filter(w => infWords.has(w)).length;
      if (overlap > 0 && overlap / claimWords.length >= 0.5) {
        const evidence = base.sources.filter(s => s.value.toLowerCase().trim() === inf);
        return { claim, status: 'INFERRED', evidence, match_type: 'word-overlap' };
      }
    }
  }

  return { claim, status: 'UNSUPPORTED', evidence: [], match_type: 'none' };
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

export interface FactualityCheckInput {
  draft: { text: string };
  profile: EventProfile;
  event: {
    title?: string;
    venue_name?: string | null;
    city?: string | null;
    category_slug?: string | null;
  };
}

/**
 * Verifiera draft mot Profile + event-data, claim-by-claim.
 *
 * Returnerar PASS om inga UNSUPPORTED claims finns.
 * INFERRED claims är OK (rimlig semantisk konsekvens av kategori).
 * unsupported_claims innehåller detaljer per claim för loggning.
 */
export function checkFactuality(input: FactualityCheckInput): FactualityResult {
  const { draft, event, profile } = input;
  const base = buildEvidenceBase(profile, event, { categorySlug: event.category_slug });

  const claims = extractClaims(draft.text);
  const supported: string[] = [];
  const inferred: string[] = [];
  const unsupported: string[] = [];
  const details: ClaimEvidence[] = [];

  for (const claim of claims) {
    const ev = matchClaim(claim, base);
    details.push(ev);
    if (ev.status === 'SUPPORTED') supported.push(claim);
    else if (ev.status === 'INFERRED') inferred.push(claim);
    else unsupported.push(claim);
  }

  return {
    pass: unsupported.length === 0,
    unsupported_claims: unsupported,
    supported_claims: supported,
    inferred_claims: inferred,
    details,
    checked_at: new Date().toISOString(),
  };
}

// ─── Exports för testning ────────────────────────────────────────────────────

export const __test__ = {
  STOPWORDS,
  STYLISTIC_ADJECTIVES,
  PRONOUNS,
  QUANTITY_TIME,
  isStylisticOrCommon,
  buildEvidenceBase,
  matchClaim,
};
