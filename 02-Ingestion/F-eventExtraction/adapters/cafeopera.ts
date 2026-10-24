/**
 * Café Opera adapter — cafeopera.se, Karl XII:s torg 5, Stockholm.
 *
 * Site-specific pattern (verified 2026-10-24 against the real site):
 *
 * - cafeopera.se is a one-page Lovable/React-SPA (modulepreload
 *   /assets/routes-*.js). Den renderade startsidan innehåller bara
 *   GUESTLIST, CONTACT, BIRTHDAY CELEBRATION, DRESS CODE och FIND US —
 *   inga kort, inga datum, ingen JSON-LD. Därför ger universellextractorn
 *   0 events (mätt: raw=0 usable=0).
 * - Startsidans GUESTLIST-sektion pekar på Café Operas två gästlistor på
 *   Attendium:
 *     https://attendium.com/.iWtScj8PkQ2KSQOkBu-p0xA  ("Fridays & Saturdays")
 *     https://attendium.com/.it6Eut260Sr-AjZuXJPXAyg  ("Wednesdays")
 *   De bär de riktiga, daterade kvällarna i ett inbäddat Relay-payload:
 *     <script>window.appInitData = "\"{\\\"relayRecords\\\":{ … }}"</script>
 *   med poster av __typename "Event":
 *     { id:"evr…", name:"Café Opera - Saturday October 24",
 *       startsAt:"2026-10-24T21:00:38Z", endsAt:"2026-10-25T02:00:44Z",
 *       venue:{__ref:"ve-…"} }
 *   och en "Venue"-post { name:"Café Opera", timeZone:"Europe/Stockholm" }.
 *   Payloaden finns i RAW-HTML — JS-rendering behövs alltså inte för datan.
 * - Mätning 2026-10-24: "Fridays & Saturdays" → 3 kvällar, "Wednesdays"
 *   → 2 kvällar = 5 riktiga, framtida, daterade events.
 *
 * Datum/tid: startsAt/endsAt är UTC. Omräknat till Europe/Stockholm
 * (CEST → CET den 25 okt 2026) ligger alla fem kvällar 22:00–23:00
 * lokal tid OCH på samma kalenderdag som kvällens namn i Event-posten
 * ("Café Opera - Friday October 30"). Sluttiden blir 03:00 lokal, vilket
 * stämmer med startsidans "Wednesday, Friday, and Saturday until 03:00".
 * Vi använder därför UTC→Stockholm för både datum och tid.
 *
 * Skydd: payloadens Venue-post måste vara Café Opera, annars skapas
 * inga events. matches() tar bara emot Café Operas två egna
 * invitations-slugs, så andra venues på samma plattform berörs aldrig.
 *
 * Per CLAUDE.md Generalization Protection Rule: adaptern är isolerad från
 * C0/C1/C2 och gäller ENDAST Café Opera.
 */
import * as cheerio from 'cheerio';
import { ParsedEventSchema, type ParsedEvent } from '../schema';

const SOURCE_ID = 'cafe-opera';
const VENUE = 'Café Opera';
const CITY = 'Stockholm';
/** Adress enligt FIND US-sektionen på startsidan: "Karl XII:s torg 5, 111 47 Stockholm". */
const ADDRESS = 'Karl XII:s torg 5, 111 47 Stockholm';
const SITE = 'https://www.cafeopera.se';
const DEFAULT_TIMEZONE = 'Europe/Stockholm';

/**
 * Café Operas två gästlistor på Attendium — slug mätt 2026-10-24 från
 * startsidans GUESTLIST-sektion. Vi matchar BARA dessa slugs så att ingen
 * annan venue på samma plattform påverkas av adaptern.
 */
const CAFE_OPERA_INVITE_SLUGS: readonly string[] = [
  'iWtScj8PkQ2KSQOkBu-p0xA', // "Fridays & Saturdays"
  'it6Eut260Sr-AjZuXJPXAyg', // "Wednesdays"
];

