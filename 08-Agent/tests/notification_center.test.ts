/**
 * Tests for notification_center — T0048 / MVP-gap §77.
 *
 * Mocks the Supabase client (no live DB needed). Validates:
 *   - reminderNotificationId is deterministic + uuid-shaped
 *   - generateRemindersForUser finds saved events in the 2h window
 *   - it skips already-persisted reminders (idempotent re-run)
 *   - it returns ok:false on bad inputs (no Supabase call)
 *   - listNotifications orders newest-first and caps to limit
 *   - markNotificationRead validates uuids before any DB call
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateRemindersForUser,
  listNotifications,
  markNotificationRead,
  reminderNotificationId,
  isUuid,
  REMINDER_WINDOW_MS,
} from '../tools/notification_center';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const START = '2026-08-21T20:00:00.000Z';

function makeThenableChain(state: { data: any; error: any | null }) {
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

describe('isUuid', () => {
  it('accepts a real uuid', () => {
    expect(isUuid(USER_ID)).toBe(true);
  });
  it('rejects empty / non-string', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123 as unknown)).toBe(false);
  });
  it('rejects malformed uuids', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('00000000-0000-0000-0000-00000000000')).toBe(false);
  });
});

describe('reminderNotificationId', () => {
  it('returns a uuid-shaped string', () => {
    const id = reminderNotificationId(USER_ID, EVENT_ID, START);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
  it('is deterministic for the same inputs', () => {
    expect(reminderNotificationId(USER_ID, EVENT_ID, START))
      .toBe(reminderNotificationId(USER_ID, EVENT_ID, START));
  });
  it('changes when any input changes', () => {
    const base = reminderNotificationId(USER_ID, EVENT_ID, START);
    expect(reminderNotificationId('00000000-0000-0000-0000-000000000002', EVENT_ID, START)).not.toBe(base);
    expect(reminderNotificationId(USER_ID, '22222222-2222-2222-2222-222222222222', START)).not.toBe(base);
    expect(reminderNotificationId(USER_ID, EVENT_ID, '2026-08-21T21:00:00.000Z')).not.toBe(base);
  });
});

describe('generateRemindersForUser', () => {
  it('returns ok:false without calling Supabase on bad uuid', async () => {
    const from = vi.fn();
    const sb = { from } as unknown as SupabaseClient;
    const result = await generateRemindersForUser(sb, { client_user_id: 'not-a-uuid' });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/uuid/);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns ok:true with zero rows when user has no saves', async () => {
    const sb = { from: vi.fn().mockReturnValue(makeThenableChain({ data: [], error: null })) } as unknown as SupabaseClient;
    const result = await generateRemindersForUser(sb, {
      client_user_id: USER_ID,
      now: new Date(START),
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.eligible).toBe(0);
  });

  it('persists a reminder for a saved event inside the window', async () => {
    // Order of `from` calls: 1) saves, 2) events_public, 3) existing, 4) insert
    const calls: string[] = [];
    const fromFn = vi.fn().mockImplementation((table: string) => {
      calls.push(table);
      if (table === 'user_interactions') {
        return makeThenableChain({ data: [{ event_id: EVENT_ID }], error: null });
      }
      if (table === 'events_public') {
        return makeThenableChain({
          data: [{
            id: EVENT_ID,
            title_sv: 'Konsert',
            title_en: null,
            start_time: '2026-08-21T21:00:00.000Z',
            ticket_url: null,
            venues: { name: 'Konserthuset', city: 'Stockholm' },
          }],
          error: null,
        });
      }
      if (table === 'notifications') {
        return makeThenableChain({ data: [], error: null });
      }
      return makeThenableChain({ data: null, error: { message: 'unexpected table ' + table } });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await generateRemindersForUser(sb, {
      client_user_id: USER_ID,
      now: new Date(START),
      windowMs: REMINDER_WINDOW_MS,
    });
    expect(result.ok).toBe(true);
    expect(result.eligible).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0];
    expect(n.kind).toBe('reminder');
    expect(n.event_id).toBe(EVENT_ID);
    expect(n.title).toBe('Konsert');
    expect(n.body).toMatch(/Börjar/);
    expect(n.status).toBe('unread');
    // Order check: we hit notifications twice (existing lookup + insert)
    expect(calls).toContain('notifications');
  });

  it('is idempotent — re-running yields skipped, not inserted', async () => {
    const existingId = reminderNotificationId(USER_ID, EVENT_ID, '2026-08-21T21:00:00.000Z');
    let notificationsCall = 0;
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        return makeThenableChain({ data: [{ event_id: EVENT_ID }], error: null });
      }
      if (table === 'events_public') {
        return makeThenableChain({
          data: [{
            id: EVENT_ID,
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
        notificationsCall += 1;
        if (notificationsCall === 1) {
          // First notifications call = existing lookup
          return makeThenableChain({ data: [{ id: existingId }], error: null });
        }
        // Subsequent = insert (should not be reached when idempotent)
        return makeThenableChain({ data: null, error: null });
      }
      return makeThenableChain({ data: null, error: { message: 'unexpected' } });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await generateRemindersForUser(sb, {
      client_user_id: USER_ID,
      now: new Date(START),
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.notifications).toEqual([]);
  });

  it('returns ok:false when saves query fails', async () => {
    const sb = { from: vi.fn().mockReturnValue(makeThenableChain({ data: null, error: { message: 'db down' } })) } as unknown as SupabaseClient;
    const result = await generateRemindersForUser(sb, {
      client_user_id: USER_ID,
      now: new Date(START),
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/saves/);
  });

  it('uses sv title when present, en as fallback', async () => {
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'user_interactions') {
        return makeThenableChain({ data: [{ event_id: EVENT_ID }], error: null });
      }
      if (table === 'events_public') {
        return makeThenableChain({
          data: [{
            id: EVENT_ID,
            title_sv: null,
            title_en: 'English only',
            start_time: '2026-08-21T21:00:00.000Z',
            ticket_url: null,
            venues: null,
          }],
          error: null,
        });
      }
      return makeThenableChain({ data: [], error: null });
    });
    const sb = { from: fromFn } as unknown as SupabaseClient;
    const result = await generateRemindersForUser(sb, {
      client_user_id: USER_ID,
      now: new Date(START),
    });
    expect(result.notifications[0].title).toBe('English only');
  });
});

describe('listNotifications', () => {
  it('returns ok:false on bad uuid', async () => {
    const sb = { from: vi.fn() } as unknown as SupabaseClient;
    const result = await listNotifications(sb, 'not-a-uuid');
    expect(result.ok).toBe(false);
  });

  it('passes limit through and returns newest-first', async () => {
    const rows = [
      { id: 'a', kind: 'reminder', title: 'A', body: '', event_id: null, created_at: '2026-08-21T20:00:00.000Z', status: 'unread' },
      { id: 'b', kind: 'match',    title: 'B', body: '', event_id: null, created_at: '2026-08-21T21:00:00.000Z', status: 'unread' },
    ];
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnValue({ order, limit, eq, then: (r: any) => Promise.resolve({ data: rows, error: null }).then(r) });
    const sb = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient;
    const result = await listNotifications(sb, USER_ID, { limit: 5 });
    expect(result.ok).toBe(true);
    expect(result.notifications).toHaveLength(2);
    expect(limit).toHaveBeenCalledWith(5);
  });

  it('normalizes unknown status to unread', async () => {
    const rows = [{ id: 'a', kind: 'reminder', title: 'A', body: '', event_id: null, created_at: '2026-08-21T20:00:00.000Z', status: 'archived' }];
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (r: any) => Promise.resolve({ data: rows, error: null }).then(r),
    };
    const sb = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
    const result = await listNotifications(sb, USER_ID);
    expect(result.notifications[0].status).toBe('unread');
  });
});

describe('markNotificationRead', () => {
  it('rejects non-uuid ids without calling Supabase', async () => {
    const from = vi.fn();
    const sb = { from } as unknown as SupabaseClient;
    const r1 = await markNotificationRead(sb, 'bad', EVENT_ID);
    const r2 = await markNotificationRead(sb, USER_ID, 'bad');
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns ok:true on successful update', async () => {
    const eq = vi.fn().mockReturnThis();
    const update = vi.fn().mockReturnValue({ eq, then: (r: any) => Promise.resolve({ data: null, error: null }).then(r) });
    const sb = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const result = await markNotificationRead(sb, USER_ID, EVENT_ID);
    expect(result.ok).toBe(true);
    expect(eq).toHaveBeenCalledWith('id', EVENT_ID);
    expect(eq).toHaveBeenCalledWith('client_user_id', USER_ID);
  });
});
