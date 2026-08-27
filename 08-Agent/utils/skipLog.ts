/**
 * 08-Agent/utils/skipLog.ts
 *
 * Append-only NDJSON-logg för "skippade" AI-bild-events.
 *
 * Bakgrund: 2026-08-26 upptäcktes att AI-bild-pipelinen genererade bilder
 * även för förflutna events (1 466 av 2 257 = 65% waste, ~$36,65 onödigt).
 * För att undvika regression och kunna audita framtida filter-beteende
 * loggar vi varje skip-punkt (normalizer, worker, backfill) persistent
 * till en ndjson-fil per UTC-dag.
 *
 * Layout:
 *   runtime/ingestion/ai-image-skip/{stage}/YYYY-MM-DD.ndjson
 *
 * där `stage` är en av 'normalizer' | 'worker' | 'backfill'.
 *
 * Varför ndjson istället för DB-tabell: slipper migration + slipper query-load
 * på events-tabellen. ndjson är trivialt att greppa / jq:a / aggregera i
 * valfritt analytics-jobb senare.
 *
 * Best-effort logging: vi accepterar att concurrency-skydd saknas (volymen
 * är liten, ~50–500 rader/dag baserat på ingest-takt).
 */

import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const LOG_ROOT = resolve(process.cwd(), 'runtime/ingestion/ai-image-skip');

export type SkipStage = 'normalizer' | 'worker' | 'backfill';

/**
 * `included_past` används endast av backfill `--include-past`-läge för
 * att audit-logga EVENTS SOM VI MEDVETEN INKLUDERAR (escape hatch).
 * Resterande reasons är negativa skips (vi valde att INTE göra BFL-anrop).
 */
export type SkipReason = 'past' | 'missing_start_time' | 'included_past';

export interface SkipRecord {
  event_id: string;
  source?: string | null;
  start_time?: string | null;
  skip_reason: SkipReason;
  /** valfria extra fält (t.ex. ingested_at, dedup_hash, dry_run-flagga) */
  [k: string]: unknown;
}

/**
 * Append:a en ndjson-rad till `<LOG_ROOT>/<stage>/<UTC-datum>.ndjson`.
 * Skapar stage-mappen rekursivt vid首次 skrivning.
 *
 * Kastar INTE — vi vill inte krascha ingestion om filsystemet är fullt.
 * Loggar till stderr istället.
 */
export function appendSkipLog(stage: SkipStage, record: SkipRecord): void {
  try {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const dir = resolve(LOG_ROOT, stage);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
    appendFileSync(resolve(dir, `${date}.ndjson`), line, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[skipLog] failed to append ${stage} skip-log: ${msg}`);
  }
}