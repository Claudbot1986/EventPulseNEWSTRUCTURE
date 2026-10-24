/**
 * UNIVERSAL EVENT EXTRACTOR v2 — WORLD'S BEST SCRAPER
 *
 * Comprehensive multi-pass extraction engine for Swedish event sites.
 * NO AI — pure heuristic + structured data extraction.
 *
 * Extraction priority (all run, results merged + deduped):
 *
 * PHASE 1 — Structured Data (highest precision)
 *   A1. JSON-LD (schema.org/Event)
 *   A2. Microdata (schema.org/Event in DOM)
 *
 * PHASE 2 — Embedded JavaScript Data (extremely common on Swedish/German sites)
 *   B1. window.__INITIAL_STATE__ = JSON.parse("...")
 *   B2. __NEXT_DATA__ (Next.js pages)
 *   B3. window.__STATE__ / window.INITIAL_DATA / window.EVENTS_DATA
 *   B4. AppRegistry.registerInitialState (SiteVision/React Swedish sites)
 *   B5. Large <script> blocks with "events": [...] or eventList [...]
 *   B6. JSON arrays in script with trailing commas
 *
 * PHASE 3 — HTML Heuristics (always run, no artificial threshold)
 *   C1. Rich event card extraction — expanded selector universe
 *   C2. <time datetime> anchor extraction — grouped with nearby title/link/venue/image
 *   C3. Swedish relative date parsing (Imorgon, I dag, Onsdag 15 maj)
 *   C4. ISO date + URL anchor grouping
 *
 * Normalization: ALL outputs → ParsedEvent (see schema.ts)
 *
 * Usage:
 *   import { extractEvents } from './universal-extractor';
 *   const result = extractEvents(html, sourceId, baseUrl);
 */

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { z } from 'zod';
import {
  ParsedEventSchema,
  type ParsedEvent,
  ExtractionConfidenceSchema,
} from './schema';
import { detectCategoryFromContainerClass } from './categoryKeywords.js';
import { runAdapters } from './adapters/index.js';
import { findKlockanInText } from '../lib/swedishTimeText.js';
import { isNavigationTitle } from './navigationTitles.js';
import { pickTitleCandidate } from './dateOnlyTitles.js';
import { dedupeEvents, ALT_TEXT_TITLE_SIGNAL } from './eventDedup.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractResult {
  events: ParsedEvent[];
  rawCount: number;
  parseErrors: string[];
  sourceUrl: string;
  methodsUsed: string[];
  methodBreakdown: Record<string, number>;
  /**
   * Namnet på den site-adapter som matchade URL:en — även om den inte
   * hittade något.
   *
   * 2026-10-24: utan detta kan ingen kallare skilja på "ingen adapter
   * äger den här URL:en" och "sajtens egen läsare säger att det är tomt".
   * Det behövs för regeln "källan lever men har inget att leverera"
   * (C-gatens exitReason SITE_ADAPTER_EMPTY).
   */
  adapterMatched?: string;
}

// ─── Date Parsing ────────────────────────────────────────────────────────────

const SWE_MONTH_MAP: Record<string, string> = {
  januari:'01',februari:'02',mars:'03',april:'04',maj:'05',juni:'06',
  juli:'07',augusti:'08',september:'09',oktober:'10',november:'11',december:'12',
  jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
  sep:'09',okt:'10',nov:'11',dec:'12',
};

const SWE_WEEKDAY_MAP: Record<string, string> = {
  måndag:'01',tisdag:'02',onsdag:'03',torsdag:'04',fredag:'05',
  lördag:'06',söndag:'07',mandag:'01',tirsdag:'02',
  lordag:'06',sondag:'07',
};

/**
 * Svenska månadsnamn som regex-alternativ.
 *
 * De äldre mönstren i den här filen har sina egna literaler — de lämnas
 * orörda eftersom en sammanslagning skulle röra gruppnumreringen. Nya
 * mönster använder den här konstanten.
 */
const SWE_MONTH_ALT =
  'januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|' +
  'jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec';

/**
 * Negativ lookahead: ett sifferpar får INTE tolkas som "dag/månad" när ett
 * svenskt månadsnamn följer direkt efter. Då är det ett datumintervall
 * ("12-14 januari"), inte "14 december".
 */
const SWE_MONTH_FOLLOWS_LOOKAHEAD = `(?!\\s*(?:${SWE_MONTH_ALT})\\b)`;

/**
 * Ett månadsnamn måste vara ett HELT ord — "mar" i "Maria" är inte mars,
 * "jul" i "Julia" är inte juli, "jan" i "Janne" är inte januari.
 *
 * Efter månadsnamnet får därför inte komma en bokstav. Siffror är OK:
 * "maj2026" ska fortfarande ge år 2026.
 *
 * Bevis (Generalization Protection Rule — General, samma regel på flera
 * domäner): dn-kalendariet ("Maria Larkman" + "… lördag den 24/10 kl 12-17")
 * lästes som intervallet 12–17 MARS. Samma felform finns i svenska
 * namnlistor överallt: Julia, Janne, Maj, Sep.
 */
const SWE_MONTH_NOT_LETTER = `(?![a-zåäö])`;

