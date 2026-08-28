/**
 * Tests for the notifications client — T0048 / MVP-gap §77.
 *
 * Mocks global.fetch + AsyncStorage so we can exercise the wire surface
 * without touching the network. AAA pattern.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Provide a minimal AsyncStorage mock so storage.js loads in Node.
vi.mock('@react-native-async-storage/async-storage', () => {
  const map = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => (map.has(k) ? map.get(k) : null),
      setItem: async (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: async (k: string) => { map.delete(k); },
    },
  };
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ANON_KEY = 'eventpulse.anon_user_id';
const ANON_VALUE = '00000000-0000-0000-0000-000000000999';

beforeEach(() => {
  fetchMock.mockReset();
  process.env.EXPO_PUBLIC_AGENT_URL = 'http://agent.test';
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AGENT_URL;
});

describe('notificationsClient', () => {
  describe('fetchNotifications', () => {
    it('returns ok:true with sanitized rows on a 200 response', async () => {
      // Pre-seed anon id
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      // Re-import after seeding so storage module picks up the cached value
      vi.resetModules();
      const { fetchNotifications } = await import('./notificationsClient');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          notifications: [
            {
              id: 'n1',
              kind: 'reminder',
              title: 'Konsert',
              body: 'Börjar om 1 h',
              event_id: '11111111-1111-1111-1111-111111111111',
              created_at: '2026-08-21T20:00:00.000Z',
              status: 'unread',
            },
            {
              // bad row — unknown kind → dropped
              id: 'n2',
              kind: 'unknown',
              title: 'X',
              body: '',
              event_id: null,
              created_at: '2026-08-21T20:00:00.000Z',
              status: 'read',
            },
          ],
        }),
      });
      const result = await fetchNotifications({ limit: 10 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].id).toBe('n1');
      expect(result.notifications[0].status).toBe('unread');
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/agent/notifications');
      expect(calledUrl).toContain(`client_user_id=${ANON_VALUE}`);
      expect(calledUrl).toContain('limit=10');
    });

    it('returns ok:false on a non-2xx response', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      vi.resetModules();
      const { fetchNotifications } = await import('./notificationsClient');

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      });
      const result = await fetchNotifications();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.warning).toMatch(/agent 500/);
    });

    it('returns ok:false on network error', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      vi.resetModules();
      const { fetchNotifications } = await import('./notificationsClient');

      fetchMock.mockRejectedValueOnce(new Error('connection refused'));
      const result = await fetchNotifications();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.warning).toBe('network');
    });

    it('clamps limit to [1, 200]', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      vi.resetModules();
      const { fetchNotifications } = await import('./notificationsClient');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ notifications: [] }),
      });
      await fetchNotifications({ limit: 999_999 });
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('limit=200');
    });
  });

  describe('markNotificationRead', () => {
    it('returns ok:true on a 200', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      vi.resetModules();
      const { markNotificationRead } = await import('./notificationsClient');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
      const result = await markNotificationRead({ notificationId: 'n1' });
      expect(result.ok).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/agent/notifications/read');
      expect(init.method).toBe('POST');
      const body = JSON.parse(String(init.body));
      expect(body.client_user_id).toBe(ANON_VALUE);
      expect(body.notification_id).toBe('n1');
    });

    it('returns ok:false on missing notificationId', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      vi.resetModules();
      const { markNotificationRead } = await import('./notificationsClient');

      const result = await markNotificationRead({ notificationId: '' });
      expect(result.ok).toBe(false);
      expect(result.warning).toMatch(/missing/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats 202 as a soft success (warning surfaced)', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(ANON_KEY, ANON_VALUE);
      vi.resetModules();
      const { markNotificationRead } = await import('./notificationsClient');

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 202,
        json: async () => ({ ok: false, warning: 'mock' }),
      });
      const result = await markNotificationRead({ notificationId: 'n1' });
      expect(result.ok).toBe(false);
      expect(result.warning).toBe('mock');
    });
  });

  describe('groupNotifications', () => {
    it('buckets by kind and sorts newest first', async () => {
      const { groupNotifications } = await import('./notificationsClient');
      const out = groupNotifications([
        { id: '1', kind: 'reminder' as const,  title: 'a', body: '', event_id: null, created_at: '2026-08-21T20:00:00.000Z', status: 'unread' as const },
        { id: '2', kind: 'match' as const,     title: 'b', body: '', event_id: null, created_at: '2026-08-21T21:00:00.000Z', status: 'unread' as const },
        { id: '3', kind: 'response' as const,  title: 'c', body: '', event_id: null, created_at: '2026-08-21T19:00:00.000Z', status: 'read' as const },
        { id: '4', kind: 'reminder' as const,  title: 'd', body: '', event_id: null, created_at: '2026-08-21T22:00:00.000Z', status: 'unread' as const },
        { id: '5', kind: 'unknown' as unknown as 'match', title: 'e', body: '', event_id: null, created_at: '2026-08-21T23:00:00.000Z', status: 'unread' as const },
      ]);
      expect(out.reminders.map((n) => n.id)).toEqual(['4', '1']);
      expect(out.matches.map((n) => n.id)).toEqual(['2']);
      expect(out.responses.map((n) => n.id)).toEqual(['3']);
      expect(out.total).toBe(5);
    });

    it('returns empty buckets for a non-array input', async () => {
      const { groupNotifications } = await import('./notificationsClient');
      const out = groupNotifications(null as unknown as never[]);
      expect(out.reminders).toEqual([]);
      expect(out.matches).toEqual([]);
      expect(out.responses).toEqual([]);
      expect(out.total).toBe(0);
    });
  });

  describe('deepLinkFor', () => {
    it('returns EventDetail link when event_id present', async () => {
      const { deepLinkFor } = await import('./notificationsClient');
      const link = deepLinkFor({
        id: 'n1', kind: 'reminder', title: 'a', body: '', event_id: '11111111-1111-1111-1111-111111111111',
        created_at: '', status: 'unread',
      });
      expect(link).toEqual({
        screen: 'EventDetail',
        params: { id: '11111111-1111-1111-1111-111111111111' },
      });
    });

    it('returns null when no event_id', async () => {
      const { deepLinkFor } = await import('./notificationsClient');
      expect(deepLinkFor(null)).toBeNull();
      expect(deepLinkFor({ id: 'n', event_id: null })).toBeNull();
    });
  });
});
