/**
 * liveSample.ts — kör hela Editorial-pipelinen mot 50 RIKTIGA events från
 * Supabase. Använder riktig MiniMax-M3 (eller mock om nyckel saknas).
 *
 * P7-14/15. Syfte: ge en ärlig bild av pipeline-prestanda i produktion.
 *
 *   1. Välj 50 events stratifierat (musik, teater, utställning, sport, etc.)
 *   2. För varje event: kör runEditorialPipeline() med riktig LLM
 *   3. Spara per-event trace till runtime/live-sample-YYYY-MM-DD.jsonl
 *   4. Sammanställ rapport: pass rate, fallback rate, failure rate,
 *      per stratum, per source-richness
 *
 * Kör: `npx tsx --env-file=.env 04-Normalizer/editorial/liveSample.ts`
 *
 * Steg 7/15 i P7 Definition of Done.
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { runEditorialPipeline } from './index';
import { MiniMaxM3LlmClient, MockLlmClient } from './editorialWriter';
import { buildEventProfile } from './eventUnderstanding';
import type { EventUnderstandingInput } from './eventUnderstanding';
import type { EditorialPipelineResult, EventProfile } from './types';
import { classifyFallbackReason } from './fallbackClassifier';
import { rankSourceRichness } from './sourceRichness';

// ─── Config ─────────────────────────────────────────────────────────────────

const N_EVENTS = 50;
const REPORT_DIR = path.resolve(process.cwd(), 'runtime');
const REPORT_FILE = path.resolve(REPORT_DIR, `live-sample-${new Date().toISOString().slice(0, 10)}.jsonl`);
const SUMMARY_FILE = path.resolve(REPORT_DIR, `live-sample-${new Date().toISOString().slice(0, 10)}.summary.json`);

// ─── Supabase client ────────────────────────────────────────────────────────

function buildSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta i .env');
  }
  return createClient(url, key);
}

// ─── Hämta stratifierade events ─────────────────────────────────────────────

interface DbEventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  category_slug: string | null;
  start_time: string;
  end_time: string | null;
  price_min_sek: number | null;
  is_free: boolean | null;
  source: string;
  raw_description: string | null;
  description_license: string | null;
  eventpulse_summary: string | null;
  venue_name: string | null;
}

/**
 * Hämta 50 events stratifierat per kategori.
 * Försöker plocka från flera kategorier för att testa bredden.
 */
