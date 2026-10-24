/**
 * stockholmJazz.ts — Stockholms Jazzfestival-adapter för Tool A (direct-API)
 *
 * VARFÖR ADAPTER: källan `stockholm-jazz-festival` pekar på
 * https://www.stockholmjazz.se/program — en SvelteKit-app. /program är ett
 * ~8 kB JS-skal; själva korten byggs client-side. Mätt 2026-10-24:
 *   /program (utan rendering) → inga kort, ingen JSON-LD, ingen händelsetext
 *   JSON-LD finns på varje ENSKILD konsertsida (/program/<slug>), inte på listan
 * Det betyder att listspåret är strukturellt dött: JSON-LD-vägen ger 0 rader
 * oavsett hur många konserter som publiceras.
 *
 * Plattformen exponerar däremot ett JSON-API som INTE kräver rendering:
 *
 *   GET https://www.stockholmjazz.se/api/concerts?limit=<n>&offset=<m>
 *
 * Mätt 2026-10-24 med riktig hämtning:
 *   http 200, 339 939 B, meta = { total: 331, limit, offset, hasMore }
 *   data[] = 331 rader med id, slug, titleSv, titleEn, date, startTime,
 *            endTime, doorsTime, genre, ticketUrl, ticketStatus, isFree,
 *            status, venue { nameSv, address, slug }, artist, imageUrl
 *
 * PAGINERING: `limit`/`offset` styrs av servern (`meta.hasMore`). Utan
 * `limit` returnerar servern bara 24 rader — en tyst felaktig avläsning som
 * skulle gett 24 av 331. Adaptern läser därför ALLID sista sidan.
 *
 * SLUGGAR: 42 av 331 rader har sluggar som innehåller "kop" eller "kopia"
 * (t.ex. "augusta-swing-band-kopia-kopia-1784235467313"). Det är INTE
 * utkast — det är CMS:ets kopieringsmekanik. Mätt: "Augusta Swing Band"
 * spelar 16:00–18:30 på Källarbyn varje dag 9–18 oktober, och de nio av tio
 * dagarna har bara en "kopia"-slug. Filtrera man bort dem försvinner 9 av 10
 * konserter. Sluggen får därför INTE filtreras — bara `status` styr.
 *
 * TIDER: API:t ger LOKAL Stockholms-tid (`date` + "16:00"). Sluttiden
 * (`endTime`) finns på 278 av 331 rader. Båda omvandlas via Europe/Stockholm
 * till UTC ISO — offseten växlar mellan CEST (+02:00) och CET (+01:00), så
 * den får inte hardkodas.
 *
 * SÄSONG: festivalen är årlig. 2026-upplagan gick 9–18 oktober 2026, så
 * den 24 oktober är varje rad förfluten. Adaptern returnerar då NOLL
 * framtida rader — men API:T ÄR FRISKT. Det är därför adaptern skiljer på
 * "API:t svarade men säsongen är slut" (inget fel, `noEventsReason`) och
 * "API:t är trasigt" (riktigt fel). Annars skulle källan räknas som fel
 * varje natt och auto-quarantänas vid 5 — en LEVANDE källa begravd för att
 * den är säsongsbunden.
 *
 * Varför inte C-lager: mönstret är helt plattformsspecifikt (jazzfestivalens
 * eget API). Det är "Site-Specific → använd source adapter", precis som
 * Generalization Protection Rule kräver.
 */

import { fromZonedTime } from 'date-fns-tz';
import { detectCategory } from '../../F-eventExtraction/categoryKeywords';
import type { SourceTruth } from '../../tools/sourceRegistry';
import type { AdapterEventRow, ApiAdapterResult } from './types';

const API_BASE = 'https://www.stockholmjazz.se/api/concerts';
const SITE_BASE = 'https://www.stockholmjazz.se';
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_PAGES = 10;
const TIMEZONE = 'Europe/Stockholm';

export interface StockholmJazzConfig {
  /** Rader per förfrågan. Serverns max är okänt; 200 är säkert. */
  limit: number;
  /** Max antal förfrågningar mot API:t. */
  maxPages: number;
  /** Endast rader med detta status. */
  status: string;
}

interface JazzVenue {
  slug?: string | null;
  nameSv?: string | null;
  nameEn?: string | null;
  address?: string | null;
}

