/**
 * 08-Agent/cron/reminders — periodic reminder generator.
 *
 * T0048 / MVP-gap §77: every ~15 minutes, walks all active users and asks
 * `generateRemindersForUser` to materialize any new reminder notifications
 * for events starting in the next 2h.
 *
 * Why a separate cron job (not inline in server.ts):
 *   - The Express server is request-driven. Reminder generation has nothing
 *     to do with a request — it's a clock-driven background task. Mixing
 *     them couples liveness to request traffic, which is wrong.
 *   - Fly's `fly.toml` already runs a one-shot `release_command` for
 *     migrations. A long-lived cron job is best launched as a sibling
 *     process. See docs/DEPLOY.md §8 for the topology.
 *   - The job is idempotent (deterministic ids + upsert), so a duplicate
 *     invocation from a misbehaving scheduler is safe.
 *
 * Run:
 *   npx tsx 08-Agent/cron/reminders.ts            # run once, exit
 *   npx tsx 08-Agent/cron/reminders.ts --loop     # run every 15 minutes
 *
 * The `--loop` mode is the cron trigger. The non-loop mode is used by tests
 * and by `npx tsx 08-Agent/cron/reminders.ts` from launchd/systemd.
 *
 * Output: a single stdout line per run, machine-parseable so the supervisor
 * log can graph "users scanned / reminders inserted / errors" over time.
 *
 *   [reminders-cron] 2026-08-21T20:00:00.000Z users=42 inserted=3 skipped=89 errors=0
 *
 * No console.log inside the inner loop — only the final summary. Per
 * CLAUDE.md and the rules-of-the-repo, the cron keeps stdout clean.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateRemindersForUser, REMINDER_WINDOW_MS } from '../tools/notification_center';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default loop interval — 15 minutes per the task brief. */
export const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** Per-invocation time budget (ms). If a single reminder pass takes longer
 *  than this, the run is aborted and counted as a soft failure. Stops one
 *  bad Supabase hiccup from blocking the scheduler forever. */
export const DEFAULT_RUN_BUDGET_MS = 10 * 60 * 1000;

/** Page size when scanning users. Keep small enough that we don't slam
 *  the DB; large enough that we don't issue hundreds of round trips. */
export const USER_SCAN_PAGE = 500;

export interface CronRunOptions {
  /** Override the Supabase client (used by tests). */
  supabase?: SupabaseClient;
  /** Override "now" — used by tests for determinism. */
  now?: Date;
  /** Override the reminder window — defaults to REMINDER_WINDOW_MS. */
  windowMs?: number;
  /** Hard upper bound on how long the whole run may take. */
  budgetMs?: number;
  /** Maximum users to process in this run. Useful for staged rollouts. */
  maxUsers?: number;
}

export interface CronRunSummary {
  ok: boolean;
  started_at: string;
  duration_ms: number;
  users_scanned: number;
  users_with_reminders: number;
  inserted: number;
  skipped: number;
  errors: number;
  warning?: string;
}

/** Walk `user_interactions` and pull every distinct client_user_id that has
 *  at least one `save` interaction. We use the index
 *  `idx_user_interactions_user_time` so the scan is bounded by the number
 *  of users who actually saved something — not by total interaction rows. */
export async function pickActiveUsersWithSaves(
  supabase: SupabaseClient,
  opts: { maxUsers?: number } = {}
): Promise<{ ok: boolean; userIds: string[]; warning?: string }> {
  const max = opts.maxUsers ?? USER_SCAN_PAGE * 4;
  // PostgREST distinct via `.select('client_user_id')` and de-dup client-side.
  // The index on (client_user_id, created_at DESC) makes this cheap.
  const result = await supabase
    .from('user_interactions')
    .select('client_user_id')
    .eq('interaction', 'save')
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
    `[reminders-cron] ${summary.started_at} ` +
    `users=${summary.users_scanned} ` +
    `with_reminders=${summary.users_with_reminders} ` +
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

/** Public entry point: do a single pass. Never throws — always returns a
 *  summary. The summary's `ok` is the headline flag; `errors` counts how
 *  many users failed to produce reminders. */
export async function runReminderPass(
  opts: CronRunOptions = {}
): Promise<CronRunSummary> {
  const startedAt = opts.now ?? new Date();
  const t0 = startedAt.getTime();
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const windowMs = opts.windowMs ?? REMINDER_WINDOW_MS;
  const supabase = opts.supabase ?? getSupabaseClient();

  const summary: CronRunSummary = {
    ok: true,
    started_at: startedAt.toISOString(),
    duration_ms: 0,
    users_scanned: 0,
    users_with_reminders: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  const scan = await pickActiveUsersWithSaves(supabase, {
    maxUsers: opts.maxUsers,
  });
  if (!scan.ok) {
    summary.ok = false;
    summary.warning = scan.warning;
    summary.duration_ms = Date.now() - t0;
    return summary;
  }
  summary.users_scanned = scan.userIds.length;

  for (const userId of scan.userIds) {
    if (Date.now() - t0 > budgetMs) {
      summary.warning = `budget exceeded after ${summary.users_scanned - summary.errors} users`;
      summary.ok = false;
      break;
    }
    try {
      const result = await generateRemindersForUser(supabase, {
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
      if (result.inserted > 0) summary.users_with_reminders += 1;
    } catch (err: unknown) {
      // Defensive: per CLAUDE.md, this path must never throw into the
      // scheduler. A single bad user must not poison the whole pass.
      summary.errors += 1;
    }
  }

  summary.duration_ms = Date.now() - t0;
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
    const summary = await runReminderPass(opts);
    // Single line per pass — supervisor-friendly.
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
    if (signal.aborted) break;
    await sleep(intervalMs, signal);
  }
}

if (process.argv[1] && /reminders\.ts$/.test(process.argv[1])) {
  const loop = process.argv.includes('--loop');
  const fn = loop ? runForever : async () => {
    const summary = await runReminderPass();
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
  };
  fn().catch((err: unknown) => {
    // Top-level safety net: never let an uncaught error kill the loop
    // silently. The supervisor reads stderr.
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[reminders-cron] fatal: ${msg}`);
    process.exitCode = 1;
  });
}
