/**
 * Hammarby (hammarbyfotboll.se) adapter — Hammarby Fotboll, Stockholm.
 *
 * Site-specifict mönster (verifierat 2026-10-24):
 *
 * - Sajten är Gatsby (4.25.9) + Sanity. `/matcher` är en JS-shell: utan
 *   rendering finns INGA matcher i HTML:en (mätt — "matchHorizontal"
 *   förekommer 58 gånger, men alla i CSS:en, 0 i DOM:en). Efter rendering
 *   finns 12 matchkort (seniorlaget herr + dam; ungdomslagen filtreras bort
 *   av sidans egen tabb).
 * - Matchkortet (Gatsby CSS-modules, alltså hashade klassnamn):
 *
 *     <div class="item-module--matchHorizontal--<hash> bg">
 *       <a class="item-module--matchHorizontal__link--<hash>"
 *          href="/matcher/2026-10-25-00-00-mj-llby-aif-hammarby"></a>
 *       <p class="item-module--matchHorizontal__league--<hash>">Allsvenskan 2026</p>
 *       <p class="text-lg text-semibold">Söndag 25 oktober 2026</p>
 *       <p class="text-xs text-medium uppercase text-darker">Strandvallen - 16.30</p>
 *       <span class="item-module--matchHorizontal__logoContainer__teamTitle--<hash>">
 *         Mjällby AIF</span>
 *       <a href="https://maif.ebiljett.nu/..." class="cta-white">Köp biljett</a>
 *     </div>
 *
 *   Klassnamnen är hashad → adaptern matchar på KLASSNAMNETS PREFIX
 *   ("matchHorizontal--", "matchHorizontal__league", "teamTitle"), inte på
 *   hela hashen, så den överlever en ny Gatsby-build.
 * - DATUMET står i den synliga texten ("Söndag 25 oktober 2026") och är
 *   rätt på 12/12 kort (korsverifierat mot Sanity-datumet `startEventDate`).
 *   SLUGGEN är däremot OCH: 3 av 12 kort har fel datum i sluggen
 *   (Hammarby–Djurgården sluggar 2026-10-25 men spelas 2026-10-24).
 *   Sluggen får därför INTE användas som datum.
 * - Lagren: [1] = hemmalag, [2] = bortalag (mätt: "Hammarby IF – IK Sirius"
 *   på 3Arena, "Mjällby AIF – Hammarby IF" på Strandvallen).
 * - Tiden ligger i samma rad som arenan: "Strandvallen - 16.30" → "16:30".
 * - Enskild match (/matcher/<slug>) har i stället "header-module--matchHeader__*":
 *   `startEventDate` = "söndag 25 oktober 2026 16:30", `competition`,
 *   `location` = "STRANDVALLEN" och lagnamnen i `localTeam`/`externalTeam`.
 *
 * Per CLAUDE.md "Generalization Protection Rule": adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST hammarbyfotboll.se.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'hammarby';
const BASE = 'https://www.hammarbyfotboll.se';

/**
 * Arenor som syns i listan → stad. Mätt 2026-10-24 (12 matchkort).
 *
 * Ingen gissning: en arena som inte står här får ingen stad alls, hellre
 * än att få "Stockholm" på en match i Halmstad.
 */
const VENUE_CITY: Record<string, string> = {
  'Hammarby IP': 'Stockholm',
  '3Arena': 'Stockholm',
  Strandvallen: 'Halmstad',
  'Eleda Stadion': 'Malmö',
  'Malmö IP': 'Malmö',
  'Studenternas IP': 'Uppsala',
  'Hitachi Energy Arena': 'Västerås',
  'Stadium Myjava': 'Myjava',
  'Halmstad Arena P7': 'Halmstad',
};

const SWE_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** "Söndag 25 oktober 2026" → 2026-10-25. */
const SWE_DATE_RX = /(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/i;
/** "Strandvallen - 16.30" → arena + tid. */
const PLACE_TIME_RX = /^(.*?)\s+[-–]\s+(\d{1,2})[.:](\d{2})$/;

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'hammarbyfotboll.se' || u.hostname === 'www.hammarbyfotboll.se';
  } catch {
    return false;
  }
}

