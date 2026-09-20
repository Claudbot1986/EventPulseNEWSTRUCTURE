/**
 * 08-Agent/cron/push_din_helg — weekly "Din helg" push (S6, 2026-09-20).
 *
 * Every Thursday 17:00 Europe/Stockholm, walk all users who opted in to the
 * Din helg weekly push (preferences.din_helg_push_enabled === true) AND have
 * a stored Expo push token, read their pre-rendered weekend cards
 * (cached_recommendations slot_2 — regenerated nightly by
 * pre_render_recommendations), and send one Expo Push notification in the
 * user's locale (preferences.locale, fallback en → sv copy).
 *
 * Why a separate cron process (not node-cron inside server.ts):
 *   - Same reasoning as follow_drops/pre_render: clock-driven fan-out is
 *     independent of the request-serving lifecycle. Deployed as its own
 *     Fly machine via fly.toml [processes] worker (no http_service).
 *
 * Delivery semantics:
 *   - Expo Push API (https://exp.host/--/api/v2/push/send), messages batched
 *     in chunks of 100 per the API limit.
 *   - Receipt `DeviceNotRegistered` → the token is dead; we null it out
 *     (read-modify-write on preferences, preserving all other keys) so the
 *     user stops being billed sends next week.
 *   - Deep link in payload: data.url = 'eventpulse://home/din-helg' —
 *     deepLinkRouter classifies it and AppShell lands on the home tab.
 *
 * Run:
 *   npx tsx 08-Agent/cron/push_din_helg.ts            # run once, exit
 *   npx tsx 08-Agent/cron/push_din_helg.ts --loop     # node-cron Thursdays 17:00
 *
 * Output: one machine-parseable summary line per pass, same convention as
 * the other crons:
 *   [push_din_helg-cron] 2026-09-24T15:00:00.000Z users=12 sent=9 skipped=2 tokens_cleared=1 errors=0 duration_ms=812
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import cron from 'node-cron';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thursday 17:00 — the research-backed weekly planning moment. */
export const DEFAULT_CRON_EXPR = '0 17 * * 4';
export const STOCKHOLM_TZ = 'Europe/Stockholm';

/** Per-invocation time budget (ms). */
export const DEFAULT_RUN_BUDGET_MS = 10 * 60 * 1000;

/** Page size when scanning user_preferences. */
export const USER_SCAN_PAGE = 500;

/** Expo Push API. Chunk limit per docs: 100 messages per request. */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_CHUNK = 100;

/** Deep link delivered in data.url — routed by 06-UI/services/deepLinkRouter.js. */
export const DIN_HELG_DEEP_LINK = 'eventpulse://home/din-helg';

export type PushLocale =
  | 'sv' | 'en' | 'de' | 'no' | 'fi' | 'da' | 'nl' | 'fr' | 'zh-Hans' | 'it';

/** Notification copy per locale. Kept server-side (own source of truth):
 *  the UI pre-permission teaser intentionally mirrors `{example}` but the
 *  actual sent copy lives here so cron never imports UI modules.
 *  `{count}` is the number of weekend cards the user has cached (1–2). */
export const PUSH_COPY: Record<PushLocale, { title: string; body: string }> = {
  sv: { title: 'Din helg är här', body: '{count} kort för fredag–söndag' },
  en: { title: 'Your weekend is here', body: '{count} picks for Friday–Sunday' },
  de: { title: 'Dein Wochenende ist da', body: '{count} Tipps für Freitag–Sonntag' },
  no: { title: 'Helgen din er her', body: '{count} tips for fredag–søndag' },
  fi: { title: 'Viikonloppusi on täällä', body: '{count} vinkkiä viikonloppuun' },
  da: { title: 'Din weekend er her', body: '{count} bud til fredag–søndag' },
  nl: { title: 'Jouw weekend is er', body: '{count} tips voor vrijdag t/m zondag' },
  fr: { title: 'Ton week-end est là', body: '{count} idées de vendredi à dimanche' },
  'zh-Hans': { title: '你的周末来了', body: '周五到周日的 {count} 个精选' },
  it: { title: 'Il tuo weekend è qui', body: '{count} proposte da venerdì a domenica' },
};

const SUPPORTED_LOCALES = new Set<string>(Object.keys(PUSH_COPY));

/** chosen → en → sv, mirroring the UI fallback chain. */
export function resolvePushLocale(raw: unknown): PushLocale {
  if (typeof raw === 'string' && SUPPORTED_LOCALES.has(raw)) {
    return raw as PushLocale;
  }
  return 'en';
}

export function buildPushCopy(locale: PushLocale, count: number): { title: string; body: string } {
  const copy = PUSH_COPY[locale] ?? PUSH_COPY.en;
  return {
    title: copy.title,
    body: copy.body.replace('{count}', String(Math.max(count, 1))),
  };
}