const DATE_PATTERNS = [
  // ISO 8601 full
  { rx: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/, fmt: (m: string) => m.split('T')[0] },
  // ISO date only
  { rx: /(\d{4}-\d{2}-\d{2})/, fmt: (m: string) => m },
  // Swedish: 25 mars 2025 / 25 mar 2025
  { rx: /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i,
    fmt: function (day: string, mon: string, year: string): string {
      const monthNum = SWE_MONTH_MAP[(mon || '').toLowerCase()] ?? '01';
      const dayPadded = (day || '01').padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  },
  // European: 25/03/2025 or 25.03.2025 (day-first, for SE context)
  { rx: /(\d{1,2})[/\.](\d{1,2})[/\.](\d{4})/,
    fmt: (_: string, a: string, b: string, year: string) => {
      const m = parseInt(b) > 12 ? a : b;
      const d = parseInt(b) > 12 ? b : a;
      return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
  },
  // European short: 25/03 or 25-03 (no year — common in calendar grids, assumes current year)
  //
  // 2026-10-24 — negativ lookahead: ett sifferpar får INTE läsas som
  // "dag/månad" när ett svenskt månadsnamn följer direkt efter ("12-14
  // januari" är ett INTERVALL, inte "14 december").
  { rx: new RegExp(`(\\d{1,2})[/\\-](\\d{1,2})(?!\\d)${SWE_MONTH_FOLLOWS_LOOKAHEAD}`),
    fmt: (_: string, a: string, b: string) => {
      // If a > 12, a is day; else b > 12 → b is day; else default SE (a=day, b=month)
      let day: string, month: string;
      if (parseInt(a) > 12) { day = a; month = b; }
      else if (parseInt(b) > 12) { day = b; month = a; }
      else { day = a; month = b; }
      const year = new Date().getFullYear();
      return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    }
  },
];

const TIME_RX = /\b(\d{1,2}):(\d{2})(?::\d{2})?/;

function getToday(): Date {
  return new Date();
}

/**
 * Sant om sidan är en ARKIV-sida med tidigare evenemang.
 *
 * På sådana sidor får ett årslöst datum inte få ett år infererat — då
 * skulle arkivet vändas till nästa år och skapa händelser som aldrig
 * inträffar. Bevis: nojesfabriken.se/nojeskalendern/tidigare-evenemang/
 * är C0-vinnaren för just den källan (densitet 1525) och innehåller bara
 * passerade evenemang.
 */
function isArchiveContext($: cheerio.CheerioAPI, baseUrl: string): boolean {
  try {
    if (ARCHIVE_MARKER_RX.test(baseUrl)) return true;
  } catch { /* ogiltig url — ignorera */ }
  const heading = $('h1').first().text().trim();
  return heading.length > 0 && heading.length < 120 && ARCHIVE_MARKER_RX.test(heading);
}

/**
 * Svenskt datum UTAN år: "23 okt", "6 nov", "24 okt lördag".
 *
 * Negativ lookahead: får INTE matcha när ett år följer ("23 okt 2026") —
 * då ska den vanliga årsmönstret gälla.
 *
 * Lookbehind `(?<!\d)`: dagen får INTE vara de två sista siffrorna i ett
 * ÅR. Utan det matchar "...Through March 2027" + "Sep 30, 2026" som
 * "27 Sep" — ett påhittat datum från en nyhetsrubriks publiceringsår.
 * Bevis: rustourismnews.com (nyhetssida, 2 skräpevents före fixen).
 */
const SWE_DATE_NO_YEAR_RX =
  /(?<!\d)(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec)\b(?!\s*,?\s*\d{4})/i;

/**
 * Markörer för sidor med TIDIGARE evenemang. På sådana sidor får ett
 * årslöst datum INTE få ett år infererat — annars vänder vi arkivet
 * till nästa år och skapar händelser som aldrig inträffar.
 */
const ARCHIVE_MARKER_RX =
  /\b(tidigare|föregående|föregående|previous|past|arkiv|archive|gamla|utgångna|avslutade|finished)\b/i;

/** ISO-datum (YYYY-MM-DD) → null om det inte är ett giltigt datum. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Sant om "YYYY-MM-DD" är ett verkligt datum (t.ex. 31 feb är det inte). */
function isValidIsoDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/**
 * "HH:MM" från timme/minut — undefined om tiden inte är giltig.
 *
 * Bevis: dansenshus.se gav "35:54" (en URL-fragment-tid), och
 * tekniskamuseet.se gav "00:00" ur "0-00". Ett ogiltigt klockslag ska
 * inte skrivas som event-tid.
 */
function formatTime(hour: string, minute: string): string | undefined {
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  if (h < 0 || h > 23 || m < 0 || m > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Sant om "HH:MM" är en giltig tid. */
function isValidTime(value: string): boolean {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Tolka ett svenskt datum UTAN år ("23 okt") som NÄRMASTE framtida
 * förekomst — samma semantik som veckodags-regeln ovan ("måndag" → nästa
 * måndag). Datumet i framtiden i år → detta år. Datumet redan förbi →
 * nästa år.
 *
 * Varför: 2026-10-24 — svenska venue-kalendrar visar ofta "24 okt" utan
 * år. Utan den här tolkningen ger de källorna NOLL events.
 * Bevis (Generalization Protection Rule, General): 4 orelaterade domäner
 * visar egenstående evenemangsdatum utan år —
 *   nojesfabriken.se ("23 okt"), scalateatern.se ("24 okt lördag 19:30"),
 *   dif.se ("lör 24 okt 17:30"), junibacken.se ("23 Okt").
 *
 * @param now Injicerbar "idag" — gör regeln testbar utan att frysa
 *            klockan i testet.
 */
export function parseSwedishMonthDay(
  day: string,
  mon: string,
  now: Date = getToday()
): string | null {
  const monthNum = SWE_MONTH_MAP[(mon || '').toLowerCase()];
  if (!monthNum) return null;
  const d = parseInt(day, 10);
  if (!Number.isFinite(d) || d < 1 || d > 31) return null;

  const today = toIsoDate(now);
  const pad = (n: number) => String(n).padStart(2, '0');

  let iso = `${now.getUTCFullYear()}-${monthNum}-${pad(d)}`;
  if (!isValidIsoDate(iso)) return null;
  if (iso < today) {
    iso = `${now.getUTCFullYear() + 1}-${monthNum}-${pad(d)}`;
    if (!isValidIsoDate(iso)) return null;
  }
  return iso;
}

/**
 * Året för ett ÅRSLÖST datumintervall ("23-28 oktober").
 *
 * Utgår från SLUTDAGEN: intervallet ska fortfarande kunna pågå. Den 26
 * oktober ska "23-28 oktober" alltså bli 2026 (pågår just nu), inte 2027.
 * Startdagen-baserad inferens (parseSwedishMonthDay) skulle hoppa ett år
 * framåt och därmed tappa ett pågående evenemang helt.
 *
 * Bevis (regression på korpus, 2026-10-24):
 *   dn-kalendariet "23–28 oktober" → 2026-10-23..2026-10-28
 *   (start-dag-baserat inferens gav 2027-10-23, dvs. evenemanget försvann)
 */
function inferRangeYear(monthNum: string, endDay: number, now: Date): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = toIsoDate(now);
  const thisYear = now.getUTCFullYear();

  const endThisYear = `${thisYear}-${monthNum}-${pad(endDay)}`;
  if (isValidIsoDate(endThisYear) && endThisYear >= today) return thisYear;

  const nextYear = thisYear + 1;
  const endNextYear = `${nextYear}-${monthNum}-${pad(endDay)}`;
  if (isValidIsoDate(endNextYear)) return nextYear;

  return thisYear;
}

/**
 * Svenskt datumINTERVALL: "12-14 januari 2027", "3–5 maj", "12/13-14 mars".
 *
 * Lookbehind `(?<!\d)`: startdagen får inte vara de två sista siffrorna i
 * ett år (samma skydd som SWE_DATE_NO_YEAR_RX).
 *
 * `\w*?` är LAT: det äter inte siffrorna i året ("maj2026" ska ge år 2026,
 * inte ett årslöst "maj"). Årsgruppen är valfri — därför görs två passager
 * (med år först, se parseSwedishDateRange).
 */
const SWE_DATE_RANGE_RX = new RegExp(
  `(?<!\\d)(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s+(${SWE_MONTH_ALT})${SWE_MONTH_NOT_LETTER}\\w*?(?:\\s*[.,]?\\s*(\\d{4}))?`,
  'i',
);

/**
 * Global variant av SWE_DATE_RANGE_RX — behövs för att hitta det FÖRSTA
 * ÅRSLÖSA intervallet i en text där ett med år kan ligga före.
 * lastIndex nollställs före varje skanning (se parseSwedishDateRangeWithoutYear).
 */
const SWE_DATE_RANGE_SCAN_RX = new RegExp(SWE_DATE_RANGE_RX.source, 'gi');

/**
 * KORSMÅNADSINTERVALL: "3 oktober 2026 – 28 februari 2027", "11 oktober –
 * 23 november".
 *
 * VARFÖR: en utställning som pågår i fem månader är ETT event. Utan den här
 * regeln fick "3 oktober 2026–28 februari 2027" bara startdatumet, och
 * "30 oktober – 27 december" fick SLUTDAGEN som startdatum — evenemanget såg
 * ut att började dagen det slutade.
 *
 * BEVIS (Generalization Protection Rule — General, 7 orelaterade domäner i
 * korpuset): 3arena, aviciiarena, lokalhelhet-calendar, stockholmlive-evenemang,
 * djurgarden, dn-kalendariet, kungsbacka.
 *
 * Grupper: 1=startdag, 2=startmånad, 3=startår, 4=slutdag, 5=slutmånad,
 * 6=slutår.
 */
const SWE_CROSS_MONTH_RANGE_RX = new RegExp(
  `(?<!\\d)(\\d{1,2})\\s+(${SWE_MONTH_ALT})${SWE_MONTH_NOT_LETTER}\\w*?(?:\\s*[.,]?\\s*(\\d{4}))?\\s*[-–—]\\s*(\\d{1,2})\\s+(${SWE_MONTH_ALT})${SWE_MONTH_NOT_LETTER}\\w*?(?:\\s*[.,]?\\s*(\\d{4}))?`,
  'i',
);

/** Ett datumintervall: första och sista dag. */
export interface SwedishDateRange {
  start: string;
  end: string;
}

/**
 * Tolka ett svenskt datumintervall ("12-14 januari 2027") som start + slut.
 *
 * VARFÖR: "12-14 januari" är ETT event som pågår 12–14 januari. Utan den
 * här tolkningen läste "European short"-mönstret (/(\d{1,2})[/\-](\d{1,2})/)
 * sifferparet som dag 14 + månad 12 → 2026-12-14, nästan ett halvt år fel.
 *
 * BEVIS (Generalization Protection Rule — General, 2 orelaterade domäner):
 *   pingst.se     — "12-14 januari 2027" → 2026-12-14 (fel)
 *   dansenshus.se — "12-13 maj 2026"    → 2026-12-13 (fel)
 * Formen "N-M månad" förekommer i minst nio orelaterade domäner i korpuset.
 *
 * ÅR: med år i texten används det. Utan år härleds året från SLUTDAGEN:
 * intervallet ska fortfarande kunna pågå. "23-28 oktober" den 26 oktober
 * blir alltså 2026-10-23..2026-10-28 (ett pågående evenemang), inte
 * 2027 — att hoppa ett år framåt vore att förlora evenemanget. Året
 * infereras bara om `allowInferredYear` är sant; på en arkivsida får ett
 * årslöst datum inte få ett år infererat.
 */
export function parseSwedishDateRange(
  text: string,
  options: { now?: Date; allowInferredYear?: boolean } = {},
): SwedishDateRange | null {
  // 2026-10-24 — ett intervall MED år vinner ALLTID över ett årslöst, även
  // om det årslösa står först i texten. Bevis: dansenshus.se ("7-8 maj 2026"
  // + ett avklippt "5-13 maj…" i samma kort) — det egna datumet ska vinna
  // över teasern.
  return (
    parseSwedishRangeWithYear(text, options) ??
    parseSwedishRangeWithoutYear(text, options)
  );
}

/**
 * Bygg ett datumintervall från en regex-matchning. Året i texten används
 * direkt; annars härleds det från SLUTDAGEN (se inferRangeYear).
 */
function buildSwedishDateRange(
  m: RegExpMatchArray,
  options: { now?: Date; allowInferredYear?: boolean } = {},
): SwedishDateRange | null {
  const d1 = parseInt(m[1], 10);
  const d2 = parseInt(m[2], 10);
  const mon = (m[3] || '').toLowerCase();
  const monthNum = SWE_MONTH_MAP[mon];
  if (!monthNum) return null;
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  let year: number;

  if (m[4]) {
    year = parseInt(m[4], 10);
    if (!Number.isFinite(year)) return null;
  } else {
    if (options.allowInferredYear === false) return null;
    year = inferRangeYear(monthNum, d2, options.now ?? getToday());
  }

  const start = `${year}-${monthNum}-${pad(d1)}`;
  if (!isValidIsoDate(start)) return null;

  let end = `${year}-${monthNum}-${pad(d2)}`;
  if (!isValidIsoDate(end)) return null;
  // Intervallet får korsa årsskiftet ("29-31 december").
  if (end < start) {
    end = `${year + 1}-${monthNum}-${pad(d2)}`;
    if (!isValidIsoDate(end)) return null;
  }

  return { start, end };
}

/**
 * Global variant av SWE_CROSS_MONTH_RANGE_RX — för att hitta det första
 * ÅRSLÖSA korsmånadsintervallet även när ett med år ligger längre fram.
 */
const SWE_CROSS_MONTH_RANGE_SCAN_RX = new RegExp(SWE_CROSS_MONTH_RANGE_RX.source, 'gi');

/**
 * Tolka ett KORSMÅNADSINTERVALL ("3 oktober 2026 – 28 februari 2027").
 *
 * ÅR:
 *  - startår i texten används; annars härleds det från SLUTÅRET (årslöst
 *    intervall ska fortfarande kunna pågå).
 *  - slutår i texten används; annars är det startåret, ett år senare om
 *    slutmånaden är FÖRE startmånaden ("3 oktober – 28 februari").
 */
function buildSwedishCrossMonthRange(
  m: RegExpMatchArray,
  options: { now?: Date; allowInferredYear?: boolean } = {},
): SwedishDateRange | null {
  const d1 = parseInt(m[1], 10);
  const d2 = parseInt(m[4], 10);
  const mon1 = (m[2] || '').toLowerCase();
  const mon2 = (m[5] || '').toLowerCase();
  const month1 = SWE_MONTH_MAP[mon1];
  const month2 = SWE_MONTH_MAP[mon2];
  if (!month1 || !month2) return null;
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  // Samma månad = vanligt intervall, inte korsmånadsintervall.
  if (month1 === month2) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  const now = options.now ?? getToday();
  const year1 = m[3] ? parseInt(m[3], 10) : null;
  const year2 = m[6] ? parseInt(m[6], 10) : null;
  if (year1 !== null && !Number.isFinite(year1)) return null;
  if (year2 !== null && !Number.isFinite(year2)) return null;

  let startYear: number;
  let endYear: number;

  if (year2 !== null) {
    // Slutåret står i texten. Startåret följer av månadernas ordning.
    endYear = year2;
    startYear = year1 ?? year2 - (month1 > month2 ? 1 : 0);
  } else if (year1 !== null) {
    startYear = year1;
    endYear = year1 + (month2 < month1 ? 1 : 0);
  } else {
    if (options.allowInferredYear === false) return null;
    // Årslöst: slutåret härleds från SLUTDAGEN (intervallet ska kunna pågå),
    // startåret följer av månadernas ordning.
    endYear = inferRangeYear(month2, d2, now);
    startYear = endYear - (month1 > month2 ? 1 : 0);
  }

  const start = `${startYear}-${month1}-${pad(d1)}`;
  const end = `${endYear}-${month2}-${pad(d2)}`;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  if (end < start) return null;

  return { start, end };
}

/**
 * Ett intervall som hittats i en text, med sin PLATS i texten.
 */
interface RangeCandidate {
  /** Startposition i texten — används för att välja det FÖRSTA intervallet. */
  index: number;
  /** Sant om ett år står utskrivet i texten (absolut datum). */
  hasYear: boolean;
  range: SwedishDateRange;
}

/**
 * Samla ALLA datumintervall i en text — vanliga och korsmånadsintervall —
 * sorterade på sin PLATS i texten.
 *
 * VARFÖR: en text kan nämna flera intervall. Då gäller det som nämns
 * FÖRST: i svensk text nämns starten först. Utan den här regeln fick
 * korsmånadsintervallet prioritet över ett tidigare, enklare intervall, så
 * att djurgarden.se ("den 24–25 oktober och 31 oktober–1 november") fick
 * starten 31 oktober i stället för 24 oktober.
 *
 * BEVIS (Generalization Protection Rule — General): att en text nämner två
 * intervall i samma mening är generell svensk formulering, inte ett
 * sitedomänsdrag. Korpuset: 4 av 128 kort med intervall har fler än ett,
 * varav 3 upprepar samma intervall.
 *
 * Intervall slås INTE ihop: två skilda evenemang på samma kort ("konsert
 * 12-14 januari, workshop 20-22 januari") ger två kandidater, och det
 * första vinner. Sammanfogning skulle hitta på ett evenemang som inte finns.
 */
function collectRangeCandidates(
  text: string,
  options: { now?: Date; allowInferredYear?: boolean } = {},
): RangeCandidate[] {
  const out: RangeCandidate[] = [];

  SWE_DATE_RANGE_SCAN_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SWE_DATE_RANGE_SCAN_RX.exec(text)) !== null) {
    const range = buildSwedishDateRange(m, options);
    if (!range) continue;
    out.push({ index: m.index, hasYear: Boolean(m[4]), range });
  }

  SWE_CROSS_MONTH_RANGE_SCAN_RX.lastIndex = 0;
  while ((m = SWE_CROSS_MONTH_RANGE_SCAN_RX.exec(text)) !== null) {
    const range = buildSwedishCrossMonthRange(m, options);
    if (!range) continue;
    out.push({ index: m.index, hasYear: Boolean(m[3] || m[6]), range });
  }

  out.sort((a, b) => a.index - b.index);
  return out;
}

/**
 * Intervall där ett eller båda åren står utskrivna (absolut datum).
 *
 * Det FÖRSTA intervallet i texten vinner — oavsett om det är ett vanligt
 * intervall eller ett korsmånadsintervall.
 */
export function parseSwedishRangeWithYear(
  text: string,
  options: { now?: Date; allowInferredYear?: boolean } = {},
): SwedishDateRange | null {
  const cands = collectRangeCandidates(text, options).filter(c => c.hasYear);
  return cands.length > 0 ? cands[0].range : null;
}

/**
 * Intervall där INGET år står utskrivet (året gissas). Det FÖRSTA intervallet
 * i texten vinner.
 */
export function parseSwedishRangeWithoutYear(
  text: string,
  options: { now?: Date; allowInferredYear?: boolean } = {},
): SwedishDateRange | null {
  if (options.allowInferredYear === false) return null;
  const cands = collectRangeCandidates(text, options).filter(c => !c.hasYear);
  return cands.length > 0 ? cands[0].range : null;
}


/**
 * Element som bär en DEDIKERAD evenemangstitel ("kort-titel").
 * Samma uppsättning som C1:s extractTitle — C3 ska resonera om samma sak.
 */
const TITLE_ELEMENT_SELECTORS =
  '[class*="title"], [class*="heading"], h1, h2, h3, h4, h5, h6';

/**
 * Explicit kalenderdatum i svensk form: "24 okt", "3 nov 2026".
 * Fångar INTE veckodagar — veckodagen härleds ur datumet, inte vice versa.
 *
 * Lookbehind `(?<!\d)`: samma skydd som SWE_DATE_NO_YEAR_RX — dagen får
 * inte vara en del av ett år.
 */
const SWE_EXPLICIT_DATE_RX =
  /(?<!\d)(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec)\b(?:\s*,?\s*(\d{4}))?/gi;

/** Veckodag som eget ord ("lördag"). */
const SWE_WEEKDAY_WORD_RX =
  /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mandag|tirsdag|onsdag|torsdag|fredag|lordag|sondag)\b/i;

/** rel="tag"/"category" → kategori-/filterlänk, aldrig ett event. */
const TAXONOMY_REL_RX = /^(tag|category|taxonomy)$/i;

/** Element som kan rymma ett evenemangskort (C3:s kortuppslagning). */
const C3_CARD_SELECTOR =
  'li, article, [class*="event"], [class*="item"], [class*="card"], [class*="kalender"], [class*="program"]';

/** Hur många nivåer upp C3 får söka efter ett kort med datum. */
const CARD_EXPANSION_MAX_LEVELS = 4;

/**
 * Antal UNIKA explicita datum ("D MMM") i en text.
 * Veckodagar räknas inte — de följer av datumet ("24 okt lördag" är ETT datum).
 */
function countExplicitDates(text: string): number {
  const rx = new RegExp(SWE_EXPLICIT_DATE_RX.source, 'gi');
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    seen.add(`${m[1]}/${m[2].toLowerCase()}`);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return seen.size;
}

/** Sant om texten innehåller någon datum-signal (datum, veckodag, "i dag"). */
function hasDateSignal(text: string): boolean {
  if (countExplicitDates(text) > 0) return true;
  if (SWE_WEEKDAY_WORD_RX.test(text)) return true;
  return /\b(i dag|idag|imorgon)\b/i.test(text);
}

/**
 * ISO-datum ur "D MMM" + valfritt år. Utan år → närmaste framtida
 * förekomst (parseSwedishMonthDay).
 */
function explicitSwedishDateToIso(
  day: string,
  mon: string,
  year: string | undefined
): string | null {
  if (!year) return parseSwedishMonthDay(day, mon);
  const monthNum = SWE_MONTH_MAP[(mon || '').toLowerCase()];
  if (!monthNum) return null;
  const d = parseInt(day, 10);
  if (!Number.isFinite(d) || d < 1 || d > 31) return null;
  const iso = `${year}-${monthNum}-${String(d).padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * Länk som leder till biljettsköp — aldrig eventets URL.
 * Fångar både klassmarkörer ("btn-biljett") och URL-former
 * ("biljett.scalateatern.se/…/tickets/…").
 */
function isTicketCheckoutLink(href: string, className: string): boolean {
  if (/ticket|biljett|boka|booking|checkout/.test((className || '').toLowerCase())) return true;
  try {
    const u = new URL(href, 'https://placeholder.invalid');
    if (/^(ticket|biljett)/.test(u.hostname.toLowerCase())) return true;
    return u.pathname
      .split('/')
      .filter(Boolean)
      .some((seg) => /^(tickets?|biljetter?|boka|booking|checkout)/i.test(seg));
  } catch {
    return false;
  }
}

/**
 * Kortets primära länk: första ankaret som inte är tagg- eller biljettlänk.
 */
function primaryEventAnchor($: cheerio.CheerioAPI, $card: any): any {
  return $card
    .find('a[href]')
    .filter((_: any, a: any) => {
      const rel = ($(a).attr('rel') || '').trim().split(/\s+/)[0];
      if (rel && TAXONOMY_REL_RX.test(rel)) return false;
      if (isTicketCheckoutLink($(a).attr('href') || '', $(a).attr('class') || '')) return false;
      return true;
    })
    .first();
}

/**
 * Gå uppåt från ett element tills vi hittar ett som innehåller EXAKT ett
 * explicit datum ("24 okt").
 *
 * Varför: det närmaste matchande elementet kan vara en LAYOUT-wrapper.
 * Tailwind-klassen "items-center" (och "align-items-center") innehåller
 * delsträngen "item" och matchar därför [class*="item"] — då blir "kortet"
 * en tom layoutkolumn utan datum och evenemanget försvinner.
 *
 * Ett element med flera datum är en LISTA, inte ett kort — då kan datumet
 * inte tillskrivas ankaret, så vi avbryter med null.
 */
function expandToDatedCard($nearest: any): any | null {
  let $el = $nearest.parent();
  let levels = 0;
  while ($el.length && levels < CARD_EXPANSION_MAX_LEVELS) {
    const tag = $el[0]?.tagName;
    if (tag === 'body' || tag === 'html') return null;
    const n = countExplicitDates($el.text());
    if (n === 1) return $el;
    if (n > 1) return null;
    $el = $el.parent();
    levels++;
  }
  return null;
}

/**
 * Parse relative Swedish date expressions.
 * "Imorgon" → tomorrow's date
 * "I dag" / "Idag" → today
 * "Måndag" (standalone, no date) → next occurrence this/next week
 */
function parseRelativeSwedishDate(text: string): string | null {
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const today = getToday();

  if (/imorgon/i.test(lower)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  if (/^i\s?dag$/i.test(lower) || /^idag$/i.test(lower)) {
    return today.toISOString().split('T')[0];
  }

  const weekdayOnlyRx = /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mandag|tirsdag|onsdag|torsdag|fredag|lordag|sondag)\b(?![\s,]*\d)/i;
  const wdMatch = lower.match(weekdayOnlyRx);
  if (wdMatch) {
    const wdName = wdMatch[1].toLowerCase();
    const targetDay = SWE_WEEKDAY_MAP[wdName];
    if (!targetDay) return null;
    const target = parseInt(targetDay);
    const current = today.getDay();
    const mappedCurrent = current === 0 ? 7 : current;
    let daysUntil = target - mappedCurrent;
    if (daysUntil <= 0) daysUntil += 7;
    const result = new Date(today);
    result.setDate(result.getDate() + daysUntil);
    return result.toISOString().split('T')[0];
  }

  return null;
}

function parseDate(raw: string): { date: string; time?: string } {
  if (!raw) return { date: '' };

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [date, time] = raw.split('T');
    return { date, time: time?.slice(0,5) };
  }

  for (const p of DATE_PATTERNS) {
    const m = raw.match(p.rx);
    if (m) {
      try {
        const dateStr = p.fmt(m[1], m[2], m[3], m[4]);
        // 2026-10-24 — datumet måste vara en RIKTIG kalenderdag.
        // "2026-02-31" passerar mönstret men finns inte.
        if (isValidIsoDate(dateStr)) {
          const t = TIME_RX.exec(raw);
          return { date: dateStr, time: t ? formatTime(t[1], t[2]) : undefined };
        }
      } catch { /* invalid */ }
    }
  }

  const relDate = parseRelativeSwedishDate(raw);
  if (relDate) return { date: relDate };

  // 2026-10-24 — sista utvägen ger ETT giltigt datum eller ingenting.
  // Tidigare gav den `raw.slice(0, 10)` på godtycklig text. En tom
  // datetime-attribut ("<time datetime='\n  '>") blev då ett "datum" av
  // blanksteg, vilket (a) skrev trasiga datum till filen och (b) avslutade
  // extraktorns datumjakt — kortets riktiga datum ("17 oktober 2026") lästes
  // aldrig, så eventet försvann helt.
  //
  // Bevis: 15 orelaterade domaner gav blanksteg-datum — 3arena.se,
  // liseberg.se, lund.se, malm-konserthus.se, molndals-futsal.se, oland.se,
  // studio-acusticum.se med flera. Alltså General enligt Generalization
  // Protection Rule.
  const slice = raw.trim().slice(0, 10);
  if (isValidIsoDate(slice)) return { date: slice };
  return { date: '' };
}

// ─── URL Building ────────────────────────────────────────────────────────────

function buildUrl(href: string | undefined, base: string): string {
  if (!href) return '';
  try {
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) {
      const u = new URL(base);
      return `${u.origin}${href}`;
    }
    return new URL(href, base).href;
  } catch { return href; }
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function norm(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (val == null) return '';
  // 2026-10-23 — JSON-LD/microdata ger ofta ett OBJEKT där vi väntar en
  // sträng: organizer: { "@type": "Organization", "name": "Stockholm Live" },
  // location/venue: { "@type": "Place", "name": "Oscarsteatern" },
  // address: { "@type": "PostalAddress", "streetAddress": "…" }.
  //
  // String(obj) ger '[object Object]' — aldrig ett giltigt venue/organizer/
  // adress. Mätt på de riktiga körningarna: 599 rader i 21 orelaterade
  // källor bar '[object Object]' i venue/address/organizer/performers, och
  // 250 av dem är framtida events som faktiskt landade i databasen.
  //
  // Objekts 'name' är källans EGEN text (vi hittar inte på något), så den
  // används. Saknas 'name' → '' (fältet utelämnas) i stället för skräp.
  //
  // ARRAYER hanteras separat: microdata kan ge flera värden för samma
  // itemprop ("<a itemprop=url>" två gånger). Arrayen ska JOINAS, inte
  // behandlas som ett objekt — annars blir url'en tom och eventet förlorar
  // sin länk.
  if (Array.isArray(val)) {
    return val.map((v) => norm(v)).filter((s) => s.length > 0).join(',');
  }
  if (typeof val === 'object') {
    const name = (val as { name?: unknown }).name;
    return typeof name === 'string' ? name.trim() : '';
  }
  return String(val);
}

function normUrl(val: unknown, base: string): string {
  return buildUrl(norm(val), base);
}

function normPrice(val: unknown): string {
  return norm(val).replace(/[^\d.,]/g, '').replace(',', '.');
}

function parsePrice(s: string): number | undefined {
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

function makeEvent(data: Record<string, unknown>, method: string, source: string, baseUrl: string): ParsedEvent | null {
  try {
    let title = '';
    if (data.translations && typeof data.translations === 'object') {
      const t = data.translations as Record<string, string>;
      title = t.originalName || t.name || t.title || '';
    }
    if (!title) title = norm(data.name || data.title || data.eventTitle || data.heading || data.label);
    if (!title) return null;

    let startDate = norm(
      data.startDate || data.start_date || data.date || data.eventDate ||
      (Array.isArray(data.dates) && data.dates[0] && ((data.dates as unknown[])[0] as Record<string,string>).startDate) ||
      (Array.isArray(data.dates) && data.dates[0] && ((data.dates as unknown[])[0] as Record<string,string>).date) || '');
    let endDate = norm(data.endDate || data.end_date || '');

    if (!startDate && Array.isArray(data.dates) && data.dates.length) {
      const first = data.dates[0] as Record<string, string>;
      startDate = norm(first.startDate || first.date || '');
      endDate = norm(first.endDate || '');
    }

    if (startDate.includes('T')) startDate = startDate.split('T')[0];
    if (endDate.includes('T')) endDate = endDate.split('T')[0];

    let time: string | undefined;
    if (data.startTime || data.time || data.eventTime) {
      const t = norm(data.startTime || data.time || data.eventTime);
      const m = t.match(TIME_RX);
      time = m ? formatTime(m[1], m[2]) : (isValidTime(t.slice(0, 5)) ? t.slice(0, 5) : undefined);
    }

    let venue = '';
    let city = '';
    let address = '';

    // P1D (2026-09-10): plocka nested location FÖRST (microdata location kan
    // vara objekt med egen name/address, inte en sträng).
    if (typeof data.location === 'object' && data.location) {
      const loc = data.location as Record<string, string | Record<string, string>>;
      // Nested location.address kan i sin tur vara ett objekt
      let locAddressStr = '';
      let locCity = '';
      const locAddr = loc.address;
      if (typeof locAddr === 'object' && locAddr) {
        const a = locAddr as Record<string, string>;
        locAddressStr = a.streetAddress || '';
        locCity = a.addressLocality || a.city || '';
      } else if (typeof locAddr === 'string') {
        locAddressStr = locAddr;
      }
      venue = norm(loc.name || loc.venue);
      city = norm(locCity || loc.city || loc.town || loc.addressLocality);
      address = norm(locAddressStr || loc.street || loc.streetAddress);
    }

    if (!venue) venue = norm(data.venue || (typeof data.location === 'string' ? data.location : '') || data.place || data.locationName || data.venueName);
    if (!city) city = norm(data.city || data.town || data.municipality || data.addressLocality);
    // 2026-10-23 — JSON-LD:s address är ett OBJEKT (PostalAddress), inte en
    // sträng. norm() ger nu '' för objekt utan 'name', och kedjan
    // `data.address || data.streetAddress` blockerar då streetAddress — den
    // riktiga gatanadressen skulle förloras. Läs den explicit i stället.
    if (!address && data.address && typeof data.address === 'object') {
      const a = data.address as Record<string, unknown>;
      address = norm(a.streetAddress);
      if (!city) city = norm(a.addressLocality || a.city);
    }
    if (!address) address = norm(data.streetAddress || data.locationAddress);

    let location = venue || city || address;
    if (city && venue && !venue.includes(city)) location = `${venue}, ${city}`;

    const eventUrl = normUrl(
      data.url || data.link || data.href || data.eventUrl || data.bookingUrl || data.detailUrl, baseUrl);
    const ticketUrl = normUrl(
      data.ticketUrl || data.ticketsUrl || data.buyUrl || data.registrationUrl || data.purchaseUrl, baseUrl);

    let desc = norm(data.description || data.shortDescription || data.intro || data.text || data.shortDesc);
    if (typeof data.translations === 'object' && data.translations) {
      const t = data.translations as Record<string, string>;
      desc = desc || t.originalDescription || t.description || '';
    }
    // 2026-10-02 — meta-fallback (Round 2, plan §3). Om JSON-LD saknar
    // description ELLER är för kort (<10 tecken), hämta från page-level
    // <meta name="description"> eller <meta property="og:description">.
    // extractJsonLd bifogar pageMetaDescription som `__meta_description`
    // på data-objektet vid inskickning. Befintligt beteende (>=10 tecken)
    // bevaras — vi skriver INTE över en riktig JSON-LD-beskrivning.
    if ((!desc || desc.length < 10) && typeof data.__meta_description === 'string') {
      const meta = norm(data.__meta_description as string);
      if (meta.length >= 10) desc = meta;
    }
    // 2026-10-02 — body-fallback (Round 2 utökning). Om varken JSON-LD
    // eller meta har en duglig description → använd body-paragraph
    // som extractBodyDescription hittat. Trigga ENDAST om JSON-LD
    // description är tom/short (inte skriva över riktig JSON-LD-text).
    if ((!desc || desc.length < 10) && typeof data.__body_description === 'string') {
      const body = norm(data.__body_description as string);
      if (body.length >= 10) desc = body;
    }
    desc = desc.replace(/<[^>]+>/g, '');
    // 2026-10-02 — avkoda HTML-entiteter (aviciiarena m.fl. har raw
    // entities som &auml; &ouml; etc. i JSON-LD description; behöver
    // avkodas så description inte ser konstig ut i UI).
    desc = desc.replace(/&#(\d+);/g, (_, dec) => {
      const codePoint = parseInt(dec, 10);
      return codePoint < 0x10000 ? String.fromCodePoint(codePoint) : '?';
    });
    desc = desc.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const codePoint = parseInt(hex, 16);
      return codePoint < 0x10000 ? String.fromCodePoint(codePoint) : '?';
    });
    const NAMED_ENTITIES_DESC: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      auml: 'ä', ouml: 'ö', uuml: 'ü', aring: 'å', Auml: 'Ä', Ouml: 'Ö',
      Uuml: 'Ü', Aring: 'Å', szlig: 'ß', euro: '€', ndash: '–', mdash: '—',
    };
    desc = desc.replace(/&([a-zA-Z]+);/g, (m, name) => {
      if (name in NAMED_ENTITIES_DESC) return NAMED_ENTITIES_DESC[name];
      return ' ';
    });
    desc = desc.slice(0, 500);

    let price = '';
    const isFree = data.isFree === true || data.isFree === 'true' || data.free === true || data.freeEntry === true;
    if (isFree) {
      price = 'Free';
    } else {
      const p = data.price || data.priceMin || data.priceAmount || data.cost || data.minPrice;
      if (p != null) price = normPrice(p);
    }

    let image = normUrl(
      data.image || data.photo || data.poster || data.thumbnail || data.img || data.imageUrl, baseUrl);
    if (Array.isArray(data.images) && data.images.length) {
      const first = data.images[0];
      image = normUrl(typeof first === 'string' ? first : (first as Record<string,string>).url || (first as Record<string,string>).src, baseUrl);
    }
    if (Array.isArray(data.photos) && data.photos.length) {
      const first = data.photos[0];
      image = normUrl(typeof first === 'string' ? first : (first as Record<string,string>).url || (first as Record<string,string>).src, baseUrl);
    }

    let category = '';
    if (Array.isArray(data.categories)) category = (data.categories as string[]).join(', ');
    else if (data.category) category = norm(data.category);
    else if (Array.isArray(data.tags)) category = (data.tags as string[]).join(', ');

    let performers: string[] = [];
    if (Array.isArray(data.performers)) performers = data.performers.map(norm);
    else if (Array.isArray(data.artists)) performers = data.artists.map(norm);
    else if (Array.isArray(data.speakers)) performers = data.speakers.map(norm);
    else if (Array.isArray(data.actors)) performers = data.actors.map(norm);
    else if (Array.isArray(data.musicians)) performers = data.musicians.map(norm);
    else if (typeof data.organizer === 'string') performers = [data.organizer];
    else if (typeof data.organizer === 'object' && data.organizer && (data.organizer as Record<string,string>).name) {
      performers = [(data.organizer as Record<string,string>).name];
    }

    let status = norm(data.status || data.eventStatus || 'posted');
    if (data.cancelled || data.canceled) status = 'cancelled';
    else if (data.soldOut || data.bookedOut) status = 'sold_out';

    // 2026-09-27 — schema.org eventStatus / offers.availability are URL enums.
    // Detect from the canonical schema.org URLs so structured-data sources
    // (JSON-LD) propagate sold_out / cancelled / etc. to status_expanded.
    if (typeof data.eventStatus === 'string') {
      const es = data.eventStatus.toLowerCase();
      if (es.includes('eventscheduled')) status = 'scheduled';
      else if (es.includes('eventcancelled')) status = 'cancelled';
      else if (es.includes('eventpostponed')) status = 'postponed';
      else if (es.includes('eventrescheduled')) status = 'rescheduled';
    }
    if (Array.isArray(data.offers)) {
      for (const off of data.offers) {
        if (typeof off?.availability === 'string') {
          const a = off.availability.toLowerCase();
          if (a.includes('soldout') || a.includes('outofstock') || a.includes('discontinued')) {
            status = 'sold_out';
            break;
          }
        }
      }
    } else if (data && typeof data === 'object' && 'offers' in data && data.offers && typeof (data.offers as Record<string, unknown>).availability === 'string') {
      const a = ((data.offers as Record<string, unknown>).availability as string).toLowerCase();
      if (a.includes('soldout') || a.includes('outofstock') || a.includes('discontinued')) {
        status = 'sold_out';
      }
    }

    const confidenceScore = ['A1','A2','B1','B2','B3','B4','B5'].includes(method) ? 0.95 : 0.75;

    const parsed = ParsedEventSchema.parse({
      title: title.slice(0, 200),
      date: startDate || 'unknown',
      time,
      endDate: endDate || undefined,
      venue: venue || undefined,
      address: address || undefined,
      city: city || undefined,
      description: desc || undefined,
      url: eventUrl || undefined,
      ticketUrl: ticketUrl || undefined,
      organizer: norm(data.organizer) || undefined,
      performers: performers.length ? performers : undefined,
      category: category || undefined,
      isFree: isFree || undefined,
      priceMin: parsePrice(price),
      priceMax: data.priceMax ? parsePrice(norm(data.priceMax)) : undefined,
      // ── AI-bilder är obligatoriskt i pipelinen: toRawEventInput() mappar
      // image_url → null oavsett (normalizern köar AI-generering). Här i
      // extraktionslagret behåller vi per-event-bild från strukturerad data
      // så att Strategy A-og:image bara fyller events helt utan bild
      // (prioritet: JSON-LD/microdata > og:image, se universal-extractor.test.ts).
      imageUrl: image || undefined,
      status,
      source,
      sourceUrl: baseUrl,
      confidence: {
        score: confidenceScore,
        hasTitle: true,
        hasDate: !!startDate,
        hasVenue: !!venue,
        hasUrl: !!eventUrl,
        hasDescription: !!desc,
        hasTicketInfo: !!(ticketUrl || isFree),
        signals: [`method:${method}`],
      },
    });
    return parsed;
  } catch (e) {
    return null;
  }
}

// ─── JSON Safe Parse ─────────────────────────────────────────────────────────

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * 2026-10-02 — Tolerant JSON-LD parser för Webflow-sajter (Round 2 lärdom).
 * Många svenska event-sajter (Fållan m.fl.) har trasig JSON-LD där t ex
 *  extra `}` eller saknade inledande `{` gör att JSON.parse kraschar.
 * Vi försöker parsa tolerant genom att:
 *   1. Plocka ut description-fältet via regex (även om omgivande JSON är trasigt)
 *   2. Bygga en syntetstrad {description: "..."} som wrapper
 *
 * Returnerar null om inget description-fält hittas.
 */
function parseBrokenJsonLd(content: string): Record<string, unknown> | null {
  const m = content.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  const desc = m[1]
    .replace(/\\"/g, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&aring;/g, 'å')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Aring;/g, 'Å')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
  if (desc.length < 20) return null;
  // Bygg syntetstrad wrapper
  const nameMatch = content.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const dateMatch = content.match(/"startDate"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const urlMatch = content.match(/"url"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const wrapper: Record<string, unknown> = {
    '@type': 'Event',
    description: desc,
  };
  if (nameMatch) wrapper.name = nameMatch[1].replace(/\\"/g, '"');
  if (dateMatch) wrapper.startDate = dateMatch[1].replace(/\\"/g, '"');
  if (urlMatch) wrapper.url = urlMatch[1].replace(/\\"/g, '"');
  return wrapper;
}

// ─── Method A1: JSON-LD ──────────────────────────────────────────────────────

function extractJsonLd($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  // 2026-10-02 — meta-fallback (Round 2, plan §3). Hämta page description
  // en gång per extraktys. Sätts som `__meta_description` på alla Event-
  // objekt som saknar egen description.
  const pageMetaDescription = extractPageDescription($);

  // 2026-10-02 — body-fallback (Round 2 utökning). För källor som saknar
  // både JSON-LD description OCH meta description (gratisistockholm,
  // china-teatern, arkdes, sodrateatern.com, etc.) — hämta den riktiga
  // description från sidans body-text. Heurfel väljer i största
  // text-block som inte är nav/footer/cookie. Kräver att pageMetaDescription
  // OCH JSON-LD description är tomma (<10) för att aktiveras.
  const bodyDescription = extractBodyDescription($);

  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() || '';
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      // 2026-10-02 — Round 2 lärdom: Webflow-sajter (Fållan m.fl.) har trasig
      // JSON-LD. Försök parsa tolerant med regex för att fånga description-fältet
      // även när omgivande JSON-syntax är bruten (saknar {/}, trasig nesting).
      data = parseBrokenJsonLd(content);
      if (!data) return;
    }
    const rootDesc = findRootDescription(data);
    // Inject meta-fallback på top-nivå objektet (recursivt till alla children)
    collectJsonLdEvents(data, source, baseUrl, events, rootDesc, pageMetaDescription, bodyDescription);
  });

  return events;
}

/**
 * Hämta sidans meta description (Round 2, plan §3). Prioritet:
 *   1. <meta property="og:description"> (oftast bättre kvalitet)
 *   2. <meta name="description">
 *
 * Returnerar null om ingen finns eller är för kort (<10 tecken).
 */
function extractPageDescription($: cheerio.CheerioAPI): string | null {
  const og = $('meta[property="og:description"]').attr('content');
  if (og && og.trim().length >= 10) return og.trim();
  const meta = $('meta[name="description"]').attr('content');
  if (meta && meta.trim().length >= 10) return meta.trim();
  return null;
}

/**
 * Body-fallback (Round 2 utökning). När varken JSON-LD eller meta-taggar
 * har description, leta i sidans body-text efter den första paragrafen
 * med ≥200 tecken som inte är nav/footer/cookie-reklam.
 *
 * Denna utökning är nödvändig för källor som:
 *   - Saknar JSON-LD helt (gratisistockholm.nu, china-teatern.se, arkdes.se,
 *     stadsmuseet.stockholm, etc.)
 *   - Har generic meta description ("Ett evenemangs pa..." istället för
 *     det riktiga innehållet)
 *
 * Heurfel:
 *   1. Strippa <script>/<style>
 *   2. Konvertera <p>, <br><br>, </div> till \n\n
 *   3. Strippa resterande taggar
 *   4. Avkoda entiteter via html.unescape (hanterar &#x..; etc.)
 *   5. Hitta längsta textstycket ≥200 tecken som inte är nav/footer
 *   6. Föredra svenska (innehåller å/ä/ö)
 */
function extractBodyDescription($: cheerio.CheerioAPI): string | null {
  // Bygg ihop HTML-body utan script/style för att kunna processa texten
  // som fristående textblock. cheerio's $.html() ger serialiserad output.
  const html = $('body').html() || $.html();
  if (!html) return null;

  // 1. Strippa script/style (de innehåller bara JS/CSS, inte synlig text)
  let h = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  h = h.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  // 2. Konvertera paragraph-gränser till newlines
  h = h.replace(/<p\b[^>]*>/gi, '\n\n');
  h = h.replace(/<\/p>/gi, '\n\n');
  h = h.replace(/<br\s*\/?>/gi, '\n');  // enskild <br> = mjuk radbrytning inom paragrafen
  h = h.replace(/\n\n+/g, '\n\n');        // normalisera multipla radbryter
  h = h.replace(/<\/?(div|section|article|main|header|footer|li|ul|ol|tr)\b[^>]*>/gi, '\n');

  // 3. Strippa resterande taggar
  h = h.replace(/<[^>]+>/g, ' ');

  // 4. Avkoda HTML-entiteter (&#x..; och &name;)
  h = h.replace(/&#(\d+);/g, (_, dec) => {
    const codePoint = parseInt(dec, 10);
    return codePoint < 0x10000 ? String.fromCodePoint(codePoint) : '?';
  });
  h = h.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const codePoint = parseInt(hex, 16);
    return codePoint < 0x10000 ? String.fromCodePoint(codePoint) : '?';
  });
  // Standard-namngivna entiteter — använd lookup-tabell (html.unescape
  // gör detta men vi har redan strippat taggar; kör replace manuelt för
  // att fånga &auml; &ouml; &aring; etc.).
  const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    auml: 'ä', ouml: 'ö', uuml: 'ü', aring: 'å', Auml: 'Ä', Ouml: 'Ö',
    Uuml: 'Ü', Aring: 'Å', szlig: 'ß', euro: '€', pound: '£', yen: '¥',
    ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019',
    ldquo: '\u201C', rdquo: '\u201D', hellip: '…',
  };
  h = h.replace(/&([a-zA-Z]+);/g, (m, name) => {
    if (name in NAMED_ENTITIES) return NAMED_ENTITIES[name];
    return ' ';
  });

  // 5. Collapse whitespace MEN bevara newlines (för paragraph-split)
  h = h.replace(/[ \t\r\f\v]+/g, ' ');

  // 6. Splitta och välj
  const paragraphs = h.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length >= 200);

  // Filtrera bort nav/footer/cookie-reklam. OBS: bara fristående signaler
  // (ord som nästan uteslutande förekommer i reklam), inte vanliga ord
  // som "footer" eller "integritet" — de kan finnas i riktiga beskrivningar.
  const excludeKeywords = [
    'använder cookies', 'använder kakor', 'cookies för att',
    'privacy policy', 'skip to content', 'skip to main',
  ];
  const candidates = paragraphs.filter(p => {
    const lower = p.toLowerCase();
    return !excludeKeywords.some(kw => lower.includes(kw));
  });

  if (candidates.length === 0) return null;

  // 7. Föredra svenska
  const svCandidates = candidates.filter(p => /[åäöÅÄÖ]/.test(p));
  const best = svCandidates.length > 0 ? svCandidates : candidates;

  // Returnera längsta
  const result = best.reduce((a, b) => (b.length > a.length ? b : a));
  return result.slice(0, 1500);
}

function collectJsonLdEvents(
  data: unknown,
  source: string,
  baseUrl: string,
  acc: ParsedEvent[],
  inheritedDescription: string | null = null,
  pageMetaDescription: string | null = null,
  bodyDescription: string | null = null,
): void {
  if (!data || typeof data !== 'object') return;

  const obj = data as Record<string, unknown>;
  // 2026-10-02 — Round 2 meta-fallback. Injicera page description som
  // `__meta_description` på objektet INN vi rekursiverar majs makeEvent.
  // makeEvent läser fältet och använder det om JSON-LD saknar description.
  if (pageMetaDescription && !obj.__meta_description) {
    obj.__meta_description = pageMetaDescription;
  }
  // 2026-10-02 — body-fallback (Round 2 utökning). Injicera body-paragraph
  // som `__body_description` på samma sätt. Sista fallback om JSON-LD
  // description OCH meta description båda är tomma/för korta.
  if (bodyDescription && !obj.__body_description) {
    obj.__body_description = bodyDescription;
  }
  const type: string = String(obj['@type'] || '');

  // 2026-10-02 — 5.3 description-arv. inheritedDescription propageras ner i
  // rekursionen så att Event-objekt inuti NewsArticle.about[] eller
  // WebPage.mainEntity kan ärva Parentara felande description.
  //
  // Exempel: thatsup.se/stockholm/article/* har @graph[WebPage] med
  // description="Konstruktion och bild är en utställning..." och
  // @graph[NewsArticle].about[] med 39-58 events som saknar description.
  // Innan 5.3: Events fångades inte alls. Efter 5.3 med description-arv:
  // Events fångas OCH får description från WebPage.

  // 2026-10-02 — Round 2. Acceptera schema.org Event-subtyper
  // (MusicEvent, BusinessEvent, etc.) så att spelning.se m.fl. fångas.
  // Tidigare filtrerades MusicEvent bort och spelning.se-description försvann.
  const EVENT_SUBTYPES_LOCAL = new Set([
    'Event', 'MusicEvent', 'BusinessEvent', 'EducationEvent',
    'SportsEvent', 'TheaterEvent', 'Festival', 'LiteraryEvent',
    'SaleEvent', 'SocialEvent', 'VisualArtsEvent', 'ExhibitionEvent',
    'FoodEvent', 'ChildrensEvent', 'DanceEvent', 'ComedyEvent',
    'CourseInstance', 'ScreeningEvent', 'EventSeries', 'EventTicket',
  ]);
  if (typeof type === 'string' && EVENT_SUBTYPES_LOCAL.has(type)) {
    // Om Event saknar egen description OCH vi har en inherited → använd den.
    const eventHasOwnDescription = typeof obj.description === 'string' && obj.description.trim().length >= 10;
    const dataForEvent = !eventHasOwnDescription && inheritedDescription
      ? { ...obj, description: inheritedDescription }
      : obj;
    const evt = makeEvent(dataForEvent, 'A1', source, baseUrl);
    if (evt) acc.push(evt);
  }

  // Beräkna vilken description som propageras ner till children.
  // Prioritet:
  //   1. Aktuell nod har egna `description` → children ärver den.
  //   2. Annars behåll inheritedDescription (från parent context, t.ex.
  //      WebPage-beskrivning i samma @graph).
  //   3. Sista utväg: aktuell headline (men BARA om vi inte redan har en
  //      inherited description — annars prioriteras den exklares beskrivning
  //      som har rikare innehåll).
  let childInheritedDescription: string | null;
  if (typeof obj.description === 'string' && obj.description.trim().length >= 10) {
    childInheritedDescription = obj.description;
  } else if (inheritedDescription) {
    childInheritedDescription = inheritedDescription;
  } else if (typeof obj.headline === 'string' && obj.headline.trim().length >= 10) {
    childInheritedDescription = obj.headline;
  } else {
    childInheritedDescription = null;
  }

  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) collectJsonLdEvents(item, source, baseUrl, acc, childInheritedDescription, pageMetaDescription, bodyDescription);
  }

  if (Array.isArray(obj.itemListElement)) {
    for (const item of obj.itemListElement) {
      if (typeof item === 'object' && item) {
        const i = item as Record<string, unknown>;
        const itemType = String(i['@type'] || '');
        const eventObj = i.item || i;
        if (typeof eventObj === 'object' && eventObj) {
          const et = String((eventObj as Record<string,unknown>)['@type'] || '');
          // 2026-10-02 — Round 2. Acceptera Event-subtyper (MusicEvent etc.)
          // i itemListElement också (annexet använder MusicEvent i listor).
          if (EVENT_SUBTYPES_LOCAL.has(et) || EVENT_SUBTYPES_LOCAL.has(itemType)) {
            const evt = makeEvent(eventObj as Record<string,unknown>, 'A1', source, baseUrl);
            if (evt) acc.push(evt);
          }
        }
      }
    }
  }

  for (const key of ['subEvent', 'subEvents', 'superEvent']) {
    if (Array.isArray(obj[key])) {
      for (const sub of obj[key]) collectJsonLdEvents(sub, source, baseUrl, acc, childInheritedDescription, pageMetaDescription, bodyDescription);
    } else if (obj[key]) {
      collectJsonLdEvents(obj[key], source, baseUrl, acc, childInheritedDescription, pageMetaDescription, bodyDescription);
    }
  }

  // 2026-10-02 — NewsArticle / WebPage wrappers (5.3). Schema.org article
  // pages often wrap an Event inside NewsArticle.about[] or WebPage.mainEntity
  // rather than emitting a top-level Event. Exempel: thatsup.se/stockholm/article/*
  // har @graph[NewsArticle].about[] med 39-58 events per sida.
  // Vi rekurserar in i båda fälten så extractorn plockar det nested eventet.
  // inheritedDescription propageras ner så att nested Events utan egen
  // description får article-beskrivningen som fallback.
  for (const key of ['about', 'mainEntity']) {
    if (Array.isArray(obj[key])) {
      for (const item of obj[key]) collectJsonLdEvents(item, source, baseUrl, acc, childInheritedDescription, pageMetaDescription, bodyDescription);
    } else if (obj[key] && typeof obj[key] === 'object') {
      collectJsonLdEvents(obj[key], source, baseUrl, acc, childInheritedDescription, pageMetaDescription, bodyDescription);
    }
  }

  if (Array.isArray(obj['@set'])) {
    for (const item of obj['@set']) collectJsonLdEvents(item, source, baseUrl, acc, childInheritedDescription, pageMetaDescription, bodyDescription);
  }
}

/**
 * Hitta den bästa description-kandidat i ett JSON-LD-träd INNAN event-extrahering
 * börjar. Används som root-inheritedDescription så att wrapper-objekt i @graph
 * kan ärva description från siblings (t.ex. WebPage.description → NewsArticle.
 * about[] → nested Event).
 *
 * Söker i prioritetsordning:
 *   1. Top-level obj.description (om någon finns)
 *   2. Top-level obj.headline (om någon finns)
 *   3. Beskrivning från @graph items (WebPage.description prioriterat)
 *
 * Returnerar null om ingen lämplig description hittas.
 */
function findRootDescription(ctx: any): string | null {
  if (!ctx || typeof ctx !== 'object') return null;

  // Prioritet 1: top-level
  if (typeof ctx.description === 'string' && ctx.description.trim().length >= 10) {
    return ctx.description;
  }
  if (typeof ctx.headline === 'string' && ctx.headline.trim().length >= 10) {
    return ctx.headline;
  }

  // Prioritet 2: @graph items (söker — bloggsajter som Wrappers sätter
  // description i en sibling-nod)
  if (Array.isArray(ctx['@graph'])) {
    for (const item of ctx['@graph']) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.description === 'string' && item.description.trim().length >= 10) {
        return item.description;
      }
    }
  }

  return null;
}

// ─── Method A2: Microdata ─────────────────────────────────────────────────────

function extractMicrodata($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  $('[itemtype*="schema.org/Event"]').each((_, el) => {
    const data: Record<string, unknown> = {};
    // P1D (2026-09-10): hantera NESTED itemprops (location, offers, organizer
    // har egna [itemscope][itemtype]). Tidigare plockade vi bara content/
    // datetime/text; nu hanterar vi även URL-från href, src från img, och
    // nested objects via rekursiv extrahering.
    //
    // VIKTIGT: endast DIRECT children med itemprop tillhör event-noden.
    // Nested itemscope-träd hanteras separat och propageras INTE uppåt.
    collectMicrodataProps($, el as unknown as Element, data);
    const evt = makeEvent(data, 'A2', source, baseUrl);
    if (evt) events.push(evt);
  });

  return events;
}

/**
 * Rekursivt extrahera itemprops. Hanterar:
 *   - content-attribute (vanligt för SEO)
 *   - datetime-attribute (för <time itemprop>)
 *   - href-attribute (för <a itemprop>)
 *   - src-attribute (för <img itemprop>)
 *   - textContent (fallback)
 *   - nested [itemscope][itemtype] som object (Place, PostalAddress, Offer)
 *
 * VIKTIGT: cherryio's `find()` rekurserar ner i trädet — vi måste explicit
 * exkludera nested itemscope-träd från vår egen scope så att location.name
 * inte bubblar upp till event.name.
 */
function collectMicrodataProps(
  $: cheerio.CheerioAPI,
  root: Element,
  data: Record<string, unknown>,
): void {
  // Exkludera ALLA element som ligger inuti en nested [itemscope] från vår
  // egen scope. Detta görs genom att filtrera bort element vars närmaste
  // [itemscope]-förälder INTE är root.

  const isInsideNestedScope = (el: Element): boolean => {
    // Walka uppåt; om vi hittar en [itemscope] som inte är root → vi är nested.
    let cur = el.parent as Element | null;
    while (cur && cur !== root) {
      if ($(cur).is('[itemscope]')) return true;
      cur = cur.parent as Element | null;
    }
    return false;
  };

  // Pass 1: direct props (inte inuti nested scope, inte heller [itemscope] själva)
  $(root).find('[itemprop]').each((_, e2) => {
    if ($(e2).is('[itemscope]')) return; // skippa nested objects (hanteras i pass 2)
    if (isInsideNestedScope(e2 as unknown as Element)) return; // skippa barn till nested

    const prop = $(e2).attr('itemprop') || '';
    if (!prop) return;

    let val = $(e2).attr('content');
    if (!val) val = $(e2).attr('datetime');
    if (!val && $(e2).is('a[href]')) val = $(e2).attr('href') || undefined;
    if (!val && $(e2).is('img[src]')) val = $(e2).attr('src') || undefined;
    if (!val) val = $(e2).text();

    val = (val || '').trim();
    if (!val) return;

    if (data[prop] !== undefined) {
      if (Array.isArray(data[prop])) {
        (data[prop] as unknown[]).push(val);
      } else {
        data[prop] = [data[prop] as string, val];
      }
    } else {
      data[prop] = val;
    }
  });

  // Pass 2: nested [itemscope]-element (Place, PostalAddress, Offer, etc.)
  $(root).find('[itemscope][itemprop]').each((_, e2) => {
    if (isInsideNestedScope(e2 as unknown as Element)) return; // bara direct children

    const prop = $(e2).attr('itemprop') || '';
    if (!prop) return;

    const nested: Record<string, unknown> = {};
    const nestedType = $(e2).attr('itemtype') || '';
    if (nestedType) nested['@type'] = nestedType.split('/').pop() || nestedType;
    collectMicrodataProps($, e2 as unknown as Element, nested);

    if (Array.isArray(data[prop])) {
      (data[prop] as unknown[]).push(nested);
    } else if (data[prop] !== undefined) {
      data[prop] = [data[prop], nested];
    } else {
      data[prop] = nested;
    }
  });
}

// ─── Method B2: __NEXT_DATA__ (Next.js) ──────────────────────────────────────

function extractNextJsData(html: string, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return events;

  try {
    const parsed = JSON.parse(match[1]);
    recursivelyCollectEvents(parsed.props?.pageProps || parsed.props || parsed, events, source, baseUrl);
  } catch { /* skip */ }

  return events;
}

// ─── Method B1/B3: __INITIAL_STATE__ / window.* ─────────────────────────────

function extractInitialState(html: string, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  const m1 = html.match(/window\.__INITIAL_STATE__\s*=\s*JSON\.parse\s*\(\s*"((?:[^"\\]|\\.)*)"/);
  if (m1) {
    try {
      const unescaped = m1[1]
        .replace(/\\"/g, '"').replace(/\\n/g, '\n')
        .replace(/\\u[\da-f]{4}/gi, (s) => String.fromCodePoint(parseInt(s.slice(2), 16)))
        .replace(/\\\\/g, '\\');
      const data = JSON.parse(unescaped);
      recursivelyCollectEvents(data, events, source, baseUrl);
    } catch { /* skip */ }
  }

  if (events.length > 0) return events;

  for (const varName of ['__STATE__', 'INITIAL_DATA', 'EVENTS_DATA', 'eventStore', 'EVENT_STORE', 'pageData', 'GLOBALS']) {
    const rx = new RegExp('window\\.' + varName + '\\s*=\\s*({[\\s\\S]*?})\\s*;?', '');
    const m = html.match(rx);
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        recursivelyCollectEvents(data, events, source, baseUrl);
        if (events.length > 0) return events;
      } catch { /* skip */ }
    }
  }

  // Generic JSON.parse("...") inside script blocks
  const jsonParseRx = /JSON\.parse\s*\(\s*"((?:[^"\\]|\\.)*)"/g;
  let jsonMatch;
  while ((jsonMatch = jsonParseRx.exec(html)) !== null) {
    try {
      const unescaped = jsonMatch[1]
        .replace(/\\"/g, '"').replace(/\\n/g, '\n')
        .replace(/\\u[\da-f]{4}/gi, (s) => String.fromCodePoint(parseInt(s.slice(2), 16)));
      const data = JSON.parse(unescaped);
      const before = events.length;
      recursivelyCollectEvents(data, events, source, baseUrl);
      if (events.length > before) return events;
    } catch { /* continue */ }
  }

  return events;
}

function recursivelyCollectEvents(data: unknown, acc: ParsedEvent[], source: string, baseUrl: string): void {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'object' && item) {
        const obj = item as Record<string, unknown>;
        if (obj.name || obj.title || obj.eventTitle) {
          const evt = makeEvent(obj, 'B1', source, baseUrl);
          if (evt) acc.push(evt);
        }
        recursivelyCollectEvents(item, acc, source, baseUrl);
      }
    }
    return;
  }

  const obj = data as Record<string, unknown>;

  if (obj.name || obj.title) {
    const evt = makeEvent(obj, 'B1', source, baseUrl);
    if (evt) acc.push(evt);
  }

  for (const key of ['events', 'eventList', 'items', 'data', 'results', 'children', 'entries', 'content', 'event', 'eventsData', 'eventData', '_events', 'allEvents']) {
    if (obj[key]) recursivelyCollectEvents(obj[key], acc, source, baseUrl);
  }
}

// ─── Method B4: AppRegistry.registerInitialState ───────────────────────────────

function extractAppRegistryEvents(html: string, source: string, baseUrl: string, acc: ParsedEvent[]): boolean {
  const callStart = html.indexOf("AppRegistry.registerInitialState('");
  if (callStart < 0) return false;

  const braceStart = html.indexOf(',', callStart);
  if (braceStart < 0) return false;

  let jsonStart = -1;
  for (let i = braceStart; i < html.length && i < braceStart + 100; i++) {
    if (html[i] === '{') { jsonStart = i; break; }
  }
  if (jsonStart < 0) return false;

  let depth = 0, jsonEnd = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
    if (html.slice(i, i + 9) === '</script>') { jsonEnd = i - 1; break; }
  }
  if (jsonEnd < 0) return false;

  const jsonStr = html.slice(jsonStart, jsonEnd + 1);

  try {
    const data = JSON.parse(jsonStr);
    return collectEventsFromObject(data, acc, source, baseUrl);
  } catch {
    try {
      const cleaned = jsonStr.replace(/,(\s*[}\]])/g, '$1');
      const data = JSON.parse(cleaned);
      return collectEventsFromObject(data, acc, source, baseUrl);
    } catch { return false; }
  }
}

// ─── Method B5: Large JS blocks with arrays ───────────────────────────────────

function extractJsEmbeddedEvents(html: string, source: string, baseUrl: string): { events: ParsedEvent[]; method: string } {
  const events: ParsedEvent[] = [];

  // B4d: AppRegistry
  const appOk = extractAppRegistryEvents(html, source, baseUrl, events);
  if (appOk && events.length > 0) return { events, method: 'B4d' };

  // B2: __NEXT_DATA__
  const nextEvents = extractNextJsData(html, source, baseUrl);
  if (nextEvents.length > 0) {
    events.push(...nextEvents);
    return { events, method: 'B2' };
  }

  // B1/B3: InitialState / window.*
  const initEvents = extractInitialState(html, source, baseUrl);
  if (initEvents.length > 0) {
    events.push(...initEvents);
    return { events, method: 'B1' };
  }

  const $ = cheerio.load(html);

  const scriptBlocks: Array<{ content: string; len: number }> = [];
  $('script').each((_, el) => {
    const content = (el.children[0] as unknown as { data?: string })?.data || $(el).html() || '';
    if (content.length < 5000 && !content.includes('"events"') && !content.includes("'events'")) return;
    scriptBlocks.push({ content, len: content.length });
  });
  scriptBlocks.sort((a, b) => b.len - a.len);

  for (const { content } of scriptBlocks) {
    let found = extractEventsArrayPattern(content, source, baseUrl, events, '"events":');
    if (found) return { events, method: 'B5a' };

    found = extractEventsArrayPattern(content.replace(/'/g, '"'), source, baseUrl, events, '"events":');
    if (found) return { events, method: 'B5b' };

    for (const varName of ['eventList', 'eventsData', 'event_data', 'EVENT_DATA', 'window.events', 'eventData', '_events', 'allEvents', 'eventItems']) {
      const rx = new RegExp('(?:var|let|const)\\s+' + varName + '\\s*=\\s*\\[', '');
      if (rx.test(content)) {
        const idx = content.search(rx);
        const arrStart = content.indexOf('[', idx);
        if (arrStart >= 0) {
          let depth = 0, arrEnd = -1;
          for (let k = arrStart; k < content.length; k++) {
            if (content[k] === '[') depth++;
            else if (content[k] === ']') { depth--; if (depth === 0) { arrEnd = k; break; } }
            if (depth === 0 && k > arrStart + 10) break;
          }
          if (arrEnd > arrStart) {
            const arrStr = content.slice(arrStart, arrEnd + 1).replace(/,(\s*[}\]])/g, '$1');
            const parsed = tryParseJson(arrStr);
            if (parsed && Array.isArray(parsed)) {
              let count = 0;
              for (const item of parsed) {
                if (typeof item === 'object' && item) {
                  const evt = makeEvent(item as Record<string,unknown>, 'B5c', source, baseUrl);
                  if (evt) { events.push(evt); count++; }
                }
              }
              if (count > 0) return { events, method: 'B5c' };
            }
          }
        }
      }
    }
  }

  return { events: [], method: '' };
}

function collectEventsFromObject(obj: unknown, acc: ParsedEvent[], source: string, baseUrl: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    let found = false;
    for (const item of obj) {
      if (collectEventsFromObject(item, acc, source, baseUrl)) found = true;
    }
    return found;
  }

  const o = obj as Record<string, unknown>;

  if (Array.isArray(o.events) && o.events.length > 0) {
    let count = 0;
    for (const item of o.events) {
      if (typeof item === 'object' && item) {
        const evt = makeEvent(item as Record<string,unknown>, 'B4d', source, baseUrl);
        if (evt) { acc.push(evt); count++; }
      }
    }
    return count > 0;
  }

  for (const key of ['data', 'items', 'results', 'children', 'entries', 'content', 'event', 'eventsData', 'pageProps']) {
    if (o[key]) {
      if (collectEventsFromObject(o[key], acc, source, baseUrl)) return true;
    }
  }

  return false;
}

function extractEventsArrayPattern(
  content: string, source: string, baseUrl: string, acc: ParsedEvent[], key: string
): boolean {
  const idx = content.indexOf(key);
  if (idx < 0) return false;

  let arrStart = -1;
  for (let i = idx + key.length; i < content.length; i++) {
    if (content[i] === '[') { arrStart = i; break; }
    if (content[i] === '{' || content[i] === '"') return false;
  }
  if (arrStart < 0) return false;

  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
    if (depth === 0 && i > arrStart + 10) {
      const rest = content.slice(i+1, i+20).trim();
      if (rest.startsWith('}') || (rest.startsWith(',') && rest.includes('}'))) { arrEnd = i; depth = 0; break; }
    }
  }
  if (arrEnd < 0) return false;

  const arrStr = content.slice(arrStart, arrEnd + 1);
  const cleaned = arrStr.replace(/,(\s*[}\]])/g, '$1');
  const parsed = tryParseJson(cleaned);
  if (!parsed || !Array.isArray(parsed)) return false;

  let count = 0;
  for (const item of parsed) {
    if (typeof item === 'object' && item && !Array.isArray(item)) {
      const evt = makeEvent(item as Record<string,unknown>, 'B5', source, baseUrl);
      if (evt) { acc.push(evt); count++; }
    }
  }

  return count > 0;
}

// ─── PHASE 3: HTML HEURISTICS ────────────────────────────────────────────────

/**
 * Rich HTML event card extraction — 20x selector universe vs v1.
 * Groups all related fields (title, date, venue, image, price) per event card.
 */
function extractHtmlHeuristics($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const EVENT_CARD_SELECTORS = [
    // Swedish venue patterns (most important)
    '[class*="event"]', '[class*="kalender"]', '[class*="evenemang"]',
    '[class*="program"]', '[class*="konsert"]', '[class*="forestilling"]',
    '[class*="show"]', '[class*="biljett"]', '[class*="arrangement"]',
    '[class*="arrangemang"]', '[class*="aktivitet"]', '[class*="activity"]',
    // International
    'article', '.card', '.item', '.entry', '.post',
    'li[class*="event"]', 'li[class*="kalender"]', 'li[class*="program"]',
    'li[class*="item"]', 'li[class*="card"]',
    // Data attributes
    '[data-event]', '[data-item]', '[data-type="event"]',
    '[role="article"]', '[itemtype*="Event"]',
    // Rich CSS class patterns
    '.event-card', '.event-item', '.event-row', '.event-block',
    '.kalender-item', '.kalender-rad', '.program-item', '.program-rad',
    '.evenemang-item', '.happening-item', '.happening-card',
    '.activity-item', '.activity-card',
  ];

  /**
   * Titel ur ett evenemangskort.
   *
   * `fromImgAlt` markerar när titeln KOM FRÅN bildens alt-text. Det är
   * sista utväg, och alt-texten är en bildbeskrivning ("Komikern Kirsty
   * Armstrong med rödlockigt hår och rosa pikétröja…"), inte ett
   * eventnamn. Se eventDedup.ts (regel R2).
   */
  function extractTitle($el: cheerio.CheerioAPI, $card: any): { title: string; fromImgAlt: boolean } {
    const headingSelectors = [
      'h1', 'h2', 'h3', 'h4',
      '[class*="title"]', '[class*="heading"]', '[class*="namn"]', '[class*="name"]',
      '[data-title]', '[data-name]',
    ];
    // 2026-10-24 — vissa kort lägger datumet i den FÖRSTA rubriken och
    // evenemangets namn i en senare ("<h2>6 NOV, 14:30</h2>" +
    // "<h3>Gustav Adolf - dagen</h3>"). Se dateOnlyTitles.ts.
    const headingCandidates: string[] = [];
    for (const sel of headingSelectors) {
      $card.find(sel).each((_: any, el: any) => {
        headingCandidates.push($(el).text().trim().replace(/\s+/g, ' '));
      });
    }
    const heading = pickTitleCandidate(headingCandidates);
    if (heading) return { title: heading, fromImgAlt: false };
    const anchorTitle = $card.find('a[title]').attr('title') || '';
    if (anchorTitle.length > 2) return { title: anchorTitle, fromImgAlt: false };
    const linkText = $card.find('a').first().text().trim();
    if (linkText.length > 2) return { title: linkText, fromImgAlt: false };
    return { title: $card.find('img[alt]').attr('alt') || '', fromImgAlt: true };
  }

  function extractDate($el: cheerio.CheerioAPI, $card: any): { date: string; time?: string; endDate?: string } {
    const $time = $card.find('time[datetime]').first();
    if ($time.length) {
      const dt = $time.attr('datetime') || '';
      // 2026-10-24 — en TOM datetime-attribut är INTE ett datum. Om
      // attributet inte ger ett giltigt datum fortsätter sökningen i
      // korttexten, där det riktiga datumet står ("17 oktober 2026").
      // Tidigare avslutades sökningen här, och eventet försvann.
      if (dt.trim()) {
        const parsed = parseDate(dt);
        if (parsed.date) return parsed;
      }
    }
    for (const attr of ['data-date', 'data-start', 'data-event-date', 'data-datetime', 'data-time']) {
      const val = $card.attr(attr) || '';
      if (!val.trim()) continue;
      const parsed = parseDate(val);
      if (parsed.date) return parsed;
    }
    const cardText = $card.text();

    // ── Datum-precedens (2026-10-24) ────────────────────────────────────
    // Ordningen nedan är medveten: ett datum som står UTSKRIVET med år är
    // absolut och får aldrig förlora mot ett årslöst (infererat) datum.
    //
    //   1. intervall MED år          ("12-14 januari 2027",
    //                                  "3 oktober 2026 – 28 februari 2027")
    //   2. enstaka datum MED år      ("17 november 2026")
    //   3. intervall UTAN år          ("23-28 oktober",
    //                                  "11 oktober – 23 november")
    //   4. European short            ("25/10")
    //   5. enstaka datum UTAN år     ("24 okt")
    //   6. relativt ("imorgon")
    //   7. datum i länken
    //
    // Inom "intervall" gäller: det intervall som nämns FÖRST i texten
    // vinner (se collectRangeCandidates).
    //
    // BEVIS för att 2 ska ligga före 4 (Generalization Protection Rule —
    // General, 2 orelaterade domäner):
    //   dansenshus.se — "Dansmässan 2026 17 november 2026" med adressen
    //   "Barnhusgatan 12-14" gav 2026-12-14: sifferparet i ADRESSEN lästes
    //   som dag 14 + månad 12. Rätt ordning ger 2026-11-17.
    //   pingst.se — samma felform ("… 12-14 januari 2027" → 2026-12-14).
    //
    // BEVIS för att 2 ska ligga före 3:
    //   dansenshus.se — teasertexten "5-13 maj…" (årslöst) i samma kort
    //   som det egna datumet "7-8 maj 2026" tog över: 2026-05-05 i stället
    //   för 2026-05-07.

    // 1 — intervall med år ("12-14 januari 2027", "30 oktober – 27
    // december 2026"). Det FÖRSTA intervallet i texten vinner, oavsett om
    // det är vanligt eller korsmånadsintervall.
    //
    // Utan den här regeln fick "30 oktober – 27 december" SLUTDAGEN som
    // startdatum: evenemanget såg ut att började dagen det slutade.
    const rangeWithYear = parseSwedishRangeWithYear(cardText);
    if (rangeWithYear) {
      const t = TIME_RX.exec(cardText);
      return {
        date: rangeWithYear.start,
        endDate: rangeWithYear.end,
        time: t ? formatTime(t[1], t[2]) : undefined,
      };
    }

    // 2 — enstaka datum med år ("17 november 2026").
    const sweDateRx = /(?<!\d)(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i;
    if (cardText.match(sweDateRx)) {
      const parsed = parseDate(cardText);
      // parseDate faller tillbaka på "första 10 tecken" om inget mönster
      // träffar — det är trasig text, inte ett datum. Då går vi vidare
      // till nästa regel i stället för att skriva ut trasigheten.
      if (parsed.date && isValidIsoDate(parsed.date)) return parsed;
    }

    // 3 — intervall utan år ("23-28 oktober", "11 oktober – 23 november").
    // Året härleds från SLUTDAGEN (se inferRangeYear) så att ett pågående
    // evenemang inte tappas.
    const rangeWithoutYear = parseSwedishRangeWithoutYear(cardText, {
      allowInferredYear: !isArchiveContext($, baseUrl),
    });
    if (rangeWithoutYear) {
      const t = TIME_RX.exec(cardText);
      return {
        date: rangeWithoutYear.start,
        endDate: rangeWithoutYear.end,
        time: t ? formatTime(t[1], t[2]) : undefined,
      };
    }

    // European short: dd/mm or dd-mm without year (common in calendar grids).
    //
    // 2026-10-09 — Hallsberg-bug: `12.00-15.00` matchade som `00-15` →
    // `2026-00-15`. Fix: lookbehind `(?<![\d.])`.
    //
    // 2026-10-23 — Kolon-bug: samma problem med KOLON istället för punkt.
    // `10:00-17:00` matchade `00-17` → `2026-00-17`. Bevis på 3 orelaterade
    // domäner (nordiskamuseet.se, kungligamusikhogskolan.se, fallan.nu).
    // Fix: kolon blockeras BÅDE före första siffran (`:` i lookbehind) och
    // efter andra siffran (`:` i trailing-guard). `Event 25-10` och `5/12`
    // fungerar kvar — de föregås inte av kolon.
    //
    // 2026-10-24 — negativ lookahead: ett sifferpar får INTE läsas som
    // "dag/månad" när ett svenskt månadsnamn följer direkt efter — då är det
    // ett interval ("12-14 januari"), inte "14 december". Intervallen ovan
    // fångas redan; skydden här gäller intervall som inte går att tolka
    // (ogiltiga datum) — då ska vi hellre sakna datum än hitta på ett.
    const shortDateRx = new RegExp(
      `(?<![\\d.:])(\\d{1,2})[/\\-](\\d{1,2})(?!\\d|:)${SWE_MONTH_FOLLOWS_LOOKAHEAD}`,
    );
    const shortMatch = cardText.match(shortDateRx);
    if (shortMatch) {
      const a = shortMatch[1];
      const b = shortMatch[2];
      let day: string, month: string;
      if (parseInt(a) > 12) { day = a; month = b; }
      else if (parseInt(b) > 12) { day = b; month = a; }
      else { day = a; month = b; } // SE default
      const year = new Date().getFullYear();
      const dateStr = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
      // 2026-10-24 — "30-31 oktober" ger day=30, month=31 → "2026-31-30".
      // Ett ogiltigt datum får inte lämna extractorn: det landar i
      // databasen som trasig tid. Bevis: dansenshus.se ("2026-31-30"),
      // tekniskamuseet.se ("2026-06-00").
      if (isValidIsoDate(dateStr)) {
        const t = TIME_RX.exec(cardText);
        return { date: dateStr, time: t ? formatTime(t[1], t[2]) : undefined };
      }
    }
    // 2026-10-24 — årslöst svenskt datum ("23 okt", "24 okt lördag").
    // Utan detta ger venue-kalendrar NOLL events. Se parseSwedishMonthDay
    // för beviset (4 orelaterade domäner).
    if (!isArchiveContext($, baseUrl)) {
      const noYear = cardText.match(SWE_DATE_NO_YEAR_RX);
      if (noYear) {
        const inferred = parseSwedishMonthDay(noYear[1], noYear[2]);
        if (inferred) {
          const t = TIME_RX.exec(cardText);
          return { date: inferred, time: t ? formatTime(t[1], t[2]) : undefined };
        }
      }
    }
    for (const rel of ['imorgon', 'i dag', 'idag']) {
      if (cardText.toLowerCase().includes(rel)) {
        const result = parseRelativeSwedishDate(rel);
        if (result) return { date: result };
      }
    }
    const href = $card.find('a[href]').first().attr('href') || '';
    const urlMatch = href.match(/(\d{4}-\d{2}-\d{2})/);
    if (urlMatch) return parseDate(urlMatch[1]);
    return { date: '' };
  }

  function extractVenue($el: cheerio.CheerioAPI, $card: any): { venue: string; city: string } {
    const venueSelectors = [
      '[class*="venue"]', '[class*="location"]', '[class*="plats"]', '[class*="adress"]',
      '[class*="arena"]', '[class*="scene"]', '[class*="ort"]', '[class*="stad"]',
      'address', '[class*="where"]', '[class*="location-name"]',
    ];
    for (const sel of venueSelectors) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1 && t.length < 200) {
        const parts = t.split(',').map((p: string) => p.trim());
        if (parts.length >= 2) return { venue: parts[0], city: parts[1] };
        return { venue: t, city: '' };
      }
    }
    return { venue: '', city: '' };
  }

  function extractPrice($card: any): { price: string; isFree: boolean } {
    const priceSelectors = [
      '[class*="price"]', '[class*="biljett"]', '[class*="kostnad"]', '[class*="pris"]',
      '[class*="entry-price"]', '[class*="ticket"]', '[class*="cost"]',
      '[data-price]', '[data-cost]',
    ];
    for (const sel of priceSelectors) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length < 50) {
        const isFree = /gratis|free|fritt|0\s*(kr|sek)|kostnadsfri/i.test(t);
        if (isFree || /\d/.test(t)) return { price: t, isFree };
      }
    }
    return { price: '', isFree: false };
  }

  function extractImage($card: any, baseUrl: string): string {
    const $pic = $card.find('picture source[srcset]').first();
    if ($pic.length) {
      const srcset = $pic.attr('srcset') || '';
      const first = srcset.split(',')[0].trim().split(' ')[0];
      if (first) return buildUrl(first, baseUrl);
    }
    for (const sel of ['img[src]', 'img[data-src]', '[class*="image"] img', '[class*="poster"] img']) {
      const $img = $card.find(sel).first();
      if ($img.length) {
        const src = $img.attr('src') || $img.attr('data-src') || '';
        if (src && !src.includes('data:') && src.length > 4) return buildUrl(src, baseUrl);
      }
    }
    return '';
  }

  function extractUrl($card: any, baseUrl: string): string {
    // 2026-10-24 — skippa kategori-/tagglänkar (rel="tag") och biljettsköp:
    // de pekar på filter respektive checkout, inte på eventet.
    const usable = $card
      .find('a[href]')
      .filter((_: any, el: any) => {
        const rel = ($(el).attr('rel') || '').trim().split(/\s+/)[0];
        if (rel && TAXONOMY_REL_RX.test(rel)) return false;
        if (isTicketCheckoutLink($(el).attr('href') || '', $(el).attr('class') || '')) return false;
        return true;
      })
      .first();
    // Fallback: har kortet bara en biljettlänk är den bättre än ingen URL.
    const $a = usable.length ? usable : $card.find('a[href]').first();
    const href = $a.attr('href') || '';
    if (!href || href === '#' || href === '/' || href.startsWith('#')) return '';
    return buildUrl(href, baseUrl);
  }

  function extractCategory($card: any): string {
    // 2026-10-01: delegate to shared detectCategoryFromContainerClass() which
    // covers all 23 v3 categories with proper ordering + Generalization
    // Protection Rule. The previous local regex returned deprecated slugs
    // ('theater', 'art', 'festival', 'education', 'culture') which canonicalize
    // → 'community' and inflated the bucket.
    const attr = ($card.attr('class') || '') + ' ' + ($card.attr('data-category') || '');
    return detectCategoryFromContainerClass(attr);
  }

  function extractDescription($card: any): string {
    for (const sel of ['p', '[class*="desc"]', '[class*="text"]', '[class*="summary"]', '[class*="intro"]', '[class*="lead"]']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ').slice(0, 300);
      if (t && t.length > 10) return t;
    }
    return '';
  }

  function extractTicketUrl($card: any, baseUrl: string): string {
    for (const sel of ['a[class*="ticket"]', 'a[class*="biljett"]', 'a[class*="book"]', 'a[class*="köp"]', 'a[class*="boka"]']) {
      const href = $card.find(sel).first().attr('href') || '';
      if (href && href.length > 3) return buildUrl(href, baseUrl);
    }
    // 2026-10-24 — biljettsköp känns också igen på URL:en
    // ("biljetter.folkoperan.se/…/tickets/…").
    const byUrl = $card
      .find('a[href]')
      .filter((_: any, el: any) => isTicketCheckoutLink($(el).attr('href') || '', $(el).attr('class') || ''))
      .first();
    const href = byUrl.attr('href') || '';
    return href && href.length > 3 ? buildUrl(href, baseUrl) : '';
  }

  const $scope = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list, [class*="event"]');
  const $searchRoot = $scope.length >= 3 ? $scope : $('body');

  for (const sel of EVENT_CARD_SELECTORS) {
    $searchRoot.find(sel).each((_: any, el: any) => {
      const $card = $(el);

      if ($card.closest('nav, footer, .nav, .sidebar, [class*="breadcrumb"]').length > 0) return;
      // 2026-10-09 (A.5 Grand fix): undvik body/html som ancestor-match, och kräv
      // att en ancestor med news/post också har en semantisk news-blog-rolle.
      // Squarespace-defaults ger body class="...tweak-blog-..." vilket gjorde att
      // ALLA event-cards filtrerades bort. Vi tillåter nu article/blog-containrar
      // så länge de inte också har news/post i samma träd.
      const newsAncestor = $card.parents().filter((_: any, el: any) => {
        if (el.tagName === 'body' || el.tagName === 'html') return false;
        const cls = ($(el).attr('class') || '').toLowerCase();
        return /news|post/.test(cls);
      }).length;
      if (newsAncestor > 0) return;

      const { title, fromImgAlt } = extractTitle($, $card);
      if (!title || title.length < 2 || title.length > 200) return;

      const { date, time, endDate } = extractDate($, $card);
      if (!date) return;

      const { venue, city } = extractVenue($, $card);
      const { price, isFree } = extractPrice($card);
      const image = extractImage($card, baseUrl);
      const eventUrl = extractUrl($card, baseUrl);
      const category = extractCategory($card);
      const desc = extractDescription($card);
      const ticketUrl = extractTicketUrl($card, baseUrl);

      // 2026-10-24 — url MÅSTE vara i identitetsnyckeln. Två olika
      // företrädanden kan dela titel+datum+tid och ha klockan enbart i
      // url:en (konserthuset: .../20261025-1000/ och .../20261025-1130/).
      // Uppslagningen av url-lösa dubbletter sker i dedupeEvents (regel
      // R1') efter att metoderna slagits ihop — se eventDedup.ts.
      const key = `${title}|${date}|${time || ''}|${eventUrl || ''}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      try {
        const priceMin = price && !isFree ? parsePrice(price) : undefined;
        const evt = ParsedEventSchema.parse({
          title, date, time: time || undefined,
          // 2026-10-24 — datumintervall ("12-14 januari 2027") ger både
          // start och slut. Slutet skrivs som end_time i databasen.
          endDate: endDate || undefined,
          venue: venue || undefined, city: city || undefined,
          description: desc || undefined,
          url: eventUrl || undefined, ticketUrl: ticketUrl || undefined,
          category, isFree: isFree || undefined, priceMin,
          // AI-bilder är obligatoriskt → skippa scrape-bild helt.
          imageUrl: undefined,
          source, sourceUrl: baseUrl,
          confidence: {
            score: 0.72,
            hasTitle: true, hasDate: true, hasVenue: !!venue,
            hasUrl: !!eventUrl, hasDescription: !!desc,
            hasTicketInfo: !!(ticketUrl || isFree),
            signals: fromImgAlt ? ['html-rich-card', ALT_TEXT_TITLE_SIGNAL] : ['html-rich-card'],
          },
        });
        events.push(evt);
      } catch { /* skip malformed */ }
    });
  }

  return events;
}

