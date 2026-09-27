/**
 * bulk-link-health.ts
 *
 * Engångs-script — kör en bulk HEAD-check på ALLA framtida events med
 * ticket_url (inte bara 1 per källa som det dagliga cron-jobbet gör).
 *
 * Bakgrund (2026-09-27): Användaren misstänkte att många events är 404.
 * Analys visade att 99.9 % av events ALDRIG blivit HEAD-kontrollerade
 * (link_status=NULL). Daglig cron rullar 1 event/källa/dag → skulle ta
 * 30+ dagar att täcka alla. Detta script gör det på en gång.
 *
 * Säkerhet:
 *   - Samma HEAD-fallback till GET-Range som check_link_health.ts.
 *   - Samma timeout (5 s).
 *   - Concurrency 10 (samma som cron — skonsamt mot ticket-plattformarna).
 *   - Skriver via RPC update_link_health_cf (samma som cron) → atomisk
 *     uppdatering av link_status + consecutive_broken_count + first_broken_at.
 *   - Errors-as-data: alla resultat rapporteras i slutloggen, inga kast.
 *
 * Förväntad wall-clock:
 *   1000 events × 1.5 s / 10 concurrency ≈ 150 s ≈ 2.5 min
 *   5000 events (om vi kör även historiska) ≈ 12-13 min
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/bulk-link-health.ts
 *   tsx --env-file=.env 04-Normalizer/_scripts/bulk-link-health.ts --include-past
 *   tsx --env-file=.env 04-Normalizer/_scripts/bulk-link-health.ts --concurrency 5
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface EventRow {
  id: string;
  source: string;
  ticket_url: string;
  start_time: string | null;
  title_sv: string | null;
  title_en: string | null;
  link_status: string | null;
}

interface CheckOutcome {
  eventId: string;
  source: string;
  ticketUrl: string;
  title: string;
  status: 'ok' | 'broken';
  httpStatus: number | null;
  errorMessage: string | null;
  durationMs: number;
}

const PAGE = 1000;
// 2026-09-27 — Användaren bad om 100 parallella (fråga "kan du göra 50 eller 100 parallella?").
// HEAD-anrop är inte rate-limited på samma sätt som Supabase RPC — vi har redan
// User-Agent + timeout + GET-fallback som gör oss "polite". 100 workers =
// ~10× snabbare än 10 workers utan att slå i fjärr-servrarnas gränser.
const DEFAULT_CONCURRENCY = 100;
const DEFAULT_TIMEOUT_MS = 5000;
const USER_AGENT = 'EventPulse-LinkHealth/1.0 (+https://eventpulse.app)';

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[bulk-link-health] FATAL: ${msg}`);
  process.exit(1);
}

async function fetchAll(
  client: SupabaseClient,
  includePast: boolean,
): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = client
      .from('events')
      .select(
        'id, source, ticket_url, start_time, title_sv, title_en, link_status',
      )
      .eq('status', 'published')
      .not('ticket_url', 'is', null)
      // 2026-09-27 — Filtrera bort redan-kontrollerade så catch-up-körningar
      // inte bränner tid på 4697 events vi redan vet är ok.
      .is('link_last_checked_at', null);
    if (!includePast) {
      query = query.gte('start_time', new Date().toISOString());
    }
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) fail(`Supabase fetch failed: ${error.message}`);
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    rows.push(...(data as EventRow[]));
    hasMore = data.length === PAGE;
    offset += PAGE;
  }
  return rows;
}

async function headCheck(
  url: string,
  timeoutMs: number,
): Promise<{ status: 'ok' | 'broken'; httpStatus: number | null; errorMessage: string | null; durationMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
        headers: { Range: 'bytes=0-0', 'User-Agent': USER_AGENT },
      });
    }
    const httpStatus = res.status;
    const ok = httpStatus >= 200 && httpStatus < 400;
    return {
      status: ok ? 'ok' : 'broken',
      httpStatus,
      errorMessage: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout');
    return {
      status: 'broken',
      httpStatus: null,
      errorMessage: isTimeout ? `timeout after ${timeoutMs}ms` : msg.slice(0, 200),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

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

function pickTitle(r: EventRow): string {
  const t = r.title_sv ?? r.title_en ?? '(no title)';
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i env.');
  }

  const argv = process.argv.slice(2);
  const includePast = argv.includes('--include-past');
  const concIdx = argv.indexOf('--concurrency');
  const concurrency =
    concIdx !== -1 && argv[concIdx + 1] ? parseInt(argv[concIdx + 1], 10) : DEFAULT_CONCURRENCY;

  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // eslint-disable-next-line no-console
  console.error(`[bulk-link-health] fetching events (includePast=${includePast})...`);
  const events = await fetchAll(client, includePast);
  // eslint-disable-next-line no-console
  console.error(`[bulk-link-health] ${events.length} events att kontrollera`);

  if (events.length === 0) {
    // eslint-disable-next-line no-console
    console.error('[bulk-link-health] inga events att kolla. Avbryter.');
    return;
  }

  // eslint-disable-next-line no-console
  console.error(`[bulk-link-health] startar HEAD-checks (concurrency=${concurrency})...`);
  const startedAt = new Date();

  const outcomes = await runWithConcurrency(events, concurrency, async (event): Promise<CheckOutcome> => {
    const head = await headCheck(event.ticket_url, DEFAULT_TIMEOUT_MS);
    return {
      eventId: event.id,
      source: event.source,
      ticketUrl: event.ticket_url,
      title: pickTitle(event),
      ...head,
    };
  });

  // eslint-disable-next-line no-console
  console.error('[bulk-link-health] skriver resultat till DB (sekventiellt, concurrency=5)...');
  const writeStartedAt = Date.now();
  // Sekventiell write för att undvika Supabase rate-limit (5483 parallella RPC-anrop
  // → "fetch failed"). Concurrency 5 + 50 ms delay är safe. ~5-10 min totalt.
  const WRITE_CONCURRENCY = 5;
  const WRITE_DELAY_MS = 50;
  let writeFailures = 0;
  const writeOutcomes = [...outcomes];
  let writeIdx = 0;
  async function writeWorker(): Promise<void> {
    while (true) {
      const idx = writeIdx++;
      if (idx >= writeOutcomes.length) return;
      const r = writeOutcomes[idx];
      const { error } = await client.rpc('update_link_health_cf', {
        p_event_id: r.eventId,
        p_new_status: r.status,
        p_checked_at: new Date().toISOString(),
      });
      if (error) {
        writeFailures++;
        if (writeFailures <= 5) {
          // eslint-disable-next-line no-console
          console.error(`[bulk-link-health] DB write misslyckades för ${r.eventId}: ${error.message}`);
        }
      }
      if (WRITE_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, WRITE_DELAY_MS));
      }
    }
  }
  const writeWorkers = Array.from({ length: Math.min(WRITE_CONCURRENCY, writeOutcomes.length) }, () => writeWorker());
  await Promise.all(writeWorkers);

  const okCount = outcomes.filter((o) => o.status === 'ok').length;
  const brokenCount = outcomes.filter((o) => o.status === 'broken').length;
  const timeouts = outcomes.filter((o) => o.errorMessage?.includes('timeout')).length;
  const dnsOrNetwork = outcomes.filter(
    (o) => o.status === 'broken' && !o.errorMessage?.includes('timeout') && o.httpStatus === null,
  ).length;
  const http4xx = outcomes.filter((o) => o.httpStatus !== null && o.httpStatus >= 400 && o.httpStatus < 500).length;
  const http5xx = outcomes.filter((o) => o.httpStatus !== null && o.httpStatus >= 500).length;

  const totalDuration = Date.now() - startedAt.getTime();
  const writeDuration = Date.now() - writeStartedAt;

  // eslint-disable-next-line no-console
  console.error(`DB write failures:            ${writeFailures} (av ${outcomes.length})`);

  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error(`  BULK HEAD-CHECK KLAR`);
  // eslint-disable-next-line no-console
  console.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.error(`Startad:                ${startedAt.toISOString()}`);
  // eslint-disable-next-line no-console
  console.error(`Klar:                   ${new Date().toISOString()}`);
  // eslint-disable-next-line no-console
  console.error(`Antal kontrollerade:    ${outcomes.length}`);
  // eslint-disable-next-line no-console
  console.error(`  ok (2xx/3xx):         ${okCount} (${((okCount / outcomes.length) * 100).toFixed(1)} %)`);
  // eslint-disable-next-line no-console
  console.error(`  broken:               ${brokenCount} (${((brokenCount / outcomes.length) * 100).toFixed(1)} %)`);
  // eslint-disable-next-line no-console
  console.error(`    HTTP 4xx:           ${http4xx}`);
  // eslint-disable-next-line no-console
  console.error(`    HTTP 5xx:           ${http5xx}`);
  // eslint-disable-next-line no-console
  console.error(`    timeout:            ${timeouts}`);
  // eslint-disable-next-line no-console
  console.error(`    DNS/network error:  ${dnsOrNetwork}`);
  // eslint-disable-next-line no-console
  console.error(`Total wall-clock:       ${(totalDuration / 1000).toFixed(1)} s`);
  // eslint-disable-next-line no-console
  console.error(`DB-write wall-clock:    ${(writeDuration / 1000).toFixed(1)} s`);
  // eslint-disable-next-line no-console
  console.error('');

  // Top broken sources
  const brokenBySrc = new Map<string, number>();
  for (const o of outcomes) {
    if (o.status === 'broken') {
      brokenBySrc.set(o.source, (brokenBySrc.get(o.source) ?? 0) + 1);
    }
  }
  const topBroken = Array.from(brokenBySrc.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // eslint-disable-next-line no-console
  console.error('TOP 15 källor med flest trasiga länkar:');
  for (const [src, n] of topBroken) {
    // eslint-disable-next-line no-console
    console.error(`  ${String(n).padStart(4)} — ${src}`);
  }
  // eslint-disable-next-line no-console
  console.error('');

  // Första 20 broken (stickprov)
  // eslint-disable-next-line no-console
  console.error('Stickprov — 20 första broken events:');
  for (const o of outcomes.filter((x) => x.status === 'broken').slice(0, 20)) {
    // eslint-disable-next-line no-console
    console.error(
      `  [${o.source}] http=${o.httpStatus ?? 'n/a'} ${o.errorMessage ?? ''}`,
    );
    // eslint-disable-next-line no-console
    console.error(`     ${o.title}`);
    // eslint-disable-next-line no-console
    console.error(`     ${o.ticketUrl.slice(0, 110)}`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(msg);
});
