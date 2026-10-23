/**
 * confetti.ts — Confetti-adapter för Tool A (direct-API)
 *
 * Confetti (confetti.events) är ett evenemangscms som används av många
 * svenska arrangörer. Varje organisation har en egen subdomän
 * (<org>.confetti.events) och en publik JSON-endpoint:
 *
 *   GET https://<org>.confetti.events/common/api/events?locale=sv
 *
 * Svaret är {links, organisation, events[], categories[]}. Endpointen
 * returnerar ALL organisationens events och IGNORERAR query-parametrar
 * (city/limit/future) — filtrering måste ske klient-sida.
 *
 * Varför adapter och inte C-lager: mönstret är generellt (en Confetti-org
 * exponerar samma endpoint), men värdet på API:t ligger på en annan domän
 * än källans URL. B-gatens nätverksinspektion tittar på källans egen domän
 * och hittar därför inget. Det är exakt det fall som source-adapter är
 * avsedd för (Generalization Protection Rule → "Site-Specific: använd
 * source adapter").
 *
 * Bevis för att mönstret är generellt (två orelaterade domäner):
 *   - kmh.confetti.events              → 55 events, 28 framtida
 *   - founders-alliance.confetti.events → 211 events, 9 framtida
 *   Båda: samma endpoint, samma svarstruktur, samma fältnamn.
 *
 * Fält per event: slug, name, startDate, endDate, website, categories[],
 * prettyDates, continuous, id, copy{locationName,...}, cover{url,...}.
 *
 * Kategorinamn finns INTE i API:t (bara id:n) — därför sätts kategorin
 * via den befintliga nyckelorddetektorn detectCategory(title) i stället
 * för att gissa. Ingen hittad kategori ⇒ categorin lämnas tom och
 * normalizerns fallback (canonicalize → source-default → community)
 * bestämmer.
 */

import * as cheerio from 'cheerio';
import { toZonedTime } from 'date-fns-tz';
import { detectCategory } from '../../F-eventExtraction/categoryKeywords';
import { toStockholmDate } from '../../lib/stockholmTime';
import type { SourceTruth } from '../../tools/sourceRegistry';
import type { AdapterEventRow, ApiAdapterResult } from './types';

const USER_AGENT = 'EventPulse/1.0 (event-ingestion)';
const FEED_TIMEOUT_MS = 30_000;
const DETAIL_TIMEOUT_MS = 20_000;

/** Standard: max antal detaljsidor som hämtas per körning. */
const DEFAULT_ENRICH_LIMIT = 50;
/** Standard: max antal event som behålls. */
const DEFAULT_LIMIT = 100;

export interface ConfettiConfig {
  /** Subdomänen, t.ex. "kmh.confetti.events". */
  host: string;
  /** Språk för prettyDates etc. Default "sv". */
  locale?: string;
  /** Valfri stadsfilter — t.ex. "Stockholm". Tomt = inget filter. */
  city?: string;
  /** Var staden ska matcha: eventnamn, lokalnamn eller något av båda. */
  cityMatch?: 'name' | 'venue' | 'any';
  /** Exakta eventnamn som ska hoppas över (t.ex. organisationens testevent). */
  excludeTitles?: string[];
  limit?: number;
  enrichLimit?: number;
}

interface ConfettiFeedEvent {
  id?: string;
  slug?: string;
  name?: string;
  startDate?: string;
  endDate?: string | null;
  website?: string | null;
  prettyDates?: string | null;
  copy?: { locationName?: string | null; hideLocation?: boolean };
  cover?: { url?: string | null };
  categories?: number[];
}

interface DetailData {
  title: string | null;
  address: string | null;
  /** Var adressen kom ifrån — 'location-info' kan vara stale (se mainloopen). */
  addressSource: 'map' | 'location-info' | null;
  room: string | null;
  /** Platsnamn ur .location-info — används bara när det saknas karta. */
  venue: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
}

// ── Konfig ───────────────────────────────────────────────────────────────────