/** Ett matchkort, rått extraherat ur den renderade listan. */
export interface HammarbyMatch {
  title: string | null;
  date: string | null;
  time: string | null;
  venue: string | null;
  league: string | null;
  teams: string[];
  ticketUrl: string | null;
  url: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 2000 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * "Söndag 25 oktober 2026" → "2026-10-25".
 *
 * Utan år tolkas datumet som nästa förekomst (ett datum som redan varit i år
 * räknas som nästa år).
 */
export function parseSwedishDate(text: string, now: Date = new Date()): string | null {
  const withYear = text.match(SWE_DATE_RX);
  if (withYear) {
    const month = SWE_MONTHS[withYear[2].toLowerCase()];
    if (!month) return null;
    const day = Number(withYear[1]);
    const year = Number(withYear[3]);
    if (!isValidYmd(year, month, day)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  const withoutYear = text.match(/(\d{1,2})\s+([a-zåäö]+)/i);
  if (!withoutYear) return null;
  const month = SWE_MONTHS[withoutYear[2].toLowerCase()];
  if (!month) return null;
  const day = Number(withoutYear[1]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const candidate = new Date(today.getFullYear(), month - 1, day);
  if (!isValidYmd(candidate.getFullYear(), month, day)) return null;
  if (candidate.getTime() < today.getTime()) candidate.setFullYear(candidate.getFullYear() + 1);
  return `${candidate.getFullYear()}-${pad(month)}-${pad(day)}`;
}

function absoluteUrl(href: string): string {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return BASE;
  }
}

function textOf($: cheerio.CheerioAPI, el: cheerio.Element | undefined): string {
  return el ? $(el).text().replace(/\s+/g, ' ').trim() : '';
}

/**
 * Läser alla matchkort ur den renderade /matcher-sidan.
 *
 * Korten hittas via klassnamnets prefix ("matchHorizontal--") eftersom
 * Gatsby hashar resten av namnet.
 */
export function parseMatchCards(html: string): HammarbyMatch[] {
  const $ = cheerio.load(html);
  const matchesFound: HammarbyMatch[] = [];

  $('[class*="matchHorizontal--"]').each((_, card) => {
    const $card = $(card);
    const league = textOf($, $card.find('[class*="matchHorizontal__league"]').first());

    // Datumrad: "Söndag 25 oktober 2026".
    let date: string | null = null;
    $card.find('p').each((__, p) => {
      if (date) return;
      const text = $(p).text().replace(/\s+/g, ' ').trim();
      if (SWE_DATE_RX.test(text)) date = parseSwedishDate(text);
    });

    // Aren-rad: "Strandvallen - 16.30".
    let venue: string | null = null;
    let time: string | null = null;
    $card.find('p').each((__, p) => {
      if (venue) return;
      const text = $(p).text().replace(/\s+/g, ' ').trim();
      const m = text.match(PLACE_TIME_RX);
      if (!m) return;
      venue = m[1].trim() || null;
      time = `${pad(Number(m[2]))}:${m[3]}`;
    });

    const teams = $card
      .find('[class*="teamTitle"]')
      .map((__, el) => $(el).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter((t) => t.length > 0);

    // Detalj-länken (relativ) och biljetter ("Köp biljett", klassen cta-white).
    const detailHref = $card.find('[class*="matchHorizontal__link"]').first().attr('href');
    const ticketHref = $card.find('a.cta-white[href]').first().attr('href') ?? null;

    matchesFound.push({
      title: teams.length >= 2 ? `${teams[0]} – ${teams[1]}` : null,
      date,
      time,
      venue,
      league: league || null,
      teams,
      ticketUrl: ticketHref ?? null,
      url: detailHref ? absoluteUrl(detailHref) : null,
    });
  });

  return matchesFound;
}

/** Enskild match (/matcher/<slug>). */
export function parseMatchDetail(html: string): HammarbyMatch | null {
  const $ = cheerio.load(html);

  const dateText = textOf($, $('[class*="matchHeader__startEventDate"]').first());
  if (!dateText) return null;

  const league = textOf($, $('[class*="matchHeader__competition"]').first());
  const venue = textOf($, $('[class*="matchHeader__location"]').first());

  const teams: string[] = [];
  const local = textOf($, $('[class*="matchHeader__localTeam"] span').first());
  const external = textOf($, $('[class*="matchHeader__externalTeam"] span').first());
  if (local) teams.push(local);
  if (external) teams.push(external);

  // "söndag 25 oktober 2026 16:30" → datum + tid.
  const timeMatch = dateText.match(/(\d{1,2})[.:](\d{2})\s*$/);
  const time = timeMatch ? `${pad(Number(timeMatch[1]))}:${timeMatch[2]}` : null;

  const ticketHref = $('a.cta-white[href]').first().attr('href') ?? null;

  return {
    title: teams.length >= 2 ? `${teams[0]} – ${teams[1]}` : null,
    date: parseSwedishDate(dateText),
    time,
    venue: venue || null,
    league: league || null,
    teams,
    ticketUrl: ticketHref,
    url: null,
  };
}

/**
 * Arenansnamn → stad, case-okänsligt.
 *
 * Detaljsidan skriver arenan i versaler ("STRANDVALLEN") medan listan
 * skriver "Strandvallen" — samma arena ska ge samma stad.
 */
function cityOf(venue: string | null): string | undefined {
  if (!venue) return undefined;
  const hit = Object.keys(VENUE_CITY).find((key) => key.toLowerCase() === venue.toLowerCase());
  return hit ? VENUE_CITY[hit] : undefined;
}

/ * Arenansnamnet normaliseras till listans form ("STRANDVALLEN" → "Strandvallen"). */
function canonicalVenue(venue: string | null): string | null {
  if (!venue) return null;
  const hit = Object.keys(VENUE_CITY).find((key) => key.toLowerCase() === venue.toLowerCase());
  return hit ?? venue;
}

export interface HammarbyExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'hammarby-match-detail' | 'hammarby-listing' | 'none';
}

/**
 * Plockar ut matcherna.
 *
 * `now` är med som parameter så att filtreringen av avslutade matcher går att
 * testa deterministiskt.
 */
export function extract(
  html: string,
  url: string,
  source = SOURCE_ID,
  now: Date = new Date()
): HammarbyExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const isDetail = /\/matcher\/[^/?#]+/.test(new URL(url).pathname);
  const raw = isDetail
    ? [parseMatchDetail(html)].filter((m): m is HammarbyMatch => m !== null)
    : parseMatchCards(html);

  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const events: ParsedEvent[] = [];
  const showUrls = new Set<string>();
  const seen = new Set<string>();

  for (const match of raw) {
    // Utan datum kan raden inte överleva importens datumvakt — hoppa över.
    if (!match.date || !match.title) continue;
    // Avslutade matcher (och sådana utanför terminen) hör inte hemma i grafen.
    if (match.date < today) continue;

    const eventUrl = match.url ?? url;
    const key = `${match.title}|${match.date}|${match.time ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    showUrls.add(eventUrl);

    try {
      const evt = ParsedEventSchema.parse({
        title: match.title,
        date: match.date,
        time: match.time ?? undefined,
        venue: canonicalVenue(match.venue) ?? undefined,
        city: cityOf(match.venue),
        description: match.league ?? undefined,
        url: eventUrl,
        ticketUrl: match.ticketUrl ?? undefined,
        organizer: 'Hammarby Fotboll',
        performers: match.teams,
        category: 'sports',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.9,
          hasTitle: true,
          hasDate: true,
          hasVenue: Boolean(match.venue),
          hasUrl: true,
          hasDescription: Boolean(match.league),
          hasTicketInfo: Boolean(match.ticketUrl),
          signals: [
            isDetail ? 'hammarby-match-detail' : 'hammarby-match-card',
            'rendered-dom',
            ...(match.league ? [`competition:${match.league}`] : []),
          ],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return {
    showUrls: [...showUrls],
    events,
    method: isDetail ? 'hammarby-match-detail' : 'hammarby-listing',
  };
}
