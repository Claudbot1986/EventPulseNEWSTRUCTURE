/**
 * runRecorder.ts — append-only logg av en ingestion-batch/cykel.
 *
 * En rad per batch (inte per källa, inte per gate) skrivs till
 * `runtime/ingestion_runs.jsonl` (gitignorerad, ingen Supabase).
 *
 * Tap-points: Alltools-E2E/e2e.py, 09-ScrapingSupervisor/runDaily.ts,
 * 02-Ingestion/scheduler.ts. Fångar och loggar fel, kastar aldrig —
 * loggning får aldrig krascha en körning.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export type IngestionRunTrigger = 'e2e' | 'daily' | 'scheduler' | 'manual';

export interface IngestionRunStage {
  stage: 'A' | 'B' | 'C' | 'D';
  ok: boolean;
  durationMs: number;
  itemsOut: number;
}

export interface IngestionRunEntry {
  runId: string;
  triggerSource: IngestionRunTrigger;
  startTs: string;
  endTs: string;
  durationMs: number;
  ok: boolean;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  totalEventsFound: number;
  totalEventsPersisted: number;
  stagesCompleted: IngestionRunStage[];
  errorSummary: string | null;
  pid: number;
  reportPath: string | null;
}

export const INGESTION_RUNS_LOG = path.join(PROJECT_ROOT, 'runtime', 'ingestion_runs.jsonl');

function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 6);
}

export function makeRunId(trigger: IngestionRunTrigger, when: Date = new Date()): string {
  const iso = when.toISOString().replace(/[^0-9TZ]/g, '');
  return `${trigger}-${iso}-${randomSuffix()}`;
}

/**
 * Skriv en batch-rad till runtime/ingestion_runs.jsonl.
 * Kastar ALDRIG — loggar fel till stderr så att loggning inte kraschar en körning.
 */
export function writeIngestionRunSummary(entry: IngestionRunEntry): void {
  try {
    const dir = path.dirname(INGESTION_RUNS_LOG);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(INGESTION_RUNS_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[runRecorder] failed to write ingestion run summary: ${msg}\n`);
  }
}

/**
 * Läs sista N raderna (default 50). Används av dashboardens /api/runs.
 * Robust mot korrupta rader (skippar dem), tom fil returnerar [].
 */
export function readRecentIngestionRuns(limit: number = 50): IngestionRunEntry[] {
  if (!existsSync(INGESTION_RUNS_LOG)) return [];
  let raw = '';
  try {
    raw = readFileSync(INGESTION_RUNS_LOG, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-limit);
  const out: IngestionRunEntry[] = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as IngestionRunEntry);
    } catch {
      /* hoppa över korrupta rader */
    }
  }
  out.sort((a, b) => (a.startTs < b.startTs ? 1 : -1));
  return out;
}
