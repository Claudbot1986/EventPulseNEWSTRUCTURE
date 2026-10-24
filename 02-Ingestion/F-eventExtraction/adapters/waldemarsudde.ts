/**
 * Waldemarsudde-adaptern (waldemarsudde.se) — Prins Eugens Waldemarsudde.
 *
 * VARFÖR ADAPTER (mätt 2026-10-24 mot den riktiga sajten):
 *
 * 1. BOT-VÄGG. Sajten ligger bakom SiteGround:s "sgcaptcha". Varje vanlig
 *    HTTP-hämtning (även med browser-UA och Accept: application/json) svarar
 *    **HTTP 202** med en captcha-redirect:
 *
 *      <meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=…">
 *
 *    ScrapingBee (premium-proxy) går förbi: mätt — premium-only gav
 *    1 156 793 B ren JSON för /wp-json/wp/v2/activity?per_page=100.
 *
 * 2. LISTNINGSSIDAN BÄR INGA EVENTS. /aktiviteter/ renderar (ScrapingBee
 *    stealth, 153 kB) men korten laddas via AJAX — den renderade HTML:en
 *    innehåller **0 datum** (mätt: noll "D månad"-mönster i texten). Varken
 *    universalheuristiken eller någon render hittar alltså något.
 *
 * 3. DATUMEN LIGGER I PROSA. WordPress har en egen post-typ `activity`
 *    (rest_base "activity"). Varje post har `title` (aktivitetens namn),
 *    `link` (permalink) och `content.rendered` där evenemangets datum står
 *    som löptext: "Hem Höstlov för skollediga barn … **Tisdag 27 oktober
 *    kl 13.00-15.00** Välkomna till Waldemarsudde …". Postens `date` är
 *    PUBLICERINGSDATUM, inte evenemangsdatum — det får aldrig användas som
 *    event-datum.
 *
 * 4. ÅRET BEVISAS AV VECKODAGEN. Texten innehåller veckodagen ("Tisdag
 *    27 oktober"), så året kan bevisas i stället för att gissas: räkna ut
 *    vilket år som ger just den veckodagen. Mätt på de 500 nyaste posterna:
 *    för ALLA matchade poster finns ett år där veckodagen stämmer. En post
 *    där ingen kandidat stämmer kastas — hellre inget än fel.
 *
 * 5. FORMATVARIANTER (mätt på 500 poster, 2026-10-24):
 *
 *      "Tisdag 27 oktober kl 13.00-15.00"     veckodag + månad + kl
 *      "Söndag 11 oktober 2026 Kl. 13.00"     året står i texten
 *      "Söndag 29 november, kl. 10.00"        komma före kl
 *      "Onsdag15 juli kl. 14.00"              inget mellanrum veckodag/dag
 *      "8 november kl 13-16"                  INGEN veckodag
 *      "Torsdag 13/8, kl.13.00"               numeriskt D/M
 *      "Friday, August 15 at 1 p.m."           ENGELSKA poster
 *      "Söndag 2 juni"                        datum UTAN tid
 *
 *    De engelska posterna (14 av 500) och posterna utan tid (7 av 500) är
 *    egna format och hanteras var för sig.
 *
 * 6. FLERDAGARSAKTIVITETER LÄMNAS BORT. "Tre lördagar: 29 augusti, 26
 *    september och 24 oktober kl. 9.30-16.00" och "Tisdag – torsdag 11–13
 *    augusti, kl. 13.00 – 16.00" ger INTE ett event — en kurs med tre
 *    datum ska inte bli ett event med ett godtyckligt datum. Mätt: exakt
 *    de tre flerdagarskurserna på sida 1 av 100.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST waldemarsudde.se.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'waldemarsudde';
const HOSTS = new Set(['waldemarsudde.se', 'www.waldemarsudde.se']);

const VENUE = 'Prins Eugens Waldemarsudde';
const ADDRESS = 'Karlavägen 6, 114 35 Stockholm';
const CITY = 'Stockholm';
const ORGANIZER = 'Prins Eugens Waldemarsudde';
const CATEGORY = 'Utställning';

/** Veckodagar på svenska — index 0 = måndag. */
const WEEKDAYS = [
  'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag',
] as const;

/** Veckodagar på engelska — index 0 = måndag. */
const WEEKDAYS_EN = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

const MONTHS_EN: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Svenskt datum med tid.
 * Grupper: 1 veckodag (valfri), 2 dag, 3 månad, 4 år (valfritt),
 * 5 timme, 6 minut, 7 sluttid timme, 8 sluttid minut.
 */
