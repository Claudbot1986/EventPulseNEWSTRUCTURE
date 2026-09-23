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
  // A second candidate URL must never leak from the portal-hardening tests
  // into tests that expect a single-candidate setup.
  delete process.env.EXPO_PUBLIC_AGENT_URL_LAN;
  // The AsyncStorage mock map persists across tests within this file — flush
  // the auth session so earlier seeded sessions never leak into no-session tests.
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.removeItem(AUTH_SESSION_KEY);
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AGENT_URL;
  delete process.env.EXPO_PUBLIC_AGENT_URL_LAN;
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

    it('registerPushToken (dinHelgPushEnabled)', async () => {
      const { registerPushToken } = await importClient();
      const res = await registerPushToken({ dinHelgPushEnabled: true });
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

  describe('fetchFeed card mapping — rank reasons survive to the card (Fas C.2)', () => {
    // Fas C (e602178): the server attaches reasons+score to feed cards for
    // PERSONALIZATION_PRIORS-treatment users. Fas C.2: the legacy-shape mapper
    // must forward `reasons` so EventCardCompact can render always-visible
    // why-chips (resolveConsumerReasons). Guests/control get no reasons on the
    // wire → [] → no chips. Wire shape mirrors feed_rank_wire.test.ts payloads.
    const wireEvent = {
      id: 'e1',
      title: 'Jazz på Scen X',
      start_time: '2026-09-25T19:30:00+02:00',
      end_time: null,
      venue_name: 'Scen X',
      city: 'Stockholm',
      category_slug: 'music',
      is_free: true,
      price_min_sek: null,
      price_max_sek: null,
      ticket_url: 'https://example.com/t',
      image_url: null,
      image_ai_generated: false,
      image_ai_optout: false,
      image_generation_status: null,
      source: 'ticketmaster',
    };

    function mockFeedOnce(payload: Record<string, unknown>) {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200 }) // health probe
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
    }

    it('forwards wire reasons onto the legacy card, preserving server order', async () => {
      const { fetchFeed } = await importClient();
      mockFeedOnce({
        events: [{ ...wireEvent, reasons: ['followed_venue', 'category_personalization'], score: 1.25 }],
        from: '2026-09-25',
        to: '2026-10-02',
        has_more: false,
        total: 1,
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 7 });
      expect(res.events).toHaveLength(1);
      expect(res.events[0].reasons).toEqual(['followed_venue', 'category_personalization']);
    });

    it('a card without wire reasons maps to [] — guests/control render no chips', async () => {
      const { fetchFeed } = await importClient();
      mockFeedOnce({
        events: [{ ...wireEvent, reasons: undefined }],
        from: '2026-09-25',
        to: '2026-10-02',
        has_more: false,
        total: 1,
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 7 });
      expect(res.events[0].reasons).toEqual([]);
    });

    it('non-array garbage reasons collapse to [] instead of crashing the card', async () => {
      const { fetchFeed } = await importClient();
      mockFeedOnce({
        events: [{ ...wireEvent, reasons: 'followed_venue' }],
        from: '2026-09-25',
        to: '2026-10-02',
        has_more: false,
        total: 1,
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 7 });
      expect(res.events[0].reasons).toEqual([]);
    });

    // Fas D (2026-09-23): the Stämningsfullt tile sends a server-side mood
    // filter — fetchFeed must carry it on the wire, and omit it entirely for
    // plain browsing so the canonical feed URL stays byte-stable.
    it('sends the mood filter as a query param when provided', async () => {
      const { fetchFeed } = await importClient();
      mockFeedOnce({
        events: [],
        from: '2026-09-25',
        to: '2026-10-02',
        has_more: false,
        total: 0,
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 7, mood: 'stamningsfullt' });
      expect(res.events).toEqual([]);
      const feedCall = fetchMock.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((u: string) => u.includes('/agent/feed'));
      expect(feedCall).toContain('mood=stamningsfullt');
    });

    it('omits the mood param entirely when not provided', async () => {
      const { fetchFeed } = await importClient();
      mockFeedOnce({
        events: [],
        from: '2026-09-25',
        to: '2026-10-02',
        has_more: false,
        total: 0,
      });
      await fetchFeed({ from: '2026-09-25', days: 7 });
      const feedCall = fetchMock.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((u: string) => u.includes('/agent/feed'));
      expect(feedCall).not.toContain('mood=');
    });
  });

  describe('fetchFeed abort semantics — cancel is not a load failure (2026-09-22)', () => {
    // Device error of the day: "fetch failed: FetchRequestCanceledException"
    // surfaced as "Failed to load events". Aborts have two distinct causes:
    //   1. OUR timeout  → a real (slow) failure: throw a friendly, honest
    //      timeout Error so the error banner says something human.
    //   2. External cancel (app reload/teardown) → not a failure at all:
    //      rethrow the cancel as-is so callers can detect + ignore it.
    const CANCEL_MSG =
      'fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)';

    /** Expo-style fetch mock: health probe resolves; feed fetch rejects with
     *  the native cancel exception the moment its signal aborts. */
    function mockExpoFetch() {
      fetchMock.mockImplementation((url: unknown, init?: unknown) => {
        if (String(url).includes('/agent/health')) {
          return Promise.resolve({ ok: true, status: 200 });
        }
        return new Promise((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
          if (!signal) return; // no signal: hang forever
          if (signal.aborted) {
            reject(new Error(CANCEL_MSG));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error(CANCEL_MSG)), { once: true });
        });
      });
    }

    it('our own timeout throws a friendly timeout Error, not the raw cancel exception', async () => {
      const { fetchFeed } = await importClient();
      mockExpoFetch();
      await expect(fetchFeed({ from: '2026-09-22', days: 1, timeoutMs: 5 })).rejects.toThrow(/timeout/i);
    });

    it('external cancel rethrows the native cancel exception untouched', async () => {
      const { fetchFeed } = await importClient();
      mockExpoFetch();
      const ext = new AbortController();
      const pending = fetchFeed({ from: '2026-09-22', days: 1, signal: ext.signal, timeoutMs: 60_000 });
      // Let fetchFeed reach the in-flight fetch, then cancel mid-flight.
      await new Promise((resolve) => setTimeout(resolve, 0));
      ext.abort();
      await expect(pending).rejects.toThrow('FetchRequestCanceledException');
    });

    it('isFetchCanceled recognizes abort shapes, not plain errors', async () => {
      const { isFetchCanceled } = await importClient();
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      expect(isFetchCanceled(abortErr)).toBe(true);
      expect(isFetchCanceled(new Error(CANCEL_MSG))).toBe(true);
      expect(isFetchCanceled(new Error('feed timeout after 20s — agent API unreachable'))).toBe(false);
      expect(isFetchCanceled(new Error('feed 500: Internal Server Error'))).toBe(false);
      expect(isFetchCanceled(null)).toBe(false);
    });

    it('a native cancel (network blip) is retried once and can succeed', async () => {
      // Device reality 2026-09-22: mid-app FetchRequestCanceledException
      // blips repeatedly killed the helg-chip refetch, leaving a stale
      // today-window list that the 'helgen' filter emptied. One silent
      // retry absorbs the blip without the user ever noticing.
      const { fetchFeed } = await importClient();
      let feedAttempts = 0;
      fetchMock.mockImplementation((url: unknown) => {
        if (String(url).includes('/agent/health')) {
          return Promise.resolve({ ok: true, status: 200 });
        }
        feedAttempts += 1;
        if (feedAttempts === 1) {
          return Promise.reject(new Error(CANCEL_MSG));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ events: [{ id: 'e1', start_time: '2026-09-25T18:00:00' }] }),
        });
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 1 });
      expect(res.events).toHaveLength(1);
      expect(feedAttempts).toBe(2);
    });

    it('a cancel that survives the retry rejects with the cancel error (teardown stays caller-silent)', async () => {
      const { fetchFeed } = await importClient();
      let feedAttempts = 0;
      fetchMock.mockImplementation((url: unknown) => {
        if (String(url).includes('/agent/health')) {
          return Promise.resolve({ ok: true, status: 200 });
        }
        feedAttempts += 1;
        return Promise.reject(new Error(CANCEL_MSG));
      });
      await expect(fetchFeed({ from: '2026-09-25', days: 1 })).rejects.toThrow('FetchRequestCanceledException');
      expect(feedAttempts).toBe(2);
    });

    it('our own timeout is NOT retried — 20s already spent, fail honestly', async () => {
      const { fetchFeed } = await importClient();
      mockExpoFetch();
      let feedAttempts = 0;
      fetchMock.mockImplementation((url: unknown, init?: unknown) => {
        if (String(url).includes('/agent/health')) {
          return Promise.resolve({ ok: true, status: 200 });
        }
        feedAttempts += 1;
        return new Promise((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
          if (!signal) return;
          signal.addEventListener('abort', () => reject(new Error(CANCEL_MSG)), { once: true });
        });
      });
      await expect(fetchFeed({ from: '2026-09-25', days: 1, timeoutMs: 5 })).rejects.toThrow(/timeout/i);
      expect(feedAttempts).toBe(1);
    });

    it('a caller-signal abort is not retried — the caller asked for cancellation', async () => {
      const { fetchFeed } = await importClient();
      let feedAttempts = 0;
      fetchMock.mockImplementation((url: unknown, init?: unknown) => {
        if (String(url).includes('/agent/health')) {
          return Promise.resolve({ ok: true, status: 200 });
        }
        feedAttempts += 1;
        // Hang until the request's signal aborts — the cancel must come
        // from the caller's abort, not from an instant mock rejection.
        return new Promise((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
          if (!signal) return;
          signal.addEventListener('abort', () => reject(new Error(CANCEL_MSG)), { once: true });
        });
      });
      const ext = new AbortController();
      const pending = fetchFeed({ from: '2026-09-25', days: 1, signal: ext.signal, timeoutMs: 60_000 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      ext.abort();
      await expect(pending).rejects.toThrow('FetchRequestCanceledException');
      expect(feedAttempts).toBe(1);
    });
  });

  describe('pickReachableAgentBase hardening — impostor probes are never cached (2026-09-22)', () => {
    // Device reality: on a foreign network (user 2026-09-22, "jag är inte på
    // samma wifi") hotel/café captive portals answer HTTP 200 with a login
    // page to ANY url. Accepting any response.ok poisoned cachedAgentBase,
    // sending every later fetch to a wrong host → 20s "agent API
    // unreachable" timeouts. Only the agent's real health body { ok: true }
    // proves a candidate IS the agent.
    const HEALTH_OK = async () => ({ ok: true, phase: 0 });

    it('a captive-portal impostor (200, non-JSON body) is skipped — the real agent wins', async () => {
      process.env.EXPO_PUBLIC_AGENT_URL = 'http://portal.test';
      process.env.EXPO_PUBLIC_AGENT_URL_LAN = 'http://real.test';
      const { fetchFeed } = await importClient();
      fetchMock.mockImplementation((url: unknown) => {
        const s = String(url);
        if (s.startsWith('http://portal.test')) {
          // Captive portal: 200 + HTML login page (json() explodes).
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('Unexpected token < in JSON');
            },
          });
        }
        if (s.startsWith('http://real.test/agent/health')) {
          return Promise.resolve({ ok: true, status: 200, json: HEALTH_OK });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ events: [{ id: 'e1', start_time: '2026-09-25T18:00:00' }] }),
        });
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 1 });
      expect(res.events).toHaveLength(1);
      const feedCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/agent/feed'));
      expect(String(feedCall?.[0])).toContain('http://real.test/agent/feed');
    });

    it('a 200 with an explicit not-ok body is not the agent either', async () => {
      process.env.EXPO_PUBLIC_AGENT_URL = 'http://portal.test';
      process.env.EXPO_PUBLIC_AGENT_URL_LAN = 'http://real.test';
      const { fetchFeed } = await importClient();
      fetchMock.mockImplementation((url: unknown) => {
        const s = String(url);
        if (s.startsWith('http://portal.test')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: false }) });
        }
        if (s.startsWith('http://real.test/agent/health')) {
          return Promise.resolve({ ok: true, status: 200, json: HEALTH_OK });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ events: [] }) });
      });
      const res = await fetchFeed({ from: '2026-09-25', days: 1 });
      expect(res.events).toEqual([]);
      const feedCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/agent/feed'));
      expect(String(feedCall?.[0])).toContain('http://real.test/agent/feed');
    });

    it('every candidate an impostor → honest fallback to urls[0], no verified win', async () => {
      process.env.EXPO_PUBLIC_AGENT_URL = 'http://portal.test';
      process.env.EXPO_PUBLIC_AGENT_URL_LAN = 'http://portal2.test';
      const { fetchFeed } = await importClient();
      fetchMock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('Unexpected token < in JSON');
          },
        }),
      );
      // The feed call still happens against urls[0] — degraded but honest,
      // and the json failure surfaces as a real error (not a fake success).
      await expect(fetchFeed({ from: '2026-09-25', days: 1, timeoutMs: 5 })).rejects.toThrow(
        'Unexpected token < in JSON',
      );
      const feedCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/agent/feed'));
      expect(String(feedCall?.[0])).toContain('http://portal.test/agent/feed');
    });
  });
});
