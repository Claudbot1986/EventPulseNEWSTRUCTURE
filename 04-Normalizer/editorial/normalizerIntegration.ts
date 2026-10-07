/**
 * normalizerIntegration.ts — kopplar Editorial Engine in i normalizer-flödet.
 *
 * P7-9/15. Opt-in via EDITORIAL_ENABLED=1 env-flagga (default AV).
 *
 * Flödar efter att ett event har insertats/uppdaterats i events-tabellen:
 *   1. Bygg EventUnderstandingInput från normaliserade event-fält.
 *   2. Kör runEditorialPipeline().
 *   3. Om status === 'passed' → skriv tillbaka Profile + editorial_description
 *      + generated_at + info_level + model + prompt_version.
 *
 * Fel hanteras som non-critical (som aiImageQueue) — misslyckad editorial
 * får INTE hindra eventet från att synas i UI. UI faller tillbaka till
 * eventpulse_summary om editorial saknas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runEditorialPipeline, buildStoredProfile, buildStoredEditorialDescription } from './index';
import { OpenAILlmClient, MockLlmClient } from './editorialWriter';
import type { EventUnderstandingInput } from './eventUnderstanding';

// ─── Env / config ────────────────────────────────────────────────────────────

export function isEditorialEnabled(): boolean {
  return process.env.EDITORIAL_ENABLED === '1';
}

function buildLlmClient(): OpenAILlmClient | MockLlmClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Icke-fatalt — faller tillbaka till mock med kort text. Bättre än att
    // krascha normalizer-kön.
    console.warn('[editorial] OPENAI_API_KEY saknas — använder mock-LLM (korta placeholder-texter)');
    return new MockLlmClient('Eventbeskrivning (mock — OPENAI_API_KEY ej satt).');
  }
  return new OpenAILlmClient({ apiKey });
}

// ─── Input-byggare ───────────────────────────────────────────────────────────

export interface NormalizedEventForEditorial {
  event_id: string;
  title: string | null;
  title_sv?: string | null;
  category_slug?: string | null;
  venue_name?: string | null;
  city?: string | null;
  start_time: string | null;
  end_time?: string | null;
  price_min_sek?: number | null;
  is_free?: boolean | null;
  language?: string | null;
  source: string | null;
  /** Source description (för oberoende-kontroll — skickas INTE till Writer). */
  raw_description?: string | null;
}

/**
 * Översätt normaliserade event-fält → EventUnderstandingInput.
 */
export function toEventUnderstandingInput(
  e: NormalizedEventForEditorial,
): EventUnderstandingInput {
  // Försök hitta performers från title (artistResolver sköter redan detta i
  // normalizer.ts). Här använder vi bara title som fallback.
  return {
    category_slug: e.category_slug ?? null,
    venue_name: e.venue_name ?? null,
    city: e.city ?? null,
    start_time: e.start_time ?? null,
    end_time: e.end_time ?? null,
    price_min_sek: e.price_min_sek ?? null,
    is_free: e.is_free ?? null,
    language: e.language ?? null,
    source: e.source ?? null,
    title: e.title ?? null,
    performers: extractPerformersFromTitle(e.title),
  };
}

function extractPerformersFromTitle(title: string | null | undefined): string[] {
  if (!title) return [];
  // Enkel heuristik: "Artist på venue" / "Artist: subtitel" / "Artist @ venue"
  // Tar första kapitaliserade frasen som performer.
  const m = title.match(/^([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)*)/);
  return m ? [m[1]] : [];
}

// ─── DB-skribent ─────────────────────────────────────────────────────────────

export async function writeEditorialBack(
  supabase: SupabaseClient,
  event_id: string,
  pipelineResult: Awaited<ReturnType<typeof runEditorialPipeline>>,
  profile: import('./types').EventProfile,
): Promise<boolean> {
  if (pipelineResult.status !== 'passed') {
    console.log(`[editorial] event ${event_id} status=${pipelineResult.status} — skriv INTE tillbaka`);
    return false;
  }

  const sed = buildStoredEditorialDescription(
    pipelineResult.draft!,
    pipelineResult.factuality!.pass,
    pipelineResult.independence!.pass,
  );
  const sp = buildStoredProfile(profile);

  const { error } = await supabase
    .from('events')
    .update({
      event_profile: sp,
      editorial_description: sed.text,
      editorial_description_generated_at: sed.generated_at,
      editorial_info_level: sed.info_level,
      editorial_model: sed.model,
      editorial_prompt_version: sed.prompt_version,
    } as never)
    .eq('id', event_id);

  if (error) {
    console.warn(`[editorial] DB-update misslyckades för ${event_id}: ${error.message}`);
    return false;
  }
  console.log(`[editorial] event ${event_id} skrev redaktionell beskrivning (info_level=${sed.info_level}, attempts=${pipelineResult.attempts + 1})`);
  return true;
}

// ─── Huvudintegration ────────────────────────────────────────────────────────

export interface EditorialIntegrationDeps {
  supabase: import('@supabase/supabase-js').SupabaseClient;
}

/**
 * Kör Editorial Engine för ett normaliserat event och skriv tillbaka.
 * Opt-in via EDITORIAL_ENABLED=1.
 */
export async function maybeRunEditorial(
  deps: EditorialIntegrationDeps,
  event: NormalizedEventForEditorial,
): Promise<void> {
  if (!isEditorialEnabled()) return;
  if (!event.event_id) return;

  const llm = buildLlmClient();
  const inputs = toEventUnderstandingInput(event);

  try {
    const result = await runEditorialPipeline({
      event: inputs,
      sourceDescription: event.raw_description ?? null,
      llm,
      model: llm instanceof OpenAILlmClient ? 'gpt-4o-mini' : 'mock',
      maxAttempts: 2,
    });

    // Hämta profile separat (vi behöver den för storage även om result failed).
    const { buildEventProfile } = await import('./eventUnderstanding');
    const profile = buildEventProfile(inputs);

    await writeEditorialBack(deps.supabase, event.event_id, result, profile);
  } catch (err) {
    console.warn(
      `[editorial] event ${event.event_id} misslyckades:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}