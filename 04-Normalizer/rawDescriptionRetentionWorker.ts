/**
 * Raw Description Retention Worker — T0201 (2026-10-05).
 *
 * Nattlig worker som rensar `raw_description` från events där
 * `raw_description_captured_at` är äldre än retention-gränsen (default 30 dagar).
 *
 * Säkerhet: workern raderar BARA `raw_description` (och dess captured_at),
 *   inte andra fält. Om fältet inte finns på raden — no-op (säker att köra).
 *
 * Idempotens: körs flera gånger samma dag → inga extra händer raderade (de
 *   äldre än 30 dagar är redan raderade).
 *
 * Loggning: skriver antal raderade events till runtime/raw-description-retention.jsonl.
 *
 * Körs manuellt eller via launchd-jobb:
 *   tsx 04-Normalizer/rawDescriptionRetentionWorker.ts --dry-run
 *   tsx 04-Normalizer/rawDescriptionRetentionWorker.ts --apply
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { retentionCutoff } from './rawDescriptionRetention';

// ─── Env loading ────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // .env optional
  }
}

// ─── Main worker ────────────────────────────────────────────────────────────

export interface RetentionWorkerResult {
  mode: 'dry-run' | 'apply';
  cutoff: string;
  selectedCount: number;
  deletedCount: number;
  startedAt: string;
  finishedAt: string;
}

export async function runRetentionWorker(
  supabaseUrl: string,
  supabaseKey: string,
  opts: { mode: 'dry-run' | 'apply'; retentionDays?: number; limit?: number } = { mode: 'dry-run' }
): Promise<RetentionWorkerResult> {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cutoff = retentionCutoff(new Date(), opts.retentionDays ?? 30);
  const limit = opts.limit ?? 1000;

  const startedAt = new Date().toISOString();

  // 1. Välj kandidater
  const { data: candidates, error: selectErr } = await supabase
    .from('events')
    .select('id, raw_description_captured_at')
    .not('raw_description', 'is', null)
    .lt('raw_description_captured_at', cutoff.toISOString())
    .limit(limit);

  if (selectErr) {
    throw new Error(`Retention worker select failed: ${selectErr.message}`);
  }

  const selectedCount = candidates?.length ?? 0;

  if (opts.mode === 'dry-run' || selectedCount === 0) {
    return {
      mode: opts.mode,
      cutoff: cutoff.toISOString(),
      selectedCount,
      deletedCount: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  // 2. Radera raw_description + captured_at för varje event
  // Vi gör per-ID UPDATE för att inte krocka med andra fält och för att
  // ha tydlig audit per rad.
  let deletedCount = 0;
  for (const row of candidates ?? []) {
    const { error: updateErr } = await supabase
      .from('events')
      .update({ raw_description: null, raw_description_captured_at: null })
      .eq('id', row.id);

    if (updateErr) {
      console.error(`[retention] Failed to clear raw_description for ${row.id}: ${updateErr.message}`);
    } else {
      deletedCount++;
    }
  }

  return {
    mode: opts.mode,
    cutoff: cutoff.toISOString(),
    selectedCount,
    deletedCount,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

// ─── CLI entry ──────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  const mode: 'dry-run' | 'apply' = apply ? 'apply' : 'dry-run';

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[retention] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i .env');
    process.exit(1);
  }

  runRetentionWorker(supabaseUrl, supabaseKey, { mode })
    .then((result) => {
      console.log('[retention]', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[retention] worker failed:', err.message);
      process.exit(2);
    });
}