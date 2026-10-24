/**
 * ingestion-cron.ts — Nightly ingestion orchestrator
 *
 * Kör hela A → B → C → image-gen → preUI-flush-flödet i sekvens.
 * Skriver hjärtslag till runtime/ingestion-cron.status.json så att
 * dashboard 7777 kan visa sann status (röd/grön).
 *
 * Körs av launchd-jobb (com.eventpulse.ingestion) eller manuellt:
 *   npx tsx scripts/ingestion-cron.ts                 # engångskörning
 *   npx tsx scripts/ingestion-cron.ts --limit 50      # max 50 per steg
 *   npx tsx scripts/ingestion-cron.ts --skip-images    # hoppa över Supabase-bilder
 *   npx tsx scripts/ingestion-cron.ts --only C-htmlGate   # kör ETT steg
 *
 * Säkerhetsnot: rör INTE runA.ts interface, dedup-hash, IGNORE_PATTERNS
 * eller scoring-vikter. Detta är ett orchestrator-lager ovanpå befintlig kod.
 *
 * Per-step-timeout: varje steg har en hård gräns (default 2 h). Sätt
 * INGESTION_STEP_TIMEOUT_MS=<ms> för att sänka den (t.ex. 8000 för att
 * bevisa timeouten på ett enda steg med --only).
 */

import { spawn, execSync } from 'child_process';
import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, openSync, closeSync, writeSync, appendFileSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const STATUS_FILE = path.resolve(RUNTIME_DIR, 'ingestion-cron.status.json');
const STEPS_LOG_DIR = path.resolve(RUNTIME_DIR, 'ingestion-cron', 'steps');
const CHAIN_OVERVIEW = path.resolve(RUNTIME_DIR, 'ingestion-cron', 'chain-overview.log');

// ─── Types ─────────────────────────────────────────────────────────────────

interface StepRecord {
  name: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  sourcesProcessed: number | null;
  /**
   * null = steget persisterade inget mätbart (skriver eget JSON-format, eller
   * persisterar inte alls). 0 = steget kördes och persisterade noll. Skillnaden
   * är viktig: dashboarden ska visa "vet inte" som null, inte "noll".
   */
  eventsExtracted: number | null;
}

interface StatusFile {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  /** ISO-tid för senaste writeStatus — används av dashboarden som "alive"-signal. */
  lastHeartbeatAt: string | null;
  steps: StepRecord[];
  /** Summa av stegens eventsExtracted. Endast räkningsbara steg bidrar. */
  totalEventsExtracted: number;
  lastError: string | null;
}

interface StepResult {
  exitCode: number;
  sourcesProcessed: number | null;
  eventsExtracted: number | null;
}

// ─── Step output parsing ────────────────────────────────────────────────────

/**
 * Per-steg-recept. Varje adapter skriver både per-källa-rader och en
 * total-rad med överlappande nycklar, så en generisk `/fetched=(\d+)/g`
 * dubbelräknar. Lösningen är en explicit tabell: en regex per steg, och den
 * SISTA matchningen vinner (totalraden skrivs sist).
 *
 * Ordningen i regex-gruppen är prioritetsordnad: persisted > queued > future >
 * fetched. Vi vill rapportera det som faktiskt lämnade processen, inte det
 * som bara lästes in.
 */
const STEP_COUNT_RECIPES: Record<string, RegExp> = {
  // ingest-tribe-events.mjs:264 — "fetched=548 persisted=0 duplicates=528 errors=0"
  'tribe-events': /^(?:=== TOTAL ===\n)?fetched=\d+ persisted=(\d+)/m,
  // ingest-sitemap-discovery.mjs:437 — "sitemap_urls=993742 event_urls=713 fetched=126 persisted=14 ..."
  'sitemap-discovery': /^sitemap_urls=\d+ event_urls=\d+ fetched=\d+ persisted=(\d+)/m,
  // ingest-direct-jsonld.mjs:274 — "fetched=490 future=481 persisted=249 ..."
  'direct-jsonld': /^fetched=\d+ future=\d+ persisted=(\d+)/m,
  // ingest-eventbrite-stockholm.mjs:316 — "fetched=60 future=42 persisted=24 ..."
  'eventbrite-pagination': /^fetched=\d+ future=\d+ persisted=(\d+)/m,
  // ingest-livespot-stockholm.mjs:225 — "Queued (raw_events): 600"
  'livespot-stockholm': /^Queued \(raw_events\): (\d+)/m,
  // ingest-luma-stockholm.mjs:315 — "  queued: 12" (per page, sista vinner)
  'luma-stockholm': /^\s*queued:\s*(\d+)/m,
  // ingest-ra-stockholm.mjs:213 — samma format som luma
  'ra-stockholm': /^\s*queued:\s*(\d+)/m,
  // ingest-posh-stockholm.mjs:214 — samma format som luma
  'posh-stockholm': /^\s*queued:\s*(\d+)/m,
  // 03-Queue/drainQueue.ts — "[drain] avslutar (X): completed=3535 failed=4 ..."
  // Detta är det ENDA steget som skriver events till Supabase. Utan det tog
  // kedjan slut med 3 548 jobb liggande i raw_events sedan 2026-10-20.
  'worker-drain': /^\[drain\] avslutar \([^)]*\): completed=(\d+)/m,
  // 03-Queue/importToEventPulse.ts — "KLAR  │  1147 events till bullmq  │  0 errors"
  // Räknar events som lämnar C/D:s extrahterade filer och går in i BullMQ.
  // Det är INTE samma sak som worker-drain: detta steg räknar vad som
  // queue:as, drainQueue räknar vad som faktiskt skrivs till Supabase.
  'import-to-eventpulse': /KLAR\s+│\s+(\d+)\s+events till bullmq/m,
};

/**
 * Steg som persisterar inga events alls. Reddit skriver uttryckligen
 * "skip persistence — signal-only" (ingest-reddit-stockholm.mjs:99) så dess
 * "Total candidates: N" är kandidater, inte events. Det ska rapporteras som
 * null, inte som N — annars säger dashboarden att Reddit lade till events.
 */
const STEP_COUNT_EXCLUDED = new Set([
  'reddit-stockholm',
  'api-discovery',
  'subpath-discovery',
]);

/**
 * Räkna persisterade events för ett steg utifrån dess stdout.
 *
 * Returnerar null när steget inte har ett mätbart count — antingen för att
 * det saknar recept, eller för att det faktiskt inte persisterar events.
 * "Vet inte" och "noll" är olika påståenden och ska inte blandas ihop.
 */
