/**
 * index.ts — pipeline-orchestrator för Editorial Description Engine.
 *
 * Pipeline-steg 6 av 6 (slutsteg) i P7.
 *
 * Kedjan:
 *   buildEventProfile(input)        → Profile
 *        ↓
 *   compileWriterInputs(profile)    → WriterSafeInputs (KÖR firewall)
 *        ↓
 *   writeEditorialDescription(...)  → Draft
 *        ↓
 *   checkFactuality(draft, profile) → FactualityResult
 *        ↓
 *   checkIndependence(draft, source)→ IndependenceResult
 *        ↓
 *   PASS  → returnera draft
 *   FAIL  → regenerera (max 2 försök) med feedback
 *
 * Source description läses ALDRIG in i Writer-ledet. Den är BARA tillgänglig
 * HÄR (efter writer) för oberoende-kontroll.
 *
 * Steg 7/15 i P7 Definition of Done.
 */

import { buildEventProfile, profileInfoLevel, type EventUnderstandingInput } from './eventUnderstanding';
import { compileWriterInputs, assertFirewallClean } from './textualFirewall';
import { checkFactuality } from './factualityCheck';
import { checkIndependence, DEFAULT_SIMILARITY_THRESHOLD } from './independenceCheck';
import { writeEditorialDescription, type LlmClient } from './editorialWriter';
import type {
  EditorialDraft,
  EditorialPipelineResult,
  EventProfile,
  WriterSafeInputs,
} from './types';

// ─── Public API ──────────────────────────────────────────────────────────────

export interface EditorialPipelineInput {
  /** Strukturerade event-fält (från normalizer → events-tabell). */
  event: EventUnderstandingInput;
  /** Source description — ENDAST tillgänglig EFTER writer-anropet, inte i writer-inputs. */
  sourceDescription: string | null;
  /** LLM-klient (OpenAI eller mock). */
  llm: LlmClient;
  /** Valfri modell. */
  model?: string;
  /** Valfri seed för reproducerbarhet. */
  seed?: string;
  /** Max antal regenereringsförsök (default 2). */
  maxAttempts?: number;
  /** Valfri callback per försök (för loggning / metrics). */
  onAttempt?: (attempt: number, draft: EditorialDraft, profile: EventProfile) => void;
}

export interface EditorialPipelineOptions {
  factualityThreshold?: number;
  independenceThreshold?: number;
}

/**
 * Kör hela Editorial Description Engine-pipelinen.
 */
export async function runEditorialPipeline(
  input: EditorialPipelineInput,
  options: EditorialPipelineOptions = {},
): Promise<EditorialPipelineResult> {
  const maxAttempts = input.maxAttempts ?? 2;
  const indepThreshold = options?.independenceThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const factThreshold = options?.factualityThreshold; // null = använd default

  // ── Steg 1: Profile från strukturerade fält ──────────────────────────────
  const profile = buildEventProfile(input.event);
  const infoLevel = profileInfoLevel(profile);

  // ── Steg 2: WriterSafeInputs (brandväggen strippar source) ───────────────
  // Vi skickar HÄR bara Profile + event-data — INTE source_description.
  const writerInputs = compileWriterInputs({
    profile,
    event: {
      title: input.event.title ?? 'Event',
      start_time: input.event.start_time ?? new Date().toISOString(),
      venue_name: input.event.venue_name ?? null,
      city: input.event.city ?? null,
      price_min_sek: input.event.price_min_sek ?? null,
      is_free: input.event.is_free ?? false,
      language: input.event.language ?? null,
    },
  });

  // ── Steg 3-6: Writer + Factuality + Independence, regenerera vid fail ──
  let attempts = 0;
  let draft: EditorialDraft = await writeEditorialDescription({
    inputs: writerInputs,
    llm: input.llm,
    model: input.model,
    seed: input.seed,
  });
  draft.info_level = infoLevel;

  // Försök logga första attemptet.
  if (input.onAttempt) input.onAttempt(0, draft, profile);

  let factuality = checkFactuality({
    draft,
    profile,
    event: {
      title: input.event.title ?? undefined,
      venue_name: input.event.venue_name ?? null,
      city: input.event.city ?? null,
    },
  });

  let independence = checkIndependence({
    draft,
    sourceDescription: input.sourceDescription,
    threshold: indepThreshold,
  });

  while (
    attempts < maxAttempts &&
    (!factuality.pass || !independence.pass)
  ) {
    attempts++;

    // Regenerera med feedback i seed (så vi inte får samma output igen).
    const feedbackSeed = `regen-${attempts}:unsupported=${JSON.stringify(factuality.unsupported_claims)}:matched=${independence.matched_phrases.length}`;
    draft = await writeEditorialDescription({
      inputs: writerInputs,
      llm: input.llm,
      model: input.model,
      seed: feedbackSeed,
    });
    draft.info_level = infoLevel;
    if (input.onAttempt) input.onAttempt(attempts, draft, profile);

    factuality = checkFactuality({
      draft,
      profile,
      event: {
        title: input.event.title ?? undefined,
        venue_name: input.event.venue_name ?? null,
        city: input.event.city ?? null,
      },
    });

    independence = checkIndependence({
      draft,
      sourceDescription: input.sourceDescription,
      threshold: indepThreshold,
    });
  }

  // ── Slutgiltigt resultat ────────────────────────────────────────────────
  const passed = factuality.pass && independence.pass;
  const finalText = passed ? draft.text : undefined;
  const status: EditorialPipelineResult['status'] = passed
    ? 'passed'
    : attempts >= maxAttempts
      ? 'failed'
      : 'regenerating';

  return {
    status,
    draft,
    factuality,
    independence,
    attempts,
    final_text: finalText,
    error: passed
      ? undefined
      : `Kunde inte uppfylla båda kvalitetsgrindarna efter ${maxAttempts} försök: ` +
        (factuality.pass ? '' : `factuality fail (${factuality.unsupported_claims.length} unsupported); `) +
        (independence.pass ? '' : `independence fail (sim ${independence.max_similarity}); `),
  };
}

// ─── Helpers för storage ─────────────────────────────────────────────────────

import type { StoredEditorialDescription, StoredEventProfile } from './types';

/**
 * Bygg StoredEventProfile för DB-skrivning.
 */
export function buildStoredProfile(
  profile: EventProfile,
  sourceHashes: Record<string, string> = {},
): StoredEventProfile {
  return {
    profile,
    version: 1,
    generated_at: new Date().toISOString(),
    source_hashes: sourceHashes,
  };
}

/**
 * Bygg StoredEditorialDescription för DB-skrivning.
 */
export function buildStoredEditorialDescription(
  draft: EditorialDraft,
  factualityPass: boolean,
  independencePass: boolean,
): StoredEditorialDescription {
  return {
    text: draft.text,
    info_level: draft.info_level,
    factuality_pass: factualityPass,
    independence_pass: independencePass,
    model: draft.meta.model,
    prompt_version: draft.meta.prompt_version,
    generated_at: draft.meta.generated_at,
    attempts: 1,
    word_count: draft.word_count,
  };
}

// Re-export public surface för convenience.
export { buildEventProfile, compileWriterInputs, writeEditorialDescription, checkFactuality, checkIndependence };
export type { EditorialDraft, EditorialPipelineResult, EventProfile, WriterSafeInputs };