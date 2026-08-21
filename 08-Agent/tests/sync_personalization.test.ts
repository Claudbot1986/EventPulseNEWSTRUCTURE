/**
 * Tests for sync_personalization cron — T0075 / MVP-gap §77 (Phase 2).
 *
 * Mocks the Supabase client and exercises `runPersonalizationPass` end-to-end:
 *   - pickWarmUsersWithSaves returns distinct uuids only
 *   - runPersonalizationPass walks all users, aggregates written/stale/errors
 *   - Per-user recompute failures are caught and counted as errors
 *   - Budget check aborts the run with a warning
 *   - summarize format is parseable by the supervisor
 *
 * Run with:  npx vitest run 08-Agent/tests/sync_personalization.test.ts
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runPersonalizationPass,
  pickWarmUsersWithSaves,
  summarize,
  DEFAULT_INTERVAL_MS,
  DEFAULT_RUN_BUDGET_MS,
} from '../cron/sync_personalization';
import type { RecomputeResult } from '../tools/personalize';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';
const NOW = new Date('2026-08-22T00:00:00.000Z');

/** A minimal fluent chain that resolves to `state` when awaited.
 *  Mirrors the pattern from reminders.test.ts. */
function chainFor(state: { data: any; error: any | null }): any {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: any; error: any | null }) => void) =>
      Promise.resolve(state).then(resolve),
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
      started_at: '2026-08-22T00:00:00.000Z',
      duration_ms: 421,
      users_scanned: 42,
      users_with_weights: 12,
      weights_written: 87,
      stale_deleted: 14,
      errors: 0,
    });
    expect(line).toContain('[sync_personalization-cron] 2026-08-22T00:00:00.000Z');
    expect(line).toContain('users=42');
    expect(line).toContain('with_weights=12');
    expect(line).toContain('written=87');
    expect(line).toContain('stale=14');
    expect(line).toContain('errors=0');
    expect(line).toContain('duration_ms=421');
  });

  it('includes warning when present', () => {
    const line = summarize({
      ok: false,
      started_at: '2026-08-22T00:00:00.000Z',
      duration_ms: 100,
      users_scanned: 0,
      users_with_weights: 0,
      weights_written: 0,
      stale_deleted: 0,
      errors: 0,
      warning: 'budget exceeded',
    });
    expect(line).toContain('warning="budget exceeded"');
  });
});

describe('pickWarmUsersWithSaves', () => {
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
    const result = await pickWarmUsersWithSaves(sb, { maxUsers: 100 });
    expect(result.ok).toBe(true);
    expect(result.userIds.sort()).toEqual([USER_A, USER_B].sort());
  });

  it('returns ok:false when the underlying query errors', async () => {
    const sb = mockSb({
      user_interactions: { data: null, error: { message: 'db down' } },
    });
    const result = await pickWarmUsersWithSaves(sb);
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/db down/);
  });
});

