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
import { checkDataQuality, type DataQualityReport } from './dataQualityCheck';
import { writeEditorialDescription, type LlmClient } from './editorialWriter';
import { chooseFallback, type FallbackResult } from './fallbackHierarchy';
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
  /** LLM-klient (MiniMax-M3 eller mock). */
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
  let profile = buildEventProfile(input.event);

  // ── Steg 1.5: Data Quality Check (P7 steg 4) ────────────────────────────
  // Returnerar evidence fusion-rapport (signaler, conflict-flagga, confidence,
  // inferred_event_type). Profilen MUTERAS INTE. Gate skyddar bara Writer.
  // För Zurich-pattern: flera starka signaler (genre-ord i title, performers,
  // venue-typ) → conflict=true + inferred_event_type=music → pipeline kan
  // besluta att INTE kalla Writer och istället använda FACT-BASED fallback.
  const dataQuality: DataQualityReport = checkDataQuality(input.event, profile);

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
      category_slug: input.event.category_slug ?? null,
    },
  });

  let independence = checkIndependence({
    draft,
    sourceDescription: input.sourceDescription,
    profile: input.event ? {
      event_type: profile.event_type,
      performers: profile.performers,
      support_acts: profile.support_acts,
      genres: profile.genres,
      subgenres: profile.subgenres,
      content: profile.content,
      experience_characteristics: profile.experience_characteristics,
      setting: profile.setting,
      themes: profile.themes,
      concept: profile.concept,
      performance_style: profile.performance_style,
      audience_participation: profile.audience_participation,
      language: profile.language,
      target_audience: profile.target_audience,
      age_context: profile.age_context,
      duration_minutes: profile.duration_minutes,
      premiere: profile.premiere,
      tour: profile.tour,
      festival_context: profile.festival_context,
      special_guests: profile.special_guests,
      repertoire: profile.repertoire,
      production_characteristics: profile.production_characteristics,
      educational_content: profile.educational_content,
      family_characteristics: profile.family_characteristics,
      accessibility: profile.accessibility,
      practical_information: profile.practical_information,
      provenance: profile.provenance,
    } : undefined,
    event: {
      title: input.event.title ?? undefined,
      venue_name: input.event.venue_name ?? null,
      city: input.event.city ?? null,
    },
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
        category_slug: input.event.category_slug ?? null,
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
  let finalText = passed ? draft.text : undefined;
  let status: EditorialPipelineResult['status'];
  let fallback: FallbackResult | null = null;
  let error: string | undefined;

  if (passed) {
    status = 'passed';
  } else if (attempts < maxAttempts) {
    status = 'regenerating';
    error = `Kvalitetsgrind(ar) underkända efter ${attempts} försök: ` +
      (factuality.pass ? '' : `factuality (${factuality.unsupported_claims.length} unsupported); `) +
      (independence.pass ? '' : `independence (sim ${independence.max_similarity}); `);
  } else {
    // LLM klarade inte kvalitetsgrindarna — försök fallback-kedjan.
    // chooseFallback väljer FACT (om Profile räcker) → MINIMAL (om titel finns) → null.
    fallback = chooseFallback(profile, input.event);
    if (fallback.level) {
      finalText = fallback.text;
      status = fallback.level === 'FACT' ? 'fallback_fact' : 'fallback_minimal';
      error = undefined; // fallback hittades — inte ett fel
    } else {
      status = 'failed';
      error = `Kunde inte uppfylla kvalitetsgrindarna (${maxAttempts} försök) och ` +
              `ingen fallback möjlig (saknar titel/venue/datum).`;
    }
  }

  return {
    status,
    draft,
    factuality,
    independence,
    data_quality: dataQuality,
    attempts,
    final_text: finalText,
    error,
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