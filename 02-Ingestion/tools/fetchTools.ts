/**
 * HTTP Fetch Tool - Unified fetcher for all ingestion methods
 * Used by all non-API sources (WordPress, JSON-LD, HTML scraping)
 */

import axios from 'axios';
import type { RawEventInput } from '@eventpulse/shared';

export interface FetchResult {
  success: boolean;
  html?: string;
  data?: any;
  error?: string;
  statusCode?: number;
  /** Final URL after following redirects (for debugging/auditing) */
  finalUrl?: string;
  /** Redirect chain for auditing: ['301:/path', '308:/other'] */
  redirectChain?: string[];
  /** Retry-After från sajten vid 429/503 (sekunder, som sträng). */
  retryAfter?: string;
  /** Antal throttling-retry som gjordes innan svaret kom. 0 = första försöket lyckades. */
  throttleAttempts?: number;
}

/**
 * Fetch HTML content from a URL.
 * Follows 301/302/307/308 redirects up to MAX_REDIRECTS.
 * Same-domain redirects only for security.
 * Returns content from the final non-redirect URL.
 */
// Steg 3 (2026-09-10): höjd från 3 till 6 efter audit-redirect-chains.ts.
// Audit visade 19/20 Bucket B-källor resolverar 200 inom 5 hopp; 7 av dem
// har exakt 3 hopp (barnens-o, centuri, gr-na-lund, medborgarhuset,
// medeltidsmuseet, moderna-museet, tekniska-museet) och dog därför på 3-cap.
// Cross-domain redirect-loop-detektorn (rad 48) bevaras — skyddar mot
// riktiga cykler. Cycle-detektor slår till innan MAX_REDIRECTS ändå.
const MAX_REDIRECTS = 6;

/**
 * Throttling-policy (2026-10-24).
 *
 * Flera svenska sajter svarar 429 när de anropas för tätt. C-gaten gör många
 * anrop mot samma värd i samma körning (sitemap-filer, kandidat-sidor,
 * C1-subpaths, C2/C3-hämtning) — och WAF:en räknar dem som en burst.
 *
 * Mätt på blekholmen.se: efter ~12 snabba anrop svarar sajten 429 i ~30 s,
 * sedan svarar den 200 igen. Utan retry skrev C-gaten detta 429 som ett
 * extraktionsfel, räknade det i felräknaren och begravde en levande källa.
 * Samma mönster uppmättes på folkets-hus.se, galeasen.se, filborna.se,
 * ifkstockholm.se, waldemarsudde.se och fotografiska.se — sju orelaterade
 * domäner, så det är ett generellt mönster och inte en sajt-specifik grej.
 *
 * Tre delar:
 *   1. Per-värd-spacing — vi anropar inte samma värd snabbare än
 *      HOST_MIN_GAP_MS (mätning: 7 anrop/10 s triggar 429, 2 s spacing
 *      ger högst 6 per 10 s). Detta är rotorsaken: C0 testar upp till 30
 *      svenska URL-mönster mot samma värd i följd.
 *   2. Retry med backoff på 429/503 — vi väntar ut rate-limit-fönstret.
 *   3. `Retry-After` respekteras när sajten skickar den (mätning: 10 s).
 */
const THROTTLE_STATUS_CODES = new Set([429, 503]);
/** Antal försök totalt (1 = bara första försöket, dvs. ingen retry). */
const THROTTLE_MAX_ATTEMPTS = 3;
/**
 * Backoff i ms per försök (väntan före nästa försök) NÄR sajten inte
 * skickar Retry-After. Värdena täcker det uppmätta straff-fönstret (~10 s):
 * 5 s + 12 s = 17 s totalt.
 */
const THROTTLE_BACKOFF_MS = [5000, 12000];
/** Tak på Retry-After så en trasig header inte hänger oss i minuter. */
const THROTTLE_MAX_WAIT_MS = 30_000;

/**
 * Minsta avstånd mellan två anrop till samma värd (ms).
 *
 * Mätt 2026-10-24 på blekholmen.se med riktiga anrop:
 *   - 800 ms gap → 429 efter 7 anrop (~5.6 s)
 *   - 100 ms gap → 429 efter 8 anrop (~1.5 s)
 *   - 2000 ms gap → 14 anrop, 0 st 429
 *   - 1500 ms gap (3 värdar sammanlagt) → 8 anrop/värd, 0 st 429
 * Tröskeln är alltså ~7 anrop per 10 s per värd. 2000 ms ger högst 6 per
 * 10 s — marginal under tröskeln, mätt på flera värdar.
 *
 * Anrop till OLIKA värd påverkas inte, så C-gatens fem workers (som kör
 * olika källor, dvs. olika värdar) löper vidare i full fart. Kostnaden
 * sitter bara i den egna källans crawl — vilket är precis där WAF:en
 * satt igång.
 */
