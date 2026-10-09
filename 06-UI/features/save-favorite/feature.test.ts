/**
 * save-favorite feature — tester.
 *
 * Stream B.1 (Agent Trust Plan 2026-10-09): feature-as-directory-pilot.
 *
 * Täcker:
 *   - getSaveState: tom cache → null, skriven state → round-trippar,
 *     corrupt JSON hanteras tyst (returnerar null, kastar inte).
 *   - toggleSave: växlar isSaved, skriver cache, postar till /agent/feedback
 *     med korrekt interaction_type ('save' respektive 'unsave'),
 *     returnerar nästa-state-objekt.
 *   - toggleSave: backend-fel kastar INTE — local state är redan optimistiskt
 *     toggle.
 *   - clearAll: rensar cache + postar gdpr_erase-signal.
 *
 * Täcker INTE useSaveState-hook:en — den kräver en React-renderer
 * (react-dom eller react-test-renderer) för att useState/useEffect ska gå att
 * anropa; vi har inte jsdom/happy-dom installerat. Hookens publika shape och
 * cache-läsning täcks indirekt av getSaveState-testerna (samma cache-nyckel
 * och round-trip-format).
 *
 * Mockning:
 *   - @react-native-async-storage/async-storage stubbas med en in-memory Map
 *     (samma mönster som storage.test.ts).
 *   - global.fetch stubbas per test så vi kan inspektera body + headers.
 *   - console.warn tystas för den kända "corrupt JSON"-grenen.
 *
 * Run:  npx vitest run 06-UI/features/save-favorite/feature.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks (MÅSTE deklareras före modulen-under-test, pga vi.mock-hoisting) ──

vi.mock('@react-native-async-storage/async-storage', () => {
  const map = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: async (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: async (k: string) => {
        map.delete(k);
      },
    },
  };
});

// 06-UI's services/agentClient.js drar in networkContext.js som är JSX i
// en .js-fil — olösligt i vitest-noden (saknar jsdom/happy-dom). Mocka
// bort det enda vi faktiskt behöver: markOnline (som feature.api aldrig
// anropar, men som agentClient.js importerar vid modul-load). Samma mönster
// som 06-UI/services/agentClient.test.ts.
vi.mock('../../services/networkContext', () => ({
  markOnline: () => {},
  NetworkProvider: ({ children }) => children,
  NetworkContext: { Provider: () => null },
  useNetworkContext: () => ({ isConnected: true }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getSaveState,
  toggleSave,
  clearAll,
} from './feature.api';

const STORAGE_KEY = 'eventpulse.save-favorite.v1';

// ── Hjälpare ────────────────────────────────────────────────────────────────

/** Rensa mock-AsyncStorage mellan testfall. */
async function resetStorage() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Mock fetch med en respons + hjälpare att läsa senaste request-body. */
function installFetchMock(respond: (req: { url: string; body: any }) => Response) {
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const callRecord = { url, body, headers: init?.headers ?? {} };
    calls.push(callRecord);
    return respond(callRecord);
  });
  global.fetch = mock as unknown as typeof fetch;
  return { mock, calls };
}

// ── getSaveState ────────────────────────────────────────────────────────────

describe('getSaveState', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it('returnerar null när inget är sparat för eventId', async () => {
    const r = await getSaveState('event-1');
    expect(r).toBeNull();
  });

  it('round-trippar en sparad state', async () => {
    const updatedAt = '2026-10-09T12:00:00.000Z';
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'event-1': { isSaved: true, updatedAt } }),
    );
    const r = await getSaveState('event-1');
    expect(r).toEqual({ isSaved: true, updatedAt });
  });

  it('returnerar null för eventId som inte finns i ett giltigt cache-objekt', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'event-other': { isSaved: true, updatedAt: 'x' } }),
    );
    const r = await getSaveState('event-1');
    expect(r).toBeNull();
  });

  it('returnerar null tyst vid korrupt JSON (kastar inte)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await AsyncStorage.setItem(STORAGE_KEY, '{this is not valid json');
    const r = await getSaveState('event-1');
    expect(r).toBeNull();
    warnSpy.mockRestore();
  });

  it('returnerar null vid null-lagrat värde', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ 'event-1': null }));
    const r = await getSaveState('event-1');
    expect(r).toBeNull();
  });
});

// ── toggleSave ──────────────────────────────────────────────────────────────

