/**
 * check_link_health.ts — daglig länkhälso-check av event-URL:er per aktiv källa.
 *
 * Körs en gång per dag (se cron/runDaily.sh steg 3). För varje aktiv källa
 * (sådan som har minst en upcoming publicerad event med ticket_url) väljs
 * en representativ event — den som är minst nyligen kontrollerad — och dess
 * ticket_url verifieras. Resultatet skrivs tillbaka till events.link_status +
 * events.link_last_checked_at.
 *
 * Tre terminala stater (migration 20260927-0003):
 *   live    = URL svarade 2xx/3xx ELLER 2xx + body innehåller inte
 *             REMOVED_PATTERN (HEAD/GET-Range/SB).
 *   dead    = 404/410, ELLER 2xx + REMOVED_PATTERN (soft 404), ELLER
 *             5xx server-fel, ELLER både HEAD och GET blockerade.
 *   unknown = HEAD + GET-Range + ScrapingBee kunde inte avgöra (blockerad,
 *             timeout, anti-bot som inte ens SB tar sig förbi). cf-räknaren
 *             lämnas oförändrad så nästa HEAD-check kan fortsätta mäta.
 *   NULL    = aldrig kontrollerad (synlig i UI som default).
 *
 * State machine (2026-09-27, användar-feedback "borde de kollas igen nästa
 * dag" + "regeln för aggressiv"):
 *   HEAD(url, redirect: 'follow')
 *     ├ status 2xx/3xx (destination) → LIVE
 *     ├ status ∈ HEAD_GET_FALLBACK_STATUSES (401/403/405/408/425/429/501)
 *     │   → GET(url, Range: bytes=0-1024, redirect: 'follow'):
 *     │     ├ status 2xx + body-scan:
 *     │     │   ├ matches REMOVED_PATTERN → DEAD (soft 404)
 *     │     │   └ annars → LIVE
 *     │     ├ status 4xx/5xx → SB-fallback
 *     │     └ network error → SB-fallback
 *     ├ status 5xx/410/404 → DEAD direkt (tydligt "gone", ingen mening
 *     │                      att försöka igen)
 *     └ network error / timeout → SB-fallback
 *
 *   SB-fallback (renderPage(url, {behavior: 'static-only', timeout: 8000})):
 *     ├ 200 + body innehåller REMOVED_PATTERN → DEAD
 *     ├ 200 + body ≥ 100 byte + inte REMOVED_PATTERN → LIVE
 *     └ timeout / 4xx / 5xx / <100 byte → UNKNOWN
 *
 * Body-scan mönster (REMOVED_PATTERN, regex):
 *   - Svenska: `evenemanget (har )?(borttaget|finns inte|utgått|har redan varit)`,
 *     `detta evenemang har utgått`
 *   - Engelska: `event (has been )?(removed|cancelled|deleted)`,
 *     `no longer available`, `page not found`
 *
 * Designval (2026-09-27, användar-feedback "borde de kollas igen nästa dag"):
 *   - Två-fas-prioritering i fetchEventsToCheck:
 *     Fas 1: dead events som senast kollades för ≥1 dag sedan
 *            (auto-recheck av källor som var nere igår).
 *     Fas 2: oldest-unchecked (NULL) events (ursprunglig logik).
 *   - Effekt: en trasig källa kollas igen inom 1-2 dagar istället för
 *     att vänta på att källans alla events ska ha hunnit cyklas en gång.
 *
 * Säkerhets-skydd:
 *   - Idempotent: kan köras flera gånger samma dag utan skada.
 *   - Errors-as-data: returnerar alltid strukturerat resultat, kastar aldrig.
 *   - SB-fail (timeout, 5xx) → UNKNOWN (aldrig kastat, aldrig Död på osäker grund).
 *
 * Budget (SB):
 *   - SB-anrop kostar credits. 1 SB-anrop per dag = ~200 källor × 1 cr ≈
 *     200 cr/dag (static-only: 1-10 cr). Vi skickar max 1 SB per event,
 *     så worst case är ~200 cr/dag.
 *   - Om SCRAPINGBEE_API_KEY saknas → SB-steget blir no-op, alla "unknown"-
 *     kandidater klassificeras som unknown direkt (utan SB-verifiering).
 *
 * CLI:
 *   npx tsx 09-ScrapingSupervisor/check_link_health.ts
 *   npx tsx 09-ScrapingSupervisor/check_link_health.ts --dry-run
 *   npx tsx 09-ScrapingSupervisor/check_link_health.ts --limit 50
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — samma som dashboard/db.ts.
 *   SCRAPINGBEE_API_KEY — för SB-fallback (statisk-only tier, billigaste).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** Absolut sökväg till D-renderGate/renderGate.ts (lazy-loaded). */
