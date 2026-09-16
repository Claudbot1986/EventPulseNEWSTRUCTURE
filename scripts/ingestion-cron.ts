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

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const STATUS_FILE = path.resolve(RUNTIME_DIR, 'ingestion-cron.status.json');

// ─── Types ─────────────────────────────────────────────────────────────────

interface StatusFile {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
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
      steps: [],
      totalEventsExtracted: 0,
      lastError: null,
    };
  }
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as StatusFile;
  } catch {
    return {
      running: false, pid: null, startedAt: null, finishedAt: null, exitCode: null,
      durationMs: null, steps: [], totalEventsExtracted: 0, lastError: null,
    };
  }
}

function writeStatus(s: StatusFile): void {
  writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
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
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50;
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

    const proc = spawn(cmd, args, { cwd: PROJECT_ROOT, stdio: 'inherit' });
    let sourcesProcessed = 0;
    let eventsExtracted = 0;

    // Buffra stdout i en kort array för att kunna parsa "X events"-rader
    // (för status-sammanfattning). Vi loggar också direkt via stdio:inherit.

    proc.on('exit', (code) => {
      const finishedAt = new Date().toISOString();
      const exitCode = code ?? 1;
      console.log(`[ingestion-cron] ✓ ${name}: exit=${exitCode}`);
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
  {
    name: 'C-htmlGate',
    cmd: 'npx',
    args: ['tsx', '02-Ingestion/C-htmlGate/run-dynamic-pool.ts', '--workers', '5', '--max-rounds', smoke ? '5' : '50'],
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
    steps: [],
    totalEventsExtracted: 0,
    lastError: null,
  };
  writeStatus(status);

  console.log(`[ingestion-cron] ═══ START ═══ pid=${process.pid} startedAt=${startedAt}`);
  console.log(`[ingestion-cron] limit=${limit}, skipImages=${skipImages}`);

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

  console.log(`[ingestion-cron] ═══ DONE ═══ exit=${totalExit} events=${totalEvents} duration=${durationMs}ms`);
  process.exit(totalExit);
}

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
