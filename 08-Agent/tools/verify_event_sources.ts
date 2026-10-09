/**
 * verify_event_sources — Stream C.1 (Agent Trust Plan 2026-10-09).
 *
 * Mål: agenten ska kunna verifiera sina egna källor istället för att lita
 * blint på dem. Det här är mekanismen bakom "lita" — inte en känsla, utan
 * fem konkreta checks med strukturerat resultat.
 *
 * Checks (alla körs parallellt):
 *   1. headless_fetch_ok     — URL:en svarar 200 inom timeout (default 5s).
 *   2. jsonld_valid          — sidan har valid JSON-LD med `@type: Event`.
 *   3. image_loads           — bild-URL reachable + content-type börjar med image/.
 *   4. date_in_future        — event-start är i framtiden (≤ 2 år).
 *   5. canonical_id_stable   — eventets id är icke-tom + unique inom batch.
 *
 * Resultat:
 *   - 'pass'   alla checks är pass eller skip
 *   - 'partial' minst en pass men ≥ 1 fail
 *   - 'fail'   alla checks fail (eller alla fail utom skip)
 *
 * Säkerhet:
 *   - INGA hårdkodade URLs.
 *   - INGA credentials i options — auth headers skickas av anroparen via
 *     fetch-injection om det behövs (default = global fetch).
 *   - INGA PII i `summary` — bara typ-namn och räknare.
 *
 * Användning:
 *   import { verifyEventSources } from './tools/verify_event_sources';
 *   const result = await verifyEventSources(event, [
 *     { url: event.ticket_url, kind: 'primary' },
 *     { url: event.image_url, kind: 'image' },
 *   ]);
 *   if (result.overall === 'fail') { /* unverified *\/ }
 */

import type { EventCard } from '../types';

// ─── Publika typer ─────────────────────────────────────────────────────────

/** En källa att verifiera. */
export interface SourceRef {
  /** URL att hämta. */
  url: string;
  /** label som styr vilka checks som körs mot just denna källa. */
  kind?: 'primary' | 'image' | 'fallback';
  /**
   * Om satt, körs url:en med denna Authorization-header (typiskt
   * 'Bearer ...'). Lämnas tom för publika källor.
   */
  authHeader?: string;
}

/** De fem check-typerna. */
export type VerifyCheckKind =
  | 'headless_fetch_ok'
  | 'jsonld_valid'
  | 'image_loads'
  | 'date_in_future'
  | 'canonical_id_stable';

export interface VerifyCheck {
  kind: VerifyCheckKind;
  /** Vilken source checken gällde (om tillämpligt). */
  source_url?: string;
  status: 'pass' | 'fail' | 'skip';
  /** Maskinläsbar orsak (engelska, korta etiketter). */
  reason?: string;
  /** Hur lång tid checken tog (ms). */
  duration_ms?: number;
}

export interface VerifyResult {
  overall: 'pass' | 'partial' | 'fail';
  checks: VerifyCheck[];
  /**
   * Kort loggningsbar sammanfattning, FRI från PII. Format:
   *   "pass=4 fail=1 skip=1 primary=ok image=fail(jsonld)"
   * Lämplig för en loggrad; inga URL:er eller titlar.
   */
  summary: string;
}

export interface VerifyOptions {
  /** Override 'now' för deterministiska tester. */
  now?: Date;
  /** Per-check timeout i ms (default 5000). */
  fetchTimeoutMs?: number;
  /** Injicera fetch för tester; default = global fetch. */
  fetcher?: typeof fetch;
}

// ─── Hjälpare ─────────────────────────────────────────────────────────────

const DEFAULT_FETCH_TIMEOUT_MS = 5000;
/** Bound för framtida datum (2 år). */
const MAX_FUTURE_YEARS = 2;

