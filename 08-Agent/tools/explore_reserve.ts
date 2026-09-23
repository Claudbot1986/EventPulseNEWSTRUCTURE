/**
 * Utforskningsreserv — Fas C.4 (2026-09-23).
 *
 * The treatment feed re-ranks the whole page by taste. Without a counterweight
 * the page becomes a filter bubble: every slot reflects what the user already
 * likes, and events outside the taste profile never surface. TikTok keeps a
 * deliberate exploration budget for exactly this reason (their rabbit-hole
 * analyses settled around ~7 % of slots exempt from the engagement ranker —
 * see 00-Vault/.../2026-09-23-Rankningsparametrar-Research.md, K3).
 *
 * Mechanism: for each slot index of the page, a deterministic hash decides
 * whether the slot is "reserved". Reserved slots keep their original
 * chronological card — untouched by the ranker, no reasons/score — while the
 * remaining slots are filled with the ranked order. Deterministic per
 * (userId, windowDate, slot index):
 *
 *   - Same user + same window → identical reservation pattern between
 *     refreshes (no reshuffle flicker; a card does not jump slots mid-session).
 *   - New window date (each day/feed window) → fresh pattern.
 *   - Different users → different patterns (not one global carve-out).
 *
 * Hash pattern copied from experiments.ts (SHA-256, digest.readUInt32BE(0))
 * so the two modules stay stylistically consistent.
 */

import { createHash } from 'node:crypto';

import type { EventCard, RankedEvent } from '../types';

/**
 * Fraction of feed slots reserved for exploration. ~7 %, the TikTok
 * exploration-budget ballpark (research note 2026-09-23, K3).
 */
export const EXPLORE_RESERVE_FRACTION = 0.07;

/**
 * Salt for the reservation hash. Names the feature + version so the pattern
 * can be rotated deliberately (bump the suffix → new pattern for everyone).
 */
const EXPLORE_RESERVE_SALT = 'eventpulse-explore-reserve-v1-2026-09-23';

/**
 * Is feed slot `index` reserved for exploration for this (user, window)?
 * Pure, deterministic, no I/O.
 */
export function isReservedSlot(userId: string, windowDate: string, index: number): boolean {
  const digest = createHash('sha256')
    .update(
      EXPLORE_RESERVE_SALT +
        '\x00' +
        userId +
        '\x00' +
        windowDate +
        '\x00' +
        String(index),
    )
    .digest();
  return digest.readUInt32BE(0) < EXPLORE_RESERVE_FRACTION * 0xffffffff;
}

export interface ApplyExploreReserveInput {
  /** The chronological page as produced before ranking. */
  chronological: EventCard[];
  /** The ranker's verdict over the same cards, best first. */
  ranked: RankedEvent[];
  /** Feed user (UUID) — keys the reservation pattern. */
  userId: string;
  /** Feed window date (YYYY-MM-DD) — reshuffles the pattern per window. */
  windowDate: string;
}

export interface ApplyExploreReserveResult {
  /** The merged page: reserved slots chronological, the rest ranked. */
  events: EventCard[];
  /** IDs of the cards that kept their chronological slot. */
  reservedIds: string[];
}

/**
 * Merge the ranked page back onto the chronological page, honoring the
 * exploration reserve. No card is lost or duplicated: `ranked` must cover
 * the same cards as `chronological` (the ranker only re-orders the window).
 *
 * Reserved slots keep the ORIGINAL card object — no `reasons`, no `score` —
 * so the UI renders no taste chips there and the card honestly reads as
 * "not ranked by your taste". Non-reserved slots take the ranked cards
 * (with reasons/score/distance) in ranked order.
 */
export function applyExploreReserve({
  chronological,
  ranked,
  userId,
  windowDate,
}: ApplyExploreReserveInput): ApplyExploreReserveResult {
  const reservedIds: string[] = [];
  const reservedSet = new Set<string>();
  for (let i = 0; i < chronological.length; i++) {
    if (isReservedSlot(userId, windowDate, i)) {
      reservedSet.add(chronological[i].id);
    }
  }
  reservedSet.forEach((id) => reservedIds.push(id));

  // Ranked queue minus the reserved cards, with ranker metadata spread on.
  const rankedQueue = ranked
    .filter((r) => !reservedSet.has(r.card.id))
    .map((r) => ({ ...r.card, reasons: r.reasons, score: r.score, distance_km: r.distance_km }));

  const events: EventCard[] = [];
  let queueIndex = 0;
  for (let i = 0; i < chronological.length; i++) {
    if (reservedSet.has(chronological[i].id)) {
      events.push(chronological[i]);
    } else {
      const next = rankedQueue[queueIndex];
      if (next) {
        events.push(next);
        queueIndex++;
      } else {
        // Defensive: ranked did not cover the window — keep chronology.
        events.push(chronological[i]);
      }
    }
  }
  return { events, reservedIds };
}