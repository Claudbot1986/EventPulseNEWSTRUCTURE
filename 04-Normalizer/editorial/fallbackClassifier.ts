/**
 * fallbackClassifier.ts — klassificerar VARFÖR en Editorial-pipeline slutade
 * i fallback (eller failed) istället för passed.
 *
 * Används i P7 live-sample för att ge actionable breakdown av failure modes.
 *
 * Kategorier:
 *   - factuality_false_positive  : unsupported claims var faktiskt normaliserade
 *                                  format av känt data (false positive i checkern)
 *   - actual_hallucination       : unsupported claims var fakta som INTE finns
 *                                  i Profile (LLM hittade på)
 *   - independence_false_positive: matched phrases var generiska ord (gemensamma
 *                                  med många andra texter, inte source-kopiering)
 *   - actual_source_similarity   : matched phrases var UNIKA för source
 *                                  (klar抄袭 — Writer kopierade source)
 *   - token_truncation           : final text var < 30 ord, misstänkt trunkering
 *   - writer_empty               : final text saknas helt
 *   - insufficient_information   : Profile hade < 2 fält, ingen fallback-kedja
 *                                  kunde bygga något
 *   - data_quality_conflict      : DataQualityCheck blockerade (kontroversiell
 *                                  data mellan sources)
 *   - other                      : Oklassificerat
 *
 * P7-15/15 (del av live-sample analysis).
 */

import type { EditorialPipelineResult, EventProfile } from './types';

export type FallbackReason =
  | 'factuality_false_positive'
  | 'actual_hallucination'
  | 'independence_false_positive'
  | 'actual_source_similarity'
  | 'token_truncation'
  | 'writer_empty'
  | 'insufficient_information'
  | 'data_quality_conflict'
  | 'other';

/**
 * Generiska svenska ord som ofta matchas av independence-check men inte är
 * "källkopia" — de är naturliga adjektiv/verb som alla evenemangstexter har.
 */
const GENERIC_INDEPENDENCE_PHRASES: ReadonlySet<string> = new Set([
  'varmt välkomna', 'varmt välkommen', 'hjärtligt välkomna',
  'unik upplevelse', 'unika upplevelse', 'oförglömlig',
  'magisk kväll', 'magisk upplevelse', 'stämningsfull',
  'ta del av', 'ta del', 'njut av', 'upplev',
  'i samarbete med', 'med stöd av', 'presenterar',
  'för första gången', 'efter lång tid', 'äntligen',
  'varmt', 'hjärtligt', 'kärleksfullt',
]);

export function classifyFallbackReason(
  result: EditorialPipelineResult,
  profile: EventProfile,
  rawDescription: string | null,
): FallbackReason {
  // 1) writer_empty — final text saknas
  if (!result.final_text || result.final_text.length === 0) {
    return 'writer_empty';
  }

  // 2) token_truncation — final text < 30 ord
  const wordCount = result.final_text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 30) {
    return 'token_truncation';
  }

  // 3) data_quality_conflict — DataQuality signalerade konflikt
  if (result.data_quality && result.data_quality.conflict) {
    return 'data_quality_conflict';
  }

  // 4) insufficient_information — Profile har < 2 fält
  const profileFields = countProfileFields(profile);
  if (profileFields < 2) {
    return 'insufficient_information';
  }

  // 5) Independence-fail — kolla om matched phrases var generiska eller unika
  if (result.independence && !result.independence.pass) {
    const matched = result.independence.matched_phrases;
    const allGeneric = matched.every((p) => isGenericPhrase(p));
    if (allGeneric) {
      return 'independence_false_positive';
    }
    return 'actual_source_similarity';
  }

  // 6) Factuality-fail — analysera om unsupported claims var faktiskt stödda
  if (result.factuality && !result.factuality.pass) {
    const unsupported = result.factuality.unsupported_claims;
    // Räkna hur många som är "kända" (parseable as duration/price/date etc)
    // eller substantiella ord som PROBABLY borde stödjas
    const falsePositives = countLikelyFalsePositives(unsupported, profile);
    if (falsePositives > unsupported.length * 0.5) {
      return 'factuality_false_positive';
    }
    return 'actual_hallucination';
  }

  return 'other';
}

function isGenericPhrase(phrase: string): boolean {
  const lower = phrase.toLowerCase().trim();
  if (GENERIC_INDEPENDENCE_PHRASES.has(lower)) return true;
  // Korta fraser (< 4 ord) tenderar att vara generiska
  if (lower.split(/\s+/).length < 4) return true;
  return false;
}

function countProfileFields(profile: EventProfile): number {
  let count = 0;
  if (profile.performers.length > 0) count++;
  if (profile.genres.length > 0) count++;
  if (profile.content.length > 0) count++;
  if (profile.experience_characteristics.length > 0) count++;
  if (profile.themes && profile.themes.length > 0) count++;
  if (profile.duration_minutes) count++;
  if (profile.ensemble) count++;
  if (profile.setting) count++;
  return count;
}

function countLikelyFalsePositives(claims: string[], profile: EventProfile): number {
  let falsePositives = 0;
  for (const claim of claims) {
    const lower = claim.toLowerCase();
    // Containment i en profile-text
    const allProfileText = [
      ...profile.performers,
      ...profile.genres,
      ...profile.subgenres ?? [],
      ...profile.content,
      ...profile.experience_characteristics,
      ...profile.themes ?? [],
      ...profile.setting ? [profile.setting] : [],
      profile.ensemble ?? '',
    ].join(' ').toLowerCase();
    // 1) Innehåller profile-substantiv → false positive
    const profileWords = new Set(allProfileText.split(/\s+/).filter((w) => w.length >= 5));
    const claimWords = lower.split(/\s+/).filter((w) => w.length >= 5);
    const overlap = claimWords.filter((w) => profileWords.has(w)).length;
    if (overlap > 0 && overlap / claimWords.length >= 0.5) {
      falsePositives++;
      continue;
    }
    // 2) Generiska duration/format-ord → false positive
    if (/^\d+\s*(min|tim|kr|:-|kronor|år)/i.test(lower)) {
      falsePositives++;
      continue;
    }
    // 3) Mycket korta claims (1-2 ord) → false positive
    if (claimWords.length <= 1) {
      falsePositives++;
    }
  }
  return falsePositives;
}