async function fetchStratifiedEvents(supabase: ReturnType<typeof buildSupabaseClient>, n: number): Promise<DbEventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, title_sv, title_en, description_sv, description_en, category_slug, start_time, end_time, price_min_sek, is_free, source, raw_description, description_license, eventpulse_summary, venues(name)')
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Supabase query misslyckades: ${error.message}`);
  }

  // Platta ut venues.name → venue_name
  const flat: DbEventRow[] = (data ?? []).map((row: Record<string, unknown>) => {
    const venues = row.venues as { name?: string } | { name?: string }[] | null;
    const venueName = Array.isArray(venues) ? venues[0]?.name : venues?.name;
    return {
      id: row.id as string,
      title_sv: row.title_sv as string | null,
      title_en: row.title_en as string | null,
      description_sv: row.description_sv as string | null,
      description_en: row.description_en as string | null,
      category_slug: row.category_slug as string | null,
      start_time: row.start_time as string,
      end_time: row.end_time as string | null,
      price_min_sek: row.price_min_sek as number | null,
      is_free: row.is_free as boolean | null,
      source: row.source as string,
      raw_description: row.raw_description as string | null,
      description_license: row.description_license as string | null,
      eventpulse_summary: row.eventpulse_summary as string | null,
      venue_name: venueName ?? null,
    };
  });

  return stratify(flat, n);
}

function stratify(events: DbEventRow[], n: number): DbEventRow[] {
  // Gruppera per kategori, ta jämnt från varje
  const byCategory: Record<string, DbEventRow[]> = {};
  for (const e of events) {
    const cat = e.category_slug ?? 'unknown';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(e);
  }

  const result: DbEventRow[] = [];
  const categories = Object.keys(byCategory);
  let idx = 0;
  while (result.length < n && idx < 50) {
    let addedThisRound = 0;
    for (const cat of categories) {
      const bucket = byCategory[cat];
      if (bucket && idx < bucket.length) {
        result.push(bucket[idx]);
        addedThisRound++;
        if (result.length >= n) break;
      }
    }
    if (addedThisRound === 0) break; // slut på events
    idx++;
  }
  return result.slice(0, n);
}

// ─── LLM client ─────────────────────────────────────────────────────────────

function buildLlmClient(): MiniMaxM3LlmClient | MockLlmClient {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn('[liveSample] MINIMAX_API_KEY saknas — använder MockLlmClient (placeholder-text)');
    return new MockLlmClient('Eventbeskrivning (mock).');
  }
  return new MiniMaxM3LlmClient({
    apiKey,
    defaultModel: process.env.MINIMAX_MODEL ?? 'minimax-M3',
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1',
  });
}

// ─── Per-event trace ────────────────────────────────────────────────────────

export interface LiveSampleEventTrace {
  event_id: string;
  title: string;
  category: string | null;
  venue: string | null;
  city: string | null;
  start_time: string;
  source: string;
  source_richness: 'RICH' | 'MEDIUM' | 'POOR' | 'NO_SOURCE';
  raw_description_length: number;
  profile_summary: {
    event_type: string;
    performers_count: number;
    genres: string[];
    duration_minutes: number | null;
  };
  llm: {
    model: string;
    attempts: number;
    finish_reason: string | null;
    reasoning_tokens: number | null;
    output_tokens: number | null;
    latency_ms: number | null;
  };
  pipeline: {
    status: EditorialPipelineResult['status'];
    final_text: string | null;
    final_text_length: number;
    factuality_pass: boolean | null;
    independence_pass: boolean | null;
    unsupported_claims: string[];
    fallback_reason: string | null;
  };
  error: string | null;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

export async function runLiveSample(): Promise<{
  total: number;
  pass_rate: number;
  fallback_rate: number;
  failure_rate: number;
  by_category: Record<string, { count: number; pass: number; fallback: number; failed: number }>;
  by_richness: Record<string, { count: number; pass: number; fallback: number; failed: number }>;
  fallback_reasons: Record<string, number>;
  traces: LiveSampleEventTrace[];
}> {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

  const supabase = buildSupabaseClient();
  const events = await fetchStratifiedEvents(supabase, N_EVENTS);
  console.log(`[liveSample] Hämtade ${events.length} events från Supabase`);

  const llm = buildLlmClient();
  const isRealLlm = llm instanceof MiniMaxM3LlmClient;
  console.log(`[liveSample] LLM: ${isRealLlm ? 'MiniMax-M3 (real)' : 'Mock'}`);

  // Initiera trace-fil (tom)
  writeFileSync(REPORT_FILE, '');

  const traces: LiveSampleEventTrace[] = [];
  const byCategory: Record<string, { count: number; pass: number; fallback: number; failed: number }> = {};
  const byRichness: Record<string, { count: number; pass: number; fallback: number; failed: number }> = {};
  const fallbackReasons: Record<string, number> = {};

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const category = event.category_slug ?? 'unknown';
    const richness = rankSourceRichness(event.raw_description, event.description_sv, event.eventpulse_summary);

    const titleForLog = event.title_sv ?? event.title_en ?? 'untitled';
    console.log(`[liveSample] (${i + 1}/${events.length}) ${titleForLog.slice(0, 60)} (${richness}, ${category})`);

    // Bygg EventUnderstandingInput
    const input: EventUnderstandingInput = {
      category_slug: event.category_slug,
      venue_name: event.venue_name,
      city: null, // city finns inte i events-tabellen (kommer från venue)
      start_time: event.start_time,
      end_time: event.end_time,
      price_min_sek: event.price_min_sek,
      is_free: event.is_free,
      language: 'sv',
      source: event.source,
      title: event.title_sv ?? event.title_en,
      raw_description: event.raw_description ?? null,
    };

    let result: EditorialPipelineResult;
    let profile: EventProfile;
    let error: string | null = null;
    const startTime = Date.now();
    try {
      result = await runEditorialPipeline({
        event: input,
        sourceDescription: event.raw_description ?? null,
        llm,
        model: isRealLlm ? 'minimax-M3' : 'mock',
        maxAttempts: 2,
      });
      profile = buildEventProfile(input);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = {
        status: 'failed',
        attempts: 0,
        error,
      };
      profile = buildEventProfile(input);
    }
    const latencyMs = Date.now() - startTime;

    // Klassificera fallback reason
    const fallbackReason = result.status === 'passed' || result.status === 'pending'
      ? null
      : classifyFallbackReason(result, profile, event.raw_description);

    if (fallbackReason) {
      fallbackReasons[fallbackReason] = (fallbackReasons[fallbackReason] ?? 0) + 1;
    }

    // Uppdatera aggregerad statistik
    const catBucket = byCategory[category] ??= { count: 0, pass: 0, fallback: 0, failed: 0 };
    catBucket.count++;
    if (result.status === 'passed') catBucket.pass++;
    else if (result.status.startsWith('fallback')) catBucket.fallback++;
    else if (result.status === 'failed') catBucket.failed++;

    const richBucket = byRichness[richness] ??= { count: 0, pass: 0, fallback: 0, failed: 0 };
    richBucket.count++;
    if (result.status === 'passed') richBucket.pass++;
    else if (result.status.startsWith('fallback')) richBucket.fallback++;
    else if (result.status === 'failed') richBucket.failed++;

    // Bygg trace
    const trace: LiveSampleEventTrace = {
      event_id: event.id,
      title: titleForLog,
      category,
      venue: event.venue_name,
      city: null,
      start_time: event.start_time,
      source: event.source,
      source_richness: richness,
      raw_description_length: event.raw_description?.length ?? 0,
      profile_summary: {
        event_type: profile.event_type,
        performers_count: profile.performers.length,
        genres: profile.genres,
        duration_minutes: profile.duration_minutes ?? null,
      },
      llm: {
        model: isRealLlm ? 'minimax-M3' : 'mock',
        attempts: result.attempts,
        finish_reason: (result.draft as { meta?: { finish_reason?: string } } | undefined)?.meta?.finish_reason ?? null,
        reasoning_tokens: null, // TODO: extract from real LLM response
        output_tokens: null, // TODO: extract from real LLM response
        latency_ms: latencyMs,
      },
      pipeline: {
        status: result.status,
        final_text: result.final_text ?? null,
        final_text_length: result.final_text?.length ?? 0,
        factuality_pass: result.factuality?.pass ?? null,
        independence_pass: result.independence?.pass ?? null,
        unsupported_claims: result.factuality?.unsupported_claims ?? [],
        fallback_reason: fallbackReason,
      },
      error,
    };
    traces.push(trace);

    // Skriv till JSONL
    appendFileSync(REPORT_FILE, JSON.stringify(trace) + '\n');
  }

  // Sammanställ
  const total = traces.length;
  const pass = traces.filter((t) => t.pipeline.status === 'passed').length;
  const fallback = traces.filter((t) => t.pipeline.status.startsWith('fallback')).length;
  const failed = traces.filter((t) => t.pipeline.status === 'failed').length;

  const summary = {
    total,
    pass_rate: total > 0 ? pass / total : 0,
    fallback_rate: total > 0 ? fallback / total : 0,
    failure_rate: total > 0 ? failed / total : 0,
    by_category: byCategory,
    by_richness: byRichness,
    fallback_reasons: fallbackReasons,
    traces: traces.slice(0, 15), // För snabb översikt i summary
  };

  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  return summary;
}

// ─── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('liveSample.ts')) {
  runLiveSample()
    .then((s) => {
      console.log('');
      console.log('='.repeat(60));
      console.log('LIVE-SAMPLE TEST — Editorial Engine (P7)');
      console.log('='.repeat(60));
      console.log(`Total events: ${s.total}`);
      console.log(`Pass rate:    ${(s.pass_rate * 100).toFixed(1)}% (${s.traces.filter((t) => t.pipeline.status === 'passed').length} events)`);
      console.log(`Fallback:     ${(s.fallback_rate * 100).toFixed(1)}% (${s.traces.filter((t) => t.pipeline.status.startsWith('fallback')).length} events)`);
      console.log(`Failure:      ${(s.failure_rate * 100).toFixed(1)}% (${s.traces.filter((t) => t.pipeline.status === 'failed').length} events)`);
      console.log('');
      console.log('By category:');
      for (const [cat, b] of Object.entries(s.by_category)) {
        console.log(`  ${cat.padEnd(20)} n=${b.count} pass=${b.pass} fallback=${b.fallback} failed=${b.failed}`);
      }
      console.log('');
      console.log('By source richness:');
      for (const [r, b] of Object.entries(s.by_richness)) {
        console.log(`  ${r.padEnd(12)} n=${b.count} pass=${b.pass} fallback=${b.fallback} failed=${b.failed}`);
      }
      console.log('');
      console.log('Fallback reasons:');
      for (const [r, c] of Object.entries(s.fallback_reasons)) {
        console.log(`  ${r.padEnd(40)} n=${c}`);
      }
      console.log('');
      console.log(`Traces saved to: ${REPORT_FILE}`);
      console.log(`Summary saved to: ${SUMMARY_FILE}`);
    })
    .catch((err) => {
      console.error('Live sample failed:', err);
      process.exit(1);
    });
}
