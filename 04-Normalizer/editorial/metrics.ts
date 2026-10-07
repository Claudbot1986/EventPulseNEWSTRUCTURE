/**
 * metrics.ts — mätvärden för Editorial Engine.
 *
 * P7-12/15. Loggar pipeline-resultat till runtime/editorial-metrics.jsonl
 * för analys + before/after-jämförelser.
 *
 * Format: en JSONL-rad per pipeline-körning med:
 *   ts, event_id, status, info_level, attempts, word_count, model,
 *   factuality_pass, independence_pass, unsupported_claims_count, matched_phrases_count
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { EditorialPipelineResult } from './types';

const METRICS_DIR = path.resolve(process.cwd(), 'runtime');
const METRICS_FILE = path.resolve(METRICS_DIR, 'editorial-metrics.jsonl');

function ensureDir(): void {
  if (!existsSync(METRICS_DIR)) {
    mkdirSync(METRICS_DIR, { recursive: true });
  }
}

export interface EditorialMetricRecord {
  ts: string;
  event_id: string | null;
  status: EditorialPipelineResult['status'];
  info_level: 'RICH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' | null;
  attempts: number;
  word_count: number;
  model: string;
  factuality_pass: boolean | null;
  independence_pass: boolean | null;
  unsupported_claims_count: number;
  matched_phrases_count: number;
  /** Frivillig källa för analys. */
  source?: string | null;
  /** Frivillig kategori för analys. */
  category_slug?: string | null;
}

export function recordEditorialMetric(
  eventId: string | null,
  result: EditorialPipelineResult,
  extras: { source?: string | null; category_slug?: string | null } = {},
): void {
  try {
    ensureDir();
    const record: EditorialMetricRecord = {
      ts: new Date().toISOString(),
      event_id: eventId,
      status: result.status,
      info_level: result.draft?.info_level ?? null,
      attempts: result.attempts,
      word_count: result.draft?.word_count ?? 0,
      model: result.draft?.meta.model ?? 'unknown',
      factuality_pass: result.factuality?.pass ?? null,
      independence_pass: result.independence?.pass ?? null,
      unsupported_claims_count: result.factuality?.unsupported_claims.length ?? 0,
      matched_phrases_count: result.independence?.matched_phrases.length ?? 0,
      source: extras.source ?? null,
      category_slug: extras.category_slug ?? null,
    };
    appendFileSync(METRICS_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // Non-critical — metrics får INTE krascha pipelinen.
    if (process.env.DEBUG) {
      console.warn('[editorial-metrics] write failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

export const EDITORIAL_METRICS_PATH = METRICS_FILE;