export function parseStepCounts(stepName: string, stdout: string): number | null {
  if (STEP_COUNT_EXCLUDED.has(stepName)) return null;

  const recipe = STEP_COUNT_RECIPES[stepName];
  if (!recipe) return null;

  // Sista matchningen vinner — totalraden skrivs efter per-källa-raderna.
  let last: string | undefined;
  for (const m of stdout.matchAll(new RegExp(recipe.source, 'gm'))) {
    last = m[1];
  }
  if (last === undefined) return null;

  const n = Number.parseInt(last, 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Status helpers ─────────────────────────────────────────────────────────

function readStatus(): StatusFile {
  if (!existsSync(STATUS_FILE)) {
    return {
      running: false,
      pid: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      durationMs: null,
      lastHeartbeatAt: null,
      steps: [],
      totalEventsExtracted: 0,
      lastError: null,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as Partial<StatusFile>;
    // Bakåtkompatibelt — gamla statusfiler saknar lastHeartbeatAt
    return {
      running: raw.running ?? false,
      pid: raw.pid ?? null,
      startedAt: raw.startedAt ?? null,
      finishedAt: raw.finishedAt ?? null,
      exitCode: raw.exitCode ?? null,
      durationMs: raw.durationMs ?? null,
      lastHeartbeatAt: raw.lastHeartbeatAt ?? raw.startedAt ?? null,
      steps: raw.steps ?? [],
      totalEventsExtracted: raw.totalEventsExtracted ?? 0,
      lastError: raw.lastError ?? null,
    };
  } catch {
    return {
      running: false, pid: null, startedAt: null, finishedAt: null, exitCode: null,
      durationMs: null, lastHeartbeatAt: null, steps: [], totalEventsExtracted: 0, lastError: null,
    };
  }
}

function writeStatus(s: StatusFile): void {
  // Alltid uppdatera heartbeat vid varje write — dashboarden använder detta
  // som "alive"-signal. Om processen hänger slutar writeStatus anropas → dashboard
  // ser gammal heartbeat och kan flagga stale.
  s.lastHeartbeatAt = new Date().toISOString();
  writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

/**
 * Append a line to the chain-overview log. Each line is a self-contained
 * JSONL record that a watchdog can tail to detect stuck steps.
 *
 * Format: { ts, event, step, exitCode?, pid?, cmd? }
 */
function appendChainOverview(record: Record<string, unknown>): void {
  try {
    if (!existsSync(path.dirname(CHAIN_OVERVIEW))) {
      mkdirSync(path.dirname(CHAIN_OVERVIEW), { recursive: true });
    }
    appendFileSync(CHAIN_OVERVIEW, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
  } catch (err) {
    // Best-effort — never let logging break the chain.
    console.error('[ingestion-cron] chain-overview write failed:', err instanceof Error ? err.message : String(err));
  }
}

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const skipImages = args.includes('--skip-images');
const skipRender = args.includes('--skip-render');
const skipDiscovery = args.includes('--skip-discovery');
const skipPdf = args.includes('--skip-pdf');
const skipRss = args.includes('--skip-rss');
const skipEtags = args.includes('--skip-etags');
const skipGoogleCse = args.includes('--skip-google-cse');
const skipCandidateTests = args.includes('--skip-candidate-tests');
const skipEventbritePagination = args.includes('--skip-eventbrite');
const skipTribeIngest = args.includes('--skip-tribe');
const skipApiDiscovery = args.includes('--skip-api-discovery');
const skipSitemapDiscovery = args.includes('--skip-sitemap');
const skipLumaIngest = args.includes('--skip-luma');
const skipRaIngest = args.includes('--skip-ra');
const skipPoshIngest = args.includes('--skip-posh');
const skipRedditIngest = args.includes('--skip-reddit');
const skipSubpathDiscovery = args.includes('--skip-subpath');
const skipLivespotIngest = args.includes('--skip-livespot');
const skipDirectJsonld = args.includes('--skip-direct-jsonld');
// 2026-10-24 — `--only <steg[,steg2,...]>` kör BARA de angivna stegen.
// Motiv: en verifiering ska kunna peka på ett enda steg (t.ex. bevisa
// per-step-timeouten med INGESTION_STEP_TIMEOUT_MS=8000) utan att köra hela
// kedjan. Ett stegnamn som inte finns är ett FEL — annars kan en typo göra
// att "ingen kördes" ser ut som "steget gick bra".
const onlyIdx = args.indexOf('--only');
const onlyStepIds: string[] = onlyIdx !== -1 && args[onlyIdx + 1]
  ? args[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const limitIdx = args.indexOf('--limit');
// 2026-10-07 — default --limit höjt från 50 → 200. Bakgrund: tunga steg
// (sitemap-discovery, C-htmlGate, subpath-discovery) kan nu hantera fler
// sources/rounds i en enda körning. Sänkt värde kan fortfarande sättas via
// `--limit N` på CLI.
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 200;
const smoke = args.includes('--smoke');
// SKIP_BFL=1 (eller --skip-bfl): kör D-images med bibliotek-fallback istället
// för BFL-generering. Tänkt för nattläget tills BFL-credits fyllts på
// (beslut 2026-09-15: biblioteket är fallback — se imageGen.matchLibraryFirst).
const skipBfl = process.env.SKIP_BFL === '1' || args.includes('--skip-bfl');

/**
 * `--smoke` (2026-09-10): kör HELA pipelinen med minimal data så vi kan verifiera
 * att kedjan är hel utan att bränna Scrapingbee-credits eller BFL-budget.
 *
 * I smoke:
 *   - effectiveLimit = 1 (default för A/B/D/I-pdf/etag-refresh)
 *   - BFL-fallback avstängt via skipImages=true (vi riskerar inte bildgenerering)
 *   - P3A discovery: --queries 1 --per-query 1
 *   - P3B geo: --limit 5
 *   - P3C rss: --limit 5 --concurrency 2 --dry-run=true (skriver inte till DB)
 *   - D-renderGate: --behavior static-only (istället för premium-only) för att
 *     undvika Scrapingbee-credits i smoke
 */
const effectiveLimit = smoke ? 1 : limit;
const effectiveDBehavior = smoke ? 'static-only' : 'premium-only';

// 2026-10-23 — hård gräns per steg. Satt efter mätning, inte gissning:
// chain-overview.log visar subpath-discovery median 4 178 s och max 4 522 s
// (75 min) över 7 körningar, sitemap-discovery max 425 s, P3D max 258 s.
// Två timmar är alltså 1,6 gånger den längsta legitima stegtiden. Under den
// gränsen hittas verkliga hängningar: tribe-events stod en gång kvar i
// 419 485 s (116 h) utan att kedjan brytte. Miljövariabeln låter en operator
// sänka den utan att röra kod.
const STEP_TIMEOUT_MS = (() => {
  const fromEnv = Number(process.env.INGESTION_STEP_TIMEOUT_MS ?? '');
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 2 * 60 * 60 * 1000;
})();

// ─── Step runner ────────────────────────────────────────────────────────────

interface SpawnResult {
  exitCode: number;
  sourcesProcessed: number | null;
  eventsExtracted: number | null;
}

function runStep(name: string, cmd: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    console.log(`[ingestion-cron] ▶ ${name}: ${cmd} ${args.join(' ')}`);

    // 2026-10-07 — per-step log files. Each step gets its own .log and .err.log
    // under runtime/ingestion-cron/steps/ so we can read what a single step did
    // without grepping the interleaved launchd.out.log. The chain-overview.log
    // gets a one-line record per step start/end (JSONL) for watchdog tooling.
    if (!existsSync(STEPS_LOG_DIR)) mkdirSync(STEPS_LOG_DIR, { recursive: true });
    const stepStamp = startedAt.replace(/[:.]/g, '-');
    const stepLogPath = path.resolve(STEPS_LOG_DIR, `${name}-${stepStamp}.log`);
    const stepErrPath = path.resolve(STEPS_LOG_DIR, `${name}-${stepStamp}.err.log`);
    const stepOutFd = openSync(stepLogPath, 'a');
    const stepErrFd = openSync(stepErrPath, 'a');
    // Tee headers so even an empty step log says what it is.
    writeSync(stepOutFd, `─── ${name} started ${startedAt} (${cmd} ${args.join(' ')})\n`);
    writeSync(stepErrFd, `─── ${name} started ${startedAt} (${cmd} ${args.join(' ')})\n`);

    appendChainOverview({ event: 'step-start', step: name, pid: process.pid, cmd: `${cmd} ${args.join(' ')}` });

    // 2026-10-07 — heartbeat en gång/minut under långa steg så watchdog
    // inte tror att chain är död. 2026-10-18 — uppdatera även status.json
    // så dashboardens /api/ingestion/status visar färsk heartbeat och inte
    // flaggar stale efter >2h i en lång subpath/sitemap-step.
    const heartbeat = setInterval(() => {
      appendChainOverview({
        event: 'heartbeat',
        step: name,
        pid: process.pid,
        childPid: proc.pid,
      });
      try {
        // Läs färsk status och uppdatera bara lastHeartbeatAt — låt steg-loopens
        // egna writeStatus fortsatt vara källan för steps/totalEventsExtracted.
        const cur = readStatus();
        cur.lastHeartbeatAt = new Date().toISOString();
        writeFileSync(STATUS_FILE, JSON.stringify(cur, null, 2), 'utf8');
      } catch { /* best-effort — aldrig krascha steget */ }
    }, 60_000);

    const proc = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      // pipe så vi kan tee:a till både parent stdout OCH per-step file.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sourcesProcessed: number | null = null;
    let eventsExtracted: number | null = null;
    // Barnets stdout måste buffras för att kunna räknas ihop efteråt — utan
    // detta var eventsExtracted en konstant 0 sedan starten (2026-10-21).
    let stdoutBuf = '';

    // Tee: varje chunk från child skrivs både till parent stdout/stderr OCH
    // till step-loggen. Håll koll på ordning så vi inte tappar rader vid ras.
    proc.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      stdoutBuf += chunk.toString('utf8');
      try { writeSync(stepOutFd, chunk); } catch {}
    });
    proc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      try { writeSync(stepErrFd, chunk); } catch {}
    });

    // 2026-10-23 — per-step-timeout. Utan detta hänger kedjan för alltid om ett
    // steg inte avslutar: det fanns ingen gräns på barnprocessen, bara en
    // heartbeat. Mätt i chain-overview.log: subpath-discovery tar legitimt upp
    // till 75 min (median 70 min över 7 körningar), men tribe-events har en
    // riktig hängning på 419 485 s — 116 timmar — i historiken. Två timmar
    // ligger långt över den längsta legitima stegtiden och fångar den klassen.
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      appendChainOverview({
        event: 'step-timeout',
        step: name,
        pid: process.pid,
        childPid: proc.pid,
        limitMs: STEP_TIMEOUT_MS,
      });
      console.error(
        `[ingestion-cron] ⏱ ${name} överskred ${STEP_TIMEOUT_MS} ms — SIGTERM till pid ${proc.pid}`,
      );
      try { proc.kill('SIGTERM'); } catch {}
      // SIGTERM kan ignoreras av ett barn som väntar på I/O. Ge det 30 s, sedan
      // SIGKILL. Utan eskaleringen är timeouten bara en varning.
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          console.error(`[ingestion-cron] ⏱ ${name} svarade inte på SIGTERM — SIGKILL till pid ${proc.pid}`);
          try { proc.kill('SIGKILL'); } catch {}
        }
      }, 30_000).unref?.();
    }, STEP_TIMEOUT_MS);

    proc.on('exit', (code) => {
      clearInterval(heartbeat);
      clearTimeout(killTimer);
      const finishedAt = new Date().toISOString();
      // Ett avbrutet steg är inte exit=0 — steget räknas som fel så att
      // green-filen skriver ok:false och nästa körning försöker igen.
      const exitCode = timedOut ? 124 : (code ?? 1);
      const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
      try {
        writeSync(stepOutFd, `─── ${name} finished ${finishedAt} exit=${exitCode} duration=${durationMs}ms\n`);
        writeSync(stepErrFd, `─── ${name} finished ${finishedAt} exit=${exitCode} duration=${durationMs}ms\n`);
        closeSync(stepOutFd);
        closeSync(stepErrFd);
      } catch {}
      eventsExtracted = parseStepCounts(name, stdoutBuf);
      // 2026-10-23 — pid SAKNADES här, medan step-start/step-timeout hade det.
      // Effekten var att 263 av loggens rader inte kunde kopplas till någon
      // körning: E2 (step-start ska ha ett step-end) och E4 (promote före A)
      // gick att köra på "sista körningen" men hittade 0 step-end-rader och
      // failade med "körningen saknar steg". Loggen är observability — den måste
      // gå att fälla av per körning.
      appendChainOverview({ event: 'step-end', step: name, pid: process.pid, exitCode, durationMs, eventsExtracted, timedOut });
      console.log(
        `[ingestion-cron] ✓ ${name}: exit=${exitCode} duration=${durationMs}ms ` +
        `events=${eventsExtracted === null ? 'n/a' : eventsExtracted} ` +
        `log=${path.relative(PROJECT_ROOT, stepLogPath)}`,
      );
      resolve({ exitCode, sourcesProcessed, eventsExtracted });
    });
  });
}

