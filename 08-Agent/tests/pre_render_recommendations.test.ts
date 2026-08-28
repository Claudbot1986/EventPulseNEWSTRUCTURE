/**
 * Tests for pre_render_recommendations — T0060 / MVP-gap §77.
 *
 * Validates:
 *   - toRecommendationCard picks event_id + first rank reason
 *   - generatePreRenderForUser rejects bad UUID + fills 3 slots on success
 *   - summarize produces the parseable supervisor line
 *   - constants match documented values
 */

import { describe, it, expect } from 'vitest';
import {
  toRecommendationCard,
  generatePreRenderForUser,
  summarize,
  runPreRenderPass,
  STOCKHOLM_TZ,
  DEFAULT_CRON_EXPR,
  MIN_DISTINCT_SESSIONS,
  ELIGIBILITY_WINDOW_DAYS,
  CARDS_PER_SLOT,
  SLOT_TITLES,
} from '../cron/pre_render_recommendations';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RankedEvent, EventCard } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeCard(id: string, title: string): EventCard {
  return {
    id,
    title,
    start_time: '2026-08-22T19:30:00.000Z',
    venue_name: 'Fasching',
    city: 'Stockholm',
    category_slug: 'konserter',
    is_free: false,
    ticket_url: null,
    image_url: null,
  };
}

function makeRanked(card: EventCard, reason = 'time_fit'): RankedEvent {
  return { card, reasons: [reason as RankedEvent['reasons'][number]], score: 0.9 };
}

// ─── toRecommendationCard ────────────────────────────────────────────────────

describe('toRecommendationCard', () => {
  it('uses event_id (canonical events_public UUID), not card.id', () => {
    const ranked = makeRanked(makeFakeCard('a4f6-1111', 'Konsert'));
    const out = toRecommendationCard(ranked, '');
    expect(out.event_id).toBe('a4f6-1111');
    expect(out.title).toBe('Konsert');
    expect(out.venue_name).toBe('Fasching');
  });

  it('uses fallbackVenue when card.venue_name is empty', () => {
    const card = makeFakeCard('b', '');
    card.venue_name = '';
    const out = toRecommendationCard(makeRanked(card), 'Default Venue');
    expect(out.venue_name).toBe('Default Venue');
  });

  it('picks the FIRST rank reason as the human-facing label', () => {
    const ranked = makeRanked(makeFakeCard('c', 'Titel'), 'followed_venue_match');
    const out = toRecommendationCard(ranked, '');
    expect(out.rank_reason).toBe('followed_venue_match');
  });

  it('falls back to "not_ended" when reasons is empty', () => {
    const card = makeFakeCard('d', 'Titel');
    const ranked: RankedEvent = { card, reasons: [], score: 0 };
    const out = toRecommendationCard(ranked, '');
    expect(out.rank_reason).toBe('not_ended');
  });
});

// ─── generatePreRenderForUser — validation ───────────────────────────────────

interface MockChain {
  [k: string]: unknown;
  then: (r: (v: unknown) => void) => void;
}

function makeMockClient(_opts: object): SupabaseClient {
  const chain: MockChain = {
    then: (r) => r({ data: null, error: null }),
  };
  for (const fn of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'not']) {
    chain[fn] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: null, error: null });
  const from = () => chain;
  return { from } as unknown as SupabaseClient;
}

describe('generatePreRenderForUser — validation', () => {
  it('rejects invalid uuid with ok:false + 3 empty slots', async () => {
    const sb = makeMockClient({});
    const r = await generatePreRenderForUser(sb, {
      client_user_id: 'not-a-uuid',
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/uuid/i);
    expect(r.slots).toHaveLength(3);
    expect(r.slots.every((s) => s.card_1 === null && s.card_2 === null)).toBe(true);
    expect(r.slots[0].title).toBe(SLOT_TITLES.tonight);
    expect(r.slots[1].title).toBe(SLOT_TITLES.weekend);
    expect(r.slots[2].title).toBe(SLOT_TITLES.repeat);
  });

  it('returns 3 slots with stable titles on valid uuid', async () => {
    const sb = makeMockClient({});
    const r = await generatePreRenderForUser(sb, {
      client_user_id: 'cd58bbed-1c76-4030-b9f5-2acd83b52758',
    });
    expect(r.slots).toHaveLength(3);
    expect(r.slots.map((s) => s.title)).toEqual([
      SLOT_TITLES.tonight,
      SLOT_TITLES.weekend,
      SLOT_TITLES.repeat,
    ]);
  });
});

// ─── summarize ───────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('emits a parseable supervisor line', () => {
    const s = summarize({
      ok: true,
      started_at: '2026-08-22T06:00:00.000Z',
      duration_ms: 1832,
      users_scanned: 12,
      users_with_recommendations: 11,
      generated: 30,
      skipped: 0,
      errors: 1,
    });
    expect(s).toMatch(
      /^\[pre_render-cron\] 2026-08-22T06:00:00\.000Z users=12 generated=30 skipped=0 errors=1 duration_ms=1832$/
    );
  });

  it('appends warning when ok:false', () => {
    const s = summarize({
      ok: false,
      started_at: '2026-08-22T06:00:00.000Z',
      duration_ms: 100,
      users_scanned: 0,
      users_with_recommendations: 0,
      generated: 0,
      skipped: 0,
      errors: 1,
      warning: 'user scan failed: timeout',
    });
    expect(s).toContain('warning="user scan failed: timeout"');
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('module constants', () => {
  it('STOCKHOLM_TZ is Europe/Stockholm', () => {
    expect(STOCKHOLM_TZ).toBe('Europe/Stockholm');
  });
  it('DEFAULT_CRON_EXPR is "0 6,17 * * *"', () => {
    expect(DEFAULT_CRON_EXPR).toBe('0 6,17 * * *');
  });
  it('MIN_DISTINCT_SESSIONS is 3', () => {
    expect(MIN_DISTINCT_SESSIONS).toBe(3);
  });
  it('ELIGIBILITY_WINDOW_DAYS is 30', () => {
    expect(ELIGIBILITY_WINDOW_DAYS).toBe(30);
  });
  it('CARDS_PER_SLOT is 2', () => {
    expect(CARDS_PER_SLOT).toBe(2);
  });
});

// ─── runPreRenderPass — empty users ──────────────────────────────────────────

describe('runPreRenderPass — empty users produces clean summary', () => {
  it('returns ok:true with 0 generated when no warm users', async () => {
    const sb = makeMockClient({});
    const summary = await runPreRenderPass({
      supabase: sb,
      now: new Date('2026-08-22T06:00:00.000Z'),
      maxUsers: 100,
    });
    expect(summary.users_scanned).toBe(0);
    expect(summary.ok).toBe(true);
    expect(summary.errors).toBe(0);
  });
});