const SW_WITH_TIME_RX =
  /(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)?\s*(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?\s*,?\s*kl\.?\s*(\d{1,2})(?:[.:](\d{2}))?(?:\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?)?/i;

/**
 * Svenskt numeriskt datum med tid: "Torsdag 13/8, kl.13.00".
 * Grupper: 1 veckodag, 2 dag, 3 månad, 4 timme, 5 minut, 6 sluttid timme,
 * 7 sluttid minut.
 */
const SW_NUMERIC_RX =
  /(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)?\s*(\d{1,2})\/(\d{1,2})\s*,?\s*kl\.?\s*(\d{1,2})(?:[.:](\d{2}))?(?:\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?)?/i;

/**
 * Engelskt datum med tid: "Friday, August 15 at 1 p.m.", "… at 13:00".
 * Grupper: 1 veckodag, 2 månad, 3 dag, 4 år (valfritt), 5 timme, 6 minut,
 * 7 am/pm.
 */
const EN_WITH_TIME_RX =
  /(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:\s+(\d{4}))?\s+at\s+(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i;

/**
 * Svenskt datum UTAN tid: "Söndag 2 juni".
 * Grupper: 1 veckodag, 2 dag, 3 månad, 4 år (valfritt).
 *
 * En veckodag KRAVS här — utan den går året inte att bevisa.
 */
const SW_NO_TIME_RX =
  /(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\s+(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?/i;

/**
 * Ett datum i texten: dag + månad, månad + dag, eller D/M.
 * Används för att upptäcka datumserier ("29 augusti, 26 september och …").
 */
const DATE_TOKEN_RX =
  /\b\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b/gi;

/** "11–" eller "4 – " direkt före datumet = ett dagsintervall. */
const RANGE_BEFORE_RX = /\d{1,2}\s*[-–—]\s*$/;

/** Hur långt bakåt vi tittar efter flera datum i samma mening. */
const ENUMERATION_WINDOW = 60;

/**
 * Hur långt in i löptexten ett datum utan tid får ligga.
 *
 * Mätt (2026-10-24, 500 poster): 375 av 381 datumfraser ligger före
 * tecken 120 — de står direkt efter postens titel. Sex ligger längre in
 * och är då brödtext. Eftersom ett datum utan tid annars är svårt att
 * skilja från en mening ("…vi träffas den 5 maj…") krävs denna gräns.
 */
const NO_TIME_MAX_POSITION = 120;

/** Ett WP `activity`-objekt, så lite som behövs. */
export interface WaldemarsuddeActivity {
  id?: number;
  date?: string;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
}

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > 0 ? value : null;
}

/** Tolkar ett svar som en lista WordPress-aktiviteter. */
export function parseActivities(body: string): WaldemarsuddeActivity[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is WaldemarsuddeActivity =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
}

/** Ett datum som hittats i löptexten. */
interface DateCandidate {
  /** 0 = måndag … 6 = söndag. null = ingen veckodag i texten. */
  weekday: number | null;
  day: number;
  month: number;
  /** År angivet i texten. */
  year: number | null;
  hours: number | null;
  minutes: number | null;
  endHours: number | null;
  endMinutes: number | null;
  /** Positionen i texten där datumet börjar. */
  index: number;
  /** Sant om formatet bär en tid. */
  hasTime: boolean;
}

/**
 * Året bevisas av veckodagen: vi räknar ut vilket år som ger den angivna
 * veckodagen, i närheten av publiceringsåret.
 *
 * Kandidater är publiceringsåret och året efter. Träffar båda (veckan
 * upprepas då och då) vinner den som inte är före publiceringsdatumet — ett
 * evenemang publiceras inte efter att det har varit.
 */
export function resolveYear(
  weekday: number,
  month: number,
  day: number,
  publishDate: Date
): number | null {
  const publishYear = publishDate.getUTCFullYear();
  const matching: number[] = [];

  for (const year of [publishYear, publishYear + 1]) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    // JS getUTCDay: 0 = söndag. VECKODAGAR: 0 = måndag.
    if (date.getUTCDay() === (weekday + 1) % 7) matching.push(year);
  }

  if (matching.length === 0) return null;
  if (matching.length === 1) return matching[0];
  return (
    matching.find((year) => new Date(Date.UTC(year, month - 1, day)) >= publishDate) ??
    matching[0]
  );
}

/**
 * Året när texten saknar både år och veckodag ("8 november kl 13-16").
 *
 * Evenemanget kan inte ha varit FÖRE att det publicerades, så det första
 * datumet som ligger på/efter publiceringsdatumet används. Året är därmed
 * inte bevisat — det markeras som gissat i signalerna.
 */
export function resolveUnprovenYear(
  month: number,
  day: number,
  publishDate: Date
): number | null {
  const publishYear = publishDate.getUTCFullYear();
  for (const year of [publishYear, publishYear + 1]) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    if (date >= publishDate) return year;
  }
  return null;
}

/** Stämmer veckodagen med datumet? */
function weekdayMatches(
  weekday: number,
  year: number,
  month: number,
  day: number
): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  // JS getUTCDay: 0 = söndag. VECKODAGAR: 0 = måndag.
  return date.getUTCDay() === (weekday + 1) % 7;
}