// ─── Step definitions ──────────────────────────────────────────────────────

const steps: Array<{ name: string; cmd: string; args: string[] }> = [
  {
    name: 'A-directAPI',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/A-directAPI-networkGate/runA.ts', '--limit', String(effectiveLimit), '--workers', '20'],
  },
  {
    name: 'B-network-api',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/B-JSON-feedGate/runB.ts', '--limit', String(effectiveLimit), '--workers', '20'],
  },

  // ── P0-EB: Eventbrite pagination (2026-10-04) ─────────────────────────
  // Standalone .mjs (ingen tsx-overhead). Paginates Eventbrite Stockholm +
  // sub-city variants 3 months forward, persists future events with dedup.
  // Respekterar BACKLOG.md rate-limit 1 req / 3s. ~30s runtime.
  // Källa: sources/eventbrite-stockholm.jsonl (1 req 3s rate-limit, JSON-LD).
  ...((!skipEventbritePagination) ? [{
    name: 'eventbrite-pagination',
    cmd: 'node',
    args: ['scripts/ingest-eventbrite-stockholm.mjs', '--months=' + String(smoke ? 1 : 3)],
  }] : []),

  // ── P0-Tribe: The Events Calendar WordPress REST API (2026-10-04) ──────
  // Generic fetcher för 5+ WP-sajter som kör The Events Calendar-plugin
  // (upptäckta via scripts/discover-hidden-apis.mjs).
  // Källa: /wp-json/tribe/events/v1/events endpoint.
  // ~3 min runtime (5 sources × 7 pages × 2s rate-limit + DB writes).
  ...((!skipTribeIngest) ? [{
    name: 'tribe-events',
    cmd: 'node',
    args: ['scripts/ingest-tribe-events.mjs', '--pages=10'],
  }] : []),

  // ── P0-Sitemap: Generic sitemap.xml parser (2026-10-04) ───────────────
  // Crawlar ALLA 196 sources sitemap, filtrerar event-pattern URLs,
  // extraherar JSON-LD events från varje URL. ~10 min runtime.
  ...((!skipSitemapDiscovery) ? [{
    name: 'sitemap-discovery',
    cmd: 'node',
    args: ['scripts/ingest-sitemap-discovery.mjs', '--max-sources=999', '--max-per-source=15'],
  }] : []),

  // ── P0-Subpath: Auto-discover event subpaths (2026-10-04) ─────────────
  // Probar 12 kända event-subpaths per source och uppdaterar source-filer
  // med alternativa URLs. ~10 min runtime (216 sources × 12 paths × 0.5s).
  ...((!skipSubpathDiscovery) ? [{
    name: 'subpath-discovery',
    cmd: 'node',
    args: ['scripts/discover-subpaths.mjs', '--max-sources=999'],
  }] : []),

  // ── P0-DirectJSONLD: Generic direct JSON-LD extractor (2026-10-04) ──
  // För källor med JSON-LD på landing-sidan (utan sitemap).
  // 10 workers, ~5 min runtime för 196 sources.
  ...((!skipDirectJsonld) ? [{
    name: 'direct-jsonld',
    cmd: 'node',
    args: ['scripts/ingest-direct-jsonld.mjs'],
  }] : []),

  // ── P0-Livespot: Livespot.se API (2026-10-04) ───────────────────────
  // 5,494 Stockholm events via öppet REST-API.
  // Kör 6 pages = 600 events per natt (rimlig batch, dedup via ev.id).
  ...((!skipLivespotIngest) ? [{
    name: 'livespot-stockholm',
    cmd: 'node',
    args: ['scripts/ingest-livespot-stockholm.mjs', '--pages=6'],
  }] : []),

  {
    name: 'C-htmlGate',
    // 2026-10-07 — --max-rounds 200 (default) för längre körningar. Innan
    // 50, vilket begränsade hur många kandidater C hann processa per natt.
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/C-htmlGate/run-dynamic-pool.ts', '--workers', '5', '--max-rounds', smoke ? '5' : '200'],
  },

  // ── P1A: D-renderGate (Scrapingbee för JS-tunga sidor) ─────────────────
  // Konsumerar postTestC-D.jsonl som C-gate inte klarade. premium-only,
  // 5 cr/sida — auto-escalate till stealth vid CF/DataDome-signaler.
  // Kör EFTER C (så vi inte dubbelprocessar) och FÖRE images.
  // OBS: runD-scrapingbee.ts använder --key=value-format (inte --key value).
  ...((!skipRender) ? [{
    name: 'D-renderGate',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/D-renderGate/runD-scrapingbee.ts', `--behavior=${effectiveDBehavior}`, `--limit=${effectiveLimit}`],
  }] : []),

  // ── P2A: PDF/affisch-extraktion ────────────────────────────────────────
  // Parsar PDF:er (KB, Riksarkivet, kulturhus) via pdf-parse → universal-extractor.
  // Kör efter D-renderGate så även JS-renderade PDF-sidor är täckta.
  ...((!skipPdf) ? [{
    name: 'I-pdfExtraction',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/I-pdfExtraction/pdfExtractor.ts', '--limit', String(effectiveLimit), '--concurrency', smoke ? '1' : '3'],
  }] : []),

  // 2026-10-21 — manual-review-triage BORTA TAGEN. Steget körde
  // runC-pattern-promoter.ts, som inte är en triage — den läser
  // reports/pattern-validation/ och avslutar direkt eftersom dess producent
  // (runC-pattern-validator.ts) aldrig skrevs. Steget gav en falsk bild av att
  // triage pågick. Se även borttagandet av pattern-promoter nedan.

  // ── P2B: ETag / If-Modified-Since dedup ───────────────────────────────
  // Uppdaterar body-hash-cache; skippar nedladdning för oförändrade sidor.
  // Kör EFTER ingestion så vi har färsk data att hasha.
  ...((!skipEtags) ? [{
    name: 'etag-refresh',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/tools/etagRefresh.ts', '--limit', String(effectiveLimit)],
  }] : []),

  // ── P3-API-discovery (2026-10-04) ────────────────────────────────────
  // Hidden API discovery — körs veckovis (kontrollerar .last-discovery timestamp).
  // Upptäcker wp-json/tribe/events/v1, __NEXT_DATA__, GraphQL, etc.
  // Skapar data/api-discovery-results.jsonl som tribe-fetcher konsumerar.
  ...((!skipApiDiscovery) ? [{
    name: 'api-discovery',
    cmd: 'node',
    args: ['scripts/discover-hidden-apis.mjs', '--max-age-days=7'],
  }] : []),

  // ── P1-Luma: Luma.com Stockholm events (2026-10-04) ──────────────────
  // Tech meetups, hackathons, workshops via Scrapingbee.
  // 5 kategorier × 1 req / 3s = ~20s runtime.
  ...((!skipLumaIngest) ? [{
    name: 'luma-stockholm',
    cmd: 'node',
    args: ['scripts/ingest-luma-stockholm.mjs'],
  }] : []),

  // ── P2-RA: Resident Advisor Stockholm (2026-10-04) ───────────────────
  // Electronic music events. Kräver Scrapingbee för DataDome-bypass.
  ...((!skipRaIngest) ? [{
    name: 'ra-stockholm',
    cmd: 'node',
    args: ['scripts/ingest-ra-stockholm.mjs'],
  }] : []),

  // ── P2-Posh: Posh.vip Stockholm (2026-10-04) ────────────────────────
  // Social/party events. Kan kräva Scrapingbee för SPA-rendering.
  ...((!skipPoshIngest) ? [{
    name: 'posh-stockholm',
    cmd: 'node',
    args: ['scripts/ingest-posh-stockholm.mjs'],
  }] : []),

  // ── P2-Reddit: r/Stockholm events (2026-10-04) ───────────────────────
  // Community event cross-posts. Kräver Scrapingbee för anti-bot bypass.
  ...((!skipRedditIngest) ? [{
    name: 'reddit-stockholm',
    cmd: 'node',
    args: ['scripts/ingest-reddit-stockholm.mjs'],
  }] : []),
];