describe('runPersonalizationPass', () => {
  it('returns ok:true with zero users when no one has saves', async () => {
    const sb = mockSb({
      user_interactions: { data: [], error: null },
    });
    const summary = await runPersonalizationPass({ supabase: sb, now: NOW });
    expect(summary.ok).toBe(true);
    expect(summary.users_scanned).toBe(0);
    expect(summary.weights_written).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it('walks all distinct users and aggregates written + stale + users_with_weights', async () => {
    // Stub recompute to return a fixed RecomputeResult per user.
    const recompute = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        weightsWritten: 3,
        categoriesTouched: ['music', 'theater', 'art'],
        staleDeleted: 1,
      } satisfies RecomputeResult)
      .mockResolvedValueOnce({
        ok: true,
        weightsWritten: 2,
        categoriesTouched: ['music', 'theater'],
        staleDeleted: 0,
      } satisfies RecomputeResult);

    const sb = mockSb({
      user_interactions: {
        data: [
          { client_user_id: USER_A },
          { client_user_id: USER_B },
        ],
        error: null,
      },
    });
    const summary = await runPersonalizationPass({ supabase: sb, now: NOW, recompute });
    expect(summary.ok).toBe(true);
    expect(summary.users_scanned).toBe(2);
    expect(summary.weights_written).toBe(5); // 3 + 2
    expect(summary.stale_deleted).toBe(1);   // 1 + 0
    expect(summary.users_with_weights).toBe(2); // both wrote something
    expect(summary.errors).toBe(0);
    expect(recompute).toHaveBeenCalledTimes(2);
  });

  it('counts a per-user error in summary.errors and continues', async () => {
    const recompute = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        weightsWritten: 0,
        categoriesTouched: [],
        staleDeleted: 0,
        warning: 'transient',
      } satisfies RecomputeResult)
      .mockResolvedValueOnce({
        ok: true,
        weightsWritten: 1,
        categoriesTouched: ['music'],
        staleDeleted: 0,
      } satisfies RecomputeResult);

    const sb = mockSb({
      user_interactions: {
        data: [
          { client_user_id: USER_A },
          { client_user_id: USER_B },
        ],
        error: null,
      },
    });
    const summary = await runPersonalizationPass({ supabase: sb, now: NOW, recompute });
    expect(summary.users_scanned).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.weights_written).toBe(1);
    expect(summary.users_with_weights).toBe(1);
  });

  it('skips recompute for users with 0 weights written (cold users)', async () => {
    // A user whose recompute returned 0 weights (e.g. just below min-saves)
    // should not increment users_with_weights.
    const recompute = vi.fn().mockResolvedValue({
      ok: true,
      weightsWritten: 0,
      categoriesTouched: [],
      staleDeleted: 0,
    } satisfies RecomputeResult);

    const sb = mockSb({
      user_interactions: {
        data: [{ client_user_id: USER_A }, { client_user_id: USER_B }],
        error: null,
      },
    });
    const summary = await runPersonalizationPass({ supabase: sb, now: NOW, recompute });
    expect(summary.users_scanned).toBe(2);
    expect(summary.users_with_weights).toBe(0);
    expect(summary.weights_written).toBe(0);
  });

  it('aborts with warning when the budget is exceeded', async () => {
    const manyUsers = Array.from({ length: 100 }, (_, i) => ({
      client_user_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    const sb = mockSb({
      user_interactions: { data: manyUsers, error: null },
    });
    // Recompute that always succeeds slowly enough to exceed the budget.
    const recompute = vi.fn().mockImplementation(async () => {
      // Real wall-clock delay so the budget check fires.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: true,
        weightsWritten: 1,
        categoriesTouched: ['music'],
        staleDeleted: 0,
      } satisfies RecomputeResult;
    });
    // pastNow is 10s in the past — matches the reminders.test.ts pattern:
    // startedAt.getTime() = pastNow.getTime() = real now - 10_000, so the
    // first budget check fires immediately, well above budgetMs=1.
    const pastNow = new Date(Date.now() - 10_000);
    const summary = await runPersonalizationPass({
      supabase: sb,
      now: pastNow,
      budgetMs: 1,
      timeProvider: () => Date.now(),
      recompute,
    });
    // users_scanned counts the SCAN result, not the loop-progress — it
    // equals the total discovered users regardless of how many we actually
    // processed. The budget-abort signal is the warning + ok=false +
    // users_with_weights << users_scanned.
    expect(summary.users_scanned).toBe(100);
    expect(summary.users_with_weights).toBeLessThan(100);
    expect(summary.warning ?? '').toMatch(/budget|exceeded|users/);
    expect(summary.ok).toBe(false);
  });
});

describe('constants', () => {
  it('default interval is 6 hours', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
  it('default run budget is 30 minutes', () => {
    expect(DEFAULT_RUN_BUDGET_MS).toBe(30 * 60 * 1000);
  });
});