/**
 * Extract events from <time datetime> anchors — groups time tag with nearby
 * title/link/venue/image. Primary pattern for Tribe Events Calendar, SiteVision, React.
 */
function extractTimeAnchors($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const $scope = $('main, article, [role="main"], .content, .kalender, .event-list, [class*="event"], body');
  const searchRoot = $scope.length >= 2 ? $scope : $('body');

  searchRoot.find('time[datetime]').each((_: any, timeEl: any) => {
    const $time = $(timeEl);
    const datetime = $time.attr('datetime') || '';
    if (!datetime || !/^\d{4}-\d{2}-\d{2}/.test(datetime)) return;

    if ($time.closest('nav, footer, [class*="breadcrumb"], [class*="nav"]').length > 0) return;
    // 2026-10-09 (A.5 Grand fix): samma body-träd som i C1 ovan.
    const timeNewsAncestor = $time.parents().filter((_: any, el: any) => {
      if (el.tagName === 'body' || el.tagName === 'html') return false;
      const cls = ($(el).attr('class') || '').toLowerCase();
      return /news|article|post/.test(cls);
    }).length;
    if (timeNewsAncestor > 0) return;

    const { date, time } = parseDate(datetime);

    const $card = $time.closest(
      'li, article, [class*="event"], [class*="kalender"], [class*="item"], [class*="card"], [class*="row"], [class*="program"], [class*="entry"], [class*="happening"]'
    );
    if (!$card.length) return;

    const cardClass = $card.attr('class') || '';
    if (/news|article|blog|post/i.test(cardClass)) return;

    // 2026-10-24 — samma datum-i-rubriken-problem som i extractTitle:
    // hoppa över kandidater som bara är ett datum.
    const headingCandidates: string[] = [];
    for (const sel of ['h1','h2','h3','h4','[class*="title"]','[class*="heading"]','[data-title]']) {
      $card.find(sel).each((_: any, el: any) => {
        headingCandidates.push($(el).text().trim().replace(/\s+/g, ' '));
      });
    }
    let title = pickTitleCandidate(headingCandidates);
    if (!title) title = $card.find('a[title]').attr('title') || '';
    if (!title) {
      const $link = $time.closest('a');
      if ($link.length) title = $link.attr('title') || $link.text().trim().replace(/\s+/g, ' ');
    }
    if (!title || title.length < 2) return;

    let eventUrl = '';
    const $link = $card.find('a[href]').filter((_: any, a: any) => {
      const t = $(a).text().trim();
      return t.length > 2 && !/^(boka|book|köp|buy|läs|read|mer|more)$/i.test(t);
    }).first();
    if ($link.length) {
      const href = $link.attr('href') || '';
      if (href && !href.startsWith('#')) eventUrl = buildUrl(href, baseUrl);
    }

    let venue = '', city = '';
    for (const sel of ['[class*="venue"]','[class*="location"]','[class*="plats"]','[class*="arena"]','[class*="scene"]','address']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1 && t.length < 200) {
        const parts = t.split(',').map((p: string) => p.trim());
        venue = parts[0]; city = parts[1] || ''; break;
      }
    }

    let image = '';
    const $img = $card.find('img[src]').first();
    if ($img.length) {
      const src = $img.attr('src') || '';
      if (src && !src.includes('data:')) image = buildUrl(src, baseUrl);
    }

    let isFree = false, priceMin: number | undefined;
    for (const sel of ['[class*="price"]','[class*="biljett"]','[class*="pris"]']) {
      const t = $card.find(sel).first().text().trim();
      if (t && /\d/.test(t)) {
        isFree = /gratis|free|fritt|0\s*(kr|sek)/i.test(t);
        if (!isFree) priceMin = parsePrice(t);
        break;
      }
    }

    let desc = '';
    for (const sel of ['p','[class*="desc"]','[class*="text"]','[class*="intro"]']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ').slice(0, 200);
      if (t && t.length > 10) { desc = t; break; }
    }

    // 2026-10-01: delegate to shared detectCategoryFromContainerClass() (same
    // rationale as the other extractCategory above — no more deprecated slugs).
    let category = detectCategoryFromContainerClass(cardClass);

    const key = `${title}|${date}|${time || ''}|${eventUrl}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title, date, time: time || undefined,
        venue: venue || undefined, city: city || undefined,
        description: desc || undefined,
        url: eventUrl || undefined,
        isFree: isFree || undefined, priceMin,
        // AI-bilder är obligatoriskt → skippa scrape-bild helt.
        imageUrl: undefined,
        category, source, sourceUrl: eventUrl || baseUrl,
        confidence: {
          score: 0.75,
          hasTitle: true, hasDate: true, hasVenue: !!venue,
          hasUrl: !!eventUrl, hasDescription: !!desc,
          hasTicketInfo: !!(isFree || priceMin !== undefined),
          signals: ['html-time-anchor'],
        },
      });
      events.push(evt);
    } catch { /* skip */ }
  });

  return events;
}

/**
 * Extract events from Swedish relative date expressions in page text.
 * Handles: "Imorgon", "I dag", "Onsdag" (standalone weekday → next occurrence).
 */
function extractSwedishRelativeDates($: cheerio.CheerioAPI, source: string, baseUrl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  const $scope = $('main, article, [role="main"], .content, .kalender, .event-list, [class*="event"]');
  const $searchRoot = $scope.length >= 2 ? $scope : $('body');

  $searchRoot.find('a[href]').each((_: any, el: any) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (href.startsWith('#') || href === '/' || !href) return;
    if ($a.closest('nav, footer, .nav, [class*="breadcrumb"]').length > 0) return;

    // rel="tag"/"category" → filterlänk till en kategori, aldrig eventet.
    const rel = ($a.attr('rel') || '').trim().split(/\s+/)[0];
    if (rel && TAXONOMY_REL_RX.test(rel)) return;

    // Biljettsköp ("biljett.se/…", "btn-biljett") → inte eventets URL.
    if (isTicketCheckoutLink(href, $a.attr('class') || '')) return;

    const linkText = $a.text().trim().replace(/\s+/g, ' ');
    if (linkText.length < 3 || linkText.length > 200) return;
    if (/^(boka|book|köp|buy|läs|read|mer|more|idag|imorgon)$/i.test(linkText)) return;

    // ── Kortet ────────────────────────────────────────────────────────
    // Det närmaste matchande elementet kan vara en LAYOUT-wrapper:
    // Tailwood-klassen "items-center" innehåller delsträngen "item" och
    // matchar därför [class*="item"]. Då saknas datumet i korttexten och
    // evenemanget försvinner helt. Därför går vi uppåt efter ett element
    // med EXAKT ett explicit datum. Expansionen kan bara skapa event
    // (ett kort utan datum ger 0 events redan idag).
    const $nearest = $a.closest(C3_CARD_SELECTOR);
    if (!$nearest.length) return;
    let $card = $nearest;
    if (!hasDateSignal($nearest.text())) {
      const $expanded = expandToDatedCard($nearest);
      if (!$expanded) return;
      $card = $expanded;
    }

    const cardText = $card.text();

    // ── Titel ─────────────────────────────────────────────────────────
    // Företräde för den DEDIKERADE titelmarkeringen: ankarens egen
    // ("<a><div class="title">…") eller kortets ("<p class="title">…").
    // Ankartexten kan ju vara "19:30 Stora scen Humor, Stand up KRISTOFFER …".
    const $ownTitle = $a.find(TITLE_ELEMENT_SELECTORS).first();
    const $cardTitle = $card.find(TITLE_ELEMENT_SELECTORS).first();
    let title: string;
    if ($ownTitle.length) {
      // 2026-10-24 — datum i första rubriken ("<h2>6 NOV, 14:30</h2>")
      // hoppas över till förmån för den riktiga titeln i kortet.
      const ownTitles: string[] = [];
      $a.find(TITLE_ELEMENT_SELECTORS).each((_: any, el: any) => {
        ownTitles.push($(el).text().trim().replace(/\s+/g, ' '));
      });
      title = pickTitleCandidate(ownTitles);
    } else if ($cardTitle.length) {
      // Kortet har en titel men ankaret bär den inte → ankaret är en
      // CTA-länk ("Läs mer", scen-filter). Bara kortets primära länk
      // bildar eventet.
      const $primary = primaryEventAnchor($, $card);
      if (!$primary.length || $primary[0] !== $a[0]) return;
      title = $cardTitle.text().trim().replace(/\s+/g, ' ');
    } else {
      title = linkText;
    }
    if (title.length < 3 || title.length > 200) return;

    let foundDate = '', foundTime = '', foundEndDate = '';

    // 2026-10-24 — datumINTERVALL ("12-14 januari 2027") är ETT event som
    // pågår 12–14 januari. Samma regel som i C1 (se extractDate).
    //
    // Intervallet kan ligga i kortet eller i texten bredvid kortet (t.ex. i
    // en kalenderlist där kortet bara är en länk) — därför läses båda.
    //
    // PRECEDENS: ett intervall MED år vinner över ett årslöst, även om det
    // årslösa ligger i kortet och det med år i texten bredvid. Ett utskrivet
    // år är absolut; ett gissat år är en gissning.
    //
    // Bevis: dansenshus.se — kortet med "5-13 maj…" (årslöst) bredvid
    // "7-8 maj 2026" gav 2026-05-05 i stället för 2026-05-07.
    const siblingText = $card.parent().clone().children().remove().end().text();
    const allowInferredYear = !isArchiveContext($, baseUrl);
    const range =
      parseSwedishRangeWithYear(cardText) ??
      parseSwedishRangeWithYear(siblingText) ??
      parseSwedishRangeWithoutYear(cardText, { allowInferredYear }) ??
      parseSwedishRangeWithoutYear(siblingText, { allowInferredYear });
    if (range) {
      foundDate = range.start;
      foundEndDate = range.end;
    }

    // 2026-10-24 — ett EXPLICIT ÅRSLÖST datum ("24 okt") slår alltid en
    // veckodagsinferens. Annars får "31 okt lör" fel datum: nästa lördag
    // efter 23 okt är 24 okt, inte 31 okt.
    //
    // Datum MED år ("23 oktober 2026") hanterar C1/C2 (kort med
    // klassmarkör). C3 ska inte gissa: en nyhetsartikels publiceringsdatum
    // ligger i samma text och skulle bli ett påhittat event.
    const explicitRx = new RegExp(SWE_EXPLICIT_DATE_RX.source, 'gi');
    const explicit = explicitRx.exec(cardText);
    if (!foundDate && explicit && !explicit[3]) {
      // Låt C1/C2 äga kortet om det har ett absolut <time datetime>, och
      // gissa aldrig ett år på en arkivsida.
      if ($card.find('time[datetime]').length > 0) return;
      if (isArchiveContext($, baseUrl)) return;
      const iso = explicitSwedishDateToIso(explicit[1], explicit[2], explicit[3]);
      if (!iso) return;
      foundDate = iso;
    }

    if (!foundDate) {
      for (const rel of ['imorgon', 'i dag', 'idag']) {
        if (cardText.toLowerCase().includes(rel)) {
          const result = parseRelativeSwedishDate(rel);
          if (result) { foundDate = result; break; }
        }
      }
    }

    if (!foundDate) {
      const weekdayRx = /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mandag|tirsdag|onsdag|torsdag|fredag|lordag|sondag)\b(?![\s,]*\d)/i;
      const wdMatch = cardText.match(weekdayRx);
      if (wdMatch) {
        const result = parseRelativeSwedishDate(wdMatch[1]);
        if (result) foundDate = result;
      }
    }

    if (!foundDate) {
      const sweDateRx = /(?<!\d)(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*\s+(\d{4})/i;
      const m = siblingText.match(sweDateRx);
      if (m) {
        const result = parseDate(siblingText);
        if (result.date) foundDate = result.date;
      }
    }

    if (!foundDate) return;

    const timeMatch = cardText.match(/\b(\d{1,2}):(\d{2})\b/);
    if (timeMatch) foundTime = formatTime(timeMatch[1], timeMatch[2]) || '';

    let venue = '';
    for (const sel of ['[class*="venue"]','[class*="location"]','[class*="plats"]','[class*="arena"]','address']) {
      const t = $card.find(sel).first().text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1) { venue = t; break; }
    }

    const eventUrl = buildUrl(href, baseUrl);
    const key = `${title}|${foundDate}|${foundTime}|${eventUrl}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    try {
      const evt = ParsedEventSchema.parse({
        title, date: foundDate, time: foundTime || undefined,
        endDate: foundEndDate || undefined,
        venue: venue || undefined, url: eventUrl || undefined,
        source, sourceUrl: eventUrl || baseUrl,
        confidence: {
          score: 0.60,
          hasTitle: true, hasDate: true, hasVenue: !!venue,
          hasUrl: !!eventUrl, hasDescription: false, hasTicketInfo: false,
          signals: ['html-swedish-relative-date'],
        },
      });
      events.push(evt);
    } catch { /* skip */ }
  });

  return events;
}

