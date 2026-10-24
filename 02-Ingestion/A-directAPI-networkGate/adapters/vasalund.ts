/**
 * vasalund.ts — Vasalunds IF API-adapter för Tool A (direct-API)
 *
 * VARFÖR ADAPTER (mätt 2026-10-24):
 *
 * 1. Källans registrerade URL `https://www.vasalund.se` är en PARKERAD domän
 *    ("TILL SALU"). Klubbens riktiga sajt är `https://www.vasalund.com`.
 *
 * 2. `/matcher` på .com är en DM/360Player-sida. Server-HTML:en innehåller
 *    bara JS-mallen (en template-literal med `<div class="match-item">`) och
 *    0 renderade matchrader. Kalendern fylls client-side via
 *    `window.dmAPI.loadCollectionsAPI()` → `fetchAll(collectionsApi,
 *    'matchesUpcoming', …)`.
 *
 * 3. RENDER VÄGER INTE. Mätt med D-gatens riktiga ScrapingBee-premiumrender
 *    (2 körningar, 25 credits vardera):
 *      wait=5000  → 109 409 bytes, `upcoming-grid` TOM, `match-item` 0 st i DOM
 *      wait=12000 → 109 409 bytes (byte-identisk), `match-item` 0 st i DOM
 *    Renderingen hing fast i `loading-state` (spinnern syns, tom-state visas
 *    INTE) → `init()` hängde i `loadCollectionsAPI()`/collection-anropet.
 *    ScrapingBee-renderingen fyller alltså aldrig DM:s collection-API.
 *
 * 4. MEN data-APIt är ÖPPET med ren HTTP. DM:s runtime exponerar
 *      GET /rts/collections/public/client/resources
 *        → {"src":"https://ms-cdn.multiscreensite.com/collections/3639/res/js/…"}
 *    och collection-läsningen sker på
 *      GET /rts/collections/public/<SiteAlias>/runtime/collection/<namn>/query-data
 *    där <SiteAlias> står i sidans `window.Parameters.SiteAlias` (2d5d3bf3).
 *
 *    Mätt 2026-10-24 (utan rendering, utan credits):
 *      matchesUpcoming  → HTTP 200, 46 framtida matcher (2026-10-24 … 2027-01-17)
 *      matchesComplete  → HTTP 200, 100 spelade matcher
 *
 * 5. TIDSZONEN ÄR BEVISAD, inte antagen. Kontrollmatchen mot den riktiga
 *    renderingen:
 *      JSON:  startsAt 1792850400 → UTC 2026-10-24T14:00 → Stockholm 16:00
 *      HTML:  samma match renderad som "Sollentuna FK vs Herrar", lör 24 okt.
 *             2026, 16:00, Sollentunavallen 1
 *    Två oberoende vägar (JSON-epoch och DOM-parsning) ger samma lokal tid.
 *
 * 6. VILKA MATCHER? API:t innehåller 46 framtida matcher varav 43 är
 *    ungdomslag (P2013–P2019, F2016, F2017) och 3 är seniorlaget ("Herrar",
 *    groupId 14790). Vi tar SENIORLAGET — samma scope som hammarby-adaptern
 *    ger (11 herr- och damlagets matcher). Skäl: en ungdomsmatch är inte ett
 *    evenemang en person kan ta del av; klubbens egna /matcher-widget visar
 *    också ett filtrerat urval, inte alla 46.
 *
 * Varför inte C-lager: mönstret är helt plattformsspecifikt (DM/360Players
 * collections-API). Det är "Site-Specific → använd source adapter", precis
 * som Generalization Protection Rule kräver. Ingen upptäcktsheuristik
 * (C0/C1/C2) rörs.
 */

import { toZonedTime } from 'date-fns-tz';
import type { SourceTruth } from '../../tools/sourceRegistry';
import type { AdapterEventRow, ApiAdapterResult } from './types';

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** DM-collectionen som innehåller framtida matcher. */
const UPCOMING_COLLECTION = 'matchesUpcoming';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

/**
 * Seniorlagets grupp i DM. Mätt 2026-10-24: groupId 14790 = "Herrar"
 * (Sollentuna FK vs Herrar, Herrar vs IF Karlstad Fotboll, FC Järfälla vs
 * Herrar). Övriga grupper i samma collection är ungdomslag.
 */
const DEFAULT_GROUP_IDS = ['14790'];

const TIMEZONE = 'Europe/Stockholm';

