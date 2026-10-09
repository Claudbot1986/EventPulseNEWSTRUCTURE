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
 * LLM: MiniMax-M3 via MINIMAX_API_KEY (root .env). Saknas nyckel → mock-LLM
 * (icke-fatalt, korta placeholder-texter). Byt modell/endpoint via
 * MINIMAX_MODEL / MINIMAX_BASE_URL.
 *
 * Fel hanteras som non-critical (som aiImageQueue) — misslyckad editorial
 * får INTE hindra eventet från att synas i UI. UI faller tillbaka till
 * eventpulse_summary om editorial saknas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runEditorialPipeline, buildStoredProfile, buildStoredEditorialDescription } from './index';
import { MiniMaxM3LlmClient, MockLlmClient } from './editorialWriter';
import type { EventUnderstandingInput } from './eventUnderstanding';

// ─── Env / config ────────────────────────────────────────────────────────────

export function isEditorialEnabled(): boolean {
  return process.env.EDITORIAL_ENABLED === '1';
}

function buildLlmClient(): MiniMaxM3LlmClient | MockLlmClient {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    // Icke-fatalt — faller tillbaka till mock med kort text. Bättre än att
    // krascha normalizer-kön.
    console.warn('[editorial] MINIMAX_API_KEY saknas — använder mock-LLM (korta placeholder-texter)');
    return new MockLlmClient('Eventbeskrivning (mock — MINIMAX_API_KEY ej satt).');
  }
  return new MiniMaxM3LlmClient({
    apiKey,
    defaultModel: process.env.MINIMAX_MODEL ?? 'minimax-M3',
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1',
  });
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
 *
 * FAS 3 Evidence Pack (2026-10-09): vi sätter INTE performers här — låt
 * buildEventProfile:s inbyggda entity_extractor-fallback (som kör
 * extractEntities med regler + LLM-fallback) fylla performers från title
 * om artistResolver inte redan har gett några.
 *
 * Den tidigare `extractPerformersFromTitle`-heuristiken (första kapitaliserade
 * frasen) är avlägsnad — entity_extractor är mer sofistikerad och fångar
 * colon_lists, slash_collabs, ampersand_lists, single_name, etc.
 */
export function toEventUnderstandingInput(
  e: NormalizedEventForEditorial,
): EventUnderstandingInput {
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
    // performers lämnas tom — buildEventProfile:s entity_extractor-fallback
    // fyller på om nödvändigt. Detta förhindrar dubbel-extraktion och ger
    // samma extraherings-pipeline oavsett om artistResolver har data eller ej.
    performers: undefined,
  };
}

// ─── DB-skribent ─────────────────────────────────────────────────────────────

export async function writeEditorialBack(
  supabase: SupabaseClient,
  event_id: string,
  pipelineResult: Awaited<ReturnType<typeof runEditorialPipeline>>,
  profile: import('./types').EventProfile,
): Promise<boolean> {
  // Vi skriver tillbaka om vi har en slutgiltig text — oavsett om det är
  // LLM-genererad (passed) eller fallback (fallback_fact / fallback_minimal).
  // Hellre en FACT-lista än ingenting alls i UI.
  if (pipelineResult.status === 'failed' ||
      pipelineResult.status === 'regenerating' ||
      pipelineResult.status === 'pending' ||
      !pipelineResult.final_text) {
    console.log(`[editorial] event ${event_id} status=${pipelineResult.status} — skriv INTE tillbaka (ingen slutgiltig text)`);
    return false;
  }

  // LLM-genererad: använd full meta (model, prompt_version, attempts).
  // Fallback: bygg StoredEditorialDescription utan LLM-meta.
  const sed = pipelineResult.draft
    ? buildStoredEditorialDescription(
        pipelineResult.draft,
        pipelineResult.factuality?.pass ?? false,
        pipelineResult.independence?.pass ?? false,
      )
    : {
        // Fallback-text — bygg minimal StoredEditorialDescription
        text: pipelineResult.final_text,
        info_level: pipelineResult.status === 'fallback_fact' ? ('LOW' as const) : ('VERY_LOW' as const),
        factuality_pass: false, // fallback kunde inte valideras
        independence_pass: false,
        model: 'fallback',
        prompt_version: 'fallback-v1',
        generated_at: new Date().toISOString(),
        attempts: pipelineResult.attempts + 1,
        word_count: pipelineResult.final_text.split(/\s+/).filter(Boolean).length,
      };
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
  const source = pipelineResult.draft ? 'LLM' : 'fallback';
  console.log(`[editorial] event ${event_id} skrev ${source}-beskrivning (info_level=${sed.info_level}, attempts=${pipelineResult.attempts + 1})`);
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
      model: llm instanceof MiniMaxM3LlmClient ? 'minimax-M3' : 'mock',
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