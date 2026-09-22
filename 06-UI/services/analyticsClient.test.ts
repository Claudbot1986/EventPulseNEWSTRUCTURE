/**
 * analyticsClient.test.ts — tile_tap helper (Fas B, 2026-09-22).
 *
 * The Utforska tiles emit `tile_tap { word }` on press — the per-word KPI
 * that lands in dashboard 7777 (Fas E). This pins the client contract:
 *   - a known tile word queues { event_type: 'tile_tap', page: 'home',
 *     payload: { word } } and the batch POSTs to /api/events
 *   - an unknown word clamps to 'unknown' (schema max 32 chars)
 *   - the GDPR consent gate drops tile_tap like every other event
 *
 * Mocks AsyncStorage + global.fetch. The env var is read at module load,
 * so every import goes through importClient() with the env pinned.
 * AAA pattern.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const map = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => (map.has(k) ? map.get(k) : null),
      setItem: async (k: string, v: string) => {
        map.set(k, String(v));
      },
      removeItem: async (k: string) => {
        map.delete(k);
      },
    },
  };
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/**
 * Fresh module instance with the analytics URL pinned (module-load state)
 * and a consenting active user seeded — tile_tap must survive the whole
 * gate chain to reach the wire.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importClient(): Promise<any> {
  vi.resetModules();
  const mod = await import('./analyticsClient');
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('analytics.active_user', 'tomorg1');
  // Consent is stored as '1' (getConsent checks raw === '1').
  await AsyncStorage.setItem('analytics.consent', '1');
  return mod;
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env.EXPO_PUBLIC_ANALYTICS_URL = 'http://analytics.test';
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_ANALYTICS_URL;
});

describe('tileTap (Utforska tiles → tile_tap on the wire)', () => {
  it('queues a tile_tap event and POSTs it in the flush batch', async () => {
    const { analyticsClient } = await importClient();
    await analyticsClient.tileTap('helg');
    await analyticsClient._flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('http://analytics.test/api/events');
    const body = JSON.parse(String(init?.body)) as {
      events: Array<{ event_type: string; page: string; payload: Record<string, unknown> }>;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event_type).toBe('tile_tap');
    expect(body.events[0].page).toBe('home');
    expect(body.events[0].payload).toEqual({ word: 'helg' });
  });

  it('clamps an unknown tile word to unknown (schema guard)', async () => {
    const { analyticsClient } = await importClient();
    await analyticsClient.tileTap('not-a-tile');
    await analyticsClient._flush();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init?.body)) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.events[0].payload).toEqual({ word: 'unknown' });
  });

  it('the GDPR consent gate drops tile_tap like every other event', async () => {
    const { analyticsClient } = await importClient();
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('analytics.consent', '0');
    await analyticsClient.tileTap('helg');
    await analyticsClient._flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TILE_WORDS mirrors the six Utforska tiles', async () => {
    const { analyticsClient } = await importClient();
    expect(analyticsClient.TILE_WORDS).toEqual([
      'gratis', 'live', 'skratt', 'stamning', 'helg', 'imorgon',
    ]);
  });
});