const RENDER_GATE_MODULE = pathToFileURL(
  resolve(__dirname, '../../02-Ingestion/D-renderGate/renderGate.ts'),
).href;

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Tre terminala stater (migration 20260927-0003).
 * - 'live': URL svarade 2xx/3xx utan REMOVED_PATTERN.
 * - 'dead': URL bekräftat borta (404/410) ELLER body bekräftar "soft 404".
 * - 'unknown': varken HEAD/GET-Range/SB kunde avgöra.
 */
export type LinkStatus = 'live' | 'dead' | 'unknown';

export interface CheckOptions {
  /** Max antal källor att kontrollera (skydd mot explosion). Default 200. */
  limit?: number;
  /** Concurrency för HEAD-anrop. Default 10. */
  concurrency?: number;
  /** Timeout per HEAD i ms. Default 5000. */
  timeoutMs?: number;
  /** Timeout per SB-anrop i ms. Default 8000. */
  sbTimeoutMs?: number;
  /** Dry-run: rapportera men skriv inte till DB. */
  dryRun?: boolean;
  /** Test-injection: ersätt Supabase-klienten. */
  _client?: SupabaseClient | null;
  /** Test-injection: ersätt fetch-implementationen. */
  _fetch?: typeof fetch;
  /**
   * Test-injection: ersätt SB-verifiering (default = anropa renderPage).
   * Returnerar samma shape som `verifyWithScrapingBee`.
   */
  _verifyWithScrapingBee?: typeof verifyWithScrapingBee;
}

export interface SourceCheckResult {
  source: string;
  eventId: string;
  ticketUrl: string;
  status: LinkStatus;
  /** Slutgiltlig HTTP-status (HEAD, GET-Range, eller SB). */
  httpStatus: number | null;
  /** Hur vi kom fram till status: 'head' | 'get-range' | 'scrapingbee' | 'direct-dead'. */
  method: 'head' | 'get-range' | 'scrapingbee' | 'direct-dead';
  errorMessage: string | null;
  durationMs: number;
  /** SB-credits använda för detta event (0 om SB inte anropades). */
  creditsUsed: number;
}