export interface JazzConcert {
  id?: string | null;
  slug?: string | null;
  titleSv?: string | null;
  titleEn?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  doorsTime?: string | null;
  genre?: string | null;
  ticketUrl?: string | null;
  ticketStatus?: string | null;
  isFree?: boolean | null;
  status?: string | null;
  venue?: JazzVenue | null;
}

interface JazzResponse {
  data?: JazzConcert[] | null;
  meta?: { total?: number | null; limit?: number | null; offset?: number | null; hasMore?: boolean | null } | null;
}

/** Läs konfigurationen ur source-filen. */
export function readStockholmJazzConfig(source: SourceTruth): StockholmJazzConfig {
  const raw = (source.metadata ?? {}).stockholmJazz as Partial<StockholmJazzConfig> | undefined;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  const status = typeof raw?.status === 'string' && raw.status.trim() ? raw.status.trim() : 'published';
  return {
    limit: num(raw?.limit, DEFAULT_LIMIT),
    maxPages: num(raw?.maxPages, DEFAULT_MAX_PAGES),
    status,
  };
}

/**
 * Lokal datum + klockslag i Europe/Stockholm → UTC ISO.
 *
 * API:t ger "2026-10-09" + "16:00" — lokal tid, ingen offset. Vi tolkar
 * strängen i zonen (fromZonedTime) och returnerar UTC ISO med Z.
 */
export function localDateTimeToUtc(date: string | null | undefined, clock: string | null | undefined): string | null {
  if (!date || !clock) return null;
  const d = date.trim();
  const c = clock.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(c)) return null;
  try {
    const utc = fromZonedTime(`${d}T${c}:00`, TIMEZONE);
    if (Number.isNaN(utc.getTime())) return null;
    return utc.toISOString();
  } catch {
    return null;
  }
}

async function fetchPage(config: StockholmJazzConfig, offset: number): Promise<{
  concerts: JazzConcert[];
  hasMore: boolean;
  total: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${API_BASE}?limit=${config.limit}&offset=${offset}`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} från ${url}: ${text.slice(0, 160)}`);
    }
    let json: JazzResponse;
    try {
      json = JSON.parse(text) as JazzResponse;
    } catch {
      throw new Error(`icke-JSON-svar (${text.slice(0, 80)})`);
    }
    const concerts = Array.isArray(json.data) ? json.data : [];
    const meta = json.meta ?? {};
    const total = typeof meta.total === 'number' ? meta.total : concerts.length;
    const hasMore =
      typeof meta.hasMore === 'boolean'
        ? meta.hasMore
        : offset + concerts.length < total;
    return { concerts, hasMore, total };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bygg en rad från en konsertpost.
 *
 * Exportad för testning — mappningen är den del som faktiskt kan gå fel.
 */
export function concertToRow(
  concert: JazzConcert,
  source: SourceTruth,
  nowMs: number,
): AdapterEventRow | null {
  const title = (concert.titleSv ?? concert.titleEn ?? '').trim();
  if (!title) return null;

  const startIso = localDateTimeToUtc(concert.date, concert.startTime);
  if (!startIso) return null;
  if (Date.parse(startIso) < nowMs) return null; // förflutet → sparas inte

  // Sluttiden ska ligga EFTER starten. Saknas den, eller är den trasig
  // (slut == start), skrivs ingen sluttid — importens normaliserare
  // släpper ändå bort en sluttid före starten.
  let endIso: string | null = null;
  const rawEnd = localDateTimeToUtc(concert.date, concert.endTime);
  if (rawEnd && Date.parse(rawEnd) > Date.parse(startIso)) {
    endIso = rawEnd;
  }

  const slug = (concert.slug ?? '').trim();
  const url = slug ? `${SITE_BASE}/program/${slug}` : source.url;
  const ticketUrl = (concert.ticketUrl ?? '').trim();
  const venueName = (concert.venue?.nameSv ?? concert.venue?.nameEn ?? '').trim();
  const genre = (concert.genre ?? '').trim();

  return {
    title,
    start_time: startIso,
    end_time: endIso,
    date: concert.date!.trim(),
    time: (concert.startTime ?? '').trim(),
    venue: venueName || undefined,
    address: (concert.venue?.address ?? '').trim() || undefined,
    city: source.city || 'Stockholm',
    url,
    ticketUrl: ticketUrl || undefined,
    category: detectCategory(`${title} ${genre}`),
    source: source.id,
    sourceUrl: source.url,
    source_id: concert.id ?? slug ?? null,
    lat: null,
    lng: null,
    // AI-bilder är obligatoriskt (se 04-Normalizer/normalizer.ts) — därför
    // sätts källbilderna till null och låter AI-workern generera dem.
    image_url: null,
    detected_language: 'sv',
    raw_payload: {
      id: concert.id ?? null,
      slug: slug || null,
      genre: genre || null,
      doorsTime: concert.doorsTime ?? null,
      ticketStatus: concert.ticketStatus ?? null,
      isFree: concert.isFree ?? null,
      venueSlug: concert.venue?.slug ?? null,
      concertStatus: concert.status ?? null,
    },
  };
}