/**
 * Läser Confetti-konfigurationen ur source-filen.
 *
 * `metadata.confetti.host` anger vilken Confetti-organisation som ska läsas.
 * Om det saknas härleds värden från källans egen URL — Confetti-organisationer
 * ligger alltid på `<org>.confetti.events`, så en källa som pekar dit behöver
 * ingen särskild konfiguration alls.
 */
export function readConfettiConfig(source: SourceTruth): ConfettiConfig | null {
  const meta = source.metadata ?? {};
  const raw = meta.confetti as Partial<ConfettiConfig> | undefined;
  const explicitHost = raw && typeof raw.host === 'string' ? raw.host.trim() : '';
  const host = explicitHost || hostFromSourceUrl(source.url);
  if (!host) return null;
  return {
    host,
    locale: typeof raw?.locale === 'string' ? raw.locale : 'sv',
    city: typeof raw?.city === 'string' && raw.city.trim() ? raw.city.trim() : undefined,
    cityMatch: raw?.cityMatch === 'name' || raw?.cityMatch === 'venue' ? raw.cityMatch : 'any',
    excludeTitles: Array.isArray(raw?.excludeTitles)
      ? raw.excludeTitles.filter((t): t is string => typeof t === 'string')
      : [],
    limit: typeof raw?.limit === 'number' ? raw.limit : DEFAULT_LIMIT,
    enrichLimit: typeof raw?.enrichLimit === 'number' ? raw.enrichLimit : DEFAULT_ENRICH_LIMIT,
  };
}

/** Värdet ur källans URL om den pekar på en Confetti-organisation. */
function hostFromSourceUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.confetti.events') ? host : null;
  } catch {
    return null;
  }
}

// ── Feed ─────────────────────────────────────────────────────────────────────