export interface VasalundConfig {
  /** DM-grupper som ska räknas som evenemang. Tom lista = alla grupper. */
  groupIds: string[];
  /** Hur många sidor av collectionen som läses. */
  maxPages: number;
}

export interface DmMatch {
  id?: string | null;
  homeName?: string | null;
  awayName?: string | null;
  startsAt?: number | null;
  location?: string | null;
  competitionName?: string | null;
  groupId?: string | null;
  isHome?: boolean | null;
  status?: string | null;
}

export interface DmCollectionResponse {
  name?: string;
  values?: Array<{ data?: DmMatch }>;
  page?: {
    pageSize?: number;
    pageNumber?: number;
    totalPages?: number;
    totalItems?: number;
  };
}

/** Läs konfigurationen ur source-filen. */
export function readVasalundConfig(source: SourceTruth): VasalundConfig {
  const raw = (source.metadata ?? {}).vasalund as
    | { groupIds?: unknown; maxPages?: unknown }
    | undefined;
  const groupIds = Array.isArray(raw?.groupIds)
    ? raw.groupIds.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
    : DEFAULT_GROUP_IDS;
  const maxPages =
    typeof raw?.maxPages === 'number' && Number.isFinite(raw.maxPages) && raw.maxPages > 0
      ? Math.floor(raw.maxPages)
      : MAX_PAGES;
  return { groupIds, maxPages };
}

/**
 * DM:s SiteAlias står i sidans runtime-parameters:
 *   window.Parameters = { …, SiteAlias: '2d5d3bf3', … }
 */
export function extractSiteAlias(html: string): string | null {
  const m = html.match(/SiteAlias\s*:\s*'([^']+)'/);
  return m ? m[1] : null;
}

/**
 * Bygg collection-URL:en för en given sida.
 *
 * `pageNumber` är NOLLBASERAD i DM:s collections-API — mätt 2026-10-24:
 *   pageNumber=0 → 46 värden (första sidan)
 *   pageNumber=1 → 0 värden (sidan finns inte)
 *   pageNumber=2 → 0 värden
 * Utan pageNumber-parametern returneras alla 46 värden. Ett API som startar
 * på 1 ger alltså en tydlig "tom lista" utan felmeddelande — därför är
 * nollbaseringen här uttrycklig och testad.
 */
export function buildCollectionUrl(
  origin: string,
  siteAlias: string,
  collection: string,
  pageNumber: number,
  pageSize: number = PAGE_SIZE
): string {
  return (
    `${origin}/rts/collections/public/${encodeURIComponent(siteAlias)}/runtime/collection/` +
    `${encodeURIComponent(collection)}/query-data?pageSize=${pageSize}&pageNumber=${pageNumber}`
  );
}

/** Plocka ut matchraderna ur ett DM-collection-svar. */
export function parseDmMatches(payload: DmCollectionResponse): DmMatch[] {
  if (!Array.isArray(payload?.values)) return [];
  return payload.values
    .map(v => v?.data)
    .filter((d): d is DmMatch => Boolean(d) && typeof d === 'object');
}

/**
 * Lokal datum/tid (Europe/Stockholm) ur en UTC-ISO-sträng.
 *
 * `toZonedTime` skjuter om Date-objektet så att dess LOKALA fält motsvarar
 * tiden i zonen. Därför läses fälten med getFullYear/getDate/getHours — inte
 * via toISOString() (det skulle ge UTC-fälten igen).
 */
