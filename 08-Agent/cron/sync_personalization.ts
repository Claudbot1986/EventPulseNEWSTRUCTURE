/**
 * 08-Agent/cron/sync_personalization — Phase 2 personalization materialization (T0075).
 *
 * Every 6 hours, walks all "warm" users (anyone with at least one
 * `save`/`feedback_positive` interaction) and calls `recomputeUserPreferences`
 * to compute decay-weighted category posteriors + Laplace smoothing, then
 * upserts the result into `user_signal_weights`.
 *
 * Why a separate cron (not inline in server.ts):
 *   - Same reasoning as reminders.ts / follow_drops.ts: clock-driven
 *     background work has nothing to do with request-driven server
 *     lifecycle. Decoupling keeps the server lean and the cron
 *     independently deployable.
 *   - Idempotent via PK upsert + stale-key DELETE — concurrent cron
 *     invocations (e.g. two launchd agents) are safe.
 *
 * Run:
 *   npx tsx 08-Agent/cron/sync_personalization.ts            # run once, exit
 *   npx tsx 08-Agent/cron/sync_personalization.ts --loop     # run every 6 hours
 *
 * Output: a single stdout line per run, machine-parseable so the supervisor
 * log can graph "users scanned / weights written / stale deleted / errors".
 *
 *   [sync_personalization-cron] 2026-08-22T00:00:00.000Z users=42 written=87 stale=14 errors=0
 *
 * No console.log inside the inner loop — only the final summary line.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  recomputeUserPreferences,
  type RecomputeResult,
} from '../tools/personalize';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default loop interval — 6 hours per the T0075 task brief. */
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Per-invocation time budget (ms). If a single pass takes longer than this,
 *  the run is aborted and counted as a soft failure. */
export const DEFAULT_RUN_BUDGET_MS = 30 * 60 * 1000;

/** Page size when scanning users. Each user costs two queries (interactions
 *  + upsert). Keep modest. */
export const USER_SCAN_PAGE = 500;

export interface CronRunOptions {
  /** Override the Supabase client (used by tests). */
  supabase?: SupabaseClient;
  /** Override "now" — used by tests for deterministic replay. */
  now?: Date;
  /** Hard upper bound on how long the whole run may take. */
  budgetMs?: number;
  /** Maximum users to process in this run. Useful for staged rollouts. */
  maxUsers?: number;
  /** Override the time provider for the budget check. Defaults to Date.now. */
  timeProvider?: () => number;
  /** Override the inner `recomputeUserPreferences` — used by tests to stub
   *  the per-user math without a DB. */
  recompute?: typeof recomputeUserPreferences;
}

export interface CronRunSummary {
  ok: boolean;
  started_at: string;
  duration_ms: number;
  users_scanned: number;
  users_with_weights: number;
  weights_written: number;
  stale_deleted: number;
  errors: number;
  warning?: string;
}

/** Walk `user_interactions` and pull every distinct client_user_id that has
 *  at least one `save` (or `feedback_positive`) interaction — i.e. the
 *  "warm" users worth recomputing weights for. Cold users with only
 *  impressions / clicks / dismisses contribute nothing to category
 *  posteriors and we skip them to keep the cron fast.
 *
 *  We use the index `idx_user_interactions_user_time` so the scan is
 *  bounded by the number of users who actually saved something — not by
 *  total interaction rows. */
export async function pickWarmUsersWithSaves(
  supabase: SupabaseClient,
  opts: { maxUsers?: number } = {}
): Promise<{ ok: boolean; userIds: string[]; warning?: string }> {
  const max = opts.maxUsers ?? USER_SCAN_PAGE * 4;
  // PostgREST distinct via `.select('client_user_id')` and de-dup client-side.
  // The index on (client_user_id, created_at DESC) makes this cheap.
  const result = await supabase
    .from('user_interactions')
    .select('client_user_id')
    .in('interaction', ['save', 'feedback_positive'])
    .limit(max * 2); // over-fetch so distinct() leaves us enough rows
  if (result.error) {
    return { ok: false, userIds: [], warning: `user scan failed: ${result.error.message}` };
  }
  const seen = new Set<string>();
  for (const row of (result.data ?? []) as Array<{ client_user_id: string | null }>) {
    if (typeof row.client_user_id === 'string' && UUID_RE.test(row.client_user_id)) {
      seen.add(row.client_user_id);
      if (seen.size >= max) break;
    }
  }
  return { ok: true, userIds: [...seen] };
}