if (!skipImages) {
  // I smoke: skippa BFL-fallback via skipBflFallback=true (bibliotek-matchning
  // är OK men vi vill inte bränna pengar om biblioteket inte har något).
  const imageLimit = smoke ? 3 : limit;
  steps.push({
    name: 'D-images',
    // Library-first image fallback (2026-09-10): provar image_library först
    // (pickLibraryFallback → venue+category → category → default). Bara om
    // biblioteket INTE har något match alls → fall tillbaka till BFL.
    // Mål: 10–20 bilder per kategori/eventtyp så BFL blir sällsynt
    // (post-launch / med riktig budget). Just nu: BFL nästan aldrig.
    cmd: 'npx',
    args: ['tsx', '--eval', `import('./08-Agent/services/imageGen.matchLibraryFirst.ts').then(m => m.matchLibraryFirst({ limit: ${imageLimit}, onlyMissing: true, libraryConcurrency: 5, bflConcurrency: 3, skipBflFallback: ${smoke || skipBfl} })).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e); process.exit(1); })`],
  });

  // ── import-to-eventpulse: extraherade events → BullMQ ─────────────────
  // 2026-10-23 — samma fel som worker-drain, en helt annan väg.
  //
  // A/B/C/D/I skriver sina events till `03-Queue/03-extractedevents/`
  // (C och D i underkataloger). Ingen gate når `events`-tabellen: de skriver
  // bara filer. Persistensen sker i `03-Queue/importToEventPulse.ts` → BullMQ
  // `raw_events` → startWorker → 04-Normalizer.
  //
  // Problemet: importeraren kördes INTE i den här kedjan (0 referenser).
  // Den kördes av `com.eventpulse.post-ingest` (04:00) → runDaily.ts →
  // ingestionPipeline.ts steg 3 — alltså på en klocka oberoende av den här
  // kedjan, som startar 02:00 och mätt tar 1,5–2,5 h. Mätt 2026-10-23:
  // senaste import 02:00 UTC, medan C skrev 13 extrafiler kl. 12:24 UTC.
  // Följden: 18 spårade källor med sammanlagt 120 extraherade events och
  // NOLL rader i `events`.
  //
  // Bevisad mekanism (2026-10-23, wwwkonserthusetse): 12 events extraherade →
  // 5 avvisade av datumvakten i importToEventPulse.ts:301 (förgångna eller
  // `date: "unknown"`) → 7 enqueue:ade → 5 persisterade som riktiga events
  // 24–26 okt. Kedjan fungerar; den kördes bara fel tid.
  //
  // Placerat FÖRE worker-drain, av samma skäl som det steget ligger där: import
  // måste hinna innan någon dränerar, annars ligger jobben kvar till nästa natt.
  // `--dry-run` i smoke: annars skulle en smoke-körning skriva riktiga events.
  steps.push({
    name: 'import-to-eventpulse',
    cmd: 'npx',
    args: ['tsx', '03-Queue/importToEventPulse.ts', ...(smoke ? ['--dry-run', '--limit', '5'] : [])],
  });

  // ── worker-drain: sista milen till Supabase ───────────────────────────
  // Alla steg ovanför skriver till BullMQ-kön `raw_events`. Utan det här steget
  // ingick de i en kö som ingen dränera i denna kedja — runDaily.ts har en
  // 15-minuters drain, men det är inte den launchd kör (plisten pekar på
  // scripts/ingestion-cron.ts). Mätt 2026-10-23: 3 548 jobb väntande, äldsta
  // från 2026-10-20, 0 persisterade av nattens 1 147 "funna" events.
  //
  // Placerat FÖRE P2C, som läser ur databasen och alltså ska se de nycklade
  // eventsen. --max-ms ger en hård gräns så att steget alltid avslutas.
  //
  // 2026-10-23 — budgeten höjd 15 → 90 min efter mätning: en riktig drain med
  // den RIKTIGA normalizern (inte en räknande stub) tog 293 jobb på 15 min med
  // 0 misslyckade = 19,5 jobb/min. Run 1 producerade 790 jobb. Med 15 min blev
  // 492 kvar väntande varje natt — kön växte monotont. 90 min rymmer ~1 750
  // jobb, alltså en hel natt plus dagens utestående rest. Stegets egen gräns är
  // ändå STEP_TIMEOUT_MS (2 h), så en budget på 90 min kan aldrig hänga kedjan.
  steps.push({
    name: 'worker-drain',
    cmd: 'npx',
    args: ['tsx', '03-Queue/drainQueue.ts', '--max-ms', String(smoke ? 60_000 : 5_400_000)],
  });

  // ── P2C: Active-learning closed loop ──────────────────────────────────
  // Triggar review-flagga för låg-confidence events → record_feedback
  // → dashboard visar dem i human-review modal.
  steps.push({
    name: 'P2C-active-learning',
    cmd: 'npx',
    // threshold = 50 (0–100 skala, default i activeLearning). Vi flaggar events
    // med confidence_score < 50 för human review. Stiger tröskeln → fler events
    // i kö för granskning; vi har inte kapacitet för >200 per natt just nu.
    args: ['tsx', '--eval', `import('./08-Agent/tools/activeLearning.ts').then(m => m.run({ threshold: 50, dryRun: false })).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e); process.exit(1); })`],
  });
}