export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'cafeopera.se' || host === 'www.cafeopera.se') return true;
    if (host === 'attendium.com' || host === 'www.attendium.com') {
      // Attendiums gästlistelänkar ser ut som "/.iWtScj8PkQ2KSQOkBu-p0xA"
      // (punkt-prefix), ibland med språkprefix ("/sv/.").
      const segment = u.pathname.split('/').filter(Boolean).pop() ?? '';
      const slug = segment.startsWith('.') ? segment.slice(1) : segment;
      return CAFE_OPERA_INVITE_SLUGS.includes(slug);
    }
    return false;
  } catch {
    return false;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** En post ur Attendiums relayRecords. */
interface RelayRecord {
  __typename?: string;
  __ref?: string;
  id?: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  url?: string;
  venue?: { __ref?: string };
  renderedAdditionalInformationMessage?: string;
  additionalInformationMessageFiles?: { __refs?: string[] };
}

/**
 * Läser `window.appInitData`. Attendium dubbelsträngar payloaden
 * ("\"{\\\"…\"}") — därför parsas den upp till tre gånger.
 */
export function parseRelayRecords(html: string): Record<string, RelayRecord> | null {
  const match = html.match(/window\.appInitData\s*=\s*("(?:[^"\\]|\\.)*")/);
  if (!match) return null;

  let value: unknown = match[1];
  for (let i = 0; i < 5; i++) {
    if (typeof value !== 'string') break;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;

  const relay = (value as { relayRecords?: unknown }).relayRecords;
  if (!relay || typeof relay !== 'object') return null;
  return relay as Record<string, RelayRecord>;
}

/** En kväll, rått extraherad ur payloaden. */
export interface RawNight {
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venueName: string | null;
  timeZone: string | null;
  info: string | null;
  imageUrl: string | null;
}

/** Normaliserar ett venue-namn så att "Café Opera" → "cafeopera". */
export function normalizeVenueName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Läser kvällarna ur Attendium-payloaden. */
export function parseNights(html: string): RawNight[] {
  const records = parseRelayRecords(html);
  if (!records) return [];

  const invitation = Object.values(records).find((r) => r.__typename === 'OpenInvitation');
  const fileRefs = invitation?.additionalInformationMessageFiles?.__refs ?? [];
  const imageUrl = fileRefs.map((ref) => records[ref]?.url).find((u) => Boolean(u)) ?? null;

  const nights: RawNight[] = [];
  for (const record of Object.values(records)) {
    if (record.__typename !== 'Event') continue;
    const venue = record.venue?.__ref ? records[record.venue.__ref] : undefined;
    nights.push({
      name: record.name ?? null,
      startsAt: record.startsAt ?? null,
      endsAt: record.endsAt ?? null,
      venueName: venue?.name ?? null,
      timeZone: venue?.timeZone ?? null,
      info: invitation?.renderedAdditionalInformationMessage ?? null,
      imageUrl,
    });
  }
  return nights;
}

const ENGLISH_MONTHS: Readonly<Record<string, number>> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

interface ZonedParts {
  date: string;
  time: string;
}

/** ISO-timestamp → lokal datum/tid i tidszonen (UTC → Europe/Stockholm). */
function toZoned(iso: string | null | undefined, timeZone: string): ZonedParts | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return null;
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  if (!year || !month || !day || !hour || !minute) return null;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

/** "Café Opera - Saturday October 24" → { month: 10, day: 24 }. */
function parseNameDate(name: string | null): { month: number; day: number } | null {
  if (!name) return null;
  const match = name.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i,
  );
  if (!match) return null;
  const month = ENGLISH_MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return { month, day };
}

function daysBetween(a: string, b: string): number {
  const toUtc = (value: string): number => {
    const [y, m, d] = value.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

/**
 * Gästlistelänkorna på startsidan — de URL:er som måste hämtas för att
 * få kvällarna.
 */
export function findGuestlistUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const u = new URL(href);
      if (u.hostname.toLowerCase().endsWith('attendium.com')) urls.add(u.toString());
    } catch {
      /* ignorera trasiga länkar */
    }
  });
  return [...urls];
}

/** Städar bort Attendiums markdown-bild och radbrytningar ur beskrivningen. */
function cleanDescription(info: string | null | undefined): string | undefined {
  if (!info) return undefined;
  const cleaned = info
    .replace(/!\[\]\([^)]*\)/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

export interface CafeOperaExtractResult {
  showUrls: string[];
  events: ParsedEvent[];
  method: 'cafeopera-listing' | 'cafeopera-guestlist-links' | 'none';
}

export function extract(
  html: string,
  url: string,
  source = SOURCE_ID,
): CafeOperaExtractResult {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };

  const host = hostnameOf(url);

  // Startsidan: ingen evenemangsdata, men den pekar ut gästlistorna.
  if (host === 'cafeopera.se' || host === 'www.cafeopera.se') {
    const showUrls = findGuestlistUrls(html);
    if (showUrls.length === 0) return { showUrls: [], events: [], method: 'none' };
    return { showUrls, events: [], method: 'cafeopera-guestlist-links' };
  }

  // Gästlistsidan: kvällarna ligger i payloaden.
  const nights = parseNights(html);
  if (nights.length === 0) return { showUrls: [], events: [], method: 'none' };

  const events: ParsedEvent[] = [];
  const seen = new Set<string>();
  const showUrls = new Set<string>();

  for (const night of nights) {
    if (!night.name) continue;

    // Skydd: payloaden måste vara Café Operas egen gästlista.
    if (!normalizeVenueName(night.venueName).includes('cafeopera')) continue;

    const timeZone = night.timeZone || DEFAULT_TIMEZONE;
    const start = toZoned(night.startsAt, timeZone);
    if (!start) continue; // utan starttid finns inget datum — raden hoppas över

    // Eventnamnet bär kvällens datum ("Café Opera - Friday October 30").
    // Använd det bara om det stämmer med timestampen (±1 dag).
    let date = start.date;
    const named = parseNameDate(night.name);
    if (named) {
      const localYear = Number(start.date.slice(0, 4));
      for (const year of [localYear, localYear - 1, localYear + 1]) {
        const candidate = `${year}-${String(named.month).padStart(2, '0')}-${String(named.day).padStart(2, '0')}`;
        if (Math.abs(daysBetween(candidate, start.date)) <= 1) {
          date = candidate;
          break;
        }
      }
    }

    const end = toZoned(night.endsAt, timeZone);
    const description = cleanDescription(night.info);

    const key = `${night.name}|${date}|${start.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    showUrls.add(url);

    try {
      const evt = ParsedEventSchema.parse({
        title: night.name,
        date,
        time: start.time,
        endDate: end?.date,
        endTime: end?.time,
        venue: VENUE,
        address: ADDRESS,
        city: CITY,
        description,
        url,
        ticketUrl: url,
        imageUrl: night.imageUrl ?? undefined,
        category: 'music',
        source,
        sourceUrl: url,
        confidence: {
          score: 0.85,
          hasTitle: true,
          hasDate: true,
          hasVenue: true,
          hasUrl: true,
          hasDescription: Boolean(description),
          hasTicketInfo: false,
          signals: ['cafeopera-attendium-event', `venue:${night.venueName ?? 'unknown'}`],
        },
      });
      events.push(evt);
    } catch {
      /* skip malformed */
    }
  }

  if (events.length === 0) return { showUrls: [], events: [], method: 'none' };
  return { showUrls: [...showUrls], events, method: 'cafeopera-listing' };
}
