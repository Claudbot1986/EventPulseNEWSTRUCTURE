/**
 * universe.ts — Universe.com-adapter för Tool A (direct-API)
 *
 * VARFÖR ADAPTER: källan `universe-stockholm` pekar på
 * https://www.universe.com/events/stockholm — en SPA-ruta som INNEHÅLLER inga
 * event utan rendering. Mätt 2026-10-24 med ScrapingBee premium (25 credits
 * per render, två renderingar):
 *   /events/stockholm  → 175 523 bytes: bara OneTrust-cookie-rutan, 0 event-länkar
 *   /explore/stockholm → 174 814 bytes: generiskt skal, 0 event-länkar
 * HTML-spåret kan alltså inte ge rader — sidan bygger listan client-side.
 *
 * Plattformen exponerar däremot ett GraphQL-sök-API som INTE kräver
 * rendering:
 *
 *   POST https://www.universe.com/discover/graphql
 *   query { search(latitude, longitude, distance, limit, page) { events { … } } }
 *
 * Mätt 2026-10-24 (se /tmp/universe-probe*.mjs och nedan):
 *   distance=20 km, lat/lng = Stockholms stadshus → totalCount 2 events
 *   distance=5/20/30/50/100 → samma 2 events (radien ändrar inget)
 *   page=2 → 0 events
 *   `locale` som argument → 0 events (parametern bryter geosökningen)
 *   `pageInfo` finns INTE på typen Search (fälten är `page`, `totalCount`)
 *
 * Två events är lite — men de är riktiga, de har datum, plats, adress, pris
 * och kanonisk URL, och de överlever importens datumvakt. Det är vad den
 * SANCTIONERADE vägen (source-adapter) ska ge: rader som faktiskt kan sparas,
 * inte en heartbeat.
 *
 * Varför inte C-lager: mönstret är helt plattformsspecifikt (universe.com:s
 * eget GraphQL-API). Det är "Site-Specific → använd source adapter", precis
 * som Generalization Protection Rule kräver.
 *
 * Fält per event: title, slug, description, type, category, price, minPrice,
 * maxPrice, timezone, timeSlots { nodes { startAt endAt } }, geo { city address
 * latitude longitude country }, host { name url }, source { url }, coverPhoto.
 *
 * OBS: Event-typen har INGET `url`-fält. Den kanoniska event-URL:en ligger på
 * `source.url` (t.ex. "https://www.universe.com/events/franska-vindagen-2026-tickets-Q2ZG30").
 *
 * TIDER: `timeSlots.nodes[].startAt` kommer som NAIV lokal tid
 * ("2026-11-14T12:00:00") tillsammans med `timezone` ("Europe/Stockholm").
 * Den tolkas i eventets egen zon och konverteras till UTC ISO.
 *
 * EN RAD PER TIDSLUCKA: ett event kan ha flera slots ("Heroes, Hits & Holidays"
 * har 15:00 och 18:30) — varje slot är ett eget tillfälle och blir en egen rad.
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { detectCategory } from '../../F-eventExtraction/categoryKeywords';
import type { SourceTruth } from '../../tools/sourceRegistry';
import type { AdapterEventRow, ApiAdapterResult } from './types';

const GRAPHQL_URL = 'https://www.universe.com/discover/graphql';
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LATITUDE = 59.3293;
const DEFAULT_LONGITUDE = 18.0686;
const DEFAULT_DISTANCE_KM = 25;
const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_PAGES = 3;
const FALLBACK_TZ = 'Europe/Stockholm';

const SEARCH_QUERY = `query UniverseSearch(
  $latitude: Float!, $longitude: Float!, $distance: Int!, $limit: Int!, $page: Int!
) {
  search(
    latitude: $latitude, longitude: $longitude, distance: $distance, limit: $limit, page: $page
  ) {
    totalCount
    events {
      id
      title
      slug
      description
      type
      category
      price
      minPrice
      maxPrice
      timezone
      timeSlots { nodes { startAt endAt } }
      geo { city address latitude longitude country }
      host { name url }
      source { url }
      coverPhoto { url }
    }
  }
}`;

export interface UniverseConfig {
  latitude: number;
  longitude: number;
  distanceKm: number;
  limit: number;
  maxPages: number;
  /** Valfritt stadsfilter på `geo.city`. Tomt = inget filter. */
  city?: string;
}

interface UniverseTimeSlot {
  startAt?: string | null;
  endAt?: string | null;
}