if (!skipGoogleCse) {
  // P3A: Google Custom Search API för discovery.
  // Kräver GOOGLE_CSE_ID + GOOGLE_API_KEY i env. Om nycklar saknas → no-op.
  // Queries: ["events stockholm", "konsert stockholm 2026", ...] → source_candidates.
  steps.push({
    name: 'P3A-discovery',
    // P3A (2026-09-10): Exa primär, Google CSE fallback.
    // discoverySearch.ts kör Exa först (om EXA_API_KEY är riktig) och
    // faller tillbaka till Google CSE om Exa returnerar < minExa URLs
    // eller är otillgänglig. Resultat dedupas via source_candidates upsert.
    cmd: 'npx',
    args: ['tsx', '07-Discovery/src/searchEngines/discoverySearch.ts', '--queries', smoke ? '1' : '10', '--per-query', smoke ? '1' : '10', '--min-exa', '1'],
  });
}

if (!skipDiscovery) {
  // P3B: Venue-graph geo-expansion.
  // Hittar nya venues inom 500m av existerande venues via lat/lng och skriver
  // geo-baserade queries till source_candidates (engine='venue_graph_geo').
  // Dessa plockas sedan upp av P3A discoverySearch → Exa → nya venues.
  steps.push({
    name: 'P3B-venue-graph-geo',
    cmd: 'npx',
    args: ['tsx', '07-Discovery/src/venueGraph/geoExpansion.ts', '--geo-radius-m', '500', '--limit', smoke ? '5' : '50', '--city', 'Stockholm'],
  });
}

