/**
 * EventPulse Summary — T0201 (2026-10-05).
 *
 * Deterministisk faktakonstruktion + faktabaserad sammanfattning.
 *
 * Pipeline (användarens krav §3 + §5 + §11):
 *   1. Extrahera verifierbara fakta från normaliserade event-fält OCH
 *      raw_description (regex-baserat, aldrig gissa).
 *   2. Bygg `eventpulse_summary` via template per event-typ (concert, theater,
 *      exhibition, festival, workshop, screening, community, ...).
 *   3. Hitta aldrig på fält som inte kan extraheras.
 *
 * Användarens hårdregler:
 *   - Inga synonymer / ingen parafrasering / ingen "skriva om" av originaltext.
 *   - Allt som inte är verifierat → null.
 *   - Allt som har flera konfliktande källor → deterministisk vinnare enligt
 *     source-priority (se `chooseFact`).
 *
 * Kontrakt: rena funktioner, inga sidoeffekter. Inga I/O-anrop.
 */

import { extractHeadliner } from './artistResolver';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Fakta som bygger eventpulse_summary. Här finns BARA verifierbara saker —
 * vi accepterar att många fält är null hellre än att gissa.
 *
 * Modell: "no-fake-data" — fält utan stöd ska vara null, inte påhittade.
 */
export interface EventpulseFacts {
  event_type: 'concert' | 'theater' | 'standup' | 'exhibition' | 'festival'
              | 'workshop' | 'screening' | 'community' | 'sport' | 'other' | null;
  artist: string | null;
  support_act: string | null;
  venue: string | null;
  city: string | null;
  /** YYYY-MM-DD (lokal-datum från start_time). */
  date: string | null;
  /** HH:MM, 24h. */
  start_time: string | null;
  /** HH:MM, 24h. */
  end_time: string | null;
  /** HH:MM, 24h. */
  doors_time: string | null;
  /** "18", "21", "all ages", null. */
  age_limit: string | null;
  language: 'sv' | 'en' | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  price_max_sek: number | null;
  /** Fri accessibility-info. null om inget stöd i källan. */
  accessibility: string | null;
  /** Arrangör (om fil). */
  organizer: string | null;
  /**
   * Titel (community-fallback 2026-10-14). Används BARA om
   * facts.artist och facts.venue båda är null — då blir titeln
   * det enda "vad" vi har. Vi presenterar den rakt av (ingen
   * omformulering, ingen LLM). Syfte: fylla 100% summary-täckning
   * på kategorier där headliner/venue saknas (community-bucketen
   * i synnerhet).
   */
  title: string | null;
}

export const EMPTY_FACTS: EventpulseFacts = {
  event_type: null,
  artist: null,
  support_act: null,
  venue: null,
  city: null,
  date: null,
  start_time: null,
  end_time: null,
  doors_time: null,
  age_limit: null,
  language: null,
  is_free: null,
  price_min_sek: null,
  price_max_sek: null,
  accessibility: null,
  organizer: null,
  title: null,
};

export interface EventpulseFactsInput {
  /** Normaliserad event-rad eller motsvarande fält. */
  start_time?: string | null;
  end_time?: string | null;
  /** category_slug från events (eller denormaliserad) */
  category_slug?: string | null;
  /** venue-namn (events → venues.name) */
  venue_name?: string | null;
  city?: string | null;
  is_free?: boolean | null;
  price_min_sek?: number | null;
  price_max_sek?: number | null;
  /** Källbeskrivning (text vi vill extrahera fakta ur). */
  raw_description?: string | null;
  /** Source-namn (för language-detektering + audit). */
  source?: string | null;
  title?: string | null;
}

export interface EventpulseFactsResult {
  facts: EventpulseFacts;
  /** Per faktumnyckel → "raw_description" | "events_row" | "venue_row" | "category" */
  provenance: Partial<Record<keyof EventpulseFacts, string>>;
}

// ─── Helpers: date / time parsing ───────────────────────────────────────────

