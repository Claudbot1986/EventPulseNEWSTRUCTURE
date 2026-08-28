/**
 * 08-Agent/cron/follow_drops — periodic new-event notifications for followed venues.
 *
 * T0059 / MVP-gap §77: every ~30 minutes, walks all users who follow at least
 * one venue and asks `generateFollowDropsForUser` to materialize any new
 * follow_drop notifications for events from those venues that were first-seen
 * in the recent window (default 30 min).
 *
 * Why a separate cron job (not inline in server.ts):
 *   - Same reasoning as reminders.ts: clock-driven background work has nothing
 *     to do with request-driven server lifecycle. Decoupling keeps the server
 *     lean and the cron independently deployable.
 *   - Idempotent via deterministic notification ids (FNV-1a), so concurrent
 *     cron instances (e.g. two launchd agents) are safe.
 *
 * Run:
 *   npx tsx 08-Agent/cron/follow_drops.ts            # run once, exit
 *   npx tsx 08-Agent/cron/follow_drops.ts --loop     # run every 30 minutes
 *
 * Output: a single stdout line per run, machine-parseable so the supervisor
 * log can graph "users scanned / notifications inserted / skipped / errors".
 *
 *   [follow_drops-cron] 2026-08-22T00:00:00.000Z users=12 inserted=3 skipped=9 errors=0
 *
 * No console.log inside the inner loop — only the final summary line.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  generateFollowDropsForUser,
  FOLLOW_DROP_WINDOW_MS,
  type GenerateFollowDropsResult,
} from '../tools/follow_drops';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default loop interval — 30 minutes per the T0059 task brief. */
export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/** Per-invocation time budget (ms). If a single pass takes longer than this,
 *  the run is aborted and counted as a soft failure. */
export const DEFAULT_RUN_BUDGET_MS = 10 * 60 * 1000;

/** Page size when scanning users. Each user costs one query to load their
 *  followed venues + one to find events. Keep modest. */
export const USER_SCAN_PAGE = 500;

export interface CronRunOptions {
  /** Override the Supabase client (used by tests). */
  supabase?: SupabaseClient;
  /** Override "now" — used by tests for deterministic replay. */
  now?: Date;
  /** Override the freshness window — defaults to FOLLOW_DROP_WINDOW_MS. */
  windowMs?: number;
  /** Hard upper bound on how long the whole run may take. */
  budgetMs?: number;
  /** Maximum users to process in this run. Useful for staged rollouts. */
  maxUsers?: number;
  /** Override the time provider for the budget check. Defaults to Date.now. */
  timeProvider?: () => number;
}

export interface CronRunSummary {
  ok: boolean;
  started_at: string;
  duration_ms: number;
  users_scanned: number;
  users_with_drops: number;
  inserted: number;
  skipped: number;
  errors: number;
  warning?: string;
}

/** Scan user_preferences for any user who has at least one followed venue.
 *  We scan the entire table rather than user_interactions (unlike reminders)
 *  because a user who follows venues but never saved anything is still
 *  eligible for follow_drop notifications. */
export async function pickUsersWithFollowedVenues(
  supabase: SupabaseClient,
  opts: { maxUsers?: number } = {}
): Promise<{ ok: boolean; userIds: string[]; warning?: string }> {
  const max = opts.maxUsers ?? USER_SCAN_PAGE * 4;

  const result = await supabase
    .from('user_preferences')
    .select('client_user_id, preferences')
    .limit(max);

  if (result.error) {
    return { ok: false, userIds: [], warning: `user scan failed: ${result.error.message}` };
  }

  const seen: string[] = [];
  for (const row of (result.data ?? []) as Array<{
    client_user_id: string | null;
    preferences: unknown | null;
  }>) {
    if (typeof row.client_user_id !== 'string') continue;
    if (!UUID_RE.test(row.client_user_id)) continue;
    const prefs = row.preferences as { followed_venue_ids?: unknown } | null;
    if (!prefs || !Array.isArray(prefs.followed_venue_ids) || prefs.followed_venue_ids.length === 0) {
      continue;
    }
    seen.push(row.client_user_id);
    if (seen.length >= max) break;
  }

  return { ok: true, userIds: seen };
}

/** Format a CronRunSummary as a single line. */
export function summarize(summary: CronRunSummary): string {
  const base =
    `[follow_drops-cron] ${summary.started_at} ` +
    `users=${summary.users_scanned} ` +
    `with_drops=${summary.users_with_drops} ` +
    `inserted=${summary.inserted} ` +
    `skipped=${summary.skipped} ` +
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
export async function runFollowDropsPass(
  opts: CronRunOptions = {}
): Promise<CronRunSummary> {
  const startedAt = opts.now ?? new Date();
  const t0 = startedAt.getTime();
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const windowMs = opts.windowMs ?? FOLLOW_DROP_WINDOW_MS;
  const supabase = opts.supabase ?? getSupabaseClient();
  const timeProvider = opts.timeProvider ?? (() => Date.now());

  const summary: CronRunSummary = {
    ok: true,
    started_at: startedAt.toISOString(),
    duration_ms: 0,
    users_scanned: 0,
    users_with_drops: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  const scan = await pickUsersWithFollowedVenues(supabase, {
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
      const result: GenerateFollowDropsResult = await generateFollowDropsForUser(supabase, {
        client_user_id: userId,
        now: startedAt,
        windowMs,
      });
      if (!result.ok) {
        summary.errors += 1;
        continue;
      }
      summary.inserted += result.inserted;
      summary.skipped += result.skipped;
      if (result.inserted > 0) summary.users_with_drops += 1;
    } catch (err: unknown) {
      summary.errors += 1;
    }
  }

  summary.duration_ms = timeProvider() - t0;
  return summary;
}

/** Sleep helper that respects an abort signal. */
function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
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

/** Top-level --loop runner. */
export async function runForever(opts: CronRunOptions & { intervalMs?: number } = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const signal = { aborted: false };
  process.once('SIGINT', () => { signal.aborted = true; });
  process.once('SIGTERM', () => { signal.aborted = true; });
  while (!signal.aborted) {
    const summary = await runFollowDropsPass(opts);
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
    if (signal.aborted) break;
    await sleep(intervalMs, signal);
  }
}

if (process.argv[1] && /follow_drops\.ts$/.test(process.argv[1])) {
  const loop = process.argv.includes('--loop');
  const fn = loop ? runForever : async () => {
    const summary = await runFollowDropsPass();
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
  };
  fn().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[follow_drops-cron] fatal: ${msg}`);
    process.exitCode = 1;
  });
}