async function fetchFeed(host: string, locale: string): Promise<ConfettiFeedEvent[]> {
  const axios = (await import('axios')).default;
  const url = `https://${host}/common/api/events?locale=${encodeURIComponent(locale)}`;
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    timeout: FEED_TIMEOUT_MS,
    validateStatus: (s: number) => s < 500,
  });
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status} från ${url}`);
  }
  const events = response.data?.events;
  if (!Array.isArray(events)) {
    throw new Error(`OVÄNTAT svar från ${url} — saknar events[]`);
  }
  return events as ConfettiFeedEvent[];
}

/** Framtida events: startDate måste vara ett giltigt datum i framtiden. */
function isFuture(startDate: unknown, nowMs: number): boolean {
  if (typeof startDate !== 'string' || !startDate.trim()) return false;
  const ms = Date.parse(startDate);
  return Number.isFinite(ms) && ms >= nowMs;
}

/** Stadsfilter — API:t ignorerar query-parametrar, så detta sker klient-sida. */
function matchesCity(ev: ConfettiFeedEvent, city: string, mode: 'name' | 'venue' | 'any'): boolean {
  const needle = city.toLowerCase();
  const name = typeof ev.name === 'string' ? ev.name.toLowerCase() : '';
  const venue = typeof ev.copy?.locationName === 'string' ? ev.copy.locationName.toLowerCase() : '';
  if (mode === 'name') return name.includes(needle);
  if (mode === 'venue') return venue.includes(needle);
  return name.includes(needle) || venue.includes(needle);
}

// ── Detaljsida (microdata) ──────────────────────────────────────────────────

/**
 * Plockar lat/lng ur MapTiler-bakgrundsbilden.
 * URL-formatet är <lng>,<lat>,<zoom> — t.ex. "18.080985,59.343852,14".
 */
function parseLatLngFromMapTile(style: string | undefined): { lat: number | null; lng: number | null } {
  if (!style) return { lat: null, lng: null };
  const m = style.match(/maptiler\.com\/maps\/[^/]+\/static\/(-?\d+\.\d+),(-?\d+\.\d+),(\d+)/);
  if (!m) return { lat: null, lng: null };
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
  return { lat, lng };
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Normaliserar ett platsnamn för jämförelse (diakritiker, mellanslag, skift). */
function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Beskrivningen ur `.text-text` — stycken skiljs med newline.
 *
 * `.text()` på hela blocket concatenerar barnen utan avgränsare, vilket ger
 * "Kör: Hägersten A CappellaOrgel: Patrick LindblomViolin: …". Blocknivå
 * (p, h1-h6, li) hämtas därför var för sig och joins med '\n'.
 */
function extractDescription($: cheerio.CheerioAPI): string | null {
  const blocks: string[] = [];
  $('.text-text').each((_: number, el: unknown) => {
    const scope = $(el);
    const children = scope.find('p, h1, h2, h3, h4, h5, h6, li');
    if (children.length === 0) {
      const text = cleanText(scope.text());
      if (text) blocks.push(text);
      return;
    }
    children.each((_: number, child: unknown) => {
      const text = cleanText($(child).text());
      if (text) blocks.push(text);
    });
  });
  if (blocks.length === 0) return null;
  // En .text-text kan innehålla både evenemangstexten och en länktext
  // ("Se alla …"). Den längsta sammanhållna texten är beskrivningen.
  return blocks.join('\n');
}

async function fetchDetail(url: string): Promise<DetailData | null> {
  const axios = (await import('axios')).default;
  let html: string;
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      timeout: DETAIL_TIMEOUT_MS,
      validateStatus: (s: number) => s < 400,
      responseType: 'text',
      transformResponse: [(d: unknown) => d],
    });
    if (response.status !== 200 || typeof response.data !== 'string') return null;
    html = response.data;
  } catch {
    return null;
  }

  const $ = cheerio.load(html);

  const title = cleanText($('h1.header-title').first().text()) || null;

  const street = cleanText($('.location-map-address .street-address').first().text());
  const postal = cleanText($('.location-map-address .postal-code').first().text());
  const locality = cleanText($('.location-map-address .locality').first().text());
  const country = cleanText($('.location-map-address .country-name').first().text());
  const addressParts = [street, [postal, locality].filter(Boolean).join(' '), country].filter(Boolean);
  const hasMap = addressParts.length > 0;

  const room = cleanText($('.location-map-name').first().text()) || null;

  // Utan karta ("location-hide-map") ligger platsen i stället i
  // .location-info: första <p> = platsnamn, andra <p> = adress.
  const infoParagraphs = $('.location-info p')
    .map((_: number, el: unknown) => cleanText($(el).text()))
    .get()
    .filter(Boolean);
  const infoVenue = infoParagraphs[0] ?? null;
  const infoAddress = infoParagraphs[1] ?? null;

  const address = hasMap ? addressParts.join(', ') : infoAddress;
  const addressSource: DetailData['addressSource'] = hasMap ? 'map' : infoAddress ? 'location-info' : null;

  const mapStyle = $('.location-map-image').first().attr('style');
  const { lat, lng } = parseLatLngFromMapTile(mapStyle);

  const description = extractDescription($);

  return {
    title,
    address,
    addressSource,
    room,
    venue: hasMap ? null : infoVenue,
    lat,
    lng,
    description,
  };
}

// ── Huvudfunktion ───────────────────────────────────────────────────────────

export async function runConfettiAdapter(source: SourceTruth): Promise<ApiAdapterResult> {
  const config = readConfettiConfig(source);
  if (!config) {
    return {
      status: 'failed',
      events: [],
      error: 'källan pekar inte på en Confetti-organisation och metadata.confetti.host saknas',
    };
  }

  let feed: ConfettiFeedEvent[];
  try {
    feed = await fetchFeed(config.host, config.locale ?? 'sv');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', events: [], error: `confetti feed: ${message}` };
  }

  const nowMs = Date.now();
  const future = feed.filter(ev => isFuture(ev.startDate, nowMs));
  const excluded = new Set((config.excludeTitles ?? []).map(t => t.trim().toLowerCase()));
  const notExcluded = future.filter(
    ev => !(typeof ev.name === 'string' && excluded.has(ev.name.trim().toLowerCase())),
  );
  const cityFiltered = config.city
    ? notExcluded.filter(ev => matchesCity(ev, config.city!, config.cityMatch ?? 'any'))
    : notExcluded;

  const limit = config.limit ?? DEFAULT_LIMIT;
  const selected = cityFiltered.slice(0, limit);

  if (selected.length === 0) {
    return {
      status: 'failed',
      events: [],
      error: `confetti: 0 events (feed=${feed.length}, framtida=${future.length}, efter uteslutning=${notExcluded.length}, efter stadfilter=${cityFiltered.length})`,
    };
  }

  // Detaljsidor: geografi + beskrivning. Begränsat antal, parallellt.
  const enrichLimit = config.enrichLimit ?? DEFAULT_ENRICH_LIMIT;
  const details = new Map<string, DetailData | null>();
  const toEnrich = selected.filter(ev => typeof ev.website === 'string' && ev.website).slice(0, enrichLimit);
  const CONCURRENCY = 4;
  for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
    const chunk = toEnrich.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(chunk.map(ev => fetchDetail(ev.website as string)));
    chunk.forEach((ev, idx) => {
      const key = ev.id ?? ev.slug ?? ev.website ?? '';
      details.set(key, fetched[idx] ?? null);
    });
  }

  const rows: AdapterEventRow[] = [];

  for (const ev of selected) {
    const title = typeof ev.name === 'string' ? ev.name.trim() : '';
    if (!title) continue;

    const key = ev.id ?? ev.slug ?? ev.website ?? '';
    const detail = details.get(key) ?? null;

    const apiVenue = typeof ev.copy?.locationName === 'string' ? ev.copy.locationName : null;
    const room = detail?.room ?? apiVenue;

    // Adressen ur .location-info (utan karta) används bara om platsnamnet i
    // samma block matchar evenemangets platsnamn. Annars är blocket stale —
    // t.ex. har "Sofia Lärkfors Requiem i Storkyrkan" kvar Uppenbarelsekyrkans
    // adress, och en fel adress är värre än ingen adress.
    let address = detail?.address ?? null;
    if (detail?.addressSource === 'location-info') {
      const samePlace = !!apiVenue && !!detail.venue && normalizePlace(detail.venue) === normalizePlace(apiVenue);
      if (!samePlace) address = null;
    }

    const description = detail?.description ?? null;
    const local = stockholmLocalParts(ev.startDate as string);

    const row: AdapterEventRow = {
      title,
      start_time: ev.startDate as string,
      end_time: typeof ev.endDate === 'string' && ev.endDate ? ev.endDate : null,
      date: local.date,
      time: local.time,
      venue: room ?? undefined,
      address: address ?? undefined,
      city: source.city,
      description: description ?? undefined,
      url: typeof ev.website === 'string' ? ev.website : undefined,
      source: source.id,
      sourceUrl: source.url,
      source_id: ev.id ?? ev.slug ?? null,
      lat: detail?.lat ?? null,
      lng: detail?.lng ?? null,
      // AI-bilder är obligatoriskt (se 04-Normalizer/normalizer.ts) — därför
      // sätts källbilderna till null och låter AI-workeren generera dem.
      image_url: null,
      detected_language: 'sv',
      category: detectCategory(title, description ?? undefined),
      raw_payload: ev as unknown as Record<string, unknown>,
    };

    rows.push(row);
  }

  return { status: 'completed', events: rows };
}

/**
 * Lokal (Stockholm-)datum och tid för ett UTC-instant.
 *
 * Legacy-fälten date/time ska beskriva SAMMA sak som start_time, annars
 * kan en rad hamna på fel dag (kl. 00:30 lokalt = 23:30Z föregående dag).
 * Utgår därför från zonen, inte från UTC-strängens datumdel.
 */
function stockholmLocalParts(utcIso: string): { date: string; time: string } {
  const date = toStockholmDate(utcIso) ?? utcIso.slice(0, 10);
  const zoned = toZonedTime(new Date(utcIso), 'Europe/Stockholm');
  const hh = String(zoned.getHours()).padStart(2, '0');
  const mm = String(zoned.getMinutes()).padStart(2, '0');
  return { date, time: `${hh}:${mm}` };
}