/**
 * Extraherar YYYY-MM-DD ur en ISO timestamp. Hanterar både
 * "2026-09-12T19:30:00Z" och "2026-09-12T19:30:00+02:00".
 *
 * Returnerar datumet som **lokalt Stockholm-datum** (inte UTC) så att det
 * matchar UI:t (HomeScreen / DetailsScreen) exakt. Tidigare tog vi bara
 * datum-prefixet från ISO — det räcker för de flesta (som inte korsar
 * midnatt UTC), men datum-komponenten blir fel för events som startar
 * efter midnatt i UTC men före midnatt i Stockholm (t.ex. 23:30 UTC
 * 19 oktober → redan 01:30 20 oktober i CEST).
 */
function extractDate(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Fallback: parsa datum-prefix direkt (kan vara UTC om Intl failar).
    const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch {
    // Fallback om Intl saknar locale-data (äldre build).
    const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
}

/**
 * Extraherar HH:MM ur en ISO timestamp som **lokal Stockholm-tid**
 * (inte UTC). Detta säkerställer att summary visar samma klockslag som
 * UI:t (HomeScreen / DetailsScreen).
 *
 * Tidigare tog vi UTC-timmen direkt från ISO — det gjorde att t.ex.
 * 22:00 UTC visades som "22:00" i summary även när eventet faktiskt
 * börjar 00:00 lokal tid (CEST = UTC+2).
 *
 * Returnerar null om ISO:t är ogiltigt eller om Intl-konvertering faller.
 */
function extractTime(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Fallback till UTC-parsning.
    const m = iso.match(/T(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hh = parts.find(p => p.type === 'hour')?.value;
    const mm = parts.find(p => p.type === 'minute')?.value;
    if (!hh || !mm) return null;
    return `${hh}:${mm}`;
  } catch {
    const m = iso.match(/T(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
}

// ─── Helpers: regex-fact-extraktion från raw_description ────────────────────

/**
 * Extraherar "doors time" från svensk och engelsk text.
 * Matchar: "Dörrar 18:30", "Doors 18:30", "Doors open 18:30",
 *          "Dörrarna öppnar 18.30", "Insläpp 18:30", "Öppnar 18:30".
 *
 * Tillåter valfria ord (t.ex. "öppnar") mellan nyckelordet och tiden.
 *
 * Returnerar HH:MM (24h). null om inget matchar.
 */
export function extractDoorsTime(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  // Nyckelord (dörrar/doors/insläpp) → valfritt verb (inkl. svenska) → HH:MM|HH.MM
  // Vi använder [A-Za-zÅÄÖåäö]+ för ordet istället för \w, eftersom \w inte
  // matchar svenska tecken i alla JS-motorer även med u-flagga.
  const rx = /(?:d[öo]rrar(?:na)?|doors?|insl[äa]pp)\s+(?:[A-Za-zÅÄÖåäö]+\s+)?(\d{1,2})[:.](\d{2})/i;
  const m = text.match(rx);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Extraherar "age limit" från svensk och engelsk text.
 * Matchar: "18 år", "åldersgräns 18", "18+", "age limit 18", "21+".
 *
 * Returnerar sträng (t.ex. "18", "21", "all ages"). null om inget matchar.
 */
export function extractAgeLimit(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  // Explicit "all ages" / "fri ålder" / "alla åldrar"
  if (/(?:all\s+ages|fri\s+ålder|alla\s+åldrar|åldersgräns\s+ingen)/i.test(text)) {
    return 'all ages';
  }
  // Numerisk: "18 år", "18+", "age limit 18", "21 år"
  const rxNum = /(?:åldersgräns[: ]+|age\s*limit[: ]+|fr[åa]n\s+|over\s+|from\s+)?(\d{1,2})\s*(?:år|\+|years?)/i;
  const mNum = text.match(rxNum);
  if (mNum) {
    const age = parseInt(mNum[1], 10);
    if (age >= 0 && age <= 99) return String(age);
  }
  return null;
}

/**
 * Extraherar support act / öppningsakt från description.
 * Matchar: "Support: Artist Y", "med artist Y", "Öppnar: Y".
 *
 * Returnerar artistnamn. null om inget matchar.
 */
export function extractSupportAct(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;

  // Case-insensitive (i-flagga) så "support", "Support", "SUPPORT" alla matchar.
  //
  // Pass 1: "Support: X", "Förband: X", "Öppnar: X", "supporting act: X",
  //         "opens: X" — prefixet är ett support-nyckelord.
  const prefixRx = /(?:support(?:ing)?\s*(?:act)?|f[öo]rband|[öo]ppnar|opens?)\s*[:\-]\s*([A-ZÅÄÖ][\wåäöÅÄÖ\- ]{1,40})/i;
  const prefixMatch = text.match(prefixRx);
  if (prefixMatch) return prefixMatch[1].trim();

  // Pass 2: "Artist Y som support", "Föreställare Artist Y som support",
  //         "Y Band som förband" — nyckelordet kommer efter artistnamnet.
  // Vi matchar 1-3 versal-startade ord före "som support/förband/..." och
  // strippar sedan vanliga svenska prefix-ord (föreställare/performer).
  //
  // OBS: vi använder [A-Za-zÅÄÖåäö]+ istället för \w+ eftersom \w inte
  // matchar svenska tecken i alla JS-motorer även med u-flagga.
  // OBS: vi kräver MINST ETT helt ord (för att inte fånga bara en ensam
  //      förkortning som "X som support") men tillåter sista ordet att vara
  //      en ensam versal (t.ex. "Y" i "Artist Y").
  //
  // Struktur: [A-ZÅÄÖ][A-Za-zÅÄÖåäö]+ (\s+ [A-ZÅÄÖ][A-Za-zÅÄÖåäö]+){0,2}
  //   - Första ordet: versal + minst 1 mer bokstav (kräver att det är ett ord)
  //   - Följande 0-2 ord: versal + 0+ mer (tillåter "Y" ensamt)
  const suffixRx = /\b[A-ZÅÄÖ][A-Za-zÅÄÖåäö]+(?:\s+[A-ZÅÄÖ][A-Za-zÅÄÖåäö]*){0,2}\s+som\s+(?:support|f[öo]rband|opening\s+act|oppning)/i;
  const suffixMatch = text.match(suffixRx);
  if (suffixMatch) {
    const STRIP_PREFIX = /^(?:f[öo]reställare|performer|medverkande|artister|artist\s+)/i;
    const cleaned = suffixMatch[0]
      .replace(/\s+som\s+(?:support|f[öo]rband|opening\s+act|oppning)$/i, '')
      .replace(STRIP_PREFIX, '')
      .trim();
    return cleaned || null;
  }

  return null;
}

// ─── category_slug → event_type ─────────────────────────────────────────────

const CONCERT_SLUGS = new Set(['music', 'concert']);
const THEATER_SLUGS = new Set(['theater', 'teater']);
const STANDUP_SLUGS = new Set(['standup', 'comedy']);
const EXHIBITION_SLUGS = new Set(['art-exhibitions', 'exhibition', 'utstallning']);
const FESTIVAL_SLUGS = new Set(['festival', 'festivaler']);
const WORKSHOP_SLUGS = new Set(['workshop', 'kurser']);
const SCREENING_SLUGS = new Set(['film', 'screening', 'bio']);
const SPORT_SLUGS = new Set(['sport']);
const OTHER_SLUGS = new Set(['community', 'barn', 'food-drink']);

export function categoryToEventType(slug: string | null | undefined): EventpulseFacts['event_type'] {
  if (!slug) return null;
  const s = slug.toLowerCase().trim();
  if (CONCERT_SLUGS.has(s)) return 'concert';
  if (THEATER_SLUGS.has(s)) return 'theater';
  if (STANDUP_SLUGS.has(s)) return 'standup';
  if (EXHIBITION_SLUGS.has(s)) return 'exhibition';
  if (FESTIVAL_SLUGS.has(s)) return 'festival';
  if (WORKSHOP_SLUGS.has(s)) return 'workshop';
  if (SCREENING_SLUGS.has(s)) return 'screening';
  if (SPORT_SLUGS.has(s)) return 'sport';
  if (OTHER_SLUGS.has(s)) return 'community';
  return 'other';
}

// ─── Main: faktakonstruktion ────────────────────────────────────────────────

export function buildEventpulseFacts(input: EventpulseFactsInput): EventpulseFactsResult {
  const facts: EventpulseFacts = { ...EMPTY_FACTS };
  const provenance: EventpulseFactsResult['provenance'] = {};

  // ── event_type
  const eventType = categoryToEventType(input.category_slug);
  if (eventType) {
    facts.event_type = eventType;
    provenance.event_type = 'category';
  }

  // ── title (community-fallback 2026-10-14)
  // Sätts ALLTID om input.title finns. Används av buildEventpulseSummary
  // när artist + venue båda saknas. Aldrig input till LLM.
  if (input.title && input.title.trim().length > 0) {
    facts.title = input.title.trim();
    provenance.title = 'events_row';
  }

  // ── artist (från title via extractHeadliner)
  // Vi använder ALLTID headliner om vi får en sträng tillbaka — även när
  // extraction_hint=true (dvs titeln saknar separator). Att "Artist X" eller
  // "Beyoncé" saknar separator är inte ett tecken på att det inte är en
  // artist — extractHeadliner sätter bara hint som info till andra system.
  if (input.title) {
    const h = extractHeadliner(input.title);
    if (h.headliner && h.headliner.trim().length > 0) {
      facts.artist = h.headliner.trim();
      provenance.artist = 'events_row';
    }
  }

  // ── venue + city (från events → venues join)
  if (input.venue_name) {
    facts.venue = input.venue_name;
    provenance.venue = 'venue_row';
  }
  if (input.city) {
    facts.city = input.city;
    provenance.city = 'venue_row';
  }

  // ── date / start_time / end_time (från events.start_time/end_time ISO)
  const date = extractDate(input.start_time ?? null);
  if (date) {
    facts.date = date;
    provenance.date = 'events_row';
  }
  const startTime = extractTime(input.start_time ?? null);
  if (startTime) {
    facts.start_time = startTime;
    provenance.start_time = 'events_row';
  }
  const endTime = extractTime(input.end_time ?? null);
  if (endTime) {
    facts.end_time = endTime;
    provenance.end_time = 'events_row';
  }

  // ── is_free / price (från events.is_free + price_*)
  if (input.is_free === true) {
    facts.is_free = true;
    provenance.is_free = 'events_row';
  } else if (input.is_free === false) {
    facts.is_free = false;
    provenance.is_free = 'events_row';
  }
  if (input.price_min_sek != null && Number.isFinite(input.price_min_sek)) {
    facts.price_min_sek = input.price_min_sek;
    provenance.price_min_sek = 'events_row';
  }
  if (input.price_max_sek != null && Number.isFinite(input.price_max_sek)) {
    facts.price_max_sek = input.price_max_sek;
    provenance.price_max_sek = 'events_row';
  }

  // ── language (heuristik på raw_description; null om okänt)
  //   Heuristik: om description innehåller å/ä/ö → sv; annars null
  //   (utöka senare med bättre detektering om det behövs)
  if (input.raw_description) {
    facts.language = /[åäöÅÄÖ]/.test(input.raw_description) ? 'sv' : 'en';
    provenance.language = 'raw_description';
  }

  // ── facts från raw_description (regex) — BARA om description finns.
  //    Vi hittar inte på. Inga fält skrivs om description saknas.
  if (input.raw_description) {
    const doors = extractDoorsTime(input.raw_description);
    if (doors) {
      facts.doors_time = doors;
      provenance.doors_time = 'raw_description';
    }
    const age = extractAgeLimit(input.raw_description);
    if (age) {
      facts.age_limit = age;
      provenance.age_limit = 'raw_description';
    }
    const support = extractSupportAct(input.raw_description);
    if (support) {
      facts.support_act = support;
      provenance.support_act = 'raw_description';
    }
  }

  return { facts, provenance };
}

// ─── Source-priority för konfliktande fakta (multi-source) ──────────────────

/**
 * Source-priority för konfliktande fakta. Högre = mer trovärd.
 * Användaren kräver "deterministisk source/confidence policy".
 *
 * Mönster: confidence_v1.ts + source_readiness-tabellen. Vi hårdkodar en
 * rimlig default här; operatör kan utöka source-registry senare.
 */
export const SOURCE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  // Partner-feed-svenska API:er (vanligtvis högst kvalitet)
  'ticketmaster-se': 90,
  'eventbrite-stockholm': 85,
  'songkick-stockholm': 80,
  'spelning-se': 85,
  // Direkta venue-CMS / RSS
  'kulturhuset': 80,
  'kulturhuset-stadsteatern': 80,
  'berwaldhallen': 80,
  'berwaldhallen-tixly': 75,
  'debaser': 75,
  'folkoperan': 80,
  'sodrateatern': 75,
  'globen-3': 75,
  // Aggregator-sajter (varierande kvalitet)
  'sthlmlist': 60,
  'thatsup-stockholm-articles': 55,
  'gratisistockholm': 50,
  'gota-lejon': 70,
});

/**
 * Hjälpfunktion: välj fakta mellan konfliktande källor.
 *
 * Prioritet:
 *   1. Källa med högst `SOURCE_PRIORITY[source]`.
 *   2. Om ingen av källorna finns i priority → deterministisk: 'A' (alfabetisk).
 *   3. Om båda har samma priority → deterministisk: lägre source-namn först.
 *
 * AI får INTE välja. Detta är en hård regel.
 */
export function chooseFact<T>(options: Array<{ source: string; value: T | null }>): T | null {
  // Filtrera bort null först
  const nonNull = options.filter((o) => o.value !== null && o.value !== undefined);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return nonNull[0].value;

  // Sortera på (priority desc, source asc) — deterministiskt
  const sorted = [...nonNull].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? 0;
    const pb = SOURCE_PRIORITY[b.source] ?? 0;
    if (pa !== pb) return pb - pa; // högre priority först
    return a.source.localeCompare(b.source); // tie-break alfabetiskt
  });
  return sorted[0].value;
}

// ─── Main: summary template ─────────────────────────────────────────────────

/**
 * Format Swedish date "2026-11-14" → "14 november".
 */
export function formatSwedishDate(date: string | null): string | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const months = [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december',
  ];
  const monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  const day = parseInt(m[3], 10);
  return `${day} ${months[monthIdx]}`;
}

/**
 * Bygg eventpulse_summary från extraherade fakta. Returnerar null om
 * vi inte ens har event_type + datum (eller artist + venue) — då är
 * summary:n inte informativ nog att visas.
 *
 * Templates per typ (maven "Exempel BRA" i användarens krav):
 *   - "Konsert med X på Avicii Arena i Stockholm den 14 november.
 *      Dörrarna öppnar 18.30 och konserten börjar 19.30. Artist Y medverkar
 *      som support."
 *   - "Standup med X på Norra Brunn i Stockholm den 12 november.
 *      Föreställningen börjar 20.00 och har 18-årsgräns."
 *
 * Title-fallback (2026-10-14): Om artist + venue båda saknas för
 * ALLA event-typer OCH title finns → använd titeln som "vad". Detta
 * fyller 100% summary-täckning även när venue-resolution är trasig
 * (t.ex. "왕의 정원") eller artist inte extraheras. För music/concert
 * slår title-fallback sällan in eftersom MusicBrainz normalt ger artist;
 * för theatre-drama, community, exhibition m.fl. är titeln ofta det
 * enda "vad" vi har — och det räcker.
 */
export function buildEventpulseSummary(facts: EventpulseFacts): string | null {
  // Vi kräver MINST event_type + date för att summary ska vara värd att visa.
  if (!facts.event_type || !facts.date) return null;

  // Artist + venue krävs, ELLER title som fallback (alla typer från 2026-10-14).
  const hasArtistOrVenue = !!(facts.artist || facts.venue);
  if (!hasArtistOrVenue && !facts.title) return null;

  const swedishDate = formatSwedishDate(facts.date);
  const whereParts: string[] = [];
  if (facts.venue) whereParts.push(facts.venue);
  if (facts.city) whereParts.push(facts.city);
  const where = whereParts.length ? whereParts.join(' i ') : '';

  // Huvudrad per event_type
  let main = '';
  const artistPrefix = facts.artist ? `${facts.artist}` : '';

  if (facts.event_type === 'concert') {
    main = artistPrefix
      ? `Konsert med ${artistPrefix}`
      : (facts.title ?? `Konsert`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'theater') {
    main = artistPrefix
      ? `Teater med ${artistPrefix}`
      : (facts.title ?? `Teater`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'standup') {
    main = artistPrefix
      ? `Standup med ${artistPrefix}`
      : (facts.title ?? `Standup`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'exhibition') {
    main = artistPrefix
      ? `Utställning med ${artistPrefix}`
      : (facts.title ?? `Utställning`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` med start ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'festival') {
    main = artistPrefix
      ? `Festival med ${artistPrefix}`
      : (facts.title ?? `Festival`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'workshop') {
    main = artistPrefix
      ? `Workshop med ${artistPrefix}`
      : (facts.title ?? `Workshop`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'screening') {
    main = artistPrefix
      ? `Visning med ${artistPrefix}`
      : (facts.title ?? `Visning`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else if (facts.event_type === 'sport') {
    main = artistPrefix
      ? `Sportevenemang med ${artistPrefix}`
      : (facts.title ?? `Sportevenemang`);
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  } else {
    // community / other
    // Tre nivåer (2026-10-14): artist → title → generiskt "Evenemang"
    if (artistPrefix) {
      main = `Evenemang med ${artistPrefix}`;
    } else if (facts.title) {
      // Title-fallback: använd titeln rakt av som "vad".
      // Vi vill inte omformulera (ingen LLM, ingen påhittad info) — bara
      // presentera titeln i ett sammanhang som fungerar i UI:t.
      main = `${facts.title}`;
    } else {
      main = `Evenemang`;
    }
    if (where) main += ` på ${where}`;
    if (swedishDate) main += ` den ${swedishDate}`;
    main += '.';
  }

  // ── Praktiska detaljer (max 2 meningar för att hålla det konciskt)
  const practical: string[] = [];
  if (facts.doors_time) {
    practical.push(`Dörrarna öppnar ${facts.doors_time}.`);
  }
  if (facts.start_time) {
    // Olika formulering beroende på event-typ
    const startPrefix = facts.event_type === 'concert'
      ? 'Konserten börjar'
      : facts.event_type === 'standup'
      ? 'Föreställningen börjar'
      : facts.event_type === 'theater'
      ? 'Föreställningen börjar'
      : 'Starttid';
    practical.push(`${startPrefix} ${facts.start_time}.`);
  }
  if (facts.end_time && !facts.start_time) {
    practical.push(`Slutar ${facts.end_time}.`);
  }
  if (facts.support_act) {
    practical.push(`${facts.support_act} medverkar som support.`);
  }
  if (facts.age_limit) {
    if (facts.age_limit === 'all ages') {
      practical.push(`Fri ålder.`);
    } else {
      practical.push(`${facts.age_limit}-årsgräns.`);
    }
  }
  if (facts.is_free === true) {
    practical.push(`Gratis inträde.`);
  } else if (facts.is_free === false && facts.price_min_sek != null && facts.price_max_sek != null) {
    if (facts.price_min_sek === facts.price_max_sek) {
      practical.push(`Biljett ${facts.price_min_sek} kr.`);
    } else {
      practical.push(`Biljetter ${facts.price_min_sek}–${facts.price_max_sek} kr.`);
    }
  } else if (facts.is_free === false && facts.price_min_sek != null) {
    practical.push(`Från ${facts.price_min_sek} kr.`);
  }

  // Kombinera — huvudrad först, sedan praktiska detaljer (max 3 för att
  // undvika "lång utdata"-anti-mönstret).
  const detailSentences = practical.slice(0, 3);
  return [main, ...detailSentences].join(' ');
}

// ─── Test-only exports ──────────────────────────────────────────────────────

export const __test__ = {
  extractDate,
  extractTime,
  extractDoorsTime,
  extractAgeLimit,
  extractSupportAct,
  categoryToEventType,
  formatSwedishDate,
  SOURCE_PRIORITY,
  CONCERT_SLUGS,
  THEATER_SLUGS,
  STANDUP_SLUGS,
  EXHIBITION_SLUGS,
  FESTIVAL_SLUGS,
  WORKSHOP_SLUGS,
  SCREENING_SLUGS,
  SPORT_SLUGS,
  OTHER_SLUGS,
};