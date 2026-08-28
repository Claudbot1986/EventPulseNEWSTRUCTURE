/**
 * 08-Agent/workers/aiImageWorker.ts
 *
 * BullMQ worker som konsumerar `ai-image-generation`-kön och anropar
 * autoGenServer för att generera AI-bilder åt events som saknar bild
 * (image_url IS NULL) eller har en icke-AI-bild.
 *
 * Designprinciper:
 *   1. Async — blockerar ALDRIG ingestion-pipelinen (normalizer-processen).
 *   2. Dedup-aggregera — syskon-events (samma title_sv+venue_name, olika
 *      datum) delar EN AI-bild, inte N.
 *   3. Retry med backoff för transient errors.
 *   4. No-credits detection — BFL kan returnera 402 eller "credit"/"balance"
 *      i svarstexten. Vid träff sätts status='no_credits' på ALLA påverkade
 *      events och workern pausar (workern ser redan existerande 'no_credits'
 *      events och skippar dem tills manuell re-charge).
 *   5. Daglig budget-cap — räknar ackumulerad USD-kostnad, sover till
 *      midnatt om budget överskriden.
 *
 * Kill switch:
 *   AI_IMAGE_PIPELINE_ENABLED=0 → workern startar inte alls.
 *   Annars startas den automatiskt vid require.
 */

import 'dotenv/config';
import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import { appendSkipLog } from '../utils/skipLog';
import {
  addToLibrary,
  pickLibraryFallback,
  markEventWithLibraryFallback,
} from '../utils/imageLibrary';

// ── Env ─────────────────────────────────────────────────────────────────────

const ENABLED = (process.env.AI_IMAGE_PIPELINE_ENABLED ?? '1') !== '0';
const AUTOGEN_URL = process.env.AI_IMAGE_AUTOGEN_URL || 'http://localhost:7790';
const DAILY_BUDGET_USD = Number(process.env.AI_IMAGE_DAILY_BUDGET_USD || '1.0');
const REDIS_URL = process.env.REDIS_URL || 'redis://host.docker.internal:6379';
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 60_000;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

if (ENABLED) {
  console.log(
    `[ai-image-worker] enabled=1 daily_budget_usd=${DAILY_BUDGET_USD.toFixed(2)} autogen=${AUTOGEN_URL} redis=${REDIS_URL}`,
  );
}

// ── Queue setup ────────────────────────────────────────────────────────────

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