describe('toggleSave', () => {
  beforeEach(async () => {
    await resetStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('växlar från osparad → sparad och postar interaction_type=save', async () => {
    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    const result = await toggleSave('event-1', 'user-1');

    expect(result.isSaved).toBe(true);
    expect(result.eventId).toBe('event-1');
    expect(result.pending).toBe(false);
    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/agent/feedback');
    expect(calls[0].body).toMatchObject({
      client_user_id: 'user-1',
      event_id: 'event-1',
      interaction_type: 'save',
    });
    expect(calls[0].body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('växlar från sparad → osparad och postar interaction_type=unsave', async () => {
    // Först spara
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'event-1': { isSaved: true, updatedAt: '2026-10-08T00:00:00.000Z' } }),
    );

    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    const result = await toggleSave('event-1', 'user-1');

    expect(result.isSaved).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.interaction_type).toBe('unsave');
  });

  it('tillåter userId=null (gästläge)', async () => {
    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    await toggleSave('event-1', null);
    expect(calls[0].body.client_user_id).toBeNull();
  });

  it('fortsätter lokalt vid backend-fel (kastar inte)', async () => {
    const { calls } = installFetchMock(() => {
      throw new Error('network down');
    });

    const result = await toggleSave('event-1', 'user-1');
    expect(result.isSaved).toBe(true); // lokalt ändå toggle:ad

    // Och cachen är skriven
    const cached = await getSaveState('event-1');
    expect(cached?.isSaved).toBe(true);

    // fetch anropades en gång (även om det kastade)
    expect(calls).toHaveLength(1);
  });

  it('fortsätter lokalt vid backend 500-svar (kastar inte)', async () => {
    installFetchMock(() => new Response('boom', { status: 500 }));

    const result = await toggleSave('event-1', 'user-1');
    expect(result.isSaved).toBe(true);
    const cached = await getSaveState('event-1');
    expect(cached?.isSaved).toBe(true);
  });

  it('inkluderar Content-Type-application/json-header i requesten', async () => {
    // AsyncStorage saknar auth-session → getAuthHeader() (från agentClient)
    // returnerar {}. Det vi verifierar här är att rätt Content-Type skickas;
    // Authorization-header-vägen testas indirekt genom att network-context.js:s
    // dependency-träd INTE block:ar test-loadningen (vitet kör allt).
    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    await toggleSave('event-1', 'user-1');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('skickar INGEN Authorization-header när ingen session finns', async () => {
    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    await toggleSave('event-1', 'user-1');
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });

  it('TVÅ idempotenta toggles på samma event tar state false → true → false', async () => {
    installFetchMock(() => new Response('{}', { status: 200 }));

    const first = await toggleSave('event-1', 'user-1');
    const second = await toggleSave('event-1', 'user-1');

    expect(first.isSaved).toBe(true);
    expect(second.isSaved).toBe(false);
  });
});

// ── clearAll (GDPR-erase) ───────────────────────────────────────────────────

describe('clearAll', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it('rensar all save-state ur cache', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'event-1': { isSaved: true, updatedAt: '2026-10-09T00:00:00.000Z' },
        'event-2': { isSaved: true, updatedAt: '2026-10-09T00:00:00.000Z' },
      }),
    );

    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    await clearAll('user-1');

    const v1 = await getSaveState('event-1');
    const v2 = await getSaveState('event-2');
    expect(v1).toBeNull();
    expect(v2).toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/agent/feedback');
    expect(calls[0].body.interaction_type).toBe('gdpr_erase_save_favorite');
    expect(calls[0].body.client_user_id).toBe('user-1');
    expect(calls[0].body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('fungerar även om cache redan är tom', async () => {
    const { calls } = installFetchMock(() => new Response('{}', { status: 200 }));
    await clearAll('user-1');
    expect(calls).toHaveLength(1); // signal skickas ändå
  });

  it('kastar inte om backend-signalen misslyckas', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'event-1': { isSaved: true, updatedAt: 'x' } }),
    );
    installFetchMock(() => {
      throw new Error('offline');
    });

    // Ska INTE kasta
    await expect(clearAll('user-1')).resolves.toBeUndefined();
    // Och cache ska vara rensad (det lokala steget lyckas även vid nät-fel)
    expect(await getSaveState('event-1')).toBeNull();
  });
});

// ── useSaveState: se modul-top-kommentar — hook-testning kräver React-renderer ──
