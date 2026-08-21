/**
 * Tests for the cron/reminders module — T0048 / MVP-gap §77.
 *
 * Mocks the Supabase client and exercises the real
 * `generateRemindersForUser` against test data. Mirrors how
 * `feed_events.test.ts` exercises its tool.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runReminderPass,
  pickActiveUsersWithSaves,
  summarize,
  DEFAULT_INTERVAL_MS,
  DEFAULT_RUN_BUDGET_MS,
} from '../cron/reminders';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';
const EVENT_X = '11111111-1111-1111-1111-11111111111a';
const NOW = new Date('2026-08-21T20:00:00.000Z');

function chainFor(state: { data: any; error: any | null }) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: any) => void) => Promise.resolve(state).then(resolve),
  };
  return chain;
}

/** Build a Supabase mock where every `from(table)` returns the same chain
 *  unless the caller customizes per-table behavior. */
function mockSb(perTable: Record<string, { data: any; error: any | null }>): SupabaseClient {
  const from = vi.fn().mockImplementation((table: string) => {
    const state = perTable[table] ?? { data: [], error: null };
    return chainFor(state);
  });
  return { from } as unknown as SupabaseClient;
}

describe('summarize', () => {
  it('emits the canonical cron line', () => {
    const line = summarize({
      ok: true,
      started_at: '2026-08-21T20:00:00.000Z',
      duration_ms: 421,
      users_scanned: 42,
      users_with_reminders: 3,
      inserted: 3,
      skipped: 89,
      errors: 0,
    });
    expect(line).toContain('[reminders-cron] 2026-08-21T20:00:00.000Z');
    expect(line).toContain('users=42');
    expect(line).toContain('with_reminders=3');
    expect(line).toContain('inserted=3');
    expect(line).toContain('skipped=89');
    expect(line).toContain('errors=0');
    expect(line).toContain('duration_ms=421');
  });

  it('includes warning when present', () => {
    const line = summarize({
      ok: false,
      started_at: '2026-08-21T20:00:00.000Z',
      duration_ms: 100,
      users_scanned: 0,
      users_with_reminders: 0,
      inserted: 0,
      skipped: 0,
      errors: 0,
      warning: 'budget exceeded',
    });
    expect(line).toContain('warning="budget exceeded"');
  });
});

describe('pickActiveUsersWithSaves', () => {
  it('returns distinct uuids only', async () => {
    const sb = mockSb({
      user_interactions: {
        data: [
          { client_user_id: USER_A },
          { client_user_id: USER_A },
          { client_user_id: USER_B },
          { client_user_id: null },
          { client_user_id: 'not-a-uuid' },
        ],
        error: null,
      },
    });
    const result = await pickActiveUsersWithSaves(sb, { maxUsers: 100 });
    expect(result.ok).toBe(true);
    expect(result.userIds.sort()).toEqual([USER_A, USER_B].sort());
  });

  it('returns ok:false when the underlying query errors', async () => {
    const sb = mockSb({
      user_interactions: { data: null, error: { message: 'db down' } },
    });
    const result = await pickActiveUsersWithSaves(sb);
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/db down/);
  });
});

describe('runReminderPass', () => {
  it('returns ok:true with zero users when no one has saves', async () => {
    const sb = mockSb({
      user_interactions: { data: [], error: null },
    });
    const summary = await runReminderPass({ supabase: sb, now: NOW });
    expect(summary.ok).toBe(true);
    expect(summary.users_scanned).toBe(0);
    expect(summary.inserted).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it('walks all distinct users and aggregates inserted + skipped', async () => {
    let notificationsInserts = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        return chainFor({
          data: [
            { client_user_id: USER_A, event_id: EVENT_X },
            { client_user_id: USER_A, event_id: EVENT_X },
            { client_user_id: USER_B, event_id: EVENT_X },
          ],
          error: null,
        });
      }
      if (table === 'events_public') {
        return chainFor({
          data: [{
            id: EVENT_X,
            title_sv: 'Konsert',
            title_en: null,
            start_time: '2026-08-21T21:00:00.000Z',
            ticket_url: null,
            venues: null,
          }],
          error: null,
        });
      }
      if (table === 'notifications') {
        // The production code first calls select().in(...) for the
        // existing-id check (returns data: []), then insert(fresh) for
        // the new rows. We need the chain to support both. Track insert
        // calls so the test can verify the per-user insert path ran.
        const baseChain = chainFor({ data: [], error: null });
        baseChain.insert = vi.fn().mockImplementation(() => {
          notificationsInserts += 1;
          return Promise.resolve({ data: null, error: null });
        });
        return baseChain;
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from } as unknown as SupabaseClient;
    const summary = await runReminderPass({ supabase: sb, now: NOW });
    expect(summary.ok).toBe(true);
    // User A and User B are distinct — both scanned.
    expect(summary.users_scanned).toBe(2);
    // Each user got one eligible event → two candidates total → two inserts.
    expect(summary.inserted).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.users_with_reminders).toBe(2);
    expect(notificationsInserts).toBe(2);
  });

  it('counts a per-user error in summary.errors and continues', async () => {
    let userInteractionsCalls = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        userInteractionsCalls += 1;
        // First call is the user scan (return two distinct users). The
        // subsequent per-user calls are the saves query inside
        // generateRemindersForUser — make those fail so we count errors.
        if (userInteractionsCalls === 1) {
          return chainFor({
            data: [{ client_user_id: USER_A }, { client_user_id: USER_B }],
            error: null,
          });
        }
        return chainFor({ data: null, error: { message: 'transient' } });
      }
      if (table === 'events_public') {
        return chainFor({ data: [], error: null });
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from } as unknown as SupabaseClient;
    const summary = await runReminderPass({ supabase: sb, now: NOW });
    expect(summary.users_scanned).toBe(2);
    expect(summary.errors).toBe(2);
    expect(summary.inserted).toBe(0);
  });

  it('aborts with warning when the budget is exceeded', async () => {
    const manyUsers = Array.from({ length: 100 }, (_, i) => ({
      client_user_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    const sb = mockSb({
      user_interactions: { data: manyUsers, error: null },
      events_public: { data: [], error: null },
    });
    // `now` set 10s in the past so real `Date.now() - t0` is guaranteed
    // to exceed any small `budgetMs` value (the cron module uses real
    // wall-clock for the budget check, not the injected `now`).
    const pastNow = new Date(Date.now() - 10_000);
    const summary = await runReminderPass({
      supabase: sb,
      now: pastNow,
      budgetMs: 1,
    });
    expect(summary.users_scanned).toBe(100);
    expect(summary.warning ?? '').toMatch(/budget|exceeded|users/);
  });
});

describe('constants', () => {
  it('default interval is 15 minutes', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(15 * 60 * 1000);
  });
  it('default run budget is 10 minutes', () => {
    expect(DEFAULT_RUN_BUDGET_MS).toBe(10 * 60 * 1000);
  });
});