if (!skipRss) {
  // P3C: RSS-feed discovery.
  // Provar /feed, /rss.xml för kända venues → universal-extractor.
  // I smoke: --dry-run=true så vi inte skriver till source_candidates
  // (testa discovery-flödet utan DB-write).
  steps.push({
    name: 'P3C-rss-discovery',
    cmd: 'npx',
    args: ['tsx', '07-Discovery/src/searchEngines/rssDiscovery.ts', '--limit', smoke ? '5' : '100', '--concurrency', smoke ? '2' : '5', ...(smoke ? ['--dry-run'] : [])],
  });
}

// 2026-10-21 — pattern-promoter BORTA TAGEN ur schemat. runC-pattern-promoter.ts
// läser reports/pattern-validation/ (rad 28) och avslutar direkt när mappen är
// tom (rad 182). Producenten runC-pattern-validator.ts finns varken på disk
// eller i git-historik, så mappen fylls aldrig.
//
// Att köra promotorn ändå är inte bara overksikt — den är aktivt skadlig.
// promoteToC0/C2 (rad 84/120) skriver URL-mönster in i C-lagret, och CLAUDE.md:s
// Generalization Protection Rule kräver bevis på 2–3 orelaterade domäner
// innan ett mönster får generaliseras. Utan validator finns ingen sådan
// evidens, så promotorn kan bara arbeta med skenbart bevisade mönster.
//
// Koden ligger kvar. Vill du ha pattern-promotion som riktig loop krävs
// runC-pattern-validator.ts som läser C-gate-evidensen
// (runtime/postTestC-*.jsonl, sources_status.jsonl) och kräver ≥2 orelaterade
// domäner innan status:'confirmed'. Det är ett eget bygge, inte en cron-flagga.

if (!skipCandidateTests) {
  // P3D: Source-candidate test-loop (2026-10-21).
  //
  // Stänger kedjan som P3A/P3B/P3C hittills lämnade öppen. De tre discovery-
  // stegen skriver 335 kandidater till source_candidates (exa_search 228,
  // venue_graph_geo 68, rss_discovery 39) som INGEN konsumerade — runnern
  // kördes aldrig i cron, och dess claim-RPC saknades helt på live-DB.
  //
  // Detta steg claimar kandidater ur source_candidate_test_queue, kör var och
  // en genom riktiga A/B/C/D-gates i en sandbox, och promote:ar de som
  // klarar smoke-fasen (write sources/<slug>.jsonl — den fil A-gates kan se).
  //
  // --phase=smoke: endast smoke-fasen kan ge 'promote' (decision.ts:60,77).
  //                sanity/breadth ger manual_review även för bra kandidater.
  // --limit: varje kandidat spawnar e2e.py --from-preA --limit 1 --apply,
  //         alltså riktiga nätanrop. Kör inte för stort.
  steps.push({
    name: 'P3D-source-candidate-tests',
    cmd: 'npx',
    args: ['tsx', '07-Discovery/src/sourceTesting/runSourceCandidateTests.ts', '--phase=smoke', `--limit=${smoke ? '1' : '20'}`],
  });
}

