/**
 * 08-Agent/cron/pre_render_recommendations — periodic HomeScreen pre-render.
 *
 * T0060 / MVP-gap §77 (Phase 1 retention):
 *   Active users (3+ distinct sessions in last 30d) tend to forget to open
 *   the app between sessions. We pre-render 3 intent slots so HomeScreen
 *   can show "Vad ska jag göra ikväll?", "Något i helgen?", "Upprepa senast"
 *   with the top 2 cards already materialised — zero friction on next open.
 *
 * Run:
 *   npx tsx 08-Agent/cron/pre_render_recommendations.ts            # run once, exit
 *   npx tsx 08-Agent/cron/pre_render_recommendations.ts --loop     # run on a clock
 *
 * Schedule (--loop mode): two passes per day at 06:00 and 17:00 Stockholm
 * time. node-cron uses the server's local timezone; we hardcode 'Europe/
 * Stockholm' so the schedule is stable regardless of where the cron host
 * runs (Fly / local Mac).
 *
 * Output: one stdout line per pass, machine-parseable so the supervisor
 * log can graph metrics over time:
 *
 *   [pre_render-cron] 2026-08-22T06:00:00.000Z users=12 generated=36 skipped=0 errors=0
 *
 * Why a separate cron job (not inline in server.ts):
 *   - Same reasoning as reminders.ts / follow_drops.ts: clock-driven
 *     background work has nothing to do with request-driven server
 *     lifecycle. Decoupling keeps the server lean and the cron
 *     independently deployable.
 *   - Idempotent via UPSERT on (client_user_id), so concurrent runs are
 *     safe.
 */

import 'dotenv/config';
import cron from 'node-cron';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EventCard, IntentBrief, RankedEvent } from '../types';
import { searchEvents } from '../tools/search_events';
import { rankEvents } from '../tools/rank_events';
import { buildUserSignal, loadStatedPreferences } from '../tools/personalize';
import { loadFollowedVenues, loadFollowedArtists } from '../tools/follow_entity';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hardcoded Stockholm timezone for the cron schedule — see file JSDoc. */
export const STOCKHOLM_TZ = 'Europe/Stockholm';

/** Two daily passes at 06:00 and 17:00 Stockholm time. Combined into a
 *  single cron expression that fires both slots. */
export const DEFAULT_CRON_EXPR = '0 6,17 * * *';

/** Per-invocation time budget (ms). If a single pass takes longer than this,
 *  the run is aborted and counted as a soft failure. */
export const DEFAULT_RUN_BUDGET_MS = 10 * 60 * 1000;

/** Number of distinct sessions in the look-back window required for a
 *  user to be eligible for pre-rendered recommendations. Below this, the
 *  user is still warming up and the cold-start UI is fine. */
export const MIN_DISTINCT_SESSIONS = 3;

/** Look-back window for the session-count eligibility check. */
export const ELIGIBILITY_WINDOW_DAYS = 30;

/** Cards per slot. The task brief pins this at 2 — keeps the payload
 *  small and the HomeScreen tap-targets uncluttered. */
export const CARDS_PER_SLOT = 2;

/** Cap on events fetched per slot search. Mirrors /agent/recommended. */
export const SLOT_SEARCH_LIMIT = 25;

/** Slot titles (Swedish). The UI surfaces these verbatim. */
export const SLOT_TITLES = {
  tonight: 'Vad ska jag göra ikväll?',
  weekend: 'Något i helgen?',
  repeat:  'Upprepa senast',
} as const;

/** Shape of a single card payload as persisted to JSONB. Kept small — the
 *  UI does not need full EventCard fields; it needs enough to render a
 *  list-row and a tap-through. */
export interface RecommendationCard {
  event_id: string;
  title: string;
  start_time: string;
  venue_name: string;
  image_url: string | null;
  rank_reason: string;
}

