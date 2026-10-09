/**
 * eventUnderstanding.ts — semantisk extraktion från strukturerade event-fält
 * + raw_description (entiteter, INTE formulering).
 *
 * Pipeline-steg 1 av 4 i EventPulse Editorial Description Engine (P7).
 *
 * Designprincip (omarbetad 2026-10-08):
 *   1. Strukturerade fält är primärkälla (category_slug, venue, datum, pris,
 *      performers från artistResolver).
 *   2. raw_description FÅR läsas — men ENDAST för entitetsextraktion
 *      (orkester, solist, kompositörer, verk, varaktighet). Vi extraherar
 *      ALDRIG meningar. Resultatet lagras i Profile (inte som fritext).
 *   3. textualFirewall (compileWriterInputs) blockerar source_description
 *      från att nå Writer. Profile är det enda Writer ser.
 *
 * Steg 1.3/15 i P7 Definition of Done. Omarbetad 2026-10-08.
 */

import type { EventProfile } from './types';
import { CATEGORY_BY_SLUG } from '../categoryDefinitions';
import { extractSemantics, applySemanticExtraction } from './semanticExtractor';
import { extractEntities } from './entityExtractor';
import { lookupArtists } from './gazetteerCache';
import { lookupSubjects, type SubjectEntry } from './subjectCache';

// ─── Inputs (strukturerade event-fält + valfri raw_description) ──────────────

export interface EventUnderstandingInput {
  /** category_slug från events-tabellen (kanonsk). */
  category_slug?: string | null;
  /** Venue-namn (från events → venues JOIN). */
  venue_name?: string | null;
  /** Venue-typ ('concert_hall' | 'theater' | 'club' | 'gallery' | 'cinema' | ...). */
  venue_type?: string | null;
  /** Stad (Stockholm / Göteborg / ...). */
  city?: string | null;
  /** Starttid (ISO 8601). */
  start_time?: string | null;
  /** Sluttid (ISO 8601). */
  end_time?: string | null;
  /** Pris (lägsta). */
  price_min_sek?: number | null;
  /** Pris (högsta, valfritt). */
  price_max_sek?: number | null;
  /** true om gratis. */
  is_free?: boolean | null;
  /** Språk ('sv' | 'en' | ...). */
  language?: string | null;
  /** Source-namn (för provenance). */
  source?: string | null;
  /** Huvudartist/headliner (om normaliserad via artistResolver). */
  performers?: string[];
  /** Öppningsakter (om normaliserade). */
  support_acts?: string[];
  /** Titel (för semantik — t.ex. "Jazzkväll med X"). */
  title?: string | null;
  /**
   * raw_description-text (entitetsextraktion).
   *
   * FÅR läsas av Event Understanding för att extrahera BETYDELSE (orkester,
   * solist, kompositörer, verk, varaktighet). Får ALDRIG nå Writer —
   * textualFirewall.compileWriterInputs() kastar om source_description,
   * raw_description eller liknande fält finns i inputs.
   *
   * Valfri — om null/empty hoppas semantisk extraktion över.
   */
  raw_description?: string | null;
}

// ─── Category → Profile mappning ─────────────────────────────────────────────

interface CategoryHints {
  event_type: string;
  /** Förväntade genrer för kategorin (tom om okänt). */
  genres: string[];
  /** Förväntade upplevelsekaraktärer. */
  experience_characteristics: string[];
  /** Default-innehåll (typ av program). */
  content: string[];
  /** Typisk målgrupp. */
  target_audience: string[];
  /** Default duration (minuter) om vi bara vet typen. */
  typical_duration_min: number;
  /** Default setting (om venue-type är okänt). */
  default_setting: string;
  /** Förväntat audience_participation. */
  audience_participation: string[];
  /** performance_style (typiskt). */
  performance_style: string;
}

/**
 * Deterministisk mappning från kanonsk category_slug → CategoryHints.
 *
 * Det här är INTE en inventering av vad varje kategori ÄR — det är bara
 * typiska signaler som hjälper Writer. Allt går att overrida via Profile.
 */