// ─── Ordning: discovery FÖRE ingestion (2026-10-23) ─────────────────────────
//
// Kedjan är nu: P3A/P3B/P3C hittar kandidater → P3D testar och promote:ar dem
// till sources/<slug>.jsonl → A-gatet plockar upp dem (getNextABatch() filtrerar
// på status === 'never_run') → B/C/D tar vid.
//
// Före flytten låg P3D som steg 23 av 23, alltså EFTER A. En källa som
// promote:ades 08:08 av P3D kunde därför inte nå A-gatet förrän nästa natt
// kl 02:00 — upp till 18 timmars latens. Ordningen är den enda ändringen;
// inga stegs kommandon eller gränser har rörts.
const P3_STEP_NAMES = new Set([
  'P3A-discovery',
  'P3B-venue-graph-geo',
  'P3C-rss-discovery',
  'P3D-source-candidate-tests',
]);

steps.splice(
  0,
  steps.length,
  ...steps.filter((s) => P3_STEP_NAMES.has(s.name)),
  ...steps.filter((s) => !P3_STEP_NAMES.has(s.name)),
);

// ─── Pre-discovery kill check (2026-10-18) ────────────────────────────────

/**
 * Lista ps auxww, hitta processer vars cmdline ser ut som en discovery/ingest-
 * worker, och skicka SIGTERM till dem (följt av SIGKILL efter 5s om de lever).
 *
 * Matchar mot: scripts/ingest-*.mjs, scripts/discover-*.mjs,
 * 07-Discovery/src/, geoExpansion, rssDiscovery, discoverySearch.
 *
 * Exkluderar: processen själv (current pid), npm/tsx-wrappern ovanför oss,
 * ps/grep/bash. Returnerar lista av dödade PIDs för loggning.
 *
 * Loggar varje dödad process till chain-overview.log (event='pre-kill').
 */
