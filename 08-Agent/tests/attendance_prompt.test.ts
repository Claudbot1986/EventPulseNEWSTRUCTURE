/**
 * Tests for the attendance-prompt cron + tool helpers — T0082 / MVP-gap §77.
 *
 * Mocks the Supabase client and exercises the real
 * `generateAttendancePromptsForUser` and `listUnratedSavedEvents` against
 * test data. Mirrors the structure of `reminders.test.ts` and
 * `follow_drops.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attendancePromptNotificationId,
  generateAttendancePromptsForUser,
  listUnratedSavedEvents,
  ATTENDANCE_PROMPT_GRACE_MS,
} from '../tools/notification_center';
import {
  runAttendancePromptPass,
  pickActiveUsersWithSaves,
  summarize,
  DEFAULT_INTERVAL_MS,
  DEFAULT_RUN_BUDGET_MS,
} from '../cron/attendance_prompt';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const EVENT_X = '11111111-1111-1111-1111-11111111111a';
const NOW = new Date('2026-08-22T20:00:00.000Z');

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
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: any; error: any | null }) => void) =>
      Promise.resolve(state).then(resolve),
  };
  return chain;
}

function mockSb(perTable: Record<string, { data: any; error: any | null }>): SupabaseClient {
  const from = vi.fn().mockImplementation((table: string) => {
    const state = perTable[table] ?? { data: [], error: null };
    return chainFor(state);
  });
  return { from } as unknown as SupabaseClient;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe('attendancePromptNotificationId', () => {
  it('returns a uuid-shaped string', () => {
    const id = attendancePromptNotificationId(USER_A, EVENT_X, NOW.toISOString());
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
  it('is deterministic for the same inputs', () => {
    expect(attendancePromptNotificationId(USER_A, EVENT_X, NOW.toISOString()))
      .toBe(attendancePromptNotificationId(USER_A, EVENT_X, NOW.toISOString()));
  });
  it('changes when any input changes', () => {
    const base = attendancePromptNotificationId(USER_A, EVENT_X, NOW.toISOString());
    const otherUser = '00000000-0000-0000-0000-00000000000b';
    expect(attendancePromptNotificationId(otherUser, EVENT_X, NOW.toISOString())).not.toBe(base);
    expect(attendancePromptNotificationId(USER_A, '22222222-2222-2222-2222-222222222222', NOW.toISOString())).not.toBe(base);
    expect(attendancePromptNotificationId(USER_A, EVENT_X, '2026-08-22T19:00:00.000Z')).not.toBe(base);
  });
  it('produces a 36-char uuid-shaped string', () => {
    const id = attendancePromptNotificationId(USER_A, EVENT_X, NOW.toISOString());
    expect(id.length).toBe(36);
  });
});

// ─── generateAttendancePromptsForUser ──────────────────────────────────────

describe('generateAttendancePromptsForUser', () => {
  it('returns ok:false without calling Supabase on bad uuid', async () => {
    const from = vi.fn();
    const sb = { from } as unknown as SupabaseClient;
    const result = await generateAttendancePromptsForUser(sb, { client_user_id: 'not-a-uuid' });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/uuid/);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns ok:true with zero rows when user has no saves', async () => {
    const sb = mockSb({
      user_interactions: { data: [], error: null },
    });
    const result = await generateAttendancePromptsForUser(sb, {
      client_user_id: USER_A,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.eligible).toBe(0);
  });

  it('persists a prompt for a saved event whose start_time crossed grace', async () => {
    // Order of `from` calls:
    //   1) saves query (user_interactions)
    //   2) events_public window lookup
    //   3) already-rated filter (user_interactions)
    //   4) existing notifications dedup
    //   5) notifications insert
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        const callIndex = (fromFn.mock.calls as any[][]).filter(
          ([t]: [string]) => t === 'user_interactions'
        ).length;
        if (callIndex === 1) {
          return chainFor({ data: [{ event_id: EVENT_X }], error: null });
        }
        // 2nd user_interactions call = rated check (empty).
        return chainFor({ data: [], error: null });
      }
      if (table === 'events_public') {
        return chainFor({
          data: [{
            id: EVENT_X,
            title_sv: 'Konsert pa Debaser',
            title_en: null,
            start_time: '2026-08-22T18:00:00.000Z', // 2h before NOW
            venues: { name: 'Debaser', city: 'Stockholm' },
          }],
          error: null,
        });
      }
      if (table === 'notifications') {
        return chainFor({ data: [], error: null });
      }
      return chainFor({ data: null, error: { message: 'unexpected table ' + table } });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await generateAttendancePromptsForUser(sb, {
      client_user_id: USER_A,
      now: NOW,
      graceMs: ATTENDANCE_PROMPT_GRACE_MS,
    });
    expect(result.ok).toBe(true);
    expect(result.eligible).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0];
    expect(n.kind).toBe('attendance_prompt');
    expect(n.event_id).toBe(EVENT_X);
    expect(n.title).toBe('Konsert pa Debaser');
    expect(n.body).toMatch(/Hur var/);
    expect(n.status).toBe('unread');
  });

  it('skips events the user has already rated', async () => {
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        const callIndex = (fromFn.mock.calls as any[][]).filter(
          ([t]: [string]) => t === 'user_interactions'
        ).length;
        if (callIndex === 1) {
          return chainFor({ data: [{ event_id: EVENT_X }], error: null });
        }
        // User has already rated this event.
        return chainFor({ data: [{ event_id: EVENT_X }], error: null });
      }
      if (table === 'events_public') {
        return chainFor({
          data: [{
            id: EVENT_X,
            title_sv: 'Konsert',
            title_en: null,
            start_time: '2026-08-22T18:00:00.000Z',
            venues: null,
          }],
          error: null,
        });
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await generateAttendancePromptsForUser(sb, {
      client_user_id: USER_A,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.eligible).toBe(1);
    expect(result.notifications).toEqual([]);
  });

  it('is idempotent — re-running yields skipped, not inserted', async () => {
    const existingId = attendancePromptNotificationId(
      USER_A,
      EVENT_X,
      '2026-08-22T18:00:00.000Z'
    );
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        const callIndex = (fromFn.mock.calls as any[][]).filter(
          ([t]: [string]) => t === 'user_interactions'
        ).length;
        if (callIndex === 1) {
          return chainFor({ data: [{ event_id: EVENT_X }], error: null });
        }
        return chainFor({ data: [], error: null });
      }
      if (table === 'events_public') {
        return chainFor({
          data: [{
            id: EVENT_X,
            title_sv: 'Konsert',
            title_en: null,
            start_time: '2026-08-22T18:00:00.000Z',
            venues: null,
          }],
          error: null,
        });
      }
      if (table === 'notifications') {
        return chainFor({ data: [{ id: existingId }], error: null });
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await generateAttendancePromptsForUser(sb, {
      client_user_id: USER_A,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.notifications).toEqual([]);
  });

  it('returns ok:false when saves query fails', async () => {
    const sb = { from: vi.fn().mockReturnValue(chainFor({ data: null, error: { message: 'db down' } })) } as unknown as SupabaseClient;
    const result = await generateAttendancePromptsForUser(sb, {
      client_user_id: USER_A,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/saves/);
  });
});

// ─── listUnratedSavedEvents ────────────────────────────────────────────────

describe('listUnratedSavedEvents', () => {
  it('returns ok:false on bad uuid', async () => {
    const from = vi.fn();
    const sb = { from } as unknown as SupabaseClient;
    const result = await listUnratedSavedEvents(sb, 'not-a-uuid');
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/uuid/);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns [] when user has no saves', async () => {
    const sb = mockSb({ user_interactions: { data: [], error: null } });
    const result = await listUnratedSavedEvents(sb, USER_A, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.events).toEqual([]);
  });

  it('returns past saved events the user has not yet rated', async () => {
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        const callIndex = (fromFn.mock.calls as any[][]).filter(
          ([t]: [string]) => t === 'user_interactions'
        ).length;
        if (callIndex === 1) {
          return chainFor({ data: [{ event_id: EVENT_X }], error: null });
        }
        return chainFor({ data: [], error: null });
      }
      if (table === 'events_public') {
        return chainFor({
          data: [{
            id: EVENT_X,
            title_sv: 'Konsert pa Debaser',
            title_en: null,
            start_time: '2026-08-22T18:00:00.000Z',
            venues: { name: 'Debaser' },
          }],
          error: null,
        });
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await listUnratedSavedEvents(sb, USER_A, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Konsert pa Debaser');
    expect(result.events[0].venue_name).toBe('Debaser');
  });
});

// ─── Cron helpers ─────────────────────────────────────────────────────────

describe('summarize', () => {
  it('emits the canonical cron line', () => {
    const line = summarize({
      ok: true,
      started_at: '2026-08-22T20:00:00.000Z',
      duration_ms: 421,
      users_scanned: 42,
      users_with_prompts: 3,
      inserted: 3,
      skipped: 12,
      errors: 0,
    });
    expect(line).toContain('[attendance-prompt-cron] 2026-08-22T20:00:00.000Z');
    expect(line).toContain('users=42');
    expect(line).toContain('with_prompts=3');
    expect(line).toContain('inserted=3');
    expect(line).toContain('skipped=12');
    expect(line).toContain('errors=0');
    expect(line).toContain('duration_ms=421');
  });

  it('includes warning when present', () => {
    const line = summarize({
      ok: false,
      started_at: '2026-08-22T20:00:00.000Z',
      duration_ms: 100,
      users_scanned: 0,
      users_with_prompts: 0,
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
          { client_user_id: null },
          { client_user_id: 'not-a-uuid' },
        ],
        error: null,
      },
    });
    const result = await pickActiveUsersWithSaves(sb, { maxUsers: 100 });
    expect(result.ok).toBe(true);
    expect(result.userIds).toEqual([USER_A]);
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

describe('runAttendancePromptPass', () => {
  it('returns ok:true with zero users when no one has saves', async () => {
    const sb = mockSb({ user_interactions: { data: [], error: null } });
    const summary = await runAttendancePromptPass({ supabase: sb, now: NOW });
    expect(summary.ok).toBe(true);
    expect(summary.users_scanned).toBe(0);
    expect(summary.inserted).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it('walks all distinct users and aggregates inserted + skipped', async () => {
    let userInteractionsCalls = 0;
    let notificationsInserts = 0;
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        userInteractionsCalls += 1;
        if (userInteractionsCalls === 1) {
          // user scan: two distinct users
          return chainFor({
            data: [
              { client_user_id: USER_A },
              { client_user_id: '00000000-0000-0000-0000-00000000000b' },
            ],
            error: null,
          });
        }
        if (userInteractionsCalls === 2 || userInteractionsCalls === 4) {
          // saves query (per user) — both users saved EVENT_X
          return chainFor({ data: [{ event_id: EVENT_X }], error: null });
        }
        // already-rated query — return empty so prompts fire
        return chainFor({ data: [], error: null });
      }
      if (table === 'events_public') {
        return chainFor({
          data: [{
            id: EVENT_X,
            title_sv: 'Konsert',
            title_en: null,
            start_time: '2026-08-22T18:00:00.000Z',
            venues: null,
          }],
          error: null,
        });
      }
      if (table === 'notifications') {
        const chain = chainFor({ data: [], error: null });
        chain.insert = vi.fn().mockImplementation(() => {
          notificationsInserts += 1;
          return Promise.resolve({ data: null, error: null });
        });
        return chain;
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const summary = await runAttendancePromptPass({
      supabase: sb,
      now: NOW,
      timeProvider: () => NOW.getTime(),
    });
    expect(summary.ok).toBe(true);
    expect(summary.users_scanned).toBe(2);
    expect(summary.inserted).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.users_with_prompts).toBe(2);
    expect(notificationsInserts).toBe(2);
  });

  it('counts a per-user error in summary.errors and continues', async () => {
    let userInteractionsCalls = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        userInteractionsCalls += 1;
        if (userInteractionsCalls === 1) {
          return chainFor({
            data: [
              { client_user_id: USER_A },
              { client_user_id: '00000000-0000-0000-0000-00000000000b' },
            ],
            error: null,
          });
        }
        // subsequent per-user saves query fails
        return chainFor({ data: null, error: { message: 'transient' } });
      }
      return chainFor({ data: [], error: null });
    });
    const sb = { from } as unknown as SupabaseClient;
    const summary = await runAttendancePromptPass({
      supabase: sb,
      now: NOW,
      timeProvider: () => NOW.getTime(),
    });
    expect(summary.users_scanned).toBe(2);
    expect(summary.errors).toBe(2);
    expect(summary.inserted).toBe(0);
  });

  it('aborts with warning when the budget is exceeded', async () => {
    const manyUsers = Array.from({ length: 50 }, (_, i) => ({
      client_user_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    const sb = mockSb({
      user_interactions: { data: manyUsers, error: null },
      events_public: { data: [], error: null },
    });
    const pastNow = new Date(Date.now() - 10_000);
    const summary = await runAttendancePromptPass({
      supabase: sb,
      now: pastNow,
      budgetMs: 1,
      timeProvider: () => Date.now(),
    });
    expect(summary.users_scanned).toBe(50);
    expect(summary.warning ?? '').toMatch(/budget|exceeded|users/);
  });
});

describe('constants', () => {
  it('default interval is 30 minutes', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(30 * 60 * 1000);
  });
  it('default run budget is 10 minutes', () => {
    expect(DEFAULT_RUN_BUDGET_MS).toBe(10 * 60 * 1000);
  });
  it('default grace is 2 hours', () => {
    expect(ATTENDANCE_PROMPT_GRACE_MS).toBe(2 * 60 * 60 * 1000);
  });
});