/** Samlar alla datumkandidater i texten, sorterade bäst först. */
function collectCandidates(text: string): DateCandidate[] {
  const candidates: DateCandidate[] = [];

  const sw = SW_WITH_TIME_RX.exec(text);
  if (sw) {
    candidates.push({
      weekday: sw[1] ? WEEKDAYS.indexOf(sw[1].toLowerCase()) : null,
      day: Number(sw[2]),
      month: MONTHS[sw[3].toLowerCase()] ?? 0,
      year: sw[4] ? Number(sw[4]) : null,
      hours: Number(sw[5]),
      minutes: sw[6] ? Number(sw[6]) : null,
      endHours: sw[7] !== undefined ? Number(sw[7]) : null,
      endMinutes: sw[8] !== undefined ? Number(sw[8]) : null,
      index: sw.index,
      hasTime: true,
    });
  }

  const numeric = SW_NUMERIC_RX.exec(text);
  if (numeric) {
    candidates.push({
      weekday: numeric[1] ? WEEKDAYS.indexOf(numeric[1].toLowerCase()) : null,
      day: Number(numeric[2]),
      month: Number(numeric[3]),
      year: null,
      hours: Number(numeric[4]),
      minutes: numeric[5] ? Number(numeric[5]) : null,
      endHours: numeric[6] !== undefined ? Number(numeric[6]) : null,
      endMinutes: numeric[7] !== undefined ? Number(numeric[7]) : null,
      index: numeric.index,
      hasTime: true,
    });
  }

  const en = EN_WITH_TIME_RX.exec(text);
  if (en) {
    let hours = Number(en[5]);
    const meridiem = en[7]?.toLowerCase() ?? '';
    if (meridiem.startsWith('p') && hours < 12) hours += 12;
    if (meridiem.startsWith('a') && hours === 12) hours = 0;
    candidates.push({
      weekday: WEEKDAYS_EN.indexOf(en[1].toLowerCase()),
      day: Number(en[3]),
      month: MONTHS_EN[en[2].toLowerCase()] ?? 0,
      year: en[4] ? Number(en[4]) : null,
      hours,
      minutes: en[6] ? Number(en[6]) : null,
      endHours: null,
      endMinutes: null,
      index: en.index,
      hasTime: true,
    });
  }

  const noTime = SW_NO_TIME_RX.exec(text);
  if (noTime && noTime.index <= NO_TIME_MAX_POSITION) {
    candidates.push({
      weekday: WEEKDAYS.indexOf(noTime[1].toLowerCase()),
      day: Number(noTime[2]),
      month: MONTHS[noTime[3].toLowerCase()] ?? 0,
      year: noTime[4] ? Number(noTime[4]) : null,
      hours: null,
      minutes: null,
      endHours: null,
      endMinutes: null,
      index: noTime.index,
      hasTime: false,
    });
  }

  // Fördel med tid framför utan tid, sedan den som ligger tidigast.
  return candidates.sort((a, b) => {
    if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1;
    return a.index - b.index;
  });
}

/**
 * Är datumet en del av en flerdagarsaktivitet?
 *
 * Mätta exempel (2026-10-24) som INTE ska bli ett event med ett godtyckligt
 * datum:
 *
 *   "Tisdag – torsdag 11–13 augusti, kl. 13.00 – 16.00"  (dagsintervall)
 *   "Tisdag – torsdag 4 – 6 augusti, kl. 13.00 – 16.00"   (dagsintervall)
 *   "Tre lördagar: 29 augusti, 26 september och 24 oktober kl. 9.30-16.00"
 *                                                          (datumserie)
 *
 * Skyddet tittar bakåt i texten: en dagsintervall direkt före datumet, eller
 * ett annat datum inom kort räckvidd före det, betyder att datumet hör till
 * en flerdagarsaktivitet.
 */
export function isMultiDate(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - ENUMERATION_WINDOW), matchIndex);
  if (RANGE_BEFORE_RX.test(before)) return true;
  DATE_TOKEN_RX.lastIndex = 0;
  return DATE_TOKEN_RX.test(before);
}

/** Ett event-datum som går att lita på. */
export interface WaldemarsuddeEventDate {
  date: string;
  time?: string;
  endTime?: string;
  /**
   * Sant om året är bevisat (år i texten eller veckodag som stämmer).
   * Fals = året gissat från publiceringsdatumet.
   */
  yearProven: boolean;
}

