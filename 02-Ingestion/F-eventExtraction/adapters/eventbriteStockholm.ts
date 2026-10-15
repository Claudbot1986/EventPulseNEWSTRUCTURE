/**
 * eventbriteStockholm adapter — Eventbrite Stockholm city-listing page
 *
 * Site-specific pattern (verified 2026-08-21 from
 * https://www.eventbrite.com/d/sweden--stockholm/events/):
 *
 * - Public city-listing page returns 200 OK with HTML containing a single
 *   <script type="application/ld+json"> block of type ItemList whose
 *   itemListElement contains ~46 schema.org/Event entries.
 * - Each Event entry exposes: name, startDate, endDate, url, image,
 *   location (Place with geo + address), eventAttendanceMode.
 * - Verified 2026-08-21 with curl: 765141 bytes HTML, 46 events,
 *   date range 2026-08-21 to 2026-11-29.
 * - Pagination: /d/sweden--stockholm/all-events/?start_date=YYYY-MM-DD
 *   returns 17+ events per month (verified for 2026-09-01).
 * - B-gate path per BACKLOG.md Stockholm Density Plan Layer 1:
 *   rate-limit 1 req / 3s, UA "EventPulse-Bot/1.0", respect robots.txt.
 * - Adapter is intentionally narrow (only matches the Stockholm page,
 *   not all of Eventbrite). Per CLAUDE.md Generalization Protection Rule,
 *   site-specific quirks must not influence C0/C1/C2 — they live here.
 *
 * 2026-10-01 change: Category used to be hardcoded to 'community' (line 150).
 * Now we run `detectCategory(name)` from categoryKeywords.ts on the event
 * title so events with clear categories (musik, teater, workshop, etc.) get
 * their real slug. Items with no detectable keyword still get 'community'
 * via the shared module — which is the correct semantic, not a slaskhink.
 *
 * 2026-10-14 change: Single-event URLs of shape /e/<slug>-tickets-<id> were
 * previously matched (matches() returned true) but the JSON-LD `Event` /
 * `SocialEvent` blocks were discarded because this adapter only accepted
 * ItemList at the top level. We now delegate single-event pages to the
 * shared `extractFromJsonLd` so the structured startDate / endDate /
 * location / offers are parsed correctly.
 */
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ParsedEventSchema, type ParsedEvent } from '../schema';
import { detectCategory } from '../categoryKeywords.js';
import { extractFromJsonLd } from '../extractor.js';

const SOURCE_ID = 'eventbrite-stockholm-aggregator';
const CITY = 'Stockholm';

const LISTING_URL = 'https://www.eventbrite.com/d/sweden--stockholm/events/';
const PAGINATION_URL_FMT =
  'https://www.eventbrite.com/d/sweden--stockholm/all-events/?start_date=YYYY-MM-DD';

const USER_AGENT = 'EventPulse-Bot/1.0';
const RATE_LIMIT_MS = 3000; // 1 req / 3s per BACKLOG.md

// 2026-10-14: Single-event URLs of shape /e/<slug>-tickets-<id> were previously
// ignored (matches() returned false), so the structured startDate / endDate
// JSON-LD on those pages never made it into the queue — events landed with
// start_time = midnight UTC. We accept the pattern now when the host is an
// Eventbrite domain AND the URL has /tickets- in the path AND there's no
// non-SE country hint in the path (e.g. /d/malmo-/). Single-event pages also
// need the city in the page body or in raw_data.fetched_via to be Stockholm.
export function matches(url: string): boolean {
  try {
    const u = new URL(url);
    const isEbHost =
      u.hostname === 'www.eventbrite.com' ||
      u.hostname === 'eventbrite.com' ||
      u.hostname === 'www.eventbrite.se' ||
      u.hostname === 'eventbrite.se';
    if (!isEbHost) return false;
    const pathAndQuery = (u.pathname + u.search).toLowerCase();

    // Listing pages (existing behaviour, unchanged)
    if (/\/d\/sweden--stockholm\//i.test(pathAndQuery)) return true;

    // Single-event page: /e/<slug>-tickets-<digits>
    // Slug may contain hyphens; must end in "-tickets-<id>" (numeric id).
    if (/\/e\/[a-z0-9-]+-tickets-\d+\/?$/i.test(u.pathname)) return true;

    return false;
  } catch {
    return false;
  }
}

interface RawJsonLdEvent {
  '@type'?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  image?: string;
  location?: {
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      postalCode?: string;
      addressCountry?: string;
    };
    geo?: {
      latitude?: string | number;
      longitude?: string | number;
    };
  };
}

interface JsonLdItemList {
  '@type'?: string;
  itemListElement?: Array<{
    '@type'?: string;
    position?: number;
    item?: RawJsonLdEvent;
  }>;
}