async function killLivingDiscoveryProcesses(): Promise<number[]> {
  const self = process.pid;
  const PATTERNS = [
    /scripts\/ingest-[\w-]+\.m?js/,           // scripts/ingest-tribe-events.mjs
    /scripts\/discover-[\w-]+\.m?js/,          // scripts/discover-subpaths.mjs
    /07-Discovery\/src\//,                     // 07-Discovery/src/...
    /geoExpansion/,
    /rssDiscovery/,
    /discoverySearch/,
  ];

  let out: string;
  try {
    out = execSync('ps auxww', { encoding: 'utf8', timeout: 5_000 });
  } catch (err) {
    console.error('[ingestion-cron] pre-kill: ps auxww misslyckades:', err instanceof Error ? err.message : err);
    return [];
  }

  const killed: number[] = [];
  const seen = new Set<number>();

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // ps auxww-format: USER PID %CPU %MEM VSZ RSS TTY STAT STARTED TIME COMMAND…
    // Splitta på whitespace, max 12 delar → COMMAND börjar på index 10.
    const parts = line.split(/\s+/, 12);
    if (parts.length < 12) continue;
    const pid = parseInt(parts[1], 10);
    if (Number.isNaN(pid) || pid === self) continue;
    const cmdline = parts.slice(10).join(' ');
    // Skippa ps/grep/bash och vår egen bash-wrapper ovanför cron.
    // cmdline börjar typiskt med /opt/homebrew/.../node eller /bin/bash eller liknande.
    if (/^\/?(usr\/bin\/)?(ps|grep|bash)\b/.test(cmdline)) continue;
    if (!PATTERNS.some((rx) => rx.test(cmdline))) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);

    // Signal: TERM, vänta 5s, KILL om fortfarande vid liv.
    try {
      process.kill(pid, 'SIGTERM');
      appendChainOverview({ event: 'pre-kill-sigterm', pid, cmdline });
      await new Promise((r) => setTimeout(r, 5_000));
      try {
        process.kill(pid, 0); // kollar om processen lever
        process.kill(pid, 'SIGKILL');
        appendChainOverview({ event: 'pre-kill-sigkill', pid, cmdline });
      } catch {
        // Redan död efter SIGTERM — bra.
      }
      killed.push(pid);
    } catch (err) {
      console.error(`[ingestion-cron] pre-kill: kunde inte döda pid ${pid}:`, err instanceof Error ? err.message : err);
    }
  }

  return killed;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const status: StatusFile = {
    running: true,
    pid: process.pid,
    startedAt,
    finishedAt: null,
    exitCode: null,
    durationMs: null,
    lastHeartbeatAt: startedAt,
    steps: [],
    totalEventsExtracted: 0,
    lastError: null,
  };
  writeStatus(status);

  console.log(`[ingestion-cron] ═══ START ═══ pid=${process.pid} startedAt=${startedAt}`);
  console.log(`[ingestion-cron] limit=${limit}, skipImages=${skipImages}`);

  // 2026-10-18 — pre-discovery kill-check. Innan step-loopen startar: döda
  // levande discovery/ingest-processer från en tidigare hängd körning.
  // tribe-events hängde 2026-10-16–18 i ~76h eftersom cron överlevde watchdog
  // och startade tribe på nytt vid varje launchd-restart. Om vi inte städar
  // här kommer varje körning race:a mot samma zombie-processer.
  const killed = await killLivingDiscoveryProcesses();
  if (killed.length > 0) {
    console.log(`[ingestion-cron] pre-kill: dödade ${killed.length} levande discovery-process(er): ${killed.join(', ')}`);
  } else {
    console.log('[ingestion-cron] pre-kill: inga levande discovery-processer hittades');
  }
  appendChainOverview({ event: 'pre-kill', killedPids: killed, killedCount: killed.length });

  // 2026-10-18 — green-skip-gate. Om verify-eventpulse-discovery kördes nyligen
  // (<24h) och var grön: skriv en kort status-snapshot till chain-overview.log.
  // Skippa INTE cron-körningen (cron ÄR det vi vill köra), men använd
  // skip-filen som "senaste green"-signal för att låta underhålls-skippa
  // verifierings-skills när allt ser friskt ut.
  // 2026-10-21 — villkoret ändrat från `ageH < 24` till `ageH < 24 && skip.ok`.
  // Utan ok-villkoret kunde en röd fil ändå räknas som grön.
  const skipPath = path.join(RUNTIME_DIR, 'discovery-verification.status.json');
  if (existsSync(skipPath)) {
    try {
      const skip = JSON.parse(readFileSync(skipPath, 'utf8'));
      const lastGreenAt = skip?.lastGreenAt;
      if (lastGreenAt) {
        const ageH = (Date.now() - new Date(lastGreenAt).getTime()) / (1000 * 60 * 60);
        if (ageH < 24 && skip.ok) {
          console.log(`[ingestion-cron] green-skip: discovery verifierades grön för ${ageH.toFixed(1)}h sedan (run=${skip.runId}) — skippar verify-skill-körning`);
          appendChainOverview({ event: 'green-skip', lastGreenAt, ageHours: ageH, runId: skip.runId });
        } else if (!skip.ok) {
          console.log(`[ingestion-cron] green-skip: senaste verify är RÖD (exit=${skip.exitCode ?? '?'}, misslyckade steg: ${(skip.failedSteps ?? []).join(', ') || 'okänt'}) — verify-skill körs separat`);
        } else {
          console.log(`[ingestion-cron] green-skip: senaste verify är ${ageH.toFixed(1)}h gammal — verify-skill körs separat`);
        }
      }
    } catch {
      // Korrupt fil — ignorera.
    }
  }

  let totalExit = 0;
  let totalEvents = 0;
  const stepResults: StepRecord[] = [];

  // 2026-10-24 — `--only` filter. Okänt stegnamn är ett fel, inte en tyst
  // "inget att göra" — annars kan en typo få verifieringen att se grön ut.
  let selectedSteps = steps;
  if (onlyStepIds.length > 0) {
    const known = new Set(steps.map((s) => s.name));
    const unknown = onlyStepIds.filter((id) => !known.has(id));
    if (unknown.length) {
      console.error(
        `[ingestion-cron] --only: okända steg ${unknown.join(', ')}. ` +
        `Kända steg: ${[...known].join(', ')}`,
      );
      process.exit(2);
    }
    selectedSteps = steps.filter((s) => onlyStepIds.includes(s.name));
    console.log(`[ingestion-cron] --only: kör ${selectedSteps.length}/${steps.length} steg: ${selectedSteps.map((s) => s.name).join(', ')}`);
  }

  for (const step of selectedSteps) {
    const stepStartedAt = new Date().toISOString();
    const result = await runStep(step.name, step.cmd, step.args);
    const stepFinishedAt = new Date().toISOString();

    stepResults.push({
      name: step.name,
      startedAt: stepStartedAt,
      finishedAt: stepFinishedAt,
      exitCode: result.exitCode,
      sourcesProcessed: result.sourcesProcessed,
      eventsExtracted: result.eventsExtracted,
    });

    // Endast mätbara steg summeras — null betyder "vet inte", inte noll.
    if (result.eventsExtracted !== null) totalEvents += result.eventsExtracted;
    if (result.exitCode !== 0) totalExit = result.exitCode;

    // Uppdatera status under körning så dashboard ser steg-för-steg
    status.steps = [...stepResults];
    status.totalEventsExtracted = totalEvents;
    writeStatus(status);
  }

  const finishedAt = new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  status.running = false;
  status.finishedAt = finishedAt;
  status.exitCode = totalExit;
  status.durationMs = durationMs;
  status.totalEventsExtracted = totalEvents;
  if (totalExit !== 0) status.lastError = `Step(s) failed with exit code ${totalExit}`;
  writeStatus(status);

  // 2026-10-18 — green-skip-signal. När cron-körningen är grön (totalExit=0),
  // uppdatera runtime/discovery-verification.status.json så framtida
  // verify-skill-körningar kan skippa sig själva <24h efter en grön körning.
  // 2026-10-21 — else-gren tillagd. Utan den skrevs ingenting vid fel, så
  // lastGreenAt blev stale från en gammal lyckad körning och filen lästes som
  // "ok" i all evighet. Läs-gate:t ovan (ageH < 24 && skip.ok) självkorrigerar
  // så snart rätt ok-värde finns — ingen ändring av gate-logiken behövs.
  const skipFile = path.join(RUNTIME_DIR, 'discovery-verification.status.json');
  const runId = status.pid
    ? `cron-${status.pid}-${new Date(finishedAt).getTime()}`
    : `cron-${new Date(finishedAt).getTime()}`;
  try {
    if (totalExit === 0) {
      writeFileSync(skipFile, JSON.stringify({
        ok: true,
        lastGreenAt: finishedAt,
        lastRunAt: finishedAt,
        runId,
        totalEventsExtracted: totalEvents,
        durationMs,
      }, null, 2), 'utf8');
      console.log(`[ingestion-cron] green-skip: skrev grön ${path.relative(PROJECT_ROOT, skipFile)}`);
    } else {
      // Behåll en eventuell tidigare lastGreenAt — den är historiskt sann och
      // gate:t ska kunna se hur länge senast grönt var.
      let previousGreen: string | null = null;
      try {
        const prev = JSON.parse(readFileSync(skipFile, 'utf8'));
        previousGreen = typeof prev?.lastGreenAt === 'string' ? prev.lastGreenAt : null;
      } catch { /* fil saknas eller är korrupt — inget att bevara */ }

      const failedSteps = stepResults.filter((s) => s.exitCode !== 0).map((s) => s.name);
      writeFileSync(skipFile, JSON.stringify({
        ok: false,
        lastGreenAt: previousGreen,
        lastRunAt: finishedAt,
        runId,
        exitCode: totalExit,
        failedSteps,
        totalEventsExtracted: totalEvents,
        durationMs,
      }, null, 2), 'utf8');
      console.error(
        `[ingestion-cron] green-skip: skrev RÖD ${path.relative(PROJECT_ROOT, skipFile)} ` +
        `— exit=${totalExit}, misslyckade steg: ${failedSteps.join(', ') || 'okänt'}`,
      );
    }
  } catch (err) {
    console.error('[ingestion-cron] green-skip: kunde inte skriva skip-fil:', err instanceof Error ? err.message : err);
  }

  console.log(`[ingestion-cron] ═══ DONE ═══ exit=${totalExit} events=${totalEvents} duration=${durationMs}ms`);
  process.exit(totalExit);
}

// Kör bara main() när filen startas direkt — inte vid import (parse-checks,
// hooks, tester). Mönster från 09-ScrapingSupervisor/runDaily.ts:231 — förhindrar
// att npx tsx -e "import('./scripts/ingestion-cron.ts')" råkar starta en riktig
// nattkörning.
const _invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (_invokedDirectly && !process.env.VITEST) {
  main().catch((err) => {
    const status = readStatus();
    status.running = false;
    status.finishedAt = new Date().toISOString();
    status.exitCode = 1;
    status.lastError = err.message ?? String(err);
    writeStatus(status);
    console.error('[ingestion-cron] FATAL:', err);
    process.exit(1);
  });
}