// ─── Open Graph Image Fallback ───────────────────────────────────────────────
// Strategy A (MASTERPLAN §13: "+10 image present" confidence). HTML pages that
// lack JSON-LD `image` (A1) or embedded JS image data (B1–B6) often still
// publish og:image / twitter:image as page-level meta tags. These are a cheap
// fallback for Tier-1 Stockholm sources. The fallback is per-page (meta tags
// describe the page, not individual events on a listing page).
//
// Order matches observed priority on Swedish event sites — og:image first.
function extractPageOgImage($: cheerio.CheerioAPI): string | undefined {
  const candidates: Array<string | undefined> = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content'),
    $('meta[name="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[property="twitter:image"]').attr('content'),
    $('meta[name="twitter:image:src"]').attr('content'),
    $('link[rel="image_src"]').attr('href'),
  ];
  for (const raw of candidates) {
    if (raw && typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return undefined;
}

/** Resolve relative URL against base. Returns raw input if it is already absolute or invalid. */
function absolutizeUrl(raw: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function extractEvents(html: string, source: string, baseUrl: string): ExtractResult {
  const errors: string[] = [];
  const methodBreakdown: Record<string, number> = {};
  const navSkipped: Record<string, number> = {};
  const allEvents: ParsedEvent[] = [];
  const seenKeys = new Set<string>();

  function addEvents(events: ParsedEvent[], method: string): void {
    for (const evt of events) {
      // 2026-10-24 — navigations-/CTA-texter är aldrig event-namn. T.ex. en
      // "köp biljetter"-länk i ett kort som råkar innehålla ett datum blev
      // annars ett event med titeln "Köp biljetter". Se navigationTitles.ts
      // för beviset (13 domäner) och den negativa kontrollen mot 12 120
      // events i databasen.
      if (isNavigationTitle(evt.title)) {
        navSkipped[method] = (navSkipped[method] || 0) + 1;
        continue;
      }
      // 2026-10-24 — url ingår i identitetsnyckeln (se C1-raderna ovan).
      // Dubbletter slås ihop efteråt av dedupeEvents (regel R1').
      const key = `${evt.title}|${evt.date}|${evt.time || ''}|${evt.url || ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allEvents.push(evt);
      methodBreakdown[method] = (methodBreakdown[method] || 0) + 1;
    }
  }

  if (!html || html.length < 100) {
    return { events: [], rawCount: 0, parseErrors: ['Empty HTML'], sourceUrl: baseUrl, methodsUsed: [], methodBreakdown: {} };
  }

  // PRIORITY: site-specific adapters (per CLAUDE.md Generalization Protection
  // Rule, isolated from C0/C1/C2). Run before any universal heuristic so that
  // site quirks are handled by the dedicated adapter.
  const adapterResult = runAdapters(html, baseUrl, source);
  if (adapterResult && adapterResult.events.length > 0) {
    for (const evt of adapterResult.events) {
      if (isNavigationTitle(evt.title)) {
        navSkipped[adapterResult.adapter] = (navSkipped[adapterResult.adapter] || 0) + 1;
        continue;
      }
      const key = `${evt.title}|${evt.date}|${evt.time || ''}|${evt.url || ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allEvents.push(evt);
      methodBreakdown[adapterResult.adapter] = (methodBreakdown[adapterResult.adapter] || 0) + 1;
    }
    const methodsUsed = Object.keys(methodBreakdown);
    return {
      events: allEvents,
      rawCount: allEvents.length,
      parseErrors: [],
      sourceUrl: baseUrl,
      methodsUsed,
      methodBreakdown,
      adapterMatched: adapterResult.adapter,
    };
  }

  // 2026-10-24 — adaptern är AUKTORITATIV för sin sajt och hittade
  // ingenting. "Inget" är då svaret: universalheuristiken får inte fylla
  // på med något annat. Mätt bakom beslutet: på ladansthlm.se gör
  // universalheuristiken ett falskt event av öppettiderna ("Vad är Lådan?",
  // 2026-10-27 17:00). Negativ kontroll: folkoperan.se får INTE den här
  // behandlingen — där ger universalheuristiken 30 riktiga events som
  // adaptern inte hittar. Därför är flaggan opt-in per adapter.
  if (adapterResult?.authoritative) {
    return {
      events: [],
      rawCount: 0,
      parseErrors: [],
      sourceUrl: baseUrl,
      methodsUsed: [adapterResult.adapter],
      methodBreakdown: {},
      adapterMatched: adapterResult.adapter,
    };
  }

  const $ = cheerio.load(html);

  // PHASE 1: Structured Data
  addEvents(extractJsonLd($, source, baseUrl), 'A1');
  addEvents(extractMicrodata($, source, baseUrl), 'A2');

  // PHASE 2: JavaScript Data
  const jsResult = extractJsEmbeddedEvents(html, source, baseUrl);
  if (jsResult.events.length) addEvents(jsResult.events, jsResult.method);

  // PHASE 3: HTML Heuristics — ALL methods run, no threshold
  addEvents(extractHtmlHeuristics($, source, baseUrl), 'C1');
  addEvents(extractTimeAnchors($, source, baseUrl), 'C2');
  addEvents(extractSwedishRelativeDates($, source, baseUrl), 'C3');

  // 2026-10-24 — slå ihop dubbletter mellan metoderna (R1 + R2).
  // Samma evenemangskort läses på flera sätt: ena vägen ger rubrik + länk,
  // andra ger bildens alt-text. Se eventDedup.ts för reglerna och mätningen.
  const dedup = dedupeEvents(allEvents);
  if (dedup.droppedDuplicate > 0 || dedup.droppedAltText > 0) {
    console.log(
      `[${source}] [UniversalExtractor v2] dedup: ${dedup.droppedDuplicate} dubblett(er), ` +
      `${dedup.droppedAltText} bildtext(er) borttaget — ${allEvents.length} → ${dedup.kept.length}`,
    );
  }
  const dedupedEvents = dedup.kept;

  // Strategy A fallback — page-level og:image / twitter:image for events that
  // did not pick up an image from any of A1–C3. Per-page only (meta tags
  // describe the page, not individual events). JSON-LD / microdata wins.
  const pageOgImage = extractPageOgImage($);
  let enrichedEvents: ParsedEvent[] = pageOgImage
    ? dedupedEvents.map((evt) =>
        evt.imageUrl ? evt : { ...evt, imageUrl: absolutizeUrl(pageOgImage, baseUrl) }
      )
    : dedupedEvents;

  // 2026-10-02 — page-level description enrichment (Round 2 utökning).
  // Fångar fall där A1/A2/B/C hittade events men description är tom — sidan
  // saknar både JSON-LD description och meta description, men har text i
  // body (gratisistockholm, china-teatern, arkdes, sodrateatern.com m.fl.).
  // Triggar ENDAST om eventen inte redan har description (JSON-LD/Microdata/
  // JS-embedded vinner alltid över page-level fallback).
  //
  // Prioritet:
  //   1. JSON-LD/Microdata/JS description (satt i makeEvent)
  //   2. <meta property="og:description"> / <meta name="description">
  //   3. Body-text (första paragrafen ≥200 tecken, ej nav/footer)
  //
  // Notera: extractBodyDescription triggas redan inuti A1-pathen
  // (extractJsonLd) för events som har JSON-LD. Denna enrichment fångar
  // även events från A2/B/C som saknar description.
  const pageMetaDescription = extractPageDescription($);
  const bodyDescription = extractBodyDescription($);
  if (pageMetaDescription || bodyDescription) {
    enrichedEvents = enrichedEvents.map((evt) => {
      if (evt.description && evt.description.length >= 10) return evt;
      const fallback = pageMetaDescription || bodyDescription;
      if (!fallback) return evt;
      return { ...evt, description: fallback.slice(0, 500) };
    });
  }

  const methodsUsed = Object.keys(methodBreakdown);
  const navSkippedTotal = Object.values(navSkipped).reduce((a, b) => a + b, 0);

  if (enrichedEvents.length > 0) {
    console.log(`[${source}] [UniversalExtractor v2] ${enrichedEvents.length} events via ${methodsUsed.join('+')} | ${Object.entries(methodBreakdown).map(([k,v]) => `${k}:${v}`).join(', ')}${pageOgImage ? ' | og-image-fallback applied' : ''}${navSkippedTotal ? ` | nav-skipped: ${Object.entries(navSkipped).map(([k,v]) => `${k}:${v}`).join(', ')}` : ''}`);
  }

  // Strategy 3b (2026-10-14): Swedish time-of-day text enrichment.
  // For events that already have a date but no time, search the page body
  // text for Swedish time phrases ("kl. 19:00", "Klockan 17:30–19:00",
  // "<td>15:00 - 17:00</td>", etc.) and attach them. The util is regex-only
  // and intentionally conservative — it rejects bare decimal patterns
  // (e.g. prices) so we don't accidentally invent times.
  //
  // Apply when EITHER:
  //   - the event has no time yet (fill from start), OR
  //   - the event has only a single time AND the util found an interval:
  //     overwrite with start, then add endTime. Fixes two known C1 bugs:
  //     a) "<td>15:00 - 17:00</td>" → time=17:00 (end) instead of 15:00
  //     b) "Klockan 17:30–19:00" → endTime missing because C1 only sets start.
  //
  // Sites affected: jarfalla (upplevjarfalla.se table cells), livespot
  // (livespot.se event pages with "kl. HH:MM"), arkdes (already uses the
  // pattern via its own adapter; this is a fallback for non-arkdes pages).
  {
    const pageText = $('body').text();
    const textTime = findKlockanInText(pageText);
    if (textTime?.start) {
      for (let i = enrichedEvents.length - 1; i >= 0; i--) {
        const ev = enrichedEvents[i];
        if (!ev.date) continue;
        const hasInterval = Boolean(textTime.start && textTime.end);
        const isMissingTime = !ev.time;
        const isSingleTimeOnly = Boolean(ev.time) && !ev.endTime;
        const intervalFixesBug =
          hasInterval &&
          (ev.time === textTime.end || // C1 bug a: time is interval end
            (ev.time === textTime.start && isSingleTimeOnly)); // C1 bug b: only start
        const shouldApply =
          isMissingTime || isSingleTimeOnly || intervalFixesBug;
        if (!shouldApply) continue;
        // Replace time with interval start if we have a stronger interval,
        // otherwise fill what's missing.
        if (hasInterval) {
          // If C1 set time to the END of an interval (bug a), prefer start.
          if (ev.time !== textTime.start) ev.time = textTime.start;
          if (!ev.endTime) ev.endTime = textTime.end;
        } else {
          if (!ev.time) ev.time = textTime.start;
        }
        ev.confidence = {
          ...ev.confidence,
          score: Math.min(1, ev.confidence.score + 0.1),
          signals: [...ev.confidence.signals, 'time-text-sv'],
        };
        break; // attach to the most recent date-bearing event only
      }
    }
  }

  return {
    events: enrichedEvents,
    rawCount: enrichedEvents.length,
    parseErrors: errors,
    sourceUrl: baseUrl,
    methodsUsed,
    methodBreakdown,
    adapterMatched: adapterResult?.adapter,
  };
}

// Alias for backward compatibility
export const extractFromHtml = extractEvents;