const HOST_MIN_GAP_MS = 2000;

/** Millisekunder att vänta innan nästa försök, givet Retry-After om den finns. */
function throttleWaitMs(attempt: number, retryAfterHeader?: string): number {
  const base = THROTTLE_BACKOFF_MS[Math.min(attempt, THROTTLE_BACKOFF_MS.length - 1)];
  if (retryAfterHeader === undefined) return base;
  const seconds = Number(retryAfterHeader);
  // Retry-After: 0 betyder "försök igen nu" — det är giltig HTTP-semantik,
  // inte en trasig header. Negativa och icke-numeriska värden ignoreras.
  if (!Number.isFinite(seconds) || seconds < 0) return base;
  return Math.min(seconds * 1000, THROTTLE_MAX_WAIT_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Per-värd-spacing ──────────────────────────────────────────────────────

/** värd -> kedjan av anrop som väntar på sin tur mot det värdet. */
const hostChains = new Map<string, Promise<void>>();
/** värd -> tidpunkten för det senaste faktiska anropet. */
const hostLastRequestAt = new Map<string, number>();

/** Nyckel för per-värd-spacing: värdnamn (port ingår). */
function hostKey(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Kör `fn` så att inga två anrop till samma värd påbörjas närmare varandra
 * än HOST_MIN_GAP_MS, och så att aldrig två anrop till samma värd är i
 * luften samtidigt.
 *
 * Anrop till olika värd blockeras inte alls.
 */
async function withHostSpacing<T>(
  url: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const key = hostKey(url);
  const previous = hostChains.get(key) ?? Promise.resolve();

  let release!: () => void;
  const myTurn = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => myTurn);
  hostChains.set(key, chain);

  try {
    // Vänta tills det föregående anropet mot samma värd är klart.
    await previous;

    // Håll avståndet till det senaste faktiska anropet.
    const last = hostLastRequestAt.get(key);
    if (last !== undefined && !signal?.aborted) {
      const elapsed = Date.now() - last;
      if (elapsed < HOST_MIN_GAP_MS) await sleep(HOST_MIN_GAP_MS - elapsed);
    }

    const result = await fn();
    hostLastRequestAt.set(key, Date.now());
    return result;
  } finally {
    release();
    // Städa bort kedjan om ingen nyare körning väntar — annars växer
    // kartan för varje värd vi någonsin besökt.
    if (hostChains.get(key) === chain) hostChains.delete(key);
  }
}

export function normalizeFetchUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '') || '/';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export async function fetchHtml(url: string, options: {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
} = {}): Promise<FetchResult> {
  let last: FetchResult = { success: false, error: 'okänt fel' };
  let retries = 0;

  for (let attempt = 0; attempt < THROTTLE_MAX_ATTEMPTS; attempt++) {
    const result = await fetchHtmlOnce(url, options);
    if (result.success) {
      return { ...result, throttleAttempts: retries };
    }
    last = result;

    // Bara 429/503 är throttling. 404/403/DNS är verkliga fel och ska inte
    // försökas igen — de begravs korrekt.
    const throttled = result.statusCode !== undefined && THROTTLE_STATUS_CODES.has(result.statusCode);
    if (!throttled || attempt === THROTTLE_MAX_ATTEMPTS - 1) break;

    // Avbryt om anroparen avbrut förhoppningen.
    if (options.signal?.aborted) break;

    retries += 1;
    await sleep(throttleWaitMs(attempt, result.retryAfter));
  }

  return { ...last, throttleAttempts: retries };
}

/**
 * Ett försök: följ redirects och returnera innehållet (eller felet).
 *
 * Throttling hanteras av fetchHtml ovanför — denna funktion rapporterar
 * bara vad som hände.
 */
async function fetchHtmlOnce(url: string, options: {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
} = {}): Promise<FetchResult> {
  let currentUrl = normalizeFetchUrl(url);
  const redirectChain: string[] = [];
  let redirectsFollowed = 0; // separat räknare — XDOMAIN-markeringar räknas inte
  const seenUrls = new Set<string>();

  while (true) {
    // Loop detection (uses normalized URLs)
    if (seenUrls.has(currentUrl)) {
      return {
        success: false,
        error: `Redirect loop detected: ${currentUrl}`,
        finalUrl: currentUrl,
        redirectChain,
      };
    }
    seenUrls.add(currentUrl);

    try {
      const response = await withHostSpacing(
        currentUrl,
        () =>
          axios.get(currentUrl, {
            headers: {
              'User-Agent': 'EventPulse/1.0 (event-ingestion)',
              'Accept': 'text/html,application/xhtml+xml,*/*',
              ...options.headers,
            },
            timeout: options.timeout || 30000,
            validateStatus: (status) => status < 500,
            maxRedirects: 0, // we handle redirects manually to capture final URL
            signal: options.signal,
          }),
        options.signal,
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers['location'];
        if (!location) {
          return {
            success: false,
            error: `HTTP ${response.status} without Location header`,
            statusCode: response.status,
            finalUrl: currentUrl,
            redirectChain,
          };
        }

        // Resolve relative Location against current URL
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).href;
        } catch {
          return {
            success: false,
            error: `Invalid redirect Location: ${location}`,
            statusCode: response.status,
            finalUrl: currentUrl,
            redirectChain,
          };
        }

        // Cross-domain redirect detected — follow it for discovery purposes.
        // Many Swedish sites use cross-domain redirects for event content (e.g. vega.nu → tobiasnygren.se).
        // Continue to the next URL, record the cross-domain hop in redirectChain (informativt, ej budget-räknande).
        const currentUrlObj = new URL(currentUrl);
        const nextUrlObj = new URL(nextUrl);
        if (currentUrlObj.hostname !== nextUrlObj.hostname) {
          redirectChain.push(`XDOMAIN:${currentUrlObj.hostname}→${nextUrlObj.hostname}`);
        }
        // Keep the redirect target's actual trailing-slash form. Some servers
        // (e.g. Eventbrite) 301 /events → /events/ and would oscillate forever
        // if we stripped the slash and re-normalized on each iteration.
        // MAX_REDIRECTS begränsar antal faktiska HTTP-redirects (inte XDOMAIN-markeringar).
        currentUrl = nextUrl;

        redirectChain.push(`${response.status}:${currentUrl}`);
        redirectsFollowed++;

        if (redirectsFollowed >= MAX_REDIRECTS) {
          return {
            success: false,
            error: `Exceeded ${MAX_REDIRECTS} redirects`,
            finalUrl: currentUrl,
            redirectChain,
          };
        }
        continue;
      }

      if (response.status !== 200) {
        const retryAfterHeader = response.headers?.['retry-after'];
        return {
          success: false,
          error: `HTTP ${response.status}`,
          statusCode: response.status,
          finalUrl: currentUrl,
          redirectChain,
          ...(THROTTLE_STATUS_CODES.has(response.status) && retryAfterHeader
            ? { retryAfter: String(retryAfterHeader) }
            : {}),
        };
      }

      return {
        success: true,
        html: response.data,
        statusCode: response.status,
        finalUrl: currentUrl,
        redirectChain,
      };
    } catch (err: any) {
      // Network-level errors (DNS, timeout, etc.) — fail immediately
      return {
        success: false,
        error: err.message,
        finalUrl: currentUrl,
        redirectChain,
      };
    }
  }
}

