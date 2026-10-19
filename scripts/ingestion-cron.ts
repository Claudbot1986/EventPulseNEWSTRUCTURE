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
 *
 * Säkerhetsnot: rör INTE runA.ts interface, dedup-hash, IGNORE_PATTERNS
 * eller scoring-vikter. Detta är ett orchestrator-lager ovanpå befintlig kod.
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

interface StatusFile {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  /** ISO-tid för senaste writeStatus — används av dashboarden som "alive"-signal. */
  lastHeartbeatAt: string | null;
  steps: Array<{ name: string; startedAt: string; finishedAt: string; exitCode: number; sourcesProcessed: number; eventsExtracted: number }>;
  totalEventsExtracted: number;
  lastError: string | null;
}

interface StepResult {
  name: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  sourcesProcessed: number;
  eventsExtracted: number;
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
const skipPatternPromote = args.includes('--skip-pattern-promote');
const skipManualReviewTriage = args.includes('--skip-manual-triage');
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
 *   - pattern-promoter / manual-review-triage: --limit 5
 *   - D-renderGate: --behavior static-only (istället för premium-only) för att
 *     undvika Scrapingbee-credits i smoke
 */
const effectiveLimit = smoke ? 1 : limit;
const effectiveDBehavior = smoke ? 'static-only' : 'premium-only';

// ─── Step runner ────────────────────────────────────────────────────────────

interface SpawnResult {
  exitCode: number;
  sourcesProcessed: number;
  eventsExtracted: number;
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
    let sourcesProcessed = 0;
    let eventsExtracted = 0;

    // Tee: varje chunk från child skrivs både till parent stdout/stderr OCH
    // till step-loggen. Håll koll på ordning så vi inte tappar rader vid ras.
    proc.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      try { writeSync(stepOutFd, chunk); } catch {}
    });
    proc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      try { writeSync(stepErrFd, chunk); } catch {}
    });

    proc.on('exit', (code) => {
      clearInterval(heartbeat);
      const finishedAt = new Date().toISOString();
      const exitCode = code ?? 1;
      const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
      try {
        writeSync(stepOutFd, `─── ${name} finished ${finishedAt} exit=${exitCode} duration=${durationMs}ms\n`);
        writeSync(stepErrFd, `─── ${name} finished ${finishedAt} exit=${exitCode} duration=${durationMs}ms\n`);
        closeSync(stepOutFd);
        closeSync(stepErrFd);
      } catch {}
      appendChainOverview({ event: 'step-end', step: name, exitCode, durationMs });
      console.log(`[ingestion-cron] ✓ ${name}: exit=${exitCode} duration=${durationMs}ms log=${path.relative(PROJECT_ROOT, stepLogPath)}`);
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

  // ── P1B: Triagera toolScB-rester → D-gate istället för manual-review ──
  // (toolScB-routingen är inbakad i C-gate routeResult(); detta steg tömmer
  // manuellt kvarvarande legacy-rutor via pattern-promoter --dry-run.)
  ...((!skipManualReviewTriage) ? [{
    name: 'manual-review-triage',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/C-htmlGate/runC-pattern-promoter.ts', '--dry-run', '--limit', smoke ? '5' : '20'],
  }] : []),

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

if (!skipPatternPromote) {
  // Pattern promoter: godkänn URL-mönster från C → C0/C2.
  steps.push({
    name: 'pattern-promoter',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/C-htmlGate/runC-pattern-promoter.ts', '--limit', smoke ? '5' : '20'],
  });
}

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
  const skipFile = path.join(RUNTIME_DIR, 'discovery-verification.status.json');
  if (existsSync(skipFile)) {
    try {
      const skip = JSON.parse(readFileSync(skipFile, 'utf8'));
      const lastGreenAt = skip?.lastGreenAt;
      if (lastGreenAt) {
        const ageH = (Date.now() - new Date(lastGreenAt).getTime()) / (1000 * 60 * 60);
        if (ageH < 24 && skip.ok) {
          console.log(`[ingestion-cron] green-skip: discovery verifierades grön för ${ageH.toFixed(1)}h sedan (run=${skip.runId}) — skippar verify-skill-körning`);
          appendChainOverview({ event: 'green-skip', lastGreenAt, ageHours: ageH, runId: skip.runId });
        } else {
          console.log(`[ingestion-cron] green-skip: senaste verify är ${ageH.toFixed(1)}h gammal eller inte grön — verify-skill körs separat`);
        }
      }
    } catch {
      // Korrupt fil — ignorera.
    }
  }

  let totalExit = 0;
  let totalEvents = 0;
  const stepResults: StepResult[] = [];

  for (const step of steps) {
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

    totalEvents += result.eventsExtracted;
    if (result.exitCode !== 0) totalExit = result.exitCode;

    // Uppdatera status under körning så dashboard ser steg-för-steg
    status.steps = stepResults;
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
  if (totalExit === 0) {
    const skipFile = path.join(RUNTIME_DIR, 'discovery-verification.status.json');
    try {
      writeFileSync(skipFile, JSON.stringify({
        ok: true,
        lastGreenAt: finishedAt,
        lastRunAt: finishedAt,
        runId: status.pid ? `cron-${status.pid}-${new Date(finishedAt).getTime()}` : `cron-${new Date(finishedAt).getTime()}`,
        totalEventsExtracted: totalEvents,
        durationMs,
      }, null, 2), 'utf8');
      console.log(`[ingestion-cron] green-skip: skrev ${path.relative(PROJECT_ROOT, skipFile)}`);
    } catch (err) {
      console.error('[ingestion-cron] green-skip: kunde inte skriva skip-fil:', err instanceof Error ? err.message : err);
    }
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
