/**
 * ingestionPipeline.ts — Daglig ingestion-pipeline
 *
 * Kör hela kedjan automatiskt:
 *   1.  runA.ts            — skrapa källor från preUI-queue
 *   1b. runB-parallel.ts   — JSON/JSON-LD feeds från preB-queue
 *   2.  runA-extract.ts    — extrahera events till extractedevents/
 *   3.  importToEventPulse — skicka events till BullMQ → Supabase
 *
 * Användning:
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts                # kör hela kedjan
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --skip-a       # hoppa över steg 1
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --skip-b       # hoppa över steg 1b
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --skip-extract # hoppa över steg 2
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --skip-import  # hoppa över steg 3
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --limit N      # max N sources
 *   npx tsx 09-ScrapingSupervisor/ingestionPipeline.ts --dry-run      # logga men kör ej
 *
 * Loggar till runtime/scraping-supervisor/pipeline-{ISO-date}.log
 * Skriver sammanfattning till runtime/scraping-supervisor/pipeline-summary.jsonl
 */

import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ── Paths ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname = .../09-ScrapingSupervisor, gå upp en nivå till project root
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env'), override: true });

const LOG_DIR = path.join(PROJECT_ROOT, 'runtime', 'scraping-supervisor');
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

const RUN_A_PATH = path.join(PROJECT_ROOT, '02-Ingestion/A-directAPI-networkGate/runA.ts');
const RUN_B_PATH = path.join(PROJECT_ROOT, '02-Ingestion/B-JSON-feedGate/runB-parallel.ts');
const RUN_A_EXTRACT_PATH = path.join(PROJECT_ROOT, '02-Ingestion/A-directAPI-networkGate/runA-extract.ts');
const IMPORT_PATH = path.join(PROJECT_ROOT, '03-Queue/importToEventPulse.ts');

const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per steg

// ── Logging ───────────────────────────────────────────────────────────────────

function getRunLogPath(): string {
  const isoDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `pipeline-${isoDate}.log`);
}

function log(line: string, fileLog?: string): void {
  const ts = new Date().toISOString();
  const msg = `${ts}  ${line}`;
  console.log(msg);
  if (fileLog) {
    fs.mkdirSync(path.dirname(fileLog), { recursive: true });
    fs.appendFileSync(fileLog, msg + '\n', 'utf8');
  }
}

// ── Step runner ───────────────────────────────────────────────────────────────

interface StepResult {
  step: string;
  exitCode: number;
  durationMs: number;
  skipped: boolean;
  stdoutTail: string;
  stderrTail: string;
}

function runStep(name: string, scriptPath: string, args: string[], fileLog: string): Promise<StepResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    log(`[step:${name}] start  ${path.relative(PROJECT_ROOT, scriptPath)} ${args.join(' ')}`, fileLog);

    const proc = spawn(TSX_BIN, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, EVENTPULSE_PROJECT_ROOT: PROJECT_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      stdoutBuf += s;
      // Trim buffer to last 50KB to prevent memory growth
      if (stdoutBuf.length > 50_000) stdoutBuf = stdoutBuf.slice(-50_000);
    });

    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      stderrBuf += s;
      if (stderrBuf.length > 50_000) stderrBuf = stderrBuf.slice(-50_000);
    });

    const timer = setTimeout(() => {
      log(`[step:${name}] TIMEOUT efter ${STEP_TIMEOUT_MS}ms — dödar process`, fileLog);
      proc.kill('SIGTERM');
    }, STEP_TIMEOUT_MS);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const exitCode = code ?? 1;

      // Logga sista 30 raderna av stdout för synlighet
      const stdoutTail = stdoutBuf.split('\n').filter(Boolean).slice(-30).join('\n');
      if (stdoutTail) {
        for (const line of stdoutTail.split('\n')) {
          log(`[step:${name}]   ${line}`, fileLog);
        }
      }

      log(`[step:${name}] exit code=${exitCode} duration=${durationMs}ms`, fileLog);
      resolve({ step: name, exitCode, durationMs, skipped: false, stdoutTail, stderrTail: stderrBuf });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      log(`[step:${name}] spawn error: ${err.message}`, fileLog);
      resolve({ step: name, exitCode: 1, durationMs: Date.now() - startedAt, skipped: false, stdoutTail: '', stderrTail: err.message });
    });
  });
}

// ── CLI ───────────────────────────────────────────────────────────────────────