interface UniverseEvent {
  id?: string | null;
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  type?: string | null;
  category?: string | null;
  price?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  timezone?: string | null;
  timeSlots?: { nodes?: UniverseTimeSlot[] | null } | null;
  geo?: {
    city?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  host?: { name?: string | null; url?: string | null } | null;
  source?: { url?: string | null } | null;
  coverPhoto?: { url?: string | null } | null;
}

export interface UniverseSearchResponse {
  data?: {
    search?: {
      totalCount?: number | null;
      events?: UniverseEvent[] | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

/** Läs konfigurationen ur source-filen. */
export function readUniverseConfig(source: SourceTruth): UniverseConfig {
  const raw = (source.metadata ?? {}).universe as Partial<UniverseConfig> | undefined;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    latitude: num(raw?.latitude, DEFAULT_LATITUDE),
    longitude: num(raw?.longitude, DEFAULT_LONGITUDE),
    distanceKm: num(raw?.distanceKm, DEFAULT_DISTANCE_KM),
    limit: num(raw?.limit, DEFAULT_LIMIT),
    maxPages: num(raw?.maxPages, DEFAULT_MAX_PAGES),
    city: typeof raw?.city === 'string' && raw.city.trim() ? raw.city.trim() : undefined,
  };
}

/**
 * Naiv lokal tid → UTC ISO.
 *
 * API:t ger "2026-11-14T12:00:00" utan suffix, plus `timezone` på eventet.
 * Vi tolkar strängen i den zonen och returnerar UTC ISO med Z.
 */
export function naiveLocalToUtc(value: string | null | undefined, timezone?: string | null): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return null;
  const tz = timezone && timezone.trim() ? timezone.trim() : FALLBACK_TZ;
  try {
    const utc = fromZonedTime(`${m[1]}T${m[2]}:00`, tz);
    if (Number.isNaN(utc.getTime())) return null;
    return utc.toISOString();
  } catch {
    return null;
  }
}

/**
 * Lokal datum/tid i eventets egen zon ur en UTC-ISO-sträng.
 *
 * Legacy-fälten date/time ska beskriva SAMMA sak som start_time — annars kan
 * en rad hamna på fel dag. Offseten får INTE hardkodas: Stockholms offset
 * växlar mellan CEST (+02:00) och CET (+01:00).
 *
 * `toZonedTime` skjuter om Date-objektet så att dess LOKALA fält motsvarar
 * växande tid i zonen. Därför läses fälten med getFullYear/getDate/getHours —
 * inte via toISOString() (det skulle ge UTC-fälten igen).
 */
function localParts(utcIso: string, timezone: string): { date: string; time: string } {
  try {
    const zoned = toZonedTime(new Date(utcIso), timezone);
    const y = zoned.getFullYear();
    const mo = String(zoned.getMonth() + 1).padStart(2, '0');
    const d = String(zoned.getDate()).padStart(2, '0');
    const hh = String(zoned.getHours()).padStart(2, '0');
    const mm = String(zoned.getMinutes()).padStart(2, '0');
    return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}` };
  } catch {
    return { date: utcIso.slice(0, 10), time: utcIso.slice(11, 16) };
  }
}

async function fetchPage(config: UniverseConfig, page: number): Promise<{
  totalCount: number;
  events: UniverseEvent[];
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: 'https://www.universe.com',
        referer: 'https://www.universe.com/events/stockholm',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          latitude: config.latitude,
          longitude: config.longitude,
          distance: config.distanceKm,
          limit: config.limit,
          page,
        },
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} från ${GRAPHQL_URL}: ${text.slice(0, 160)}`);
    }
    let json: UniverseSearchResponse;
    try {
      json = JSON.parse(text) as UniverseSearchResponse;
    } catch {
      throw new Error(`icke-JSON-svar (${text.slice(0, 80)})`);
    }
    if (json.errors?.length) {
      throw new Error(`GraphQL-fel: ${json.errors.map(e => e.message ?? 'okänt').join('; ').slice(0, 200)}`);
    }
    const search = json.data?.search;
    return {
      totalCount: typeof search?.totalCount === 'number' ? search.totalCount : 0,
      events: Array.isArray(search?.events) ? (search!.events as UniverseEvent[]) : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gissa språk på en texts språk.
 *
 * Normalizern använder `detected_language` för att välja kolumn:
 * 'sv' → description_sv får texten, 'en' → title_en får titeln. Sätter vi
 * fel språk hamnar texten i fel kolumn.
 *
 * Plattformen serverar beskrivningar i det språk arrangören skrev dem på,
 * så vi kan inte anta svenska. Stoppord räknas i stället — svenska och
 * engelska ordlistorna är i praktiken disjunkta.
 */
export function detectLanguage(text: string): 'sv' | 'en' | 'other' {
  const lower = text.toLowerCase();
  const count = (words: string[]): number =>
    words.reduce((n, w) => n + (lower.match(new RegExp(`\\b${w}\\b`, 'g'))?.length ?? 0), 0);
  const sv = count(['och', 'att', 'för', 'med', 'på', 'är', 'av', 'som', 'en', 'du', 'vi', 'kan', 'till', 'från', 'här', 'vid', 'dag', 'biljetter']);
  const en = count(['the', 'and', 'with', 'from', 'you', 'our', 'are', 'will', 'this', 'that', 'can', 'tickets', 'event', 'join']);
  if (sv > en) return 'sv';
  if (en > sv) return 'en';
  return 'other';
}

/**
 * Kör adaptern mot en källa.
 *
 * Returnerar rader i extractedevents-format — en rad per tidslucka, bara
 * framtida events (det är samma definition som importens datumvakt använder).
 */
export async function runUniverseAdapter(source: SourceTruth): Promise<ApiAdapterResult> {
  const config = readUniverseConfig(source);

  const all: UniverseEvent[] = [];
  let totalCount = 0;
  try {
    for (let page = 1; page <= Math.max(1, config.maxPages); page++) {
      const res = await fetchPage(config, page);
      totalCount = res.totalCount;
      all.push(...res.events);
      if (res.events.length < config.limit) break;
      if (all.length >= totalCount && totalCount > 0) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', events: [], error: `universe: ${message}` };
  }

  const nowMs = Date.now();
  const rows: AdapterEventRow[] = [];
  const seen = new Set<string>();

  for (const ev of all) {
    const title = typeof ev.title === 'string' ? ev.title.trim() : '';
    if (!title) continue;

    const city = ev.geo?.city?.trim() ?? '';
    if (config.city && city.toLowerCase() !== config.city.toLowerCase()) continue;

    const description = typeof ev.description === 'string' ? ev.description.trim() : '';
    const url = ev.source?.url?.trim() || (ev.slug ? `https://www.universe.com/events/${ev.slug}` : undefined);
    const tz = ev.timezone ?? FALLBACK_TZ;
    const slots = ev.timeSlots?.nodes ?? [];

    for (const slot of slots) {
      const startIso = naiveLocalToUtc(slot.startAt, tz);
      if (!startIso) continue;
      const startMs = Date.parse(startIso);
      if (!Number.isFinite(startMs) || startMs < nowMs) continue; // förflutet → sparas inte

      const key = `${ev.id ?? ev.slug ?? ''}|${startIso}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const endIso = naiveLocalToUtc(slot.endAt, tz);
      const local = localParts(startIso, tz);
      const price = ev.minPrice ?? ev.price ?? ev.maxPrice ?? null;

      rows.push({
        title,
        start_time: startIso,
        end_time: endIso,
        date: local.date,
        time: local.time,
        venue: ev.host?.name?.trim() || undefined,
        address: ev.geo?.address?.trim() || undefined,
        city: city || source.city,
        description: description || undefined,
        url,
        ticketUrl: url,
        category: detectCategory(title, description || undefined),
        source: source.id,
        sourceUrl: source.url,
        source_id: ev.id ?? ev.slug ?? null,
        lat: ev.geo?.latitude ?? null,
        lng: ev.geo?.longitude ?? null,
        // AI-bilder är obligatoriskt (se 04-Normalizer/normalizer.ts) — därför
        // sätts källbilderna till null och låter AI-workern generera dem.
        image_url: null,
        detected_language: detectLanguage(`${title} ${description}`),
        raw_payload: {
          id: ev.id ?? null,
          slug: ev.slug ?? null,
          type: ev.type ?? null,
          universeCategory: ev.category ?? null,
          price,
          minPrice: ev.minPrice ?? null,
          maxPrice: ev.maxPrice ?? null,
          timezone: tz,
          hostUrl: ev.host?.url ?? null,
          coverPhoto: ev.coverPhoto?.url ?? null,
        },
      });
    }
  }

  if (rows.length === 0) {
    return {
      status: 'failed',
      events: [],
      error: `universe: 0 sparbara events (api=${all.length}, totalCount=${totalCount})`,
    };
  }

  return { status: 'completed', events: rows };
}