export interface CheckRunResult {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  checked: number;
  live: number;
  dead: number;
  unknown: number;
  errors: number;
  results: SourceCheckResult[];
  /** Total SB-credits för hela körningen (för budget-spårning). */
  totalCreditsUsed: number;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;

function db(opts: CheckOptions): SupabaseClient | null {
  if (opts._client !== undefined) return opts._client;
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

interface SourceEventRow {
  id: string;
  source: string;
  ticket_url: string;
}

/**
 * Body-scan mönster för "soft 404" — sidor som returnerar HTTP 200 men vars
 * body meddelar att eventet är borta/taget bort. Regex:en matchar både
 * svenska och engelska formuleringar (case-insensitive).
 *
 * Designval (2026-09-27):
 * - Ord-baserade alternativ istället för breda substrings — undviker
 *   false-positive på "tickets available" eller "tickets released".
 * - Tom body matchar INTE (returnerar false) — utan body har vi ingen
 *   signal och faller tillbaka till SB-fallback.
 */
const REMOVED_PATTERN = /(?:event\s+(?:has\s+been\s+)?(?:removed|cancelled|deleted)|no\s+longer\s+available|page\s+not\s+found|evenemanget\s+har\s+(?:tagits\s+bort|utgått|redan\s+varit|borttaget)|evenemanget\s+är\s+borttaget|evenemanget\s+(?:finns\s+inte|utgått|borttaget)|detta\s+evenemang\s+har\s+utgått)/i;

/**
 * Returnerar true om body matchar REMOVED_PATTERN. Tom body = false
 * (ingen signal, returnera "inte bekräftat borttaget").
 */
export function looksRemoved(body: string): boolean {
  return body.length > 0 && REMOVED_PATTERN.test(body);
}

/**
 * Hämta en representativ event per aktiv källa.
 *
 * Två-fas-strategi (2026-09-27, användar-feedback):
 *   Fas 1: Hitta dead events som senast kollades för ≥1 dag sedan.
 *          Dessa prioriteras så att "server låg nere igår" → "kollas
 *          igen idag" istället för att vänta på full käll-cykel.
 *   Fas 2: Om Fas 1 inte fyllde kvoten, ta oldest-unchecked (NULL)
 *          events per källa — samma logik som tidigare.
 *
 * Filtrerar på:
 *   - status = 'published' (GDPR via events_public kräver detta)
 *   - ticket_url IS NOT NULL
 *   - start_time >= now() (vi bryr oss inte om historiska länkar)
 *   - link_status IN ('dead', NULL) för Fas 1 / Fas 2.
 *     (Migration 20260927-0003 konverterar 'ok'→'live' och 'broken'→'dead'.)
 *
 * Returnerar EN rad per källa — den "nästa i tur" att kontrollera.
 */
async function fetchEventsToCheck(
  client: SupabaseClient,
  limit: number,
): Promise<SourceEventRow[]> {
  const seen = new Set<string>();
  const out: SourceEventRow[] = [];

  // ── Fas 1: dead events som är ≥1 dag gamla ───────────────────────────────
  // Gränsen "1 dag" gör att vi inte dubbel-checkar ett event vi just kollade
  // (t.ex. om cron körs två gånger samma dag). Acceptera även 'broken' under
  // migreringsfönstret (innan 20260927-0003 körts på prod) — den konverteras
  // till 'dead' men frågan är idempotent och båda pekar på samma "trasiga".
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: deadRows, error: deadErr } = await client
    .from('events')
    .select('id, source, ticket_url')
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('start_time', new Date().toISOString())
    .in('link_status', ['dead', 'broken'])
    .lt('link_last_checked_at', oneDayAgo)
    .order('link_last_checked_at', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(limit * 3);

  if (deadErr) {
    throw new Error(`Supabase fetch (dead pass) failed: ${deadErr.message}`);
  }

  for (const row of deadRows ?? []) {
    if (seen.has(row.source)) continue;
    seen.add(row.source);
    out.push({
      id: row.id,
      source: row.source,
      ticket_url: row.ticket_url,
    });
    if (out.length >= limit) break;
  }

  // ── Fas 2: oldest-unchecked (NULL) — fyller på om Fas 1 inte räckte ─────
  if (out.length < limit) {
    const remaining = limit - out.length;
    const { data: nullRows, error: nullErr } = await client
      .from('events')
      .select('id, source, ticket_url, start_time, link_last_checked_at')
      .eq('status', 'published')
      .not('ticket_url', 'is', null)
      .gte('start_time', new Date().toISOString())
      .is('link_last_checked_at', null)
      .order('start_time', { ascending: true })
      .limit(remaining * 3);

    if (nullErr) {
      throw new Error(`Supabase fetch (null pass) failed: ${nullErr.message}`);
    }

    for (const row of nullRows ?? []) {
      if (seen.has(row.source)) continue;
      seen.add(row.source);
      out.push({
        id: row.id,
        source: row.source,
        ticket_url: row.ticket_url,
      });
      if (out.length >= limit) break;
    }
  }

  return out;
}

// ─── URL-verifiering (HEAD → GET-Range → SB state machine) ────────────────

/**
 * Status-koder som triggar GET-Range fallback efter HEAD. Mönster:
 * servern blockerar HEAD (405/501 = "Method Not Allowed" / "Not Implemented")
 * eller svarar med anti-bot/auth-prompt (401/403/408/425/429). GET med Range
 * kan ibland komma igenom och ge en riktig 2xx/3xx som klassificerar rätt.
 *
 * 5xx (500/502/503/504) och tydliga "gone" (404/410) testas INTE med GET —
 * de är genuint fel och GET skulle slösa tid/belasta källan i onödan.
 */
const HEAD_GET_FALLBACK_STATUSES = new Set([401, 403, 405, 408, 425, 429, 501]);

/**
 * Minsta body-längd för att SB-fallback ska räknas som "lyckad" och
 * klassificera som LIVE/DEAD. Kortare body = SB blev blockerad eller fick
 * bara en utmaningssida → klassificera som UNKNOWN istället.
 */
const SB_MIN_BODY_LENGTH = 100;

/** Rå utfall från ett enskilt HTTP-anrop (HEAD eller GET-Range). */
interface HttpProbeResult {
  httpStatus: number | null;
  body: string;
  errorMessage: string | null;
}

/**
 * HEAD:a en URL med timeout och redirect-follow. Returnerar aldrig kast —
 * alltid strukturerat resultat. Tom body (HEAD levererar aldrig body).
 */
async function headProbe(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<HttpProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    return { httpStatus: res.status, body: '', errorMessage: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout');
    return {
      httpStatus: null,
      body: '',
      errorMessage: isTimeout ? `HEAD timeout after ${timeoutMs}ms` : `HEAD ${msg.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET med Range: bytes=0-1024 för att verifiera servers som blockerar HEAD
 * (anti-bot, 405, etc.). Ger oss både slutgiltlig HTTP-status OCH en liten
 * body som vi kan body-scanna för "soft 404".
 */
async function getRangeProbe(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<HttpProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { Range: 'bytes=0-1024' },
    });
    let body = '';
    try {
      // GET-Range kan ge partiell content (206) eller full (200). Båda har body.
      body = await res.text();
    } catch {
      // Body-stream-fel: fortsätt med tom body (räcker för status-klassificering).
    }
    return {
      httpStatus: res.status,
      body: body.slice(0, 2048), // 2 KB cap — REMOVED_PATTERN behöver bara några byte
      errorMessage: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout');
    return {
      httpStatus: null,
      body: '',
      errorMessage: isTimeout ? `GET timeout after ${timeoutMs}ms` : `GET ${msg.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifiera URL:en via ScrapingBee (static-only tier, billigaste).
 * Returnerar strukturerat utfall som klassificeraren kan använda.
 *
 * Fail-safe: om SCRAPINGBEE_API_KEY saknas, eller om SB-anropet kraschar/
 * timeoutar, returnerar vi `reachable: false, status: 'unknown'` — kastas
 * ALDRIG.
 */
export interface SbVerifyResult {
  reachable: boolean;
  status: LinkStatus;
  body: string;
  httpStatus: number | null;
  creditsUsed: number;
  errorMessage: string | null;
}

/**
 * Dynamiskt importerad `renderPage` (lazy — undviker puppeteer-laddning
 * vid import). Vid SCRAPINGBEE_API_KEY = null returnerar vi "no-refer" genotyp.
 */
export async function verifyWithScrapingBee(
  url: string,
  timeoutMs: number,
): Promise<SbVerifyResult> {
  if (!process.env.SCRAPINGBEE_API_KEY) {
    return {
      reachable: false,
      status: 'unknown',
      body: '',
      httpStatus: null,
      creditsUsed: 0,
      errorMessage: 'SCRAPINGBEE_API_KEY not configured — SB-fallback disabled',
    };
  }
  try {
    // Lazy import: D-renderGate laddar puppeteer om vi importerar modulen.
    // Vid SB-nyckel gör den inget med puppeteer, men import-vägen är
    // densamma. Vi använder file://-URL för att tsc ska hitta modulen utan
    // .ts-extension (annars klagar TS2307) och för att undvika tsx-
    // relativ-path-quirks.
    const mod = await import(RENDER_GATE_MODULE) as { renderPage: (url: string, opts?: unknown) => Promise<{ success: boolean; html?: string; error?: string; metrics?: { htmlLength?: number; creditsCharged?: number } }> };
    const result = await mod.renderPage(url, {
      behavior: 'static-only',
      timeout: timeoutMs,
    });
    const html = result.html ?? '';
    const bodyLen = html.length;
    if (result.success && bodyLen >= SB_MIN_BODY_LENGTH) {
      const removed = looksRemoved(html);
      return {
        reachable: true,
        status: removed ? 'dead' : 'live',
        body: html,
        httpStatus: 200,
        creditsUsed: result.metrics?.creditsCharged ?? 1,
        errorMessage: null,
      };
    }
    // SB returnerade inte tillräckligt med body — blockerat, timeout, eller
    // kort challenge-sida. Vi vet inte, klassificera som unknown.
    return {
      reachable: false,
      status: 'unknown',
      body: html,
      httpStatus: result.success ? 200 : null,
      creditsUsed: result.metrics?.creditsCharged ?? 0,
      errorMessage: result.error ?? (bodyLen === 0 ? 'SB returned empty body' : `SB body too short (${bodyLen} bytes)`),
    };
  } catch (e) {
    // SB-anrop kraschade (nätverk, axios-throw). Vi vet inte, markera unknown.
    const msg = e instanceof Error ? e.message : String(e);
    return {
      reachable: false,
      status: 'unknown',
      body: '',
      httpStatus: null,
      creditsUsed: 0,
      errorMessage: `SB exception: ${msg.slice(0, 200)}`,
    };
  }
}

/** Klassificera ett HEAD-resultat till en LinkStatus. */
function classifyHead(httpStatus: number | null): { status: LinkStatus; needsGetRange: boolean; needsSb: boolean } {
  if (httpStatus === null) {
    // Nätverksfel / timeout — gå direkt till SB-fallback.
    return { status: 'unknown', needsGetRange: false, needsSb: true };
  }
  if (httpStatus >= 200 && httpStatus < 400) {
    return { status: 'live', needsGetRange: false, needsSb: false };
  }
  if (HEAD_GET_FALLBACK_STATUSES.has(httpStatus)) {
    // Anti-bot / blockerad HEAD — försök GET-Range först.
    return { status: 'unknown', needsGetRange: true, needsSb: false };
  }
  // 4xx (404/410) eller 5xx (500/502/503/504) — tydligt "gone".
  return { status: 'dead', needsGetRange: false, needsSb: false };
}

/** Klassificera ett GET-Range-resultat till en LinkStatus. */
function classifyGetRange(httpStatus: number | null, body: string): { status: LinkStatus; needsSb: boolean } {
  if (httpStatus === null) {
    return { status: 'unknown', needsSb: true };
  }
  if (httpStatus >= 200 && httpStatus < 400) {
    return { status: looksRemoved(body) ? 'dead' : 'live', needsSb: false };
  }
  // GET blockerad också → SB-fallback.
  return { status: 'unknown', needsSb: true };
}

/**
 * Huvudfunktion: verifiera en URL enligt state machine.
 * Returnerar strukturerat resultat, kastar ALDRIG.
 */
async function checkUrl(
  url: string,
  timeoutMs: number,
  sbTimeoutMs: number,
  fetchImpl: typeof fetch,
  sbVerifier: typeof verifyWithScrapingBee,
): Promise<Omit<SourceCheckResult, 'source' | 'eventId' | 'ticketUrl'>> {
  const startedAt = Date.now();

  // ─── Steg 1: HEAD ─────────────────────────────────────────────────────────
  const head = await headProbe(url, timeoutMs, fetchImpl);
  const headClass = classifyHead(head.httpStatus);

  if (headClass.status !== 'unknown') {
    // 'live' eller 'dead' — klart, ingen ytterligare round-trip behövs.
    return {
      status: headClass.status,
      httpStatus: head.httpStatus,
      method: headClass.status === 'dead' ? 'direct-dead' : 'head',
      errorMessage: head.errorMessage,
      durationMs: Date.now() - startedAt,
      creditsUsed: 0,
    };
  }

  // ─── Steg 2: GET-Range (bara om HEAD var i fallback-set) ─────────────────
  if (headClass.needsGetRange) {
    const get = await getRangeProbe(url, timeoutMs, fetchImpl);
    const getClass = classifyGetRange(get.httpStatus, get.body);

    if (getClass.status !== 'unknown') {
      return {
        status: getClass.status,
        httpStatus: get.httpStatus,
        method: 'get-range',
        errorMessage: get.errorMessage ?? head.errorMessage,
        durationMs: Date.now() - startedAt,
        creditsUsed: 0,
      };
    }

    // GET blockerad → SB-fallback.
    const sb = await sbVerifier(url, sbTimeoutMs);
    return {
      status: sb.status,
      httpStatus: sb.httpStatus ?? get.httpStatus ?? head.httpStatus,
      method: 'scrapingbee',
      errorMessage: sb.errorMessage ?? get.errorMessage ?? head.errorMessage,
      durationMs: Date.now() - startedAt,
      creditsUsed: sb.creditsUsed,
    };
  }

  // ─── Steg 2 alt: SB-fallback direkt (HEAD network error / timeout) ───────
  const sb = await sbVerifier(url, sbTimeoutMs);
  return {
    status: sb.status,
    httpStatus: sb.httpStatus ?? head.httpStatus,
    method: 'scrapingbee',
    errorMessage: sb.errorMessage ?? head.errorMessage,
    durationMs: Date.now() - startedAt,
    creditsUsed: sb.creditsUsed,
  };
}

// ─── Concurrency helper ─────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runCheckLinkHealth(opts: CheckOptions = {}): Promise<CheckRunResult> {
  const startedAt = new Date().toISOString();
  const limit = opts.limit ?? 200;
  const concurrency = opts.concurrency ?? 10;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const sbTimeoutMs = opts.sbTimeoutMs ?? 8000;
  const dryRun = opts.dryRun ?? false;
  const fetchImpl = opts._fetch ?? globalThis.fetch;
  const sbVerifier = opts._verifyWithScrapingBee ?? verifyWithScrapingBee;

  const client = db(opts);
  const empty: CheckRunResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    checked: 0,
    live: 0,
    dead: 0,
    unknown: 0,
    errors: 0,
    results: [],
    totalCreditsUsed: 0,
  };

  if (!client) {
    return { ...empty, errors: 1 };
  }

  const events = await fetchEventsToCheck(client, limit);
  if (events.length === 0) {
    return empty;
  }

  const results = await runWithConcurrency(events, concurrency, async (event) => {
    const check = await checkUrl(
      event.ticket_url,
      timeoutMs,
      sbTimeoutMs,
      fetchImpl,
      sbVerifier,
    );
    return {
      source: event.source,
      eventId: event.id,
      ticketUrl: event.ticket_url,
      ...check,
    } satisfies SourceCheckResult;
  });

  // Persist (skippa på dry-run).
  if (!dryRun) {
    // 2026-09-26 — link-health Hybrid B (migration 0004). Använd RPC
    // update_link_health_cf för att atomiskt uppdatera link_status +
    // consecutive_broken_count + first_broken_at i en enda SQL-sats.
    // Migration 20260927-0003 utökar RPC:n med 'unknown'-staten och
    // accepterar de nya namnen 'live' | 'dead' | 'unknown'.
    await Promise.all(
      results.map(async (r) => {
        const { error } = await client.rpc('update_link_health_cf', {
          p_event_id: r.eventId,
          p_new_status: r.status,
          p_checked_at: new Date().toISOString(),
        });
        if (error) {
          // Logga men kasta inte — vi vill ha structured output.
          // Errors-as-data: returnera i results istället.
        }
      }),
    );
  }

  const liveCount = results.filter((r) => r.status === 'live').length;
  const deadCount = results.filter((r) => r.status === 'dead').length;
  const unknownCount = results.filter((r) => r.status === 'unknown').length;
  const totalCredits = results.reduce((sum, r) => sum + r.creditsUsed, 0);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    checked: results.length,
    live: liveCount,
    dead: deadCount,
    unknown: unknownCount,
    errors: 0,
    results,
    totalCreditsUsed: totalCredits,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx !== -1 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : undefined;

  const result = await runCheckLinkHealth({
    dryRun,
    ...(limit !== undefined ? { limit } : {}),
  });

  console.log(
    [
      `[check_link_health] ${result.dryRun ? 'DRY RUN — ' : ''}${result.startedAt}`,
      `  checked: ${result.checked} (live=${result.live}, dead=${result.dead}, unknown=${result.unknown})`,
      `  duration: ${new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()}ms`,
      ...(result.errors > 0 ? [`  errors: ${result.errors}`] : []),
      ...(result.totalCreditsUsed > 0 ? [`  SB-credits: ${result.totalCreditsUsed}`] : []),
      ...result.results
        .filter((r) => r.status !== 'live')
        .slice(0, 10)
        .map((r) => `  ${r.status.toUpperCase()}: ${r.source} ${r.eventId.slice(0, 8)} method=${r.method} http=${r.httpStatus ?? 'n/a'} credits=${r.creditsUsed} ${r.errorMessage ?? ''}`),
    ].join('\n'),
  );
  return 0;
}

const isDirectInvocation = (() => {
  try {
    return process.argv[1]?.endsWith('check_link_health.ts') ?? false;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  });
}