function asNumber(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Timed fetch — avbryter vid timeout. Kastar INTE vid icke-2xx (returnerar response). */
async function timedFetch(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
  authHeader?: string,
): Promise<{ ok: boolean; status: number; body?: string; contentType?: string; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (authHeader) headers['Authorization'] = authHeader;
    const resp = await fetcher(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    const ct = resp.headers.get('content-type') ?? undefined;
    // För jsonld_valid: läs kroppen (vi klarar oss på en kort excerpt).
    const body = (ct ?? '').includes('html') || (ct ?? '').includes('json')
      ? await resp.text().catch(() => '')
      : '';
    return {
      ok: resp.ok,
      status: resp.status,
      body: body.slice(0, 200_000), // 200 KB cap — JSON-LD kan vara stor
      contentType: ct,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Enkel JSON-LD-detektor. Plockar första `@type: "Event"`-forekomst. */
function jsonLdHasEvent(htmlOrJson: string): boolean {
  if (!htmlOrJson) return false;
  // application/ld+json direkt
  if (/"@type"\s*:\s*"Event"/.test(htmlOrJson)) return true;
  // inbäddad i <script type="application/ld+json">...</script>
  const scriptMatch = htmlOrJson.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (scriptMatch && /"@type"\s*:\s*"Event"/.test(scriptMatch[1])) return true;
  return false;
}

// ─── Checks ───────────────────────────────────────────────────────────────

async function checkHeadlessFetch(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
  authHeader: string | undefined,
): Promise<VerifyCheck> {
  const start = Date.now();
  const r = await timedFetch(url, timeoutMs, fetcher, authHeader);
  const duration = Date.now() - start;
  if (r.ok) {
    return { kind: 'headless_fetch_ok', source_url: url, status: 'pass', duration_ms: duration };
  }
  return {
    kind: 'headless_fetch_ok',
    source_url: url,
    status: 'fail',
    reason: r.reason ? `abort:${r.reason}` : `http-${r.status}`,
    duration_ms: duration,
  };
}

async function checkJsonLd(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
  authHeader: string | undefined,
): Promise<VerifyCheck> {
  const start = Date.now();
  const r = await timedFetch(url, timeoutMs, fetcher, authHeader);
  const duration = Date.now() - start;
  if (!r.ok) {
    return {
      kind: 'jsonld_valid',
      source_url: url,
      status: 'skip',
      reason: `fetch-failed-${r.status}`,
      duration_ms: duration,
    };
  }
  if (!r.contentType || !(r.contentType.includes('html') || r.contentType.includes('json'))) {
    return {
      kind: 'jsonld_valid',
      source_url: url,
      status: 'skip',
      reason: `non-html(${r.contentType ?? 'unknown'})`,
      duration_ms: duration,
    };
  }
  const found = jsonLdHasEvent(r.body ?? '');
  return found
    ? { kind: 'jsonld_valid', source_url: url, status: 'pass', duration_ms: duration }
    : { kind: 'jsonld_valid', source_url: url, status: 'fail', reason: 'no-jsonld-event', duration_ms: duration };
}

async function checkImageLoads(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<VerifyCheck> {
  const start = Date.now();
  const r = await timedFetch(url, timeoutMs, fetcher);
  const duration = Date.now() - start;
  if (!r.ok) {
    return {
      kind: 'image_loads',
      source_url: url,
      status: 'fail',
      reason: r.reason ? `abort:${r.reason}` : `http-${r.status}`,
      duration_ms: duration,
    };
  }
  const ok = (r.contentType ?? '').startsWith('image/');
  return ok
    ? { kind: 'image_loads', source_url: url, status: 'pass', duration_ms: duration }
    : { kind: 'image_loads', source_url: url, status: 'fail', reason: `not-image(${r.contentType ?? '?'})`, duration_ms: duration };
}

function checkDateInFuture(startTime: string, now: Date): VerifyCheck {
  if (!startTime) {
    return { kind: 'date_in_future', status: 'fail', reason: 'missing-start_time' };
  }
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return { kind: 'date_in_future', status: 'fail', reason: 'unparseable-start_time' };
  }
  const ms = start.getTime() - now.getTime();
  if (ms < 0) {
    return { kind: 'date_in_future', status: 'fail', reason: 'past-date' };
  }
  const maxMs = MAX_FUTURE_YEARS * 365 * 24 * 60 * 60 * 1000;
  if (ms > maxMs) {
    return { kind: 'date_in_future', status: 'fail', reason: `too-far-future(>${MAX_FUTURE_YEARS}y)` };
  }
  return { kind: 'date_in_future', status: 'pass' };
}

function checkCanonicalIdStable(eventId: string, allIds: string[]): VerifyCheck {
  if (!eventId || typeof eventId !== 'string') {
    return { kind: 'canonical_id_stable', status: 'fail', reason: 'missing-id' };
  }
  const duplicates = allIds.filter((id) => id === eventId).length;
  if (duplicates > 1) {
    return { kind: 'canonical_id_stable', status: 'fail', reason: `duplicate-in-batch(${duplicates})` };
  }
  return { kind: 'canonical_id_stable', status: 'pass' };
}

// ─── Publika API:t ────────────────────────────────────────────────────────

/**
 * Verifiera en event + dess källor. Resultatet är strukturerat så att
 * middleware kan välja: 'pass' = returnera som vanligt, 'partial' = visa
 * med "unverified"-badge, 'fail' = filtrera bort.
 */
export async function verifyEventSources(
  event: Pick<EventCard, 'id' | 'start_time' | 'image_url' | 'ticket_url'>,
  sources: SourceRef[],
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const now = options.now ?? new Date();
  const timeoutMs = asNumber(
    options.fetchTimeoutMs === undefined ? null : String(options.fetchTimeoutMs),
    DEFAULT_FETCH_TIMEOUT_MS,
  );
  const fetcher = options.fetcher ?? globalThis.fetch;

  if (typeof fetcher !== 'function') {
    // Ingen fetch (Node <18 eller tester som glömt injicera) → fail-skåp.
    return {
      overall: 'fail',
      summary: 'pass=0 fail=1 skip=0 no-fetcher',
      checks: [
        { kind: 'headless_fetch_ok', status: 'fail', reason: 'no-fetcher' },
      ],
    };
  }

  const checks: VerifyCheck[] = [];

  // Datum-check är lokal — ingen I/O.
  checks.push(checkDateInFuture(event.start_time, now));

  // Kör alla source-checks parallellt.
  const sourceChecks = await Promise.all(
    sources.map(async (src): Promise<VerifyCheck[]> => {
      if (!src.url) return [{ kind: 'headless_fetch_ok', status: 'skip', reason: 'missing-url' }];
      const out: VerifyCheck[] = [];
      const auth = src.authHeader;
      out.push(await checkHeadlessFetch(src.url, timeoutMs, fetcher, auth));
      // JSON-LD är bara meningsfullt för primary-html-typer.
      if ((src.kind ?? 'primary') === 'primary') {
        out.push(await checkJsonLd(src.url, timeoutMs, fetcher, auth));
      }
      // image_loads körs bara när kind === 'image' (eller om URL:en slutar
      // på ett bildsuffix).
      if ((src.kind ?? 'primary') === 'image') {
        out.push(await checkImageLoads(src.url, timeoutMs, fetcher));
      }
      return out;
    }),
  );
  for (const group of sourceChecks) checks.push(...group);

  // canonical_id_stable körs av middleware (vi har inte hela batchen här).
  // default-check: om id finns är vi "pass" tills vidare.
  checks.push(checkCanonicalIdStable(event.id ?? '', [event.id ?? '']));

  const pass = checks.filter((c) => c.status === 'pass').length;
  const fail = checks.filter((c) => c.status === 'fail').length;
  const skip = checks.filter((c) => c.status === 'skip').length;
  const overall: VerifyResult['overall'] =
    fail === 0 ? 'pass' : pass === 0 ? 'fail' : 'partial';

  // Kort summary, FRI från URL:er eller titlar.
  const summary = `pass=${pass} fail=${fail} skip=${skip}`;

  return { overall, checks, summary };
}

/**
 * Batch-version: kör canonical_id_stable korrekt över hela batchen.
 *
 * Användning:
 *   const results = await verifyEventBatch([event1, event2, ...]);
 *   for (const r of results) if (r.overall === 'fail') ...
 */
export async function verifyEventBatch(
  events: Array<Pick<EventCard, 'id' | 'start_time' | 'image_url' | 'ticket_url'>>,
  sourcesForEvent: (event: EventCard['id']) => SourceRef[],
  options: VerifyOptions = {},
): Promise<VerifyResult[]> {
  const ids = events.map((e) => e.id ?? '');
  const perEvent = await Promise.all(
    events.map(async (ev) => {
      const sources = sourcesForEvent(ev.id ?? '');
      const base = await verifyEventSources(ev, sources, options);
      // Skriv över canonical_id-check med batch-vyn.
      const filtered = base.checks.filter((c) => c.kind !== 'canonical_id_stable');
      filtered.push(checkCanonicalIdStable(ev.id ?? '', ids));
      const pass = filtered.filter((c) => c.status === 'pass').length;
      const fail = filtered.filter((c) => c.status === 'fail').length;
      const skip = filtered.filter((c) => c.status === 'skip').length;
      const overall: VerifyResult['overall'] =
        fail === 0 ? 'pass' : pass === 0 ? 'fail' : 'partial';
      return { overall, checks: filtered, summary: `pass=${pass} fail=${fail} skip=${skip}` };
    }),
  );
  return perEvent;
}
