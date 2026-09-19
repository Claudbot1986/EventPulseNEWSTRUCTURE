/**
 * Tests for the agent client auth guard — guest mode (UserPicker removal).
 *
 * Every user-scoped /agent/* endpoint is gated server-side by requireUser.
 * When there is no Supabase session (guest mode), the client must fail fast
 * WITHOUT a network call and surface a stable 'auth' signal so UI surfaces
 * can show a login nudge instead of a bare 401.
 *
 * Contract per function family:
 *   - { ok, warning }-shaped writers  → { ok: false, warning: 'auth' }
 *   - list readers                    → empty list shape + warning: 'auth'
 *   - deleteAccount                   → { ok: false, error: 'auth' }
 *   - throwing readers/chat           → reject with code 'AUTH_REQUIRED'
 *   - public endpoints (feed)         → unaffected: no session => still fetch
 *
 * Mocks global.fetch + AsyncStorage. ./networkContext is mocked because the
 * real module is JSX-in-.js (unresolvable in the node test environment).
 * AAA pattern.
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

// The real module imports React/JSX in a .js file — never load it in tests.
vi.mock('./networkContext', () => ({
  markOnline: vi.fn(),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const AUTH_SESSION_KEY = 'eventpulse.auth_session';

/** expires_at=0 means "no expiry tracked" → treated as valid by storage.isAuthenticated(). */
async function seedAuthSession() {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(
    AUTH_SESSION_KEY,
    JSON.stringify({ access_token: 'test-jwt', refresh_token: null, expires_at: 0, user: { id: 'u1', email: null } })
  );
}

// agentClient.js is untyped JS — destructured params infer as all-required,
// so type the module as any in the test harness (runtime behavior is what's
// under test here, not its inference surface).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importClient(): Promise<any> {
  vi.resetModules();
  return await import('./agentClient');
}

beforeEach(async () => {
  fetchMock.mockReset();
  process.env.EXPO_PUBLIC_AGENT_URL = 'http://agent.test';
  // The AsyncStorage mock map persists across tests within this file — flush
  // the auth session so earlier seeded sessions never leak into no-session tests.
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.removeItem(AUTH_SESSION_KEY);
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AGENT_URL;
});

describe('agentClient auth guard (guest mode)', () => {
  describe('writers — { ok: false, warning: auth } without a session, no fetch', () => {
    it('recordEventInteraction', async () => {
      const { recordEventInteraction } = await importClient();
      const res = await recordEventInteraction({ eventId: 'e1', interaction: 'save' });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('savePreferencesToServer', async () => {
      const { savePreferencesToServer } = await importClient();
      const res = await savePreferencesToServer({ categories: ['music'] });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('recordAttendance', async () => {
      const { recordAttendance } = await importClient();
      const res = await recordAttendance({ eventId: 'e1' });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('recordRating', async () => {
      const { recordRating } = await importClient();
      const res = await recordRating({ eventId: 'e1', rating: 4 });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('followEntity', async () => {
      const { followEntity } = await importClient();
      const res = await followEntity({ entityType: 'venue', entityId: 'v1', action: 'follow' });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shareSession', async () => {
      const { shareSession } = await importClient();
      const res = await shareSession({ query: 'jazz' });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('registerPushToken', async () => {
      const { registerPushToken } = await importClient();
      const res = await registerPushToken({ followPushEnabled: true });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('setNotificationPrefs', async () => {
      const { setNotificationPrefs } = await importClient();
      const res = await setNotificationPrefs({ entityType: 'venue', entityId: 'v1', level: 'all' });
      expect(res).toEqual({ ok: false, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('list readers — empty shape + warning auth without a session, no fetch', () => {
    it('getFollowedEntities', async () => {
      const { getFollowedEntities } = await importClient();
      const res = await getFollowedEntities();
      expect(res).toEqual({ ok: false, venueIds: [], artistSlugs: [], count: 0, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('getNotificationPrefs', async () => {
      const { getNotificationPrefs } = await importClient();
      const res = await getNotificationPrefs();
      expect(res).toEqual({ notification_prefs: {}, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchCachedRecommendations', async () => {
      const { fetchCachedRecommendations } = await importClient();
      const res = await fetchCachedRecommendations();
      expect(res).toEqual({ slots: [], generated_at: null, warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchRecentQueries', async () => {
      const { fetchRecentQueries } = await importClient();
      const res = await fetchRecentQueries();
      expect(res).toEqual({ queries: [], warning: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('throwing readers/chat — reject with AUTH_REQUIRED, no fetch', () => {
    it('chatWithAgent', async () => {
      const { chatWithAgent } = await importClient();
      await expect(chatWithAgent({ message: 'jazz ikväll' })).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchRecommendedEvents', async () => {
      const { fetchRecommendedEvents } = await importClient();
      await expect(fetchRecommendedEvents()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchSavedEvents', async () => {
      const { fetchSavedEvents } = await importClient();
      await expect(fetchSavedEvents()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount — { ok: false, error: auth } without a session, no fetch', () => {
    it('deleteAccount', async () => {
      const { deleteAccount } = await importClient();
      const res = await deleteAccount();
      expect(res).toEqual({ ok: false, error: 'auth' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('with a seeded session — Bearer is attached and fetch runs', () => {
    it('recordEventInteraction sends Authorization: Bearer test-jwt', async () => {
      await seedAuthSession();
      const { recordEventInteraction } = await importClient();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
      const res = await recordEventInteraction({ eventId: 'e1', interaction: 'save' });
      expect(res).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-jwt');
    });

    it('fetchSavedEvents sends Authorization: Bearer test-jwt', async () => {
      await seedAuthSession();
      const { fetchSavedEvents } = await importClient();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ events: [] }),
      });
      const res = await fetchSavedEvents();
      expect(res.events).toEqual([]);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-jwt');
    });

    it('deleteAccount sends Authorization: Bearer test-jwt', async () => {
      await seedAuthSession();
      const { deleteAccount } = await importClient();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
      const res = await deleteAccount();
      expect(res.ok).toBe(true);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-jwt');
    });
  });

  describe('public endpoints stay anonymous (no guard)', () => {
    it('fetchFeed still fetches without a session', async () => {
      const { fetchFeed } = await importClient();
      // pickReachableAgentBase health probe, then the feed call.
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ events: [] }),
        });
      const res = await fetchFeed({ from: '2026-09-19', days: 1 });
      expect(res.events).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const calledUrl = fetchMock.mock.calls[1][0] as string;
      expect(calledUrl).toContain('/agent/feed');
    });
  });
});