export interface CronRunOptions {
  /** Override the Supabase client (used by tests). */
  supabase?: SupabaseClient;
  /** Override fetch for the Expo Push API (used by tests). */
  fetchImpl?: typeof fetch;
  /** Override "now" — used by tests for deterministic replay. */
  now?: Date;
  /** Hard upper bound on how long the whole run may take. */
  budgetMs?: number;
  /** Maximum users to process in this run. */
  maxUsers?: number;
  /** Override the time provider for the budget check. */
  timeProvider?: () => number;
}

export interface CronRunSummary {
  ok: boolean;
  started_at: string;
  duration_ms: number;
  users_scanned: number;
  sent: number;
  skipped: number;
  tokens_cleared: number;
  errors: number;
  warning?: string;
}

interface EligibleUser {
  userId: string;
  pushToken: string;
  locale: PushLocale;
}

interface WeekendCacheRow {
  slot_2_card_1: { title?: unknown } | null;
  slot_2_card_2: { title?: unknown } | null;
}

/** Scan user_preferences for users with din_helg opt-in + a push token.
 *  Client-side filtering keeps this testable without PostgREST arrow-path
 *  filter semantics — same approach as follow_drops.pickUsersWithFollowedVenues. */
export async function pickEligibleUsers(
  supabase: SupabaseClient,
  opts: { maxUsers?: number } = {}
): Promise<{ ok: boolean; users: EligibleUser[]; warning?: string }> {
  const max = opts.maxUsers ?? USER_SCAN_PAGE * 4;

  const result = await supabase
    .from('user_preferences')
    .select('client_user_id, preferences')
    .limit(max);

  if (result.error) {
    return { ok: false, users: [], warning: `user scan failed: ${result.error.message}` };
  }

  const users: EligibleUser[] = [];
  for (const row of (result.data ?? []) as Array<{
    client_user_id: string | null;
    preferences: unknown | null;
  }>) {
    if (typeof row.client_user_id !== 'string') continue;
    if (!UUID_RE.test(row.client_user_id)) continue;
    const prefs = row.preferences as {
      din_helg_push_enabled?: unknown;
      push_token?: unknown;
      locale?: unknown;
    } | null;
    if (!prefs || prefs.din_helg_push_enabled !== true) continue;
    if (typeof prefs.push_token !== 'string' || prefs.push_token.trim() === '') continue;
    users.push({
      userId: row.client_user_id,
      pushToken: prefs.push_token,
      locale: resolvePushLocale(prefs.locale),
    });
    if (users.length >= max) break;
  }

  return { ok: true, users };
}

/** Count how many weekend cards the user has cached (0–2). */
export async function loadWeekendCardCount(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; count: number; warning?: string }> {
  const result = await supabase
    .from('cached_recommendations')
    .select('slot_2_card_1, slot_2_card_2')
    .eq('client_user_id', userId)
    .maybeSingle();
  if (result.error) {
    return { ok: false, count: 0, warning: result.error.message };
  }
  const row = result.data as WeekendCacheRow | null;
  if (!row) return { ok: true, count: 0 };
  let count = 0;
  for (const card of [row.slot_2_card_1, row.slot_2_card_2]) {
    if (card && typeof card.title === 'string' && card.title.length > 0) count += 1;
  }
  return { ok: true, count };
}

interface ExpoPushMessage {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { url: string };
  /** Internal only — stripped before send; maps back to the owning user. */
  _userId: string;
}

interface ExpoPushTicket {
  status?: string;
  details?: { error?: string };
}

/** Clear a dead token via read-modify-write so the user stops being sent
 *  to. Mirrors the /agent/push-token route's merge semantics. */