export interface RecommendationSlot {
  title: string;
  card_1: RecommendationCard | null;
  card_2: RecommendationCard | null;
}

export interface GeneratePreRenderInput {
  client_user_id: string;
  /** Override "now" — used by tests for deterministic replay. */
  now?: Date;
}

export interface GeneratePreRenderResult {
  ok: boolean;
  slots: [RecommendationSlot, RecommendationSlot, RecommendationSlot];
  warning?: string;
}

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
}

export interface CronRunSummary {
  ok: boolean;
  started_at: string;
  duration_ms: number;
  users_scanned: number;
  users_with_recommendations: number;
  generated: number;
  skipped: number;
  errors: number;
  warning?: string;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Return the Stockholm-local YYYY-MM-DD for `now`. */
function stockholmDate(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: STOCKHOLM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

/** Return the upcoming Saturday YYYY-MM-DD (Stockholm local). If today IS
 *  Saturday, returns today's Saturday so "helgen" always means "the next
 *  Sat-Sun pair starting today or later". */
function upcomingSaturday(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: STOCKHOLM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = get('year'), m = get('month'), d = get('day');
  const wd = get('weekday'); // 'Mon', 'Tue', ..., 'Sat', 'Sun'
  const dowMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0,
  };
  const todayDow = dowMap[wd] ?? new Date(`${y}-${m}-${d}T12:00:00Z`).getUTCDay();
  // Days until next Saturday (6). If today is Saturday (6), delta=0 so we
  // target today's Sat → Sun window.
  const delta = (6 - todayDow + 7) % 7;
  const out = new Date(`${y}-${m}-${d}T12:00:00Z`);
  out.setUTCDate(out.getUTCDate() + delta);
  return out.toISOString().slice(0, 10);
}

/** Add N days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Trim an EventCard to the RecommendationCard shape we persist. Picks
 *  the FIRST rank reason as the human-facing label (ranker reasons are
 *  enum-only, never free text — see RankReason in types.ts). */
export function toRecommendationCard(
  ranked: RankedEvent,
  fallbackVenue: string,
): RecommendationCard {
  const card: EventCard = ranked.card;
  const reason = ranked.reasons[0] ?? 'not_ended';
  return {
    event_id: card.id,
    title: card.title,
    start_time: card.start_time,
    venue_name: card.venue_name || fallbackVenue,
    image_url: card.image_url ?? null,
    rank_reason: reason,
  };
}

/** Build a minimal IntentBrief — rank_events requires the full shape even
 *  when we're driving it from a slot's natural time/category. */
function buildSlotIntent(
  rawQuery: string,
  dateFrom?: string,
  dateTo?: string,
): IntentBrief {
  return {
    raw_query: rawQuery,
    date_from: dateFrom,
    date_to: dateTo,
    time_of_day: 'anytime',
    budget: 'any',
    party: 'any',
    categories: [],
    city: 'Stockholm',
    language: 'sv',
    exclude_categories: [],
  };
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

/** Find all distinct client_user_ids that have at least
 *  MIN_DISTINCT_SESSIONS distinct session_ids in the last
 *  ELIGIBILITY_WINDOW_DAYS days. A user with ≥1 session and 0 saves is
 *  still eligible — the saved-events cold-start is unrelated. */
export async function pickEligibleUsers(
  supabase: SupabaseClient,
  opts: { now?: Date; maxUsers?: number } = {}
): Promise<{ ok: boolean; userIds: string[]; warning?: string }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - ELIGIBILITY_WINDOW_DAYS * 24 * 3600 * 1000);
  // Pull session_id rows in the window. We over-fetch then group client-side
  // because Supabase/PostgREST does not expose DISTINCT ON through the JS
  // client cleanly.
  const max = opts.maxUsers ?? 5000;
  const result = await supabase
    .from('user_interactions')
    .select('client_user_id, session_id, created_at')
    .gte('created_at', cutoff.toISOString())
    .not('session_id', 'is', null)
    .limit(max * 4);

