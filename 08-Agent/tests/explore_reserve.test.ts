/**
 * Tests for explore_reserve — Fas C.4 (2026-09-23): utforskningsreserv.
 *
 * The treatment feed re-ranks the whole page by taste; a small deterministic
 * slice (~7 %, TikTok's exploration-budget ballpark from the WSJ rabbit-hole
 * analysis) stays exempt: the reserved slots keep their chronological cards
 * untouched (no reasons/score) so the user keeps meeting events outside the
 * taste bubble. Reservation is deterministic per (user, window date) — the
 * same window never reshuffles between refreshes, but each new window/day
 * picks fresh slots.
 *
 * Run: npx vitest run 08-Agent/tests/explore_reserve.test.ts
 */

import { describe, expect, it } from 'vitest';

import {
  applyExploreReserve,
  isReservedSlot,
  EXPLORE_RESERVE_FRACTION,
} from '../tools/explore_reserve';
import type { EventCard, RankedEvent } from '../types';

function card(id: string, start_time: string, category_slug: string): EventCard {
  return {
    id,
    title: id,
    start_time,
    end_time: null,
    venue_name: 'Scen X',
    venue_id: null,
    city: 'Stockholm',
    category_slug,
    price_min_sek: null,
    price_max_sek: null,
    is_free: true,
    ticket_url: null,
    image_url: null,
    image_license: null,
    image_attribution: null,
    image_source_url: null,
    source: null,
    confidence_score: null,
    freshness_at: null,
  };
}

function ranked(card: EventCard, score: number): RankedEvent {
  return { card, score, reasons: ['not_ended'] };
}

// A 20-card page: chronological a..t (start_time ascending), and a "ranked"
// order that reverses it — the strongest possible taste signal would put t
// first. The reserve must keep reserved slots chronological.
const PAGE = Array.from({ length: 20 }, (_, i) =>
  card(`card-${String(i).padStart(2, '0')}`, `2099-01-${String(i + 1).padStart(2, '0')}T19:00:00Z`, 'music')
);
const RANKED_REVERSED: RankedEvent[] = [...PAGE]
  .reverse()
  .map((c, i) => ranked(c, 100 - i));

describe('isReservedSlot — deterministic slot reservation', () => {
  it('is deterministic: same (user, windowDate, index) always reserves the same', () => {
    for (let i = 0; i < 20; i++) {
      expect(isReservedSlot('user-1', '2099-01-01', i))
        .toBe(isReservedSlot('user-1', '2099-01-01', i));
    }
  });

  it('reserves ~EXPLORE_RESERVE_FRACTION of slots across users (statistical sweep)', () => {
    // 200 users × 100 slots = 20 000 Bernoulli(0.07) draws. The expected
    // count is 1400; a 95 % interval is roughly ±2 %. The assertion band is
    // deliberately generous (5–10 %) — this pins the magnitude, not the
    // exact rate, so it never flakes.
    let reserved = 0;
    const draws = 200 * 100;
    for (let u = 0; u < 200; u++) {
      for (let i = 0; i < 100; i++) {
        if (isReservedSlot(`sweep-user-${u}`, '2099-01-01', i)) reserved++;
      }
    }
    const rate = reserved / draws;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.10);
  });

  it('a new window date reshuffles the reservation pattern', () => {
    // Not every slot flips, but across 100 slots at 7 % each the two days
    // must differ somewhere (P(all equal) ≈ 0.93^100 ≈ 0.0007).
    let differs = 0;
    for (let i = 0; i < 100; i++) {
      if (isReservedSlot('user-1', '2099-01-01', i) !== isReservedSlot('user-1', '2099-01-02', i)) {
        differs++;
      }
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('different users get different patterns (not user-independent)', () => {
    let differs = 0;
    for (let i = 0; i < 100; i++) {
      if (isReservedSlot('user-A', '2099-01-01', i) !== isReservedSlot('user-B', '2099-01-01', i)) {
        differs++;
      }
    }
    expect(differs).toBeGreaterThan(0);
  });
});

describe('applyExploreReserve — page merge', () => {
  it('reserved slots keep their chronological card (no reasons/score); the rest take ranked order', () => {
    // Find a window/user combination that reserves at least one of the
    // first 20 slots, deterministically.
    let userId = 'merge-user-0';
    for (let u = 0; u < 500; u++) {
      const id = `merge-user-${u}`;
      if (Array.from({ length: 20 }, (_, i) => isReservedSlot(id, '2099-01-01', i)).some(Boolean)) {
        userId = id;
        break;
      }
    }
    const { events, reservedIds } = applyExploreReserve({
      chronological: PAGE,
      ranked: RANKED_REVERSED,
      userId,
      windowDate: '2099-01-01',
    });
    expect(reservedIds.length).toBeGreaterThan(0);

    // No card lost, no card duplicated.
    expect(events).toHaveLength(PAGE.length);
    expect(new Set(events.map((e) => e.id)).size).toBe(PAGE.length);

    const reservedSet = new Set(reservedIds);
    for (let i = 0; i < PAGE.length; i++) {
      if (reservedSet.has(PAGE[i].id)) {
        // Reserved slot: original chronological card, untouched by ranker.
        expect(events[i].id).toBe(PAGE[i].id);
        expect(events[i].reasons).toBeUndefined();
        expect(events[i].score).toBeUndefined();
      }
    }
    // Non-reserved cards appear in ranked (reversed) relative order: the
    // first non-reserved slot must hold the ranked #1 (card-19).
    const nonReserved = events.filter((e) => !reservedSet.has(e.id));
    expect(nonReserved[0].id).toBe('card-19');
    expect(nonReserved[0].reasons).toContain('not_ended');
  });

  it('with zero reserved slots the output is exactly the ranked page', () => {
    // Find a user with NO reserved slot among the first 20, deterministically.
    let userId = 'clean-user-0';
    for (let u = 0; u < 500; u++) {
      const id = `clean-user-${u}`;
      if (!Array.from({ length: 20 }, (_, i) => isReservedSlot(id, '2099-01-01', i)).some(Boolean)) {
        userId = id;
        break;
      }
    }
    const { events, reservedIds } = applyExploreReserve({
      chronological: PAGE,
      ranked: RANKED_REVERSED,
      userId,
      windowDate: '2099-01-01',
    });
    expect(reservedIds).toEqual([]);
    expect(events.map((e) => e.id)).toEqual(RANKED_REVERSED.map((r) => r.card.id));
    expect(events[0].reasons).toContain('not_ended');
  });

  it('a single-card page never crashes', () => {
    const solo = [card('solo-1', '2099-01-01T19:00:00Z', 'music')];
    const result = applyExploreReserve({
      chronological: solo,
      ranked: [ranked(solo[0], 42)],
      userId: 'solo-user',
      windowDate: '2099-01-01',
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('solo-1');
  });

  it('deterministic merge: same inputs → byte-identical output twice', () => {
    const a = applyExploreReserve({ chronological: PAGE, ranked: RANKED_REVERSED, userId: 'stable-user', windowDate: '2099-01-01' });
    const b = applyExploreReserve({ chronological: PAGE, ranked: RANKED_REVERSED, userId: 'stable-user', windowDate: '2099-01-01' });
    expect(a.reservedIds).toEqual(b.reservedIds);
    expect(a.events).toEqual(b.events);
  });
});

describe('EXPLORE_RESERVE_FRACTION', () => {
  it('is the TikTok-ballpark ~7 % exploration budget', () => {
    expect(EXPLORE_RESERVE_FRACTION).toBe(0.07);
  });
});