/**
 * Fetch JSON from an API endpoint
 */
export async function fetchJson(url: string, options: {
  headers?: Record<string, string>;
  timeout?: number;
  method?: 'GET' | 'POST';
  body?: any;
} = {}): Promise<FetchResult> {
  try {
    const config: any = {
      headers: {
        'User-Agent': 'EventPulse/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeout: options.timeout || 30000,
    };

    if (options.body) {
      config.data = options.body;
    }

    const response = await withHostSpacing(
      url,
      () =>
        axios({
          url,
          method: options.method || 'GET',
          ...config,
        }),
    );

    return {
      success: true,
      data: response.data,
      statusCode: response.status,
    };
  } catch (err: any) {
    if (err.response) {
      return {
        success: false,
        error: `HTTP ${err.response.status}: ${err.message}`,
        statusCode: err.response.status,
      };
    }
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Queue an event to the raw events queue
 */
export async function queueEvent(
  source: string,
  eventId: string,
  rawEvent: RawEventInput
): Promise<boolean> {
  try {
    // Lazy import to avoid initializing Redis/ioredis for batch scripts
    // that only use fetchHtml/fetchJson without queueing events
    const { rawEventsQueue } = await import('../../03-Queue/queue.js');
    const sanitizedEventId = eventId.replace(/:/g, '-');
    await rawEventsQueue.add(`${source}:${eventId}`, rawEvent, {
      jobId: sanitizedEventId,
    });
    return true;
  } catch (err: any) {
    console.error(`[${source}] Failed to queue event ${eventId}:`, err.message);
    return false;
  }
}

/**
 * Queue multiple events
 */
export async function queueEvents(
  source: string,
  events: RawEventInput[]
): Promise<{ queued: number; failed: number }> {
  let queued = 0;
  let failed = 0;

  for (const event of events) {
    const success = await queueEvent(source, event.source_id || String(Math.random()), event);
    if (success) queued++;
    else failed++;
  }

  return { queued, failed };
}