  if (result.error) {
    return { ok: false, userIds: [], warning: `user scan failed: ${result.error.message}` };
  }

  const sessionSetByUser = new Map<string, Set<string>>();
  for (const row of (result.data ?? []) as Array<{
    client_user_id: string | null;
    session_id: string | null;
  }>) {
    if (typeof row.client_user_id !== 'string' || !UUID_RE.test(row.client_user_id)) continue;
    if (typeof row.session_id !== 'string' || !UUID_RE.test(row.session_id)) continue;
    let set = sessionSetByUser.get(row.client_user_id);
    if (!set) {
      set = new Set<string>();
      sessionSetByUser.set(row.client_user_id, set);
    }
    set.add(row.session_id);
  }

  const eligible: string[] = [];
  for (const [userId, sessions] of sessionSetByUser) {
    if (sessions.size >= MIN_DISTINCT_SESSIONS) {
      eligible.push(userId);
      if (eligible.length >= max) break;
    }
  }
  return { ok: true, userIds: eligible };
}

// ─── Slot generators ─────────────────────────────────────────────────────────

/** Slot 1: events happening tonight (Stockholm today). */
async function generateTonightSlot(
  supabase: SupabaseClient,
  intent: IntentBrief,
): Promise<RecommendationSlot> {
  const search = await searchEvents(supabase, {
    city: intent.city,
    date_from: intent.date_from,
    date_to: intent.date_to,
    limit: SLOT_SEARCH_LIMIT,
  });
  const ranked = rankEvents(search.events, intent, { topN: CARDS_PER_SLOT, timeZone: STOCKHOLM_TZ });
  return packSlot(SLOT_TITLES.tonight, ranked);
}

/** Slot 2: events for the upcoming Saturday-Sunday. */
async function generateWeekendSlot(
  supabase: SupabaseClient,
  intent: IntentBrief,
): Promise<RecommendationSlot> {
  const search = await searchEvents(supabase, {
    city: intent.city,
    date_from: intent.date_from,
    date_to: intent.date_to,
    limit: SLOT_SEARCH_LIMIT,
  });
  const ranked = rankEvents(search.events, intent, { topN: CARDS_PER_SLOT, timeZone: STOCKHOLM_TZ });
  return packSlot(SLOT_TITLES.weekend, ranked);
}

/** Slot 3: events similar to the user's most recent save/click/search.
 *  We use the latest `user_interactions` row's event_id (when present) as
 *  a category/venue proxy — search_events with no filter and rank with
 *  the user's personalization signals. Falls back to "Tonight" content
 *  when no recent interactions exist (cold-user edge case — should never
 *  fire in practice because eligibility requires ≥3 sessions). */