const CATEGORY_HINTS: ReadonlyMap<string, CategoryHints> = new Map([
  ['opera', {
    event_type: 'theater',
    genres: ['opera', 'classical'],
    experience_characteristics: ['scenföreställning', 'vokalt', 'orkestralt'],
    content: ['sång', 'orkester', 'scenframställan'],
    target_audience: ['vuxna', 'kulturellt intresserade'],
    typical_duration_min: 180,
    default_setting: 'operahus',
    audience_participation: ['lyssning'],
    performance_style: 'klassisk interpretativ',
  }],
  ['theatre-comedy', {
    event_type: 'theater',
    genres: ['komedi', 'standup'],
    experience_characteristics: ['scenframställan', 'humor', 'direkt publikkontakt (standup)'],
    content: ['monolog', 'skämt', 'improvisation'],
    target_audience: ['vuxna'],
    typical_duration_min: 90,
    default_setting: 'teater',
    audience_participation: ['lyssning', 'skratt', 'respons (standup)'],
    performance_style: 'interpretativ',
  }],
  ['theatre-drama', {
    event_type: 'theater',
    genres: ['drama'],
    experience_characteristics: ['scenföreställning', 'berättande'],
    content: ['pjäs', 'dialog', 'scenografi'],
    target_audience: ['vuxna', 'kulturellt intresserade'],
    typical_duration_min: 150,
    default_setting: 'teater',
    audience_participation: ['lyssning'],
    performance_style: 'interpretativ',
  }],
  ['dance', {
    event_type: 'theater',
    genres: ['dans'],
    experience_characteristics: ['rörelse', 'koreografi', 'musik'],
    content: ['koreografi', 'dansare'],
    target_audience: ['vuxna', 'kulturellt intresserade'],
    typical_duration_min: 120,
    default_setting: 'scen',
    audience_participation: ['lyssning', 'visuell upplevelse'],
    performance_style: 'koreograferad',
  }],
  ['circus', {
    event_type: 'theater',
    genres: ['cirkus'],
    experience_characteristics: ['akrobatik', 'fysisk prestation'],
    content: ['akrobatik', 'jonglering'],
    target_audience: ['familj', 'barn', 'vuxna'],
    typical_duration_min: 120,
    default_setting: 'cirkustält',
    audience_participation: ['visuell upplevelse', 'respons'],
    performance_style: 'fysisk',
  }],
  ['musical-theatre', {
    event_type: 'theater',
    genres: ['musikal'],
    experience_characteristics: ['sång', 'dans', 'berättande'],
    content: ['sång', 'dans', 'scenframställan'],
    target_audience: ['familj', 'vuxna'],
    typical_duration_min: 180,
    default_setting: 'teater',
    audience_participation: ['lyssning', 'applåd'],
    performance_style: 'interpretativ med sång och dans',
  }],
  ['classical', {
    event_type: 'music',
    genres: ['klassiskt'],
    experience_characteristics: ['orkester', 'kammarmusik', 'lyssning'],
    content: ['musikframförande'],
    target_audience: ['vuxna', 'kulturellt intresserade'],
    typical_duration_min: 110,
    default_setting: 'konserthus',
    audience_participation: ['lyssning'],
    performance_style: 'klassisk interpretativ',
  }],
  ['rock', {
    event_type: 'music',
    genres: ['rock'],
    experience_characteristics: ['live band', 'ljudvolym', 'publikrespons'],
    content: ['låtar', 'framförande'],
    target_audience: ['vuxna'],
    typical_duration_min: 120,
    default_setting: 'klubb / scen',
    audience_participation: ['dans', 'sjunger med', 'applåd'],
    performance_style: 'live',
  }],
  ['pop', {
    event_type: 'music',
    genres: ['pop'],
    experience_characteristics: ['live', 'lättsam', 'publikkontakt'],
    content: ['låtar', 'framförande'],
    target_audience: ['unga vuxna', 'vuxna'],
    typical_duration_min: 100,
    default_setting: 'arena / scen',
    audience_participation: ['dans', 'sjunger med'],
    performance_style: 'live',
  }],
  ['jazz', {
    event_type: 'music',
    genres: ['jazz'],
    experience_characteristics: ['improviserat', 'intimt', 'lyssning'],
    content: ['musikframförande', ' improvisation'],
    target_audience: ['vuxna', 'kulturellt intresserade'],
    typical_duration_min: 100,
    default_setting: 'klubb / konsertlokal',
    audience_participation: ['lyssning', 'applåd'],
    performance_style: 'improvisatorisk',
  }],
  ['electronic', {
    event_type: 'music',
    genres: ['elektroniskt'],
    experience_characteristics: ['dans', 'ljusshow', 'långt set'],
    content: ['DJ-set', 'produktion'],
    target_audience: ['unga vuxna', 'vuxna'],
    typical_duration_min: 240,
    default_setting: 'klubb',
    audience_participation: ['dans'],
    performance_style: 'DJ / live-set',
  }],
  ['hip-hop', {
    event_type: 'music',
    genres: ['hip-hop'],
    experience_characteristics: ['rap', 'publikkontakt'],
    content: ['låtar', 'framförande'],
    target_audience: ['unga vuxna', 'vuxna'],
    typical_duration_min: 100,
    default_setting: 'klubb / scen',
    audience_participation: ['dans', 'rappning med', 'applåd'],
    performance_style: 'live',
  }],
  ['exhibition', {
    event_type: 'exhibition',
    genres: [],
    experience_characteristics: ['visuell', 'lugn', 'självständigt tempo'],
    content: ['verk', 'installation'],
    target_audience: ['vuxna', 'kulturellt intresserade'],
    typical_duration_min: 90,
    default_setting: 'galleri / museum',
    audience_participation: ['vandring', 'observation'],
    performance_style: 'curaterad',
  }],
  ['film', {
    event_type: 'screening',
    genres: [],
    experience_characteristics: ['filmvisning', 'gemensam upplevelse'],
    content: ['film'],
    target_audience: ['vuxna'],
    typical_duration_min: 110,
    default_setting: 'biograf',
    audience_participation: ['gemensam visning'],
    performance_style: 'förmedlad',
  }],
  ['talks-lectures', {
    event_type: 'talk',
    genres: [],
    experience_characteristics: ['föreläsning', 'lyssning', 'kunskap'],
    content: ['tal', 'frågestund (eventuellt)'],
    target_audience: ['vuxna', 'intresserade'],
    typical_duration_min: 90,
    default_setting: 'sal / föreläsningslokal',
    audience_participation: ['lyssning', 'eventuell frågestund'],
    performance_style: 'föreläsande',
  }],
  ['workshop', {
    event_type: 'workshop',
    genres: [],
    experience_characteristics: ['deltagande', 'aktivt', 'praktiskt'],
    content: ['instruktion', 'övning'],
    target_audience: ['vuxna', 'intresserade'],
    typical_duration_min: 180,
    default_setting: 'studio / verkstad',
    audience_participation: ['gör-det-själv', 'frågor'],
    performance_style: 'instruerande',
  }],
  ['sports', {
    event_type: 'sport',
    genres: [],
    experience_characteristics: ['fysisk tävling', 'publikstöd'],
    content: ['match / tävling'],
    target_audience: ['vuxna', 'sportintresserade'],
    typical_duration_min: 120,
    default_setting: 'arena / plan',
    audience_participation: ['hejarop', ' applåd'],
    performance_style: 'tävlan',
  }],
  ['kids', {
    event_type: 'community',
    genres: [],
    experience_characteristics: ['barnanpassad', 'lekfull', 'kort'],
    content: ['sago', 'aktivitet'],
    target_audience: ['barn'],
    typical_duration_min: 60,
    default_setting: 'scen / lokal',
    audience_participation: ['aktiv'],
    performance_style: 'barnanpassad',
  }],
  ['family', {
    event_type: 'community',
    genres: [],
    experience_characteristics: ['familjeanpassad', 'varierad'],
    content: ['program för både barn och vuxna'],
    target_audience: ['barn', 'familj', 'vuxna'],
    typical_duration_min: 90,
    default_setting: 'lokal / scen',
    audience_participation: ['varierad'],
    performance_style: 'familjeanpassad',
  }],
  ['food', {
    event_type: 'community',
    genres: [],
    experience_characteristics: ['matfokuserad', 'sensorisk'],
    content: ['matlagning / provning'],
    target_audience: ['vuxna'],
    typical_duration_min: 120,
    default_setting: 'restaurang / kök',
    audience_participation: ['provning', 'ätande'],
    performance_style: 'kulinarisk',
  }],
  ['wine-tasting', {
    event_type: 'community',
    genres: [],
    experience_characteristics: ['provning', 'pedagogisk'],
    content: ['dryckesprovning'],
    target_audience: ['vuxna'],
    typical_duration_min: 90,
    default_setting: 'provningslokal',
    audience_participation: ['provning'],
    performance_style: 'pedagogisk',
  }],
  ['flea-market', {
    event_type: 'community',
    genres: [],
    experience_characteristics: ['shopping', 'vandra'],
    content: ['varor'],
    target_audience: ['alla'],
    typical_duration_min: 120,
    default_setting: 'marknadsplats',
    audience_participation: ['bläddra', 'köpa'],
    performance_style: 'öppen',
  }],
  ['community', {
    event_type: 'community',
    genres: [],
    experience_characteristics: ['lokalt'],
    content: ['lokalt program'],
    target_audience: ['lokala'],
    typical_duration_min: 90,
    default_setting: 'lokal',
    audience_participation: ['varierad'],
    performance_style: 'öppen',
  }],
]);