interface CliOptions {
  skipA: boolean;
  skipB: boolean;
  skipExtract: boolean;
  skipImport: boolean;
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    skipA: argv.includes('--skip-a'),
    skipB: argv.includes('--skip-b'),
    skipExtract: argv.includes('--skip-extract'),
    skipImport: argv.includes('--skip-import'),
    dryRun: argv.includes('--dry-run'),
    limit: (() => {
      const idx = argv.indexOf('--limit');
      return idx !== -1 && argv[idx + 1] ? parseInt(argv[idx + 1], 10) : null;
    })(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const fileLog = getRunLogPath();

  log(`═══════════════════════════════════════════════════════════`, fileLog);
  log(`  EventPulse ingestionPipeline  │  ${opts.dryRun ? 'DRY-RUN' : 'LIVE'}`, fileLog);
  log(`═══════════════════════════════════════════════════════════`, fileLog);
  log(`  skip-a=${opts.skipA} skip-b=${opts.skipB} skip-extract=${opts.skipExtract} skip-import=${opts.skipImport} limit=${opts.limit ?? '∞'}`, fileLog);

  const startedAt = Date.now();
  const results: StepResult[] = [];

  // Steg 1: runA (scrape)
  if (opts.skipA) {
    log(`[step:runA] SKIPPED (--skip-a)`, fileLog);
    results.push({ step: 'runA', exitCode: 0, durationMs: 0, skipped: true, stdoutTail: '', stderrTail: '' });
  } else {
    const args = ['--workers', '20'];
    if (opts.dryRun) args.push('--dry');
    if (opts.limit !== null) args.push('--limit', String(opts.limit));
    results.push(await runStep('runA', RUN_A_PATH, args, fileLog));
  }

  // Steg 1b: runB (JSON feeds) — för källor som exponerar schema.org/JSON-LD feeds
  if (opts.skipB) {
    log(`[step:runB] SKIPPED (--skip-b)`, fileLog);
    results.push({ step: 'runB', exitCode: 0, durationMs: 0, skipped: true, stdoutTail: '', stderrTail: '' });
  } else {
    const args = ['--workers', '20'];
    if (opts.dryRun) args.push('--dry');
    if (opts.limit !== null) args.push('--limit', String(opts.limit));
    results.push(await runStep('runB', RUN_B_PATH, args, fileLog));
  }

  // Steg 2: runA-extract
  if (opts.skipExtract) {
    log(`[step:runA-extract] SKIPPED (--skip-extract)`, fileLog);
    results.push({ step: 'runA-extract', exitCode: 0, durationMs: 0, skipped: true, stdoutTail: '', stderrTail: '' });
  } else {
    const args: string[] = [];
    if (opts.dryRun) args.push('--dry');
    if (opts.limit !== null) args.push('--limit', String(opts.limit));
    results.push(await runStep('runA-extract', RUN_A_EXTRACT_PATH, args, fileLog));
  }

  // Steg 3: importToEventPulse
  if (opts.skipImport) {
    log(`[step:importToEventPulse] SKIPPED (--skip-import)`, fileLog);
    results.push({ step: 'importToEventPulse', exitCode: 0, durationMs: 0, skipped: true, stdoutTail: '', stderrTail: '' });
  } else {
    const args: string[] = [];
    if (opts.dryRun) args.push('--dry-run');
    // importToEventPulse tar ALLA källor om inget --source anges — bra för pipeline
    results.push(await runStep('importToEventPulse', IMPORT_PATH, args, fileLog));
  }

  // Sammanfattning
  const totalDurationMs = Date.now() - startedAt;
  const failed = results.filter((r) => !r.skipped && r.exitCode !== 0);

  log(`═══════════════════════════════════════════════════════════`, fileLog);
  log(`  KLAR  │  totalDuration=${totalDurationMs}ms`, fileLog);
  for (const r of results) {
    const status = r.skipped ? 'SKIPPED' : r.exitCode === 0 ? 'OK' : 'FAIL';
    log(`    ${r.step.padEnd(20)} ${status.padEnd(8)} ${r.durationMs}ms`, fileLog);
  }
  log(`═══════════════════════════════════════════════════════════\n`, fileLog);

  // Skriv summary-JSONL för supervisor att rapportera
  const summaryPath = path.join(LOG_DIR, 'pipeline-summary.jsonl');
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: totalDurationMs,
    dryRun: opts.dryRun,
    steps: results.map((r) => ({ step: r.step, exitCode: r.exitCode, durationMs: r.durationMs, skipped: r.skipped })),
    failedCount: failed.length,
  };
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.appendFileSync(summaryPath, JSON.stringify(summary) + '\n', 'utf8');

  return failed.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[pipeline] fatal:', err);
    process.exit(1);
  });