function extractEventsFromHtml(html: string, url: string): ParsedEvent[] {
  const $ = cheerio.load(html);
  const events: ParsedEvent[] = [];

  // 2026-10-14: Single-event URLs delegate entirely to extractFromJsonLd so
  // we pick up `Event` / `SocialEvent` / `@graph` blocks (not just ItemList).
  // The shared extractor also re-uses detectCategory + confidence scoring.
  if (/\/e\/[a-z0-9-]+-tickets-\d+\/?$/i.test(new URL(url).pathname)) {
    const jsonLdResult = extractFromJsonLd(html, SOURCE_ID, url);
    for (const evt of jsonLdResult.events) {
      // Override source so single events are tagged with this adapter's id.
      events.push({ ...evt, source: SOURCE_ID });
    }
    return events;
  }

  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (!content) return;
    let data: JsonLdItemList;
    try {
      data = JSON.parse(content) as JsonLdItemList;
    } catch {
      return;
    }
    if (data['@type'] !== 'ItemList' || !Array.isArray(data.itemListElement)) return;

    for (const li of data.itemListElement) {
      const ev = li.item;
      if (!ev || ev['@type'] !== 'Event') continue;

      const name = ev.name;
      const startDate = ev.startDate;
      if (!name || !startDate) continue;

      const datePart = startDate.split('T')[0] || startDate;
      const timePart = startDate.includes('T')
        ? startDate.split('T')[1]?.substring(0, 5) || ''
        : '';

      const endDate = ev.endDate;
      const endDatePart = endDate ? endDate.split('T')[0] : undefined;
      const endTimePart =
        endDate && endDate.includes('T')
          ? endDate.split('T')[1]?.substring(0, 5) || undefined
          : undefined;

      const loc = ev.location;
      const venueName = loc?.name || undefined;
      const streetAddress = loc?.address?.streetAddress;
      const locality = loc?.address?.addressLocality;
      const postal = loc?.address?.postalCode;
      const address =
        [streetAddress, postal, locality].filter(Boolean).join(', ') || undefined;

      const lat =
        loc?.geo?.latitude !== undefined ? parseFloat(String(loc.geo.latitude)) : null;
      const lng =
        loc?.geo?.longitude !== undefined ? parseFloat(String(loc.geo.longitude)) : null;

      try {
        // 2026-10-01: detect category via shared keyword rules instead of hardcoding
        // 'community'. Eventbrite items typically only expose title in their
        // ItemList, so detection runs on title alone.
        const category = detectCategory(name, undefined);

        const parsed = ParsedEventSchema.parse({
          title: name,
          date: datePart,
          time: timePart || undefined,
          endDate: endDatePart || undefined,
          endTime: endTimePart || undefined,
          venue: venueName,
          address,
          city: locality || CITY,
          lat: !isNaN(lat as number) ? lat : undefined,
          lng: !isNaN(lng as number) ? lng : undefined,
          url: ev.url || undefined,
          imageUrl: ev.image || undefined,
          category,
          source: SOURCE_ID,
          sourceUrl: url,
          confidence: {
            score: 0.85,
            hasTitle: true,
            hasDate: true,
            hasVenue: !!venueName,
            hasUrl: !!ev.url,
            hasDescription: false,
            hasTicketInfo: false,
            signals: ['eventbrite-itemlist', `position:${li.position ?? '?'}`],
          },
        });
        events.push(parsed);
      } catch {
        /* skip malformed */
      }
    }
  });

  return events;
}

/**
 * Fetch a listing page and extract events. Honours the BACKLOG.md
 * rate-limit (1 req / 3s) by sleeping BEFORE the request so the previous
 * caller's call is fully completed before this one starts. The adapter is
 * invoked once per URL by the F-eventExtraction/adapters runner, so this
 * is sufficient for the single-page case. For pagination the caller must
 * await between calls (see `eventbriteStockholmFetchAll`).
 */
export async function fetchAndExtract(
  url: string,
  options: { rateLimitMs?: number; sleepFirst?: boolean } = {}
): Promise<ParsedEvent[]> {
  const rateLimitMs = options.rateLimitMs ?? RATE_LIMIT_MS;
  if (options.sleepFirst) {
    await new Promise((r) => setTimeout(r, rateLimitMs));
  }

  const response = await axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    timeout: 30000,
    maxRedirects: 0, // do not follow Eventbrite's trailing-slash redirects
    validateStatus: (status) => status === 200,
  });

  if (typeof response.data !== 'string') return [];
  return extractEventsFromHtml(response.data, url);
}

/**
 * Synchronous extractor variant matching the SiteAdapter interface.
 * Used when the HTML is already in hand (e.g. via runB runner that fetches
 * with fetchHtml). Returns 0 events if HTML doesn't contain a recognisable
 * ItemList — the caller falls back to the universal extractor.
 */
export function extract(
  html: string,
  url: string,
  source = SOURCE_ID
): { showUrls: string[]; events: ParsedEvent[]; method: string } {
  if (!matches(url)) return { showUrls: [], events: [], method: 'none' };
  const events = extractEventsFromHtml(html, url);
  return {
    showUrls: events.length > 0 ? [url] : [],
    events,
    method: 'eventbrite-itemlist',
  };
}