function localParts(utcIso: string): { date: string; time: string } {
  try {
    const zoned = toZonedTime(new Date(utcIso), TIMEZONE);
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

/** Titel: "Sollentuna FK vs Herrar". */
export function buildMatchTitle(m: DmMatch): string | null {
  const home = (m.homeName ?? '').trim();
  const away = (m.awayName ?? '').trim();
  if (!home && !away) return null;
  if (!home) return away;
  if (!away) return home;
  return `${home} vs ${away}`;
}

/**
 * Bygg rader ur matchlistan.
 *
 * Filter: status 'canceled' utesluts, förflutna matcher utesluts och
 * grupper utanför configen utesluts.
 */
export function toRows(
  matches: DmMatch[],
  source: SourceTruth,
  config: VasalundConfig,
  nowMs: number = Date.now()
): AdapterEventRow[] {
  const rows: AdapterEventRow[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const status = (m.status ?? '').toLowerCase();
    if (status === 'canceled' || status === 'cancelled') continue;

    const groupId = (m.groupId ?? '').trim();
    if (config.groupIds.length > 0 && !config.groupIds.includes(groupId)) continue;

    const startsAt = typeof m.startsAt === 'number' ? m.startsAt : null;
    if (startsAt === null || !Number.isFinite(startsAt)) continue;

    const startMs = startsAt * 1000;
    if (startMs < nowMs) continue; // förflutet → sparas inte

    const title = buildMatchTitle(m);
    if (!title) continue;

    const startIso = new Date(startMs).toISOString();
    const local = localParts(startIso);
    const id = (m.id ?? '').trim() || `${title}|${startIso}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const venue = (m.location ?? '').trim();
    const competition = (m.competitionName ?? '').trim();

    rows.push({
      title,
      start_time: startIso,
      end_time: null,
      date: local.date,
      time: local.time,
      venue: venue || undefined,
      address: undefined,
      city: source.city ?? 'Stockholm',
      description: competition || undefined,
      url: source.url,
      ticketUrl: undefined,
      category: 'sports',
      source: source.id,
      sourceUrl: source.url,
      source_id: id,
      lat: null,
      lng: null,
      // AI-bilder är obligatoriskt (se 04-Normalizer/normalizer.ts) — därför
      // sätts källbilderna till null och låter AI-workern generera dem.
      image_url: null,
      detected_language: 'sv',
      raw_payload: {
        homeName: m.homeName ?? null,
        awayName: m.awayName ?? null,
        isHome: m.isHome ?? null,
        groupId: groupId || null,
        competitionName: competition || null,
        dmStatus: status || null,
        startsAtEpoch: startsAt,
      },
    });
  }

  return rows;
}

async function fetchText(url: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept,
        'user-agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} från ${url}: ${text.slice(0, 160)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string): Promise<DmCollectionResponse> {
  const text = await fetchText(url, 'application/json');
  try {
    return JSON.parse(text) as DmCollectionResponse;
  } catch {
    throw new Error(`icke-JSON-svar från ${url}: ${text.slice(0, 80)}`);
  }
}

/**
 * Kör adaptern mot en källa.
 *
 * Returnerar rader i extractedevents-format — en rad per framtida match.
 */
export async function runVasalundAdapter(source: SourceTruth): Promise<ApiAdapterResult> {
  const config = readVasalundConfig(source);

  let origin: string;
  try {
    origin = new URL(source.url).origin;
  } catch {
    return { status: 'failed', events: [], error: `vasalund: ogiltig käll-URL "${source.url}"` };
  }

  // 1) SiteAlias ur sidans runtime-parameters.
  //
  // Accept-headern är viktig: DM:s runtime-server svarar med en JSON-payload
  // (css + delar av sidan, 177 410 B) om headern är
  // "text/html,application/json;q=0.9,*/*;q=0.8". Med "text/html" (eller
  // */*) kommer den fulla HTML-sidan (108 621 B) med SiteAlias. Mätt
  // 2026-10-24 — alla sju headervarianter provade.
  let siteAlias: string | null = null;
  try {
    const page = await fetchText(source.url, 'text/html');
    siteAlias = extractSiteAlias(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', events: [], error: `vasalund: kunde inte hämta sidan — ${message}` };
  }
  if (!siteAlias) {
    return {
      status: 'failed',
      events: [],
      error: `vasalund: hittade ingen SiteAlias i ${source.url} (DM-runtime-parametern saknas)`,
    };
  }

  // 2) Collectionen med framtida matcher. pageNumber är nollbaserad.
  const all: DmMatch[] = [];
  try {
    for (let page = 0; page < Math.max(1, config.maxPages); page++) {
      const url = buildCollectionUrl(origin, siteAlias, UPCOMING_COLLECTION, page);
      const payload = await fetchJson(url);
      const matches = parseDmMatches(payload);
      all.push(...matches);

      const totalPages = payload.page?.totalPages;
      if (typeof totalPages === 'number' && page + 1 >= totalPages) break;
      if (matches.length < PAGE_SIZE) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', events: [], error: `vasalund: ${message}` };
  }

  if (all.length === 0) {
    return {
      status: 'failed',
      events: [],
      error: `vasalund: collectionen ${UPCOMING_COLLECTION} (alias ${siteAlias}) gav 0 rader`,
    };
  }

  // 3) Rader.
  const rows = toRows(all, source, config);
  if (rows.length === 0) {
    return {
      status: 'failed',
      events: [],
      error:
        `vasalund: 0 sparbara events (api=${all.length}, grupper=${config.groupIds.join(',') || 'alla'})`,
    };
  }

  return { status: 'completed', events: rows };
}
