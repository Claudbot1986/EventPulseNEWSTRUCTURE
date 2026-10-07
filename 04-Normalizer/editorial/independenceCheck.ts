/**
 * independenceCheck.ts — jämför draft mot source description.
 *
 * Pipeline-steg 6 av 6 i EventPulse Editorial Description Engine (P7).
 *
 * Approach (deterministisk, ingen LLM):
 *   1. Jaccard-likhet på ord-nivå (uniq tokens).
 *   2. n-gram (3-5 ord) överlapp — fångar parafraserade fraser.
 *   3. Direkt fras-matchning (≥4 ord i rad från source).
 *
 * Högsta score blir resultatets max_similarity. Tröskelvärde 0.4 = fail.
 *
 * Source description läses INTE in i writer-pipelinen — den är ENDAST
 * tillgänglig HÄR i efterhand för att kontrollera att Writer höll sig
 * borta från originalspråket.
 *
 * Steg 6/15 i P7 Definition of Done.
 */

import type { EditorialDraft, IndependenceResult } from './types';

// ─── Tokenizer ────────────────────────────────────────────────────────────────

const SWEDISH_FILLER: ReadonlySet<string> = new Set([
  'i', 'och', 'att', 'det', 'är', 'som', 'för', 'av', 'med', 'till',
  'på', 'en', 'ett', 'den', 'de', 'som', 'så', 'men', 'eller', 'har',
  'kan', 'ska', 'vid', 'från', 'om', 'sig', 'sin', 'sina', 'the', 'a',
  'an', 'of', 'to', 'in', 'for', 'and', 'or', 'but',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wåäö\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SWEDISH_FILLER.has(w));
}

function ngrams(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ─── Direkt fras-matchning ───────────────────────────────────────────────────

const PHRASE_LENGTH = 4; // min 4 ord i rad för att räknas som "direkt fras"

/**
 * Hitta de längsta gemensamma sekvenserna mellan draft och source.
 * Returnerar max-likhet + exempel-fraser.
 */
function findMatchedPhrases(draft: string, source: string): string[] {
  const draftLower = draft.toLowerCase();
  const sourceLower = source.toLowerCase();

  // Vi behåller ord ≥ 2 tecken (för att inte tappa 'är', 'i', 'på').
  // För similarity-likhet (tokenize) används ≥ 3 + filler-listan.
  const draftWords = draftLower.split(/\s+/).filter((w) => w.length >= 2);
  const sourceWords = sourceLower.split(/\s+/).filter((w) => w.length >= 2);

  const matches: string[] = [];
  let i = 0;
  while (i < draftWords.length) {
    let matchedLength = 0;
    for (let len = Math.min(PHRASE_LENGTH, draftWords.length - i); len >= 3; len--) {
      const candidate = draftWords.slice(i, i + len).join(' ');
      const sourceJoined = sourceWords.join(' ');
      if (sourceJoined.includes(candidate)) {
        matchedLength = len;
        break;
      }
    }
    if (matchedLength > 0) {
      matches.push(draftWords.slice(i, i + matchedLength).join(' '));
      i += matchedLength;
    } else {
      i++;
    }
  }
  return matches;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

/** Standard-tröskel för vad som räknas som "för lik". */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.4;

export interface IndependenceCheckInput {
  draft: EditorialDraft;
  /** Source description-text (endast tillgänglig HÄR — inte i writer-inputs). */
  sourceDescription: string | null;
  /** Valfri threshold (0..1). Default 0.4. */
  threshold?: number;
}

export function checkIndependence(input: IndependenceCheckInput): IndependenceResult {
  const { draft, sourceDescription } = input;
  const threshold = input.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // Om source description är null/empty → kan inte kolla → pass.
  if (!sourceDescription || sourceDescription.trim().length === 0) {
    return {
      pass: true,
      max_similarity: 0,
      matched_phrases: [],
      checked_at: new Date().toISOString(),
    };
  }

  const draftTokens = new Set(tokenize(draft.text));
  const sourceTokens = new Set(tokenize(sourceDescription));
  const draftTri = ngrams(tokenize(draft.text), 3);
  const sourceTri = ngrams(tokenize(sourceDescription), 3);
  const draftFour = ngrams(tokenize(draft.text), 4);
  const sourceFour = ngrams(tokenize(sourceDescription), 4);

  const unigramSim = jaccard(draftTokens, sourceTokens);
  const trigramSim = jaccard(draftTri, sourceTri);
  const fourgramSim = jaccard(draftFour, sourceFour);
  const maxSim = Math.max(unigramSim, trigramSim, fourgramSim);

  const matchedPhrases = findMatchedPhrases(draft.text, sourceDescription);

  return {
    pass: maxSim < threshold && matchedPhrases.length === 0,
    max_similarity: Math.round(maxSim * 1000) / 1000,
    matched_phrases: matchedPhrases,
    checked_at: new Date().toISOString(),
  };
}