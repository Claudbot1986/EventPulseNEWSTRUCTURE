/**
 * Tests for follow_drops — T0059 / MVP-gap §77.
 *
 * Mocks the Supabase client (no live DB needed). Validates:
 *   - followDropNotificationId is deterministic + uuid-shaped
 *   - readFollowedVenueIds handles bad UUIDs, missing prefs, malformed jsonb
 *   - generateFollowDropsForUser returns ok:false on validation failure
 *   - summarize format is parseable by the supervisor
 */

import { describe, it, expect } from 'vitest';
import {
  followDropNotificationId,
  generateFollowDropsForUser,
  readFollowedVenueIds,
  FOLLOW_DROP_WINDOW_MS,
  MAX_FOLLOW_DROP_ROWS_PER_USER,
} from '../tools/follow_drops';
import { runFollowDropsPass, summarize } from '../cron/follow_drops';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('followDropNotificationId', () => {
  it('is deterministic', () => {
    const a = followDropNotificationId('user-1', 'venue-1', 'event-1');
    const b = followDropNotificationId('user-1', 'venue-1', 'event-1');
    expect(a).toBe(b);
  });

  it('differs when any input changes', () => {
    const base = followDropNotificationId('user-1', 'venue-1', 'event-1');
    expect(followDropNotificationId('user-2', 'venue-1', 'event-1')).not.toBe(base);
    expect(followDropNotificationId('user-1', 'venue-2', 'event-1')).not.toBe(base);
    expect(followDropNotificationId('user-1', 'venue-1', 'event-2')).not.toBe(base);
  });

  it('is uuid-shaped (36 chars, hyphen positions 8/13/18/23)', () => {
    const id = followDropNotificationId('user', 'venue', 'event');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(id.length).toBe(36);
  });
});

// ─── readFollowedVenueIds ───────────────────────────────────────────────────

interface MockChain {
  [key: string]: unknown;
  then: (resolve: (v: unknown) => void) => void;
}

function makeMockClient(opts: {
  preferencesError?: { message: string };
  /** Value of the `preferences` column on the row returned by Supabase.
   *  Pass null to simulate a missing row. The mock wraps this in
   *  `{ preferences: ... }` to match the Supabase row shape. */
  preferencesColumn?: { followed_venue_ids?: unknown } | null;
}): SupabaseClient {
  const chain: MockChain = {
    then: (resolve) => resolve({ data: null, error: null }),
  };
  // Every fluent call returns the same chain (we only resolve at maybeSingle).
  for (const fn of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
    chain[fn] = () => chain;
  }
  chain.maybeSingle = async () => {
    if (opts.preferencesError) {
      return { data: null, error: opts.preferencesError };
    }
    if (opts.preferencesColumn === undefined || opts.preferencesColumn === null) {
      return { data: null, error: null };
    }
    return { data: { preferences: opts.preferencesColumn }, error: null };
  };
  const from = () => chain;
  const client = { from } as unknown as SupabaseClient;
  return client;
}

describe('readFollowedVenueIds', () => {
  it('rejects invalid uuid', async () => {
    const sb = makeMockClient({});
    const r = await readFollowedVenueIds(sb, 'not-a-uuid');
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/uuid/i);
  });

  it('returns [] when row missing', async () => {
    const sb = makeMockClient({ preferencesColumn: null });
    const r = await readFollowedVenueIds(
      sb,
      'cd58bbed-1c76-4030-b9f5-2acd83b52758'
    );
    expect(r.ok).toBe(true);
    expect(r.venueIds).toEqual([]);
  });

  it('returns [] when followed_venue_ids missing', async () => {
    const sb = makeMockClient({ preferencesColumn: { categories: ['konserter'] } });
    const r = await readFollowedVenueIds(
      sb,
      'cd58bbed-1c76-4030-b9f5-2acd83b52758'
    );
    expect(r.ok).toBe(true);
    expect(r.venueIds).toEqual([]);
  });

  it('filters malformed entries', async () => {
    const sb = makeMockClient({
      preferencesColumn: {
        followed_venue_ids: [
          'cd58bbed-1c76-4030-b9f5-2acd83b52758',
          'not-a-uuid',
          42,
          null,
          '5b3473c8-e987-467d-b635-b41603671fb6',
        ],
      },
    });
    const r = await readFollowedVenueIds(
      sb,
      'cd58bbed-1c76-4030-b9f5-2acd83b52758'
    );
    expect(r.ok).toBe(true);
    expect(r.venueIds).toEqual([
      'cd58bbed-1c76-4030-b9f5-2acd83b52758',
      '5b3473c8-e987-467d-b635-b41603671fb6',
    ]);
  });

  it('returns ok:false + warning on DB error', async () => {
    const sb = makeMockClient({ preferencesError: { message: 'boom' } });
    const r = await readFollowedVenueIds(
      sb,
      'cd58bbed-1c76-4030-b9f5-2acd83b52758'
    );
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/boom/);
  });
});

// ─── generateFollowDropsForUser (validation) ───────────────────────────────

describe('generateFollowDropsForUser — validation', () => {
  it('rejects invalid uuid', async () => {
    const sb = makeMockClient({});
    const r = await generateFollowDropsForUser(sb, {
      client_user_id: 'not-a-uuid',
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/uuid/i);
  });
});

// ─── summarize format ──────────────────────────────────────────────────────

describe('summarize', () => {
  it('emits a parseable line for the supervisor', () => {
    const s = summarize({
      ok: true,
      started_at: '2026-08-22T22:30:00.000Z',
      duration_ms: 1832,
      users_scanned: 12,
      users_with_drops: 4,
      inserted: 7,
      skipped: 2,
      errors: 0,
    });
    expect(s).toMatch(
      /^\[follow_drops-cron\] 2026-08-22T22:30:00\.000Z users=12 with_drops=4 inserted=7 skipped=2 errors=0 duration_ms=1832$/
    );
  });

  it('appends warning when ok:false', () => {
    const s = summarize({
      ok: false,
      started_at: '2026-08-22T22:30:00.000Z',
      duration_ms: 100,
      users_scanned: 0,
      users_with_drops: 0,
      inserted: 0,
      skipped: 0,
      errors: 1,
      warning: 'user scan failed: timeout',
    });
    expect(s).toContain('warning="user scan failed: timeout"');
  });
});

// ─── Constants ─────────────────────────────────────────────────────────────

describe('module constants', () => {
  it('FOLLOW_DROP_WINDOW_MS is 30 minutes', () => {
    expect(FOLLOW_DROP_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it('MAX_FOLLOW_DROP_ROWS_PER_USER caps at 20', () => {
    expect(MAX_FOLLOW_DROP_ROWS_PER_USER).toBe(20);
  });
});

// ─── runFollowDropsPass — error path ────────────────────────────────────────

describe('runFollowDropsPass — empty users produces clean summary', () => {
  it('returns ok:true with 0 inserted when no users have follows', async () => {
    const sb = makeMockClient({ preferencesColumn: null });
    const summary = await runFollowDropsPass({
      supabase: sb,
      now: new Date('2026-08-22T22:30:00.000Z'),
      maxUsers: 100,
    });
    expect(summary.ok).toBe(true);
    expect(summary.inserted).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.users_scanned).toBe(0);
  });
});
