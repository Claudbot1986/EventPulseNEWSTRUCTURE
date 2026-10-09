/**
 * entityConfidencePenalty — konfidens-penalty baserat på entitets-extraktion.
 *
 * FAS 3.5 (2026-10-09): När entity-extraktion ger osäkra resultat (INFERRED,
 * AMBIGUOUS, UNKNOWN) vill vi sänka eventets confidence_score så att
 * activeLearning-flaggan i 08-Agent/tools/activeLearning.ts triggar
 * automatiskt.
 *
 * Ren funktion — ingen I/O, ingen DB, inga side-effects. Enkel att testa.
 *
 * Penalty-reducering (max 15 poäng avdrag):
 *   - Varje INFERRED/AMBIGUOUS/UNKNOWN entity:    -3 poäng
 *   - Varje SUPPORTED entity:                     +1 poäng (boost — visar att
 *                                                   extraktionen är aktiv)
 *   - Inga entities hittade:                      0 (ingen signal — normalizer
 *                                                   kan ha andra ledtrådar)
 *   - Alla entities VERIFIED:                     +5 (boost för säker data)
 *
 * Clampas till [−15, +5]. Aldrig mer än 15 poäng avdrag eftersom
 * confidence_score är floor 0 och vi vill inte göra att en händelse
 * med bra venues/data sjunker till noll.
 */

import type { ExtractedEntity } from './types';

export const ENTITY_CONFIDENCE_PENALTY_MAX = 15;
export const ENTITY_CONFIDENCE_BOOST_MAX = 5;

const PENALTY_PER_INFERRED = 3;
const PENALTY_PER_AMBIGUOUS = 4;     // lite värre än INFERRED
const PENALTY_PER_UNKNOWN = 2;
const BOOST_PER_VERIFIED = 2;
const BOOST_PER_SUPPORTED = 1;
const BOOST_ALL_VERIFIED = 5;

/**
 * Beräkna penalty baserat på extraherade entiteter.
 *
 * Returnerar NEGATIVT tal om events borde sänkas (osäkra entities),
 * POSITIVT tal om events kan höjas (bra data), 0 om ingen signal.
 *
 * Resultatet är INTE den slutliga confidence_score — utan en delta
 * som appliceras EFTER computeConfidenceV1.
 */
export function computeEntityPenalty(entities: ReadonlyArray<ExtractedEntity>): number {
  if (entities.length === 0) return 0;

  let delta = 0;
  let verifiedCount = 0;
  let inferredOrWorseCount = 0;

  for (const e of entities) {
    switch (e.confidence) {
      case 'VERIFIED':
        verifiedCount++;
        delta += BOOST_PER_VERIFIED;
        break;
      case 'SUPPORTED':
        delta += BOOST_PER_SUPPORTED;
        break;
      case 'INFERRED':
        delta -= PENALTY_PER_INFERRED;
        inferredOrWorseCount++;
        break;
      case 'AMBIGUOUS':
        delta -= PENALTY_PER_AMBIGUOUS;
        inferredOrWorseCount++;
        break;
      case 'UNKNOWN':
        delta -= PENALTY_PER_UNKNOWN;
        inferredOrWorseCount++;
        break;
    }
  }

  // Om ALLA är verifierade → bonus (entitets-flödet är extra säkert)
  if (entities.length > 0 && verifiedCount === entities.length) {
    delta += BOOST_ALL_VERIFIED;
  }

  // Clampa — vi vill aldrig ge mer än MAX penalty eller MAX boost.
  if (delta < -ENTITY_CONFIDENCE_PENALTY_MAX) delta = -ENTITY_CONFIDENCE_PENALTY_MAX;
  if (delta > ENTITY_CONFIDENCE_BOOST_MAX) delta = ENTITY_CONFIDENCE_BOOST_MAX;

  return delta;
}

/**
 * Applicera penalty på en confidence_score. Floor 0, ceil 100.
 */
export function applyEntityPenalty(
  baseScore: number,
  entities: ReadonlyArray<ExtractedEntity>,
): number {
  const delta = computeEntityPenalty(entities);
  return Math.max(0, Math.min(100, baseScore + delta));
}