async function generateRepeatSlot(
  supabase: SupabaseClient,
  clientUserId: string,
  fallbackIntent: IntentBrief,
): Promise<RecommendationSlot> {
  const fallback = async (): Promise<RecommendationSlot> => {
    const search = await searchEvents(supabase, {
      city: fallbackIntent.city,
      date_from: fallbackIntent.date_from,
      date_to: fallbackIntent.date_to,
      limit: SLOT_SEARCH_LIMIT,
    });
    const ranked = rankEvents(search.events, fallbackIntent, {
      topN: CARDS_PER_SLOT,
      timeZone: STOCKHOLM_TZ,
    });
    return packSlot(SLOT_TITLES.repeat, ranked);
  };

  // Fetch the most recent save/click/search interaction.
  const recent = await supabase
    .from('user_interactions')
    .select('event_id, interaction, created_at')
    .eq('client_user_id', clientUserId)
    .in('interaction', ['save', 'click', 'search'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent.error || !recent.data?.event_id) {
    return fallback();
  }

  // The saved/clicked event's category + venue are reflected through
  // buildUserSignal (count-based priors) + stated prefs + follows.
  const personalization = await buildUserSignal(supabase, clientUserId);
  const stated = await loadStatedPreferences(supabase, clientUserId);
  const followed = await loadFollowedVenues(supabase, clientUserId);
  const followedArtists = await loadFollowedArtists(supabase, clientUserId);

  const search = await searchEvents(supabase, {
    city: 'Stockholm',
    limit: SLOT_SEARCH_LIMIT,
  });
  const ranked = rankEvents(search.events, fallbackIntent, {
    topN: CARDS_PER_SLOT,
    personalization,
    statedCategories: stated ?? undefined,
    followedVenueIds: followed.venue_ids.length > 0 ? followed.venue_ids : undefined,
    followedArtistSlugs: followedArtists.artist_slugs.length > 0 ? followedArtists.artist_slugs : undefined,
    timeZone: STOCKHOLM_TZ,
  });
  return packSlot(SLOT_TITLES.repeat, ranked);
}

function packSlot(title: string, ranked: RankedEvent[]): RecommendationSlot {
  const cards = ranked.slice(0, CARDS_PER_SLOT);
  return {
    title,
    card_1: cards[0] ? toRecommendationCard(cards[0], '') : null,
    card_2: cards[1] ? toRecommendationCard(cards[1], '') : null,
  };
}

// ─── Per-user generator ──────────────────────────────────────────────────────

/** Build the 3-slot payload for a single user. Never throws. */
export async function generatePreRenderForUser(
  supabase: SupabaseClient,
  input: GeneratePreRenderInput
): Promise<GeneratePreRenderResult> {
  if (!UUID_RE.test(input.client_user_id)) {
    return {
      ok: false,
      slots: [
        { title: SLOT_TITLES.tonight, card_1: null, card_2: null },
        { title: SLOT_TITLES.weekend, card_1: null, card_2: null },
        { title: SLOT_TITLES.repeat,  card_1: null, card_2: null },
      ],
      warning: 'client_user_id must be a uuid',
    };
  }

  const now = input.now ?? new Date();
  const today = stockholmDate(now);
  const saturday = upcomingSaturday(now);
  const sunday = addDaysIso(saturday, 1);

  const tonightIntent = buildSlotIntent(SLOT_TITLES.tonight, today, today);
  const weekendIntent = buildSlotIntent(SLOT_TITLES.weekend, saturday, sunday);

  try {
    const [slot1, slot2, slot3] = await Promise.all([
      generateTonightSlot(supabase, tonightIntent),
      generateWeekendSlot(supabase, weekendIntent),
      generateRepeatSlot(supabase, input.client_user_id, tonightIntent),
    ]);
    return { ok: true, slots: [slot1, slot2, slot3] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      slots: [
        { title: SLOT_TITLES.tonight, card_1: null, card_2: null },
        { title: SLOT_TITLES.weekend, card_1: null, card_2: null },
        { title: SLOT_TITLES.repeat,  card_1: null, card_2: null },
      ],
      warning: msg,
    };
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Upsert the 3-slot payload into cached_recommendations. Never throws. */
async function persistPreRender(
  supabase: SupabaseClient,
  clientUserId: string,
  payload: GeneratePreRenderResult,
  now: Date,
): Promise<{ ok: boolean; warning?: string }> {
  const [s1, s2, s3] = payload.slots;
  const row = {
    client_user_id: clientUserId,
    slot_1_title: s1.title,
    slot_1_card_1: s1.card_1,
    slot_1_card_2: s1.card_2,
    slot_2_title: s2.title,
    slot_2_card_1: s2.card_1,
    slot_2_card_2: s2.card_2,
    slot_3_title: s3.title,
    slot_3_card_1: s3.card_1,
    slot_3_card_2: s3.card_2,
    generated_at: now.toISOString(),
  };
  const result = await supabase
    .from('cached_recommendations')
    .upsert(row, { onConflict: 'client_user_id' });
  if (result.error) {
    return { ok: false, warning: `upsert failed: ${result.error.message}` };
  }
  return { ok: true };
}

// ─── Single-pass runner ──────────────────────────────────────────────────────

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

/** Format a CronRunSummary as a single line. Stable shape so the supervisor
 *  can graph metrics over time. */
export function summarize(summary: CronRunSummary): string {
  const base =
    `[pre_render-cron] ${summary.started_at} ` +
    `users=${summary.users_scanned} ` +
    `generated=${summary.generated} ` +
    `skipped=${summary.skipped} ` +
    `errors=${summary.errors} ` +
    `duration_ms=${summary.duration_ms}`;
  return summary.warning ? `${base} warning="${summary.warning}"` : base;
}

/** Public entry point: do a single pass. Never throws — always returns a
 *  summary. The summary's `ok` is the headline flag; `errors` counts how
 *  many users failed to produce recommendations. */
export async function runPreRenderPass(
  opts: CronRunOptions = {}
): Promise<CronRunSummary> {
  const startedAt = opts.now ?? new Date();
  const t0 = startedAt.getTime();
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const supabase = opts.supabase ?? getSupabaseClient();
  const timeProvider = opts.timeProvider ?? (() => Date.now());

  const summary: CronRunSummary = {
    ok: true,
    started_at: startedAt.toISOString(),
    duration_ms: 0,
    users_scanned: 0,
    users_with_recommendations: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
  };

  const scan = await pickEligibleUsers(supabase, { now: startedAt, maxUsers: opts.maxUsers });
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
      const payload = await generatePreRenderForUser(supabase, {
        client_user_id: userId,
        now: startedAt,
      });
      if (!payload.ok) {
        summary.errors += 1;
        continue;
      }
      const persisted = await persistPreRender(supabase, userId, payload, startedAt);
      if (!persisted.ok) {
        summary.errors += 1;
        continue;
      }
      // Count slots that have at least one card. A user with zero cards
      // across all 3 slots is "generated but empty" — we still wrote a
      // row (so the UI gets the title copy), so it counts as generated.
      const slotsWithCards = payload.slots.filter((s) => s.card_1 !== null || s.card_2 !== null).length;
      summary.generated += slotsWithCards;
      if (slotsWithCards === 0) summary.skipped += 1;
      if (slotsWithCards > 0) summary.users_with_recommendations += 1;
    } catch (err: unknown) {
      // Per CLAUDE.md: never let one bad user poison the whole pass.
      summary.errors += 1;
    }
  }

  summary.duration_ms = timeProvider() - t0;
  return summary;
}

// ─── --loop runner ───────────────────────────────────────────────────────────

/** Top-level --loop runner. Uses node-cron's CronExpression + an immediate
 *  first pass so the supervisor gets a baseline line right away. */
export async function runForever(opts: CronRunOptions & { cronExpr?: string; timezone?: string } = {}): Promise<void> {
  const expr = opts.cronExpr ?? DEFAULT_CRON_EXPR;
  const tz = opts.timezone ?? STOCKHOLM_TZ;
  const task = cron.schedule(expr, async () => {
    const summary = await runPreRenderPass(opts);
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
  }, { timezone: tz });

  // Fire one immediately so a fresh start produces a baseline.
  const initial = await runPreRenderPass(opts);
  // eslint-disable-next-line no-console
  console.log(summarize(initial));

  // node-cron tasks keep the event loop alive until stopped.
  const stop = () => {
    task.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && /pre_render_recommendations\.ts$/.test(process.argv[1])) {
  const loop = process.argv.includes('--loop');
  const fn = loop ? runForever : async () => {
    const summary = await runPreRenderPass();
    // eslint-disable-next-line no-console
    console.log(summarize(summary));
  };
  fn().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[pre_render-cron] fatal: ${msg}`);
    process.exitCode = 1;
  });
}