/**
 * Kör adaptern mot en källa.
 *
 * Returnerar rader i extractedevents-format — bara framtida events, samma
 * definition som importens datumvakt använder.
 */
export async function runStockholmJazzAdapter(source: SourceTruth): Promise<ApiAdapterResult> {
  const config = readStockholmJazzConfig(source);

  const all: JazzConcert[] = [];
  let total = 0;
  let offset = 0;
  try {
    for (let page = 0; page < Math.max(1, config.maxPages); page++) {
      const res = await fetchPage(config, offset);
      all.push(...res.concerts);
      total = res.total;
      offset += res.concerts.length;
      if (!res.hasMore) break;
      if (res.concerts.length === 0) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', events: [], error: `stockholmjazz: ${message}` };
  }

  if (all.length === 0) {
    return {
      status: 'failed',
      events: [],
      error: `stockholmjazz: API:t svarade men gav 0 rader (total=${total})`,
    };
  }

  const nowMs = Date.now();
  const { rows, skippedStatus } = mapConcerts(all, source, nowMs, config.status);

  if (rows.length === 0) {
    // API:T ÄR FRISKT — det finns bara inga framtida konserter (säsongen
    // är slut, eller allt är ospublicerat). Det är INTE ett fel, och det
    // får inte räknas som ett: källan är levande och ska köras igen.
    return {
      status: 'completed',
      events: [],
      noEventsReason: describeNoUpcoming(
        all.length,
        skippedStatus,
        all.map(c => c.date ?? ''),
      ),
    };
  }

  return { status: 'completed', events: rows };
}

/**
 * Mappa konsertposter till rader.
 *
 * Exportad för testning — det här är den del som faktiskt kan gå fel.
 * `status` styr vilka poster som godtas; SLUGGEN filtreras ALDRIG (se
 * filens header: "kopia"-sluggar är riktiga konserter).
 */
export function mapConcerts(
  concerts: readonly JazzConcert[],
  source: SourceTruth,
  nowMs: number,
  status: string,
): { rows: AdapterEventRow[]; skippedStatus: number } {
  const rows: AdapterEventRow[] = [];
  const seen = new Set<string>();
  let skippedStatus = 0;

  for (const concert of concerts) {
    if ((concert.status ?? 'published') !== status) {
      skippedStatus++;
      continue;
    }
    const row = concertToRow(concert, source, nowMs);
    if (!row) continue;
    const key = `${row.source_id ?? ''}|${row.start_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return { rows, skippedStatus };
}

/**
 * Beskriv varför en frisk källa inte gav några framtida events.
 *
 * Används när API:t svarade men alla rader är förflutna — säsongen är slut.
 * Det är INTE ett fel och ska aldrig räknas som ett.
 */
export function describeNoUpcoming(
  total: number,
  skippedStatus: number,
  dates: readonly string[],
): string {
  const sorted = [...dates].filter(Boolean).sort();
  const span = sorted.length > 0 ? `${sorted[0]}..${sorted[sorted.length - 1]}` : '?';
  return (
    `API:t svarade med ${total} rader (${skippedStatus} ospublicerade, dater ${span}), ` +
    `men ingen är framtida — festivalen är säsongsbunden. Källan är levande; ` +
    `kör igen när nästa program publiceras.`
  );
}