// ─── Venue type → setting ───────────────────────────────────────────────────

function settingFromVenueType(venueType?: string | null): string | undefined {
  if (!venueType) return undefined;
  const map: Record<string, string> = {
    'concert_hall': 'konserthus',
    'theater': 'teater',
    'club': 'klubb',
    'gallery': 'galleri',
    'museum': 'museum',
    'cinema': 'biograf',
    'arena': 'arena',
    'outdoor': 'utomhus',
    'church': 'kyrka',
    'library': 'bibliotek',
    'park': 'park',
  };
  return map[venueType] ?? venueType;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

/**
 * Bygg en EventProfile från strukturerade fält.
 *
 * Returnerar EMPTY-liknande profile om indata är tom — vi hittar ALDRIG på.
 * Trackar provenance per fält så Writer kan referera tillbaka.
 *
 * VIKTIGT: Source description-text får ALDRIG nå hit. Det är pipes kontrakt.
 */
export function buildEventProfile(input: EventUnderstandingInput): EventProfile {
  const provenance: Record<string, string[]> = {};
  const add = (key: string, source: string) => {
    if (!provenance[key]) provenance[key] = [];
    provenance[key].push(source);
  };

  // Hämta category-hints (eller tom om okänd).
  const catSlug = input.category_slug ?? null;
  const catDef = catSlug ? CATEGORY_BY_SLUG.get(catSlug) : undefined;
  const hints = catSlug ? CATEGORY_HINTS.get(catSlug) : undefined;
  if (catSlug) add('category_slug', `category:${catSlug}`);
  if (catDef) add('event_type', `category:${catSlug}`);

  // ── Performers (från artistResolver, INTE från title) ─────────────────────
  const performers: string[] = [];
  if (input.performers?.length) {
    performers.push(...input.performers);
    add('performers', 'artist_resolver');
  }
  if (input.support_acts?.length) {
    add('support_acts', 'artist_resolver');
  }

  // ── FAS 3 Evidence Pack: Performers från title (entityExtractor) ───────────
  //
  // Om artistResolver inte gav några performers OCH vi har title +
  // category_slug → kör extractEntities för att hitta artister i titeln.
  //
  // Cross-site bevisat (live-sample 2026-10-08): 18 events där titeln
  // namnger artister men artistResolver inte fångat (Quidam: Helene Berg
  // + 5 till, Norra Brunn: Måns Möller + 2 till, Anton Estby, etc.).
  //
  // Vi filtrerar bort icke-performer-roller (work/referenced/theme/
  // unknown/organizer) — bara riktiga artister tillåts i Profile.
  if (performers.length === 0 && input.title && input.category_slug) {
    const entities = extractEntities({
      title: input.title,
      raw_description: null,
      category_slug: input.category_slug,
      venue_name: input.venue_name ?? null,
    });
    const PERFORMER_ROLES = new Set([
      'artist', 'ensemble', 'band', 'performer', 'comedian',
      'conductor', 'soloist', 'speaker', 'dj', 'team',
    ]);
    const titlePerformers: string[] = [];
    for (const e of entities) {
      if (!PERFORMER_ROLES.has(e.role)) continue;
      // Undvik dubletter mot performers-listan
      if (titlePerformers.includes(e.name)) continue;
      titlePerformers.push(e.name);
    }
    if (titlePerformers.length > 0) {
      performers.push(...titlePerformers);
      add('performers', 'entity_extractor:title');
    }
  }

  // ── FAS 3.1: Performer-metadata från gazetteer (KB/MusicBrainz) ────────────
  //
  // Om vi har performers OCH de finns i curaterad Stockholm-gazetteer →
  // populera Profile.performer_metadata med country/genres/type. Detta ger
  // factuality-check stöd för claims som 'kanadensiska' eller
  // 'folk-singer-songwriter' även när source-text är licens-blockerad.
  //
  // Cross-site bevisat på Quidam (Helene Berg NO/jazz) och
  // Musik till åminnelse (Radiokören SE/Choir, Peter Dijkstra NL/conductor).
  let performer_metadata: Record<string, { country?: string; genres?: string[]; type?: string }> | undefined;
  if (performers.length > 0) {
    const lookups = lookupArtists(performers);
    let hitCount = 0;
    for (const [name, entry] of Object.entries(lookups)) {
      if (!entry) continue;
      if (!performer_metadata) performer_metadata = {};
      performer_metadata[name] = {
        country: entry.country || undefined,
        genres: entry.genres.length > 0 ? entry.genres : undefined,
        type: entry.type,
      };
      hitCount++;
    }
    if (hitCount > 0) add('performer_metadata', `gazetteer:${hitCount}/${performers.length} hits`);
  }

  // ── FAS 3.2: Subject-metadata från öppen data (Wikidata CC0 / Wikipedia) ─────
  //
  // Vi extraherar INTE subject-namn automatiskt i FAS 3.2 — istället låter
  // vi performers (entityExtractor) fungera som tidigare, men vi slår upp
  // ALLA performers PLUS titelnyckelord mot subjectCache. Detta fångar:
  //   - Verk som innehåller performerns namn (t.ex. "Chicago - the Musical"
  //     → slå upp "Chicago" mot subjectCache)
  //   - Organisationer (Kungliga Operan, Dramaten, etc.)
  //   - Ämnen (jazz, litteratur, AI)
  //
  // Notera: subject-LIVE-lookup (Wikidata SPARQL) är en async operation
  // som inte passar i synk buildEventProfile. Vi använder ENBART curated
  // JSON här. För live-Wikidata-lookup, använd lookupSubjectLive() i en
  // separat async-pipeline (t.ex. en bakgrundsjobb).
  let subject_metadata: Record<string, {
    kind?: string;
    country?: string;
    language?: string;
    inception_year?: number;
    wikidata_id?: string | null;
    author?: string;
    genre?: string;
    form?: string;
    attribution?: string;
  }> | undefined;

  // Kandidater att slå upp: performer-namn + full title + venue + city + tokens
  const subjectCandidates: string[] = [
    ...performers,
    // Full title (så att "Kungliga Operan", "Stockholms stadsbibliotek" matchar)
    ...(input.title ? [input.title] : []),
    // Titel-del FÖRE pipe/separator (vanligt mönster: "Kärlek över tanger | Premiärvisning...")
    ...(input.title?.split(/[|]/)[0]?.trim() ? [input.title.split(/[|]/)[0]!.trim()] : []),
    // Venue-namn (ofta innehåller org-namn: "Kungliga Operan", "Dramaten")
    ...(input.venue_name ? [input.venue_name] : []),
    // Stad (Stockholm är en subject, men inte särskilt informativt)
    // Hämta tokens från titel (FAS 3.2 light — separata ord > 2 tecken)
    ...(input.title?.split(/[\s\-:&|,()!?.]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2) ?? []),
  ];

  const subjectLookups = lookupSubjects(subjectCandidates);
  let subjectHitCount = 0;
  // Deduplicera: vi vill bara ha EN entry per canonical subject-namn,
  // även om flera kandidater (alias, full title, venue_name) träffar samma.
  const seenCanonical = new Set<string>();
  for (const [name, entry] of Object.entries(subjectLookups)) {
    if (!entry) continue;
    const canonical = entry.name.toLowerCase();
    if (seenCanonical.has(canonical)) continue;
    seenCanonical.add(canonical);
    if (!subject_metadata) subject_metadata = {};
    // Använd canonical name (entry.name) som nyckel — INTE alias-ordet
    subject_metadata[entry.name] = {
      kind: entry.kind,
      country: entry.country,
      language: entry.language,
      inception_year: entry.inception_year,
      wikidata_id: entry.wikidata_id,
      author: entry.metadata?.author,
      genre: entry.metadata?.genre,
      form: entry.metadata?.form,
      attribution: `${entry.name} (${entry._source.license} via ${entry._source.primary})`,
    };
    subjectHitCount++;
  }
  if (subjectHitCount > 0) add('subject_metadata', `subject-cache:${subjectHitCount} hits`);

  // ── Languages ─────────────────────────────────────────────────────────────
  const language: string[] = [];
  if (input.language) {
    language.push(input.language);
    add('language', `events_row:${input.source ?? 'unknown'}`);
  }

  // ── Target audience från kategorins typiska audience + gratis-signal ─────
  let target_audience: string[] = hints?.target_audience ? [...hints.target_audience] : [];
  if (input.is_free === true && !target_audience.includes('alla åldrar')) {
    // Gratis → ofta öppen målgrupp. Bara lägg till om inget specifikt redan.
    if (target_audience.length === 0) {
      target_audience.push('alla åldrar');
    }
  }
  if (hints) add('target_audience', `category:${catSlug}`);

  // ── Family characteristics (om gratis + öppet) ───────────────────────────
  let family_characteristics: string[] | undefined;
  if (input.is_free === true) {
    family_characteristics = ['tillgängligt utan biljettkrav'];
    add('family_characteristics', 'events_row:is_free');
  }

  // ── Setting (från venue_type) ────────────────────────────────────────────
  let setting: string | undefined;
  if (input.venue_type) {
    setting = settingFromVenueType(input.venue_type);
    if (setting) add('setting', `venue_row:type:${input.venue_type}`);
  }
  if (!setting && hints) {
    setting = hints.default_setting;
    add('setting', `category:${catSlug}`);
  }

  // ── Duration (KORRIGERAD 2026-10-08 efter P8-granskning) ──────────────────
  //
  // Prioritetsordning:
  //   1. Explicit source duration (endast källa vi litar på — strukturerat fält
  //      eller pålitligt beräknat från start+end på samma faktiska föreställning)
  //   2. Annars UNKNOWN / NULL
  //
  // KORRIGERING: category-typical duration är INTE ett FACT. Det är en
  // deterministisk gissning. Vi får inte ersätta "1440 min (24h, multi-day)"
  // med "180 min (musikal-typiskt)" och kalla det FACT.
  //
  // Sanity check: värden som beror på calendar span istället för aktivitets-
  // duration — t.ex. 1440 min (24h), 2880 min (48h), 4319 min (~3 dygn) — får
  // INTE tolkas som aktivitetslängd. De sätts till null.
  //
  // En hård 600-min-gräns är FÖR STRAM. Vi kan inte veta att 11h är fel utan
  // att förstå eventsemantiken. Fas 4:s 10h-gräns är därför BORTTAGEN.
  //
  // Om vi i framtiden behöver ett "estimated" separat fält:
  //   - estimatedDurationMinutes (number | null)
  //   - estimatedDurationConfidence (VERIFIED | SUPPORTED | AMBIGUOUS | INFERRED | UNKNOWN)
  //   - estimatedDurationMethod ('category_prior' | ...)
  // Detta byggs INTE i P8. Default: OM VI INTE VET → NULL.
  let duration_minutes: number | undefined;
  if (input.start_time && input.end_time) {
    const start = new Date(input.start_time).getTime();
    const end = new Date(input.end_time).getTime();
    if (!isNaN(start) && !isNaN(end) && end > start) {
      const rawDuration = Math.round((end - start) / 60_000);
      // Sanity check: calendar-span-detection utan hård aktivitets-gräns.
      // En aktivitets-duration får rimligtvis inte överstiga 24h (1440 min).
      // Allt därutöver är calendar-span (festival, mässa, multi-day event),
      // inte aktivitetslängd. Sätt till null.
      //
      // OBS: 24h-gränsen är EN ABSTRAKTIONSGRÄNS, inte "för lång aktivitet".
      // Ett 6h DJ-set som korsar midnatt (22:00 → 04:00) har rawDuration 360
      // min — under 24h — och bevaras som aktivitetslängd.
      const DURATION_MAX_ACTIVITY_MIN = 24 * 60; // 1440 min = 24h
      // >= används — exakt 24h är nästan alltid en calendar-span-bugg
      // (end_time kopierad från nästa dag), inte en 24h-maraton.
      if (rawDuration >= DURATION_MAX_ACTIVITY_MIN) {
        add('duration_minutes', `events_row:start+end:calendar_span(${rawDuration}min exceeds 24h)`);
      } else {
        duration_minutes = rawDuration;
        add('duration_minutes', 'events_row:start+end');
      }
    }
  }
  // category-typical fallback är BORTTAGEN — skulle vara en deterministisk
  // hallucination. OM duration_minutes är null stannar den null.

  // ── Experience characteristics + content + audience_participation + style ─
  const experience_characteristics: string[] = hints ? [...hints.experience_characteristics] : [];
  if (hints) add('experience_characteristics', `category:${catSlug}`);

  const content: string[] = hints ? [...hints.content] : [];
  if (hints) add('content', `category:${catSlug}`);

  const audience_participation: string[] | undefined = hints ? [...hints.audience_participation] : undefined;
  if (hints) add('audience_participation', `category:${catSlug}`);

  const performance_style: string | undefined = hints?.performance_style;
  if (performance_style) add('performance_style', `category:${catSlug}`);

  // ── Practical information (pris, fri entré) ─────────────────────────────
  const practical_information: string[] = [];
  if (input.is_free === true) {
    practical_information.push('Fri entré');
  } else if (input.price_min_sek != null) {
    if (input.price_max_sek != null && input.price_max_sek > input.price_min_sek) {
      practical_information.push(`Biljett: ${input.price_min_sek}–${input.price_max_sek} kr`);
    } else {
      practical_information.push(`Biljett från ${input.price_min_sek} kr`);
    }
  }
  if (practical_information.length) add('practical_information', 'events_row:price');

  // ── Slutför Profile ─────────────────────────────────────────────────────
  const profile: EventProfile = {
    event_type: hints?.event_type ?? 'community',
    event_format: undefined, // vi kan inte veta format utan description
    performers,
    support_acts: input.support_acts,
    ensemble: undefined,
    genres: hints?.genres ? [...hints.genres] : [],
    subgenres: undefined,
    content,
    themes: undefined, // ← KRÄVER description-text, sätts aldrig här
    concept: undefined,
    experience_characteristics,
    performance_style,
    audience_participation,
    language,
    target_audience,
    age_context: undefined,
    duration_minutes,
    premiere: undefined,
    tour: undefined,
    festival_context: undefined,
    special_guests: undefined,
    repertoire: undefined,
    production_characteristics: undefined,
    educational_content: undefined,
    family_characteristics,
    accessibility: undefined,
    setting,
    practical_information: practical_information.length ? practical_information : undefined,
    provenance,
    performer_metadata,
    subject_metadata,
  };

  // ── Steg 1.4: Semantisk extraktion från raw_description ─────────────────
  // OM raw_description finns — extrahera entiteter (orkester, solist,
  // kompositörer, verk, varaktighet) och applicera på Profile.
  //
  // Viktigt: vi extraherar ALDRIG meningar. Bara strukturerade entiteter
  // (namn, antal, listor). textualFirewall blockerar raw_description från
  // att nå Writer — Profile är det enda Writer ser.
  if (input.raw_description && input.raw_description.trim().length > 0) {
    const extraction = extractSemantics(input.raw_description);
    if (extraction.evidence.length > 0) {
      add('semantic_extraction', `semantic_extractor:${extraction.evidence.length} signals`);
      return applySemanticExtraction(profile, extraction);
    }
  }

  return profile;
}

/**
 * Beräkna info_level baserat på hur mycket Profile har.
 *
 * RICH    = de flesta fält ifyllda, har performers + genres + duration.
 * MEDIUM  = har typ + några karaktäristiska drag.
 * LOW     = har typ + lite till.
 * VERY_LOW = bara event_type, ingen annan info.
 */
export function profileInfoLevel(profile: EventProfile): 'RICH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' {
  let score = 0;
  if (profile.performers.length > 0) score += 2;
  if (profile.genres.length > 0) score += 1;
  if (profile.duration_minutes != null) score += 1;
  if (profile.setting) score += 1;
  if (profile.experience_characteristics.length >= 2) score += 1;
  if (profile.content.length >= 2) score += 1;
  if (profile.target_audience && profile.target_audience.length > 0) score += 1;

  if (score >= 5) return 'RICH';
  if (score >= 3) return 'MEDIUM';
  if (score >= 1) return 'LOW';
  return 'VERY_LOW';
}