export const aiImageQueue = new Queue<AiImageJob>('ai-image-generation', {
  connection,
  prefix: 'bull',
  defaultJobOptions: {
    attempts: MAX_RETRIES,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export interface AiImageJob {
  event_id: string;
  enqueued_at: string;
}

// ── Daily budget tracking ──────────────────────────────────────────────────

interface DailySpend {
  date: string;        // YYYY-MM-DD
  totalUsd: number;
}

let dailySpend: DailySpend = { date: '', totalUsd: 0 };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function recordSpend(usd: number): void {
  const tk = todayKey();
  if (dailySpend.date !== tk) {
    dailySpend = { date: tk, totalUsd: 0 };
  }
  dailySpend.totalUsd += usd;
}

async function sleepUntilMidnight(): Promise<void> {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const ms = midnight.getTime() - now.getTime();
  console.log(`[ai-image-worker] daily budget exceeded, sleeping ${Math.round(ms / 1000)}s until UTC midnight`);
  await new Promise((r) => setTimeout(r, ms));
}

function budgetExceeded(): boolean {
  return dailySpend.date === todayKey() && dailySpend.totalUsd >= DAILY_BUDGET_USD;
}

// ── Dedup helpers ──────────────────────────────────────────────────────────

interface EventLite {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  venues: { name: string }[] | null;
  venue_name: string | null;
  category_slug: string | null;
}

function venueNameOf(ev: EventLite): string {
  return ev.venues?.[0]?.name || ev.venue_name || '';
}

function dedupKey(ev: EventLite): string {
  const t = (ev.title_sv || ev.title_en || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const v = venueNameOf(ev).trim().toLowerCase().replace(/\s+/g, ' ');
  return `${t}::${v}`;
}

interface DedupGroup {
  key: string;
  ids: string[];
  representative: EventLite;
}

function groupByDedup(events: EventLite[]): DedupGroup[] {
  const map = new Map<string, DedupGroup>();
  for (const ev of events) {
    const key = dedupKey(ev);
    if (!map.has(key)) {
      map.set(key, { key, ids: [], representative: ev });
    }
    map.get(key)!.ids.push(ev.id);
  }
  return Array.from(map.values());
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function fetchGroupMembers(seedEventId: string): Promise<EventLite[]> {
  // 1. Hämta seed-eventet (för att få title_sv + venue_name)
  const { data: seed, error: seedErr } = await supabase
    .from('events')
    .select('id, title_sv, title_en, venues(name), venue_name, category_slug')
    .eq('id', seedEventId)
    .single();
  if (seedErr || !seed) {
    throw new Error(`seed event ${seedEventId} not found: ${seedErr?.message}`);
  }

  // 2. Hämta alla syskon med samma dedup-nyckel
  const seedTitle = (seed.title_sv || seed.title_en || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const seedVenue = venueNameOf(seed as EventLite).trim().toLowerCase().replace(/\s+/g, ' ');
  const seedKey = `${seedTitle}::${seedVenue}`;

  const { data: all, error: allErr } = await supabase
    .from('events')
    .select('id, title_sv, title_en, venues(name), venue_name, category_slug')
    .eq('status', 'published');
  if (allErr) throw new Error(`failed to fetch events: ${allErr.message}`);

  const matches = (all || []).filter((ev) => {
    const t = (ev.title_sv || ev.title_en || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const v = venueNameOf(ev as EventLite).trim().toLowerCase().replace(/\s+/g, ' ');
    return `${t}::${v}` === seedKey;
  });

  return matches as unknown as EventLite[];
}

async function markEvents(
  imageUrl: string,
  storagePath: string | undefined,
  group: DedupGroup,
  prompt: string,
  model: string,
): Promise<void> {
  const generatedAt = new Date().toISOString();
  const { error } = await supabase
    .from('events')
    .update({
      image_url: imageUrl,
      image_license: 'ai-generated',
      image_attribution: 'AI-generated image (EU AI Act Art. 50)',
      image_ai_generated: true,
      image_prompt: prompt.slice(0, 1000),
      image_model: model,
      image_generated_at: generatedAt,
      image_generation_status: 'completed',
      image_generation_attempts: 0,
      image_generation_error: null,
    })
    .in('id', group.ids);
  if (error) throw new Error(`DB update failed: ${error.message}`);

  // Library-registrering (2026-08-27): varje BFL-success växer biblioteket.
  // Idempotent — storage_path är UNIQUE, dubbletter returnerar befintlig rad.
  // Tyst vid fel — vi vill inte krascha ett lyckat BFL-jobb pga library-fel.
  if (storagePath) {
    await addToLibrary({
      storage_path: storagePath,
      category_slug: group.representative.category_slug ?? null,
      source_event_id: group.ids[0] ?? null,
      tags: ['bfl-success'],
    });
  }
}

/**
 * Tilldela biblioteks-bild till en grupp events. Används vid BFL-failure
 * (no_credits / transient error) som fallback så användaren aldrig ser en
 * tom bild.
 *
 * Returnerar antal events som faktiskt fick en biblioteks-bild.
 */
async function assignLibraryFallbackForGroup(
  group: DedupGroup,
  reason: string,
): Promise<number> {
  const match = await pickLibraryFallback({
    category_slug: group.representative.category_slug,
  });
  if (!match.url || !match.library_id) return 0;
  let assigned = 0;
  for (const evId of group.ids) {
    try {
      await markEventWithLibraryFallback(evId, match);
      assigned++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      console.warn(`[ai-image-worker] library fallback failed for ${evId}: ${msg}`);
    }
  }
  if (assigned > 0) {
    console.log(
      `[ai-image-worker]   📚 ${assigned} event(s) i grupp "${group.key}" ` +
        `fick biblioteks-bild (reason=${reason}, match_type=${match.match_type})`,
    );
  }
  return assigned;
}

async function markFailed(eventIds: string[], err: Error, attempts: number): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      image_generation_status: 'failed',
      image_generation_error: err.message.slice(0, 500),
      image_generation_attempts: attempts,
    })
    .in('id', eventIds);
  if (error) console.error(`[ai-image-worker] markFailed update error: ${error.message}`);
}

async function markNoCredits(eventIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      image_generation_status: 'no_credits',
      image_generation_error: 'BFL credits exhausted — recharge required (UI shows "no credits BFL - recharge")',
    })
    .in('id', eventIds);
  if (error) console.error(`[ai-image-worker] markNoCredits update error: ${error.message}`);
}

// ── autoGenServer call ─────────────────────────────────────────────────────

interface BatchResult {
  ok: boolean;
  results: Array<{
    ok: boolean;
    key: string;
    eventIds: string[];
    imageUrl?: string;
    /** R2 storage path returned by autoGenServer — används för addToLibrary */
    storagePath?: string;
    prompt?: string;
    error?: string;
  }>;
  okCount: number;
  failCount: number;
}

async function callAutoGenBatch(events: EventLite[]): Promise<BatchResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${AUTOGEN_URL}/generate-for-batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: events.map((e) => ({
          id: e.id,
          title_sv: e.title_sv,
          title_en: e.title_en,
          venues: e.venues,
          venue_name: e.venue_name,
          category_slug: e.category_slug,
        })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`autoGen HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as BatchResult;
  } finally {
    clearTimeout(t);
  }
}

// ── Detect credit errors in autoGen responses ─────────────────────────────

function isCreditFailure(result: BatchResult): boolean {
  return result.results.some(
    (r) => !r.ok && r.error && /no credits|402|insufficient|balance|quota|exhausted/i.test(r.error),
  );
}

// ── Job processor ──────────────────────────────────────────────────────────

async function processJob(job: Job<AiImageJob>): Promise<void> {
  if (!ENABLED) {
    console.log('[ai-image-worker] disabled via AI_IMAGE_PIPELINE_ENABLED=0, dropping job');
    return;
  }

  // Daily budget gate
  while (budgetExceeded()) {
    await sleepUntilMidnight();
  }

  const eventId = job.data.event_id;
  const attempt = (job.attemptsMade ?? 0) + 1;
  console.log(`[ai-image-worker] job=${job.id} event=${eventId} attempt=${attempt}/${MAX_RETRIES}`);

  // Hoppa över om eventet redan är AI-genererat (race med annan worker)
  const { data: statusCheck } = await supabase
    .from('events')
    .select('image_ai_generated, image_ai_optout, image_generation_status, start_time, source')
    .eq('id', eventId)
    .single();

  // Future-only guard (2026-08-27): UI/dashboard/agent-feed filtrerar bort
  // events där start_time <= now(). Att generera AI-bild för past events
  // är waste — bilden syns aldrig. Matchar dashboardens `totalFutureEvents`-
  // query (`events_public + start_time > now()`) exakt.
  // Return (inte throw) → BullMQ räknas som klar, ingen retry.
  if (statusCheck?.start_time && new Date(statusCheck.start_time) <= new Date()) {
    console.log(`[ai-image-worker] job=${job.id} event=${eventId} is in the past (${statusCheck.start_time}), skipping AI generation`);
    appendSkipLog('worker', {
      event_id: eventId,
      source: statusCheck.source ?? null,
      start_time: statusCheck.start_time,
      skip_reason: 'past',
    });
    return;
  }

  if (statusCheck?.image_ai_generated === true) {
    console.log(`[ai-image-worker] job=${job.id} event=${eventId} already AI-generated, skipping`);
    return;
  }
  // Per-event opt-out — venue bad om att behålla originalbild (t.ex. pressbild).
  // Mark failed så vi inte retryar, men rör inte image_license eller image_url.
  // Sätts via admin-endpoint POST /agent/ai-image/optout.
  if (statusCheck?.image_ai_optout === true) {
    console.log(`[ai-image-worker] job=${job.id} event=${eventId} image_ai_optout=true, skipping (preserve original)`);
    await supabase
      .from('events')
      .update({ image_generation_status: 'failed' })
      .eq('id', eventId);
    return;
  }
  if (statusCheck?.image_generation_status === 'no_credits') {
    console.log(`[ai-image-worker] job=${job.id} event=${eventId} no_credits-status, skipping until manual re-charge`);
    // Kasta ett specifikt fel som gör att BullMQ inte retryar
    throw new Error('SKIP_NO_CREDITS');
  }

  // Hämta syskon-grupp
  const group = groupByDedup(await fetchGroupMembers(eventId));
  console.log(`[ai-image-worker] event=${eventId} group has ${group.length} unique(s), ${group.reduce((n, g) => n + g.ids.length, 0)} events total`);

  // Anropa autoGen (EN bild per dedup-grupp)
  const batchResult = await callAutoGenBatch(group.map((g) => g.representative));
  recordSpend(batchResult.okCount * 0.025); // ~$0.025/bild

  // No-credits detection (2026-08-27): BFL slut på credits → märk alla som
  // no_credits OCH försök biblioteks-fallback så feeden inte blir tom.
  if (isCreditFailure(batchResult)) {
    const allIds = group.flatMap((g) => g.ids);
    console.error(`[ai-image-worker] BFL no-credits detected, marking ${allIds.length} events as no_credits`);
    await markNoCredits(allIds);
    // Library-fallback för att inte lämna användaren utan bild.
    let libAssigned = 0;
    for (const grp of group) {
      libAssigned += await assignLibraryFallbackForGroup(grp, 'no_credits');
    }
    console.log(`[ai-image-worker] 📚 no_credits-fallback: ${libAssigned} event(s) fick biblioteks-bild`);
    throw new Error('SKIP_NO_CREDITS'); // BullMQ skippar retries
  }

  // Uppdatera varje lyckad grupp i DB
  for (const grpResult of batchResult.results) {
    if (!grpResult.ok || !grpResult.imageUrl) continue;
    const grp = group.find((g) => g.key === grpResult.key);
    if (!grp) continue;
    await markEvents(grpResult.imageUrl, grpResult.storagePath, grp, grpResult.prompt || '', 'flux-dev');
    console.log(`[ai-image-worker]   group "${grp.key}" → ${grp.ids.length} event(s) updated, url=${grpResult.imageUrl}`);
  }

  const failedGroups = batchResult.results.filter((r) => !r.ok);
  if (failedGroups.length > 0) {
    const failedIds = failedGroups.flatMap((r) => r.eventIds);
    // Library-fallback per misslyckad grupp (per-call runtime-beslut).
    // Användaren ska ALDRIG se en tom bild om biblioteket har en matchning.
    let libAssigned = 0;
    for (const r of failedGroups) {
      const grp = group.find((g) => g.key === r.key);
      if (!grp) continue;
      libAssigned += await assignLibraryFallbackForGroup(grp, 'bfl_error');
    }
    if (libAssigned > 0) {
      console.log(`[ai-image-worker] 📚 transient-fallback: ${libAssigned} event(s) fick biblioteks-bild istället för BFL-fel`);
    }
    // Om vi INTE kunde fallback-hjälpa ALLA events: märk de kvarvarande som
    // failed för fortsatt retry. Annars är jobbet "löst" via library.
    const libCoveredIds = new Set<string>();
    for (const r of failedGroups) {
      const grp = group.find((g) => g.key === r.key);
      if (!grp) continue;
      const match = await pickLibraryFallback({ category_slug: grp.representative.category_slug });
      if (match.url) {
        for (const id of grp.ids) libCoveredIds.add(id);
      }
    }
    const stillFailedIds = failedIds.filter((id) => !libCoveredIds.has(id));
    if (stillFailedIds.length > 0) {
      await markFailed(stillFailedIds, new Error(failedGroups[0].error ?? 'unknown'), attempt);
      // Kasta för att BullMQ retryar
      throw new Error(`AI generation failed for ${stillFailedIds.length} event(s): ${failedGroups[0].error}`);
    }
  }

  console.log(`[ai-image-worker] job=${job.id} event=${eventId} done`);
}

// ── Worker startup ─────────────────────────────────────────────────────────

let _worker: Worker<AiImageJob> | null = null;

export function startAiImageWorker(): Worker<AiImageJob> | null {
  if (!ENABLED) {
    console.log('[ai-image-worker] AI_IMAGE_PIPELINE_ENABLED=0 — worker not started');
    return null;
  }
  if (_worker) return _worker;

  _worker = new Worker<AiImageJob>('ai-image-generation', processJob, {
    connection,
    prefix: 'bull',
    concurrency: 2, // Låg — BFL rate-limit, vi har en bild per dedup-grupp
  });

  _worker.on('completed', (job) => {
    console.log(`[ai-image-worker] ✅ job=${job.id} completed`);
  });

  _worker.on('failed', (job, err) => {
    if (err.message === 'SKIP_NO_CREDITS') return;
    console.error(`[ai-image-worker] ❌ job=${job?.id} failed: ${err.message}`);
  });

  _worker.on('error', (err) => {
    console.error('[ai-image-worker] worker error:', err.message);
  });

  console.log('[ai-image-worker] started, consuming ai-image-generation');
  return _worker;
}

// Starta worker direkt om denna fil körs (CLI-läge)
if (require.main === module) {
  startAiImageWorker();
  console.log('[ai-image-worker] running standalone, Ctrl+C to stop');
}