/** Format a CronRunSummary as a single line. Stable shape so the supervisor
 *  can graph metrics over time. */
export function summarize(summary: CronRunSummary): string {
  const base =
    `[sync_personalization-cron] ${summary.started_at} ` +
    `users=${summary.users_scanned} ` +
    `with_weights=${summary.users_with_weights} ` +
    `written=${summary.weights_written} ` +
    `stale=${summary.stale_deleted} ` +
    `errors=${summary.errors} ` +
    `duration_ms=${summary.duration_ms}`;
  return summary.warning ? `${base} warning="${summary.warning}"` : base;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

let cachedClient: SupabaseClient | null = null;
function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  cachedClient = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
  return cachedClient;
}

/** Public entry point: do a single pass. Never throws. */
export async function runPersonalizationPass(
  opts: CronRunOptions = {}
): Promise<CronRunSummary> {
  const startedAt = opts.now ?? new Date();
  const t0 = startedAt.getTime();
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const supabase = opts.supabase ?? getSupabaseClient();
  const timeProvider = opts.timeProvider ?? (() => Date.now());
  const recompute = opts.recompute ?? recomputeUserPreferences;

  const summary: CronRunSummary = {
    ok: true,
    started_at: startedAt.toISOString(),
    duration_ms: 0,
    users_scanned: 0,
    users_with_weights: 0,
    weights_written: 0,
    stale_deleted: 0,
    errors: 0,
  };

  const scan = await pickWarmUsersWithSaves(supabase, {
    maxUsers: opts.maxUsers,
  });
  if (!scan.ok) {
    summary.ok = false;
    summary.warning = scan.warning;
    summary.duration_ms = timeProvider() - t0;
    return summary;
  }
  summary.users_scanned = scan.userIds.length;

  for (const userId of scan.userIds) {
    if (timeProvider() - t0 > budgetMs) {
      summary.warning = `budget exceeded after ${summary.users_scanned - summary.errors} users`;
      summary.ok = false;
      break;
    }
    try {
      const result: RecomputeResult = await recompute(supabase, userId, { now: startedAt });
      if (!result.ok) {
        summary.errors += 1;
        continue;
      }
      summary.weights_written += result.weightsWritten;
      summary.stale_deleted += result.staleDeleted;
      if (result.weightsWritten > 0) summary.users_with_weights += 1;
    } catch (err: unknown) {
      // Defensive: per CLAUDE.md, this path must never throw into the
      // scheduler. A single bad user must not poison the whole pass.
      summary.errors += 1;
    }
  }

  summary.duration_ms = timeProvider() - t0;
  return summary;
}

/** Sleep helper that respects an abort signal. Used by the --loop mode. */
function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
    // Poll at 1s granularity so SIGINT can interrupt within a second.
    const poll = setInterval(() => {
      if (signal.aborted) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    }, 1000);
    const orig = resolve;
    resolve = () => {
      clearInterval(poll);
      orig();
    };
  });
}

/** Top-level --loop runner. Runs one pass immediately, then every
 *  `intervalMs` until SIGINT. */
export async function runForever(opts: CronRunOptions & { intervalMs?: number } = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const signal = { aborted: false };
  process.once('SIGINT', () => { signal.aborted = true; });
  process.once('SIGTERM', () => { signal.aborted = true; });
  while (!signal.aborted) {
    const summary = await runPersonalizationPass(opts);
    // Single line per pass — supervisor-friendly.
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
    if (signal.aborted) break;
    await sleep(intervalMs, signal);
  }
}

if (process.argv[1] && /sync_personalization\.ts$/.test(process.argv[1])) {
  const loop = process.argv.includes('--loop');
  const fn = loop ? runForever : async () => {
    const summary = await runPersonalizationPass();
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
  };
  fn().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[sync_personalization-cron] fatal: ${msg}`);
    process.exitCode = 1;
  });
}