async function clearDeadToken(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const read = await supabase
    .from('user_preferences')
    .select('preferences')
    .eq('client_user_id', userId)
    .maybeSingle();
  if (read.error) return;
  const base =
    read.data && typeof read.data.preferences === 'object' && read.data.preferences !== null
      ? (read.data.preferences as Record<string, unknown>)
      : {};
  const next = { ...base, push_token: null, updated_at_kind: 'push-token' };
  await supabase
    .from('user_preferences')
    .upsert(
      { client_user_id: userId, preferences: next, updated_at: new Date().toISOString() },
      { onConflict: 'client_user_id' }
    );
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

/** Format a CronRunSummary as a single machine-parseable line. */
export function summarize(summary: CronRunSummary): string {
  const base =
    `[push_din_helg-cron] ${summary.started_at} ` +
    `users=${summary.users_scanned} ` +
    `sent=${summary.sent} ` +
    `skipped=${summary.skipped} ` +
    `tokens_cleared=${summary.tokens_cleared} ` +
    `errors=${summary.errors} ` +
    `duration_ms=${summary.duration_ms}`;
  return summary.warning ? `${base} warning="${summary.warning}"` : base;
}

/** Public entry point: one weekly pass. Never throws. */
export async function runPushDinHelgPass(
  opts: CronRunOptions = {}
): Promise<CronRunSummary> {
  const startedAt = opts.now ?? new Date();
  const t0 = startedAt.getTime();
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const supabase = opts.supabase ?? getSupabaseClient();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeProvider = opts.timeProvider ?? (() => Date.now());

  const summary: CronRunSummary = {
    ok: true,
    started_at: startedAt.toISOString(),
    duration_ms: 0,
    users_scanned: 0,
    sent: 0,
    skipped: 0,
    tokens_cleared: 0,
    errors: 0,
  };

  const scan = await pickEligibleUsers(supabase, { maxUsers: opts.maxUsers });
  if (!scan.ok) {
    summary.ok = false;
    summary.warning = scan.warning;
    summary.duration_ms = timeProvider() - t0;
    return summary;
  }
  summary.users_scanned = scan.users.length;

  // Build one message per user; users without cached weekend cards are
  // skipped (nothing useful to tease — better to stay silent).
  const messages: ExpoPushMessage[] = [];
  for (const user of scan.users) {
    if (timeProvider() - t0 > budgetMs) {
      summary.warning = `budget exceeded after ${messages.length} messages`;
      summary.ok = false;
      break;
    }
    try {
      const cards = await loadWeekendCardCount(supabase, user.userId);
      if (!cards.ok) {
        summary.errors += 1;
        continue;
      }
      if (cards.count === 0) {
        summary.skipped += 1;
        continue;
      }
      const copy = buildPushCopy(user.locale, cards.count);
      messages.push({
        to: user.pushToken,
        sound: 'default',
        title: copy.title,
        body: copy.body,
        data: { url: DIN_HELG_DEEP_LINK },
        _userId: user.userId,
      });
    } catch (_err: unknown) {
      summary.errors += 1;
    }
  }

  // Batch-send in chunks; receipts map 1:1 to the chunk's messages.
  for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK) {
    if (timeProvider() - t0 > budgetMs) {
      summary.warning = `budget exceeded before send chunk ${i / EXPO_PUSH_CHUNK + 1}`;
      summary.ok = false;
      break;
    }
    const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK);
    const wire = chunk.map(({ _userId: _omit, ...msg }) => msg);
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wire),
      });
      if (!response.ok) {
        summary.errors += chunk.length;
        continue;
      }
      const payload = (await response.json()) as { data?: ExpoPushTicket[] };
      const tickets = Array.isArray(payload.data) ? payload.data : [];
      for (let j = 0; j < chunk.length; j += 1) {
        const ticket = tickets[j];
        if (ticket?.status === 'ok') {
          summary.sent += 1;
          continue;
        }
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          await clearDeadToken(supabase, chunk[j]._userId);
          summary.tokens_cleared += 1;
          continue;
        }
        // Unknown/other ticket error — keep the token, count as error.
        summary.errors += 1;
      }
    } catch (_err: unknown) {
      summary.errors += chunk.length;
    }
  }

  summary.duration_ms = timeProvider() - t0;
  return summary;
}

/** Top-level --loop runner: node-cron Thursdays 17:00 Europe/Stockholm. */
export async function runForever(
  opts: CronRunOptions & { cronExpr?: string; timezone?: string } = {}
): Promise<void> {
  const expr = opts.cronExpr ?? DEFAULT_CRON_EXPR;
  const tz = opts.timezone ?? STOCKHOLM_TZ;
  const task = cron.schedule(
    expr,
    async () => {
      const summary = await runPushDinHelgPass(opts);
      // eslint-disable-next-line no-console
      console.log(summarize(summary));
    },
    { timezone: tz }
  );

  // No immediate first pass — an off-schedule send would surprise users;
  // --once is the manual verification path. One startup line so the worker
  // log proves the scheduler armed itself (otherwise the log is silent
  // until the first Thursday 17:00 fire and a crash looks invisible).
  // eslint-disable-next-line no-console
  console.log(`[push_din_helg-cron] scheduled expr="${expr}" tz=${tz}`);

  const stop = () => {
    task.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && /push_din_helg\.ts$/.test(process.argv[1])) {
  const loop = process.argv.includes('--loop');
  const fn = loop ? runForever : async () => {
    const summary = await runPushDinHelgPass();
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
  };
  fn().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[push_din_helg-cron] fatal: ${msg}`);
    process.exitCode = 1;
  });
}