/**
 * Löser ut event-datumet ur en aktivitets löptext.
 *
 * Returnerar null om texten inte bär ett entydigt datum — då ska posten
 * inte ge något event (hellre inget än fel).
 */
export function parseEventDate(
  text: string,
  publishDate: Date
): WaldemarsuddeEventDate | null {
  for (const candidate of collectCandidates(text)) {
    if (!candidate.month || candidate.day < 1 || candidate.day > 31) continue;
    if (candidate.hours !== null && (candidate.hours > 23 || candidate.minutes! > 59)) continue;
    if (isMultiDate(text, candidate.index)) continue;

    let year: number | null = null;
    let yearProven = false;

    if (candidate.year !== null) {
      year = candidate.year;
      // Året i texten ska stämma med veckodagen om båda anges.
      if (candidate.weekday !== null && !weekdayMatches(candidate.weekday, year, candidate.month, candidate.day)) {
        continue;
      }
      yearProven = true;
    } else if (candidate.weekday !== null) {
      year = resolveYear(candidate.weekday, candidate.month, candidate.day, publishDate);
      if (!year) continue;
      yearProven = true;
    } else {
      year = resolveUnprovenYear(candidate.month, candidate.day, publishDate);
      if (!year) continue;
    }

    let time: string | undefined;
    if (candidate.hours !== null) {
      const minutes = candidate.minutes ?? 0;
      time = `${String(candidate.hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    let endTime: string | undefined;
    if (candidate.endHours !== null) {
      const endMinutes = candidate.endMinutes ?? 0;
      if (candidate.endHours <= 23 && endMinutes <= 59) {
        endTime = `${String(candidate.endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
      }
    }

    return {
      date: `${year}-${String(candidate.month).padStart(2, '0')}-${String(candidate.day).padStart(2, '0')}`,
      time,
      endTime,
      yearProven,
    };
  }

  return null;
}

/** Ren text ur WordPress `content.rendered`. */
export function extractPlainText(html: string): string {
  const $ = cheerio.load(html);
  return ($.root().text() || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Avkodar WordPress `title.rendered`.
 *
 * Mätt 2026-10-24: titlarna kommer som HTML-escaped text med entiteter —
 * "Skapa &amp; skåla &#8211; collage". Utan avkodning hamnar entiteterna
 * rakt in i databasen.
 */
export function decodeHtml(html: string): string {
  const $ = cheerio.load(html, null, false);
  return ($.text() || '').replace(/\s+/g, ' ').trim();
}

/**
 * Bygger en rad ur en aktivitet. Returnerar null om posten inte bär ett
 * entydigt event-datum.
 */
export function toEvent(
  activity: WaldemarsuddeActivity,
  source: string
): ParsedEvent | null {
  const title = clean(decodeHtml(activity.title?.rendered ?? ''));
  const contentHtml = activity.content?.rendered ?? '';
  if (!title || !contentHtml) return null;

  const publishDate = new Date(activity.date ?? '');
  if (Number.isNaN(publishDate.getTime())) return null;
  const publishYear = publishDate.getUTCFullYear();
  if (publishYear < 2000 || publishYear > 2100) return null;

  const text = extractPlainText(contentHtml);
  const parsed = parseEventDate(text, publishDate);
  if (!parsed) return null;

  const url = activity.link ?? `https://waldemarsudde.se/aktiviteter/${activity.slug ?? ''}`;

  try {
    return ParsedEventSchema.parse({
      title,
      date: parsed.date,
      time: parsed.time,
      endTime: parsed.endTime,
      venue: VENUE,
      address: ADDRESS,
      city: CITY,
      description: clean(text),
      url,
      organizer: ORGANIZER,
      category: CATEGORY,
      source,
      sourceUrl: url,
      confidence: {
        score: parsed.yearProven ? 0.7 : 0.62,
        hasTitle: true,
        hasDate: true,
        hasVenue: true,
        hasUrl: true,
        hasDescription: true,
        hasTicketInfo: false,
        signals: [
          'waldemarsudde-wp-activity',
          parsed.yearProven
            ? `veckodag-bevisad:${parsed.date}`
            : `ar-gissat-fran-publicering:${parsed.date}`,
          `publicerad:${activity.date?.slice(0, 10) ?? 'okand'}`,
        ],
      },
    });
  } catch {
    return null;
  }
}

export interface WaldemarsuddeExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'waldemarsudde-wp-activity' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): WaldemarsuddeExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const activities = parseActivities(html);
  if (activities.length === 0) return { showUrls: [], events: [], method: 'none' };

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();

  for (const activity of activities) {
    const event = toEvent(activity, source);
    if (!event) continue;
    const key = `${event.title}|${event.date}|${event.time ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [], events, method: 'waldemarsudde-wp-activity' };
}
