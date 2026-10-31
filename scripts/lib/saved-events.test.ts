/**
 * scripts/lib/saved-events.test.ts
 *
 * Regressionstester för purge-skydden. Bakgrunden: purge-skriptet frågade en
 * tabell som inte finns, felet svaldes, och sparade events raderades tyst.
 * Dessa tester låser både "rätt tabell" och "fail-closed"-beteendet.
 */
import { describe, it, expect } from 'vitest';
import {
  fetchSavedEventIds,
  partitionBySaved,
  type SavedEventsClient,
} from './saved-events';

/** Testdubbel som svarar som en Supabase-klient med en fel. */
function errorClient(message: string): SavedEventsClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: async () => ({ data: null, error: { message } }),
        }),
      }),
    }),
  };
}

/** Testdubbel som svarar med rader. */
function rowsClient(rows: Array<{ event_id: string | null }>): SavedEventsClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

/** Testdubbel som kastar (nätverksfel). */
function throwingClient(message: string): SavedEventsClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: async () => {
            throw new Error(message);
          },
        }),
      }),
    }),
  };
}

describe('fetchSavedEventIds', () => {
  it('läser sparade event_id från user_interactions', async () => {
    const client = rowsClient([
      { event_id: 'evt-1' },
      { event_id: 'evt-2' },
    ]);
    const res = await fetchSavedEventIds(client);
    expect(res.ok).toBe(true);
    expect(res.eventIds.sort()).toEqual(['evt-1', 'evt-2']);
  });

  it('hoppar över rader med null event_id (äldre save-rader)', async () => {
    const client = rowsClient([
      { event_id: null },
      { event_id: 'evt-1' },
      { event_id: null },
    ]);
    const res = await fetchSavedEventIds(client);
    expect(res.ok).toBe(true);
    expect(res.eventIds).toEqual(['evt-1']);
  });

  it('deduplikerar samma event_id', async () => {
    const client = rowsClient([
      { event_id: 'evt-1' },
      { event_id: 'evt-1' },
    ]);
    const res = await fetchSavedEventIds(client);
    expect(res.eventIds).toEqual(['evt-1']);
  });

  it('returnerar ok=false när frågan fallerar (fail-closed-signalen)', async () => {
    const res = await fetchSavedEventIds(
      errorClient("Could not find the table 'public.user_interaction_save'"),
    );
    expect(res.ok).toBe(false);
    expect(res.eventIds).toEqual([]);
    expect(res.error).toContain('Could not find the table');
  });

  it('returnerar ok=false när klienten kastar', async () => {
    const res = await fetchSavedEventIds(throwingClient('fetch failed'));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('fetch failed');
  });
});

describe('partitionBySaved', () => {
  it('skyddar sparade event och raderar resten', () => {
    const res = partitionBySaved(['a', 'b', 'c'], ['b']);
    expect(res.toArchive).toEqual(['b']);
    expect(res.toDelete).toEqual(['a', 'c']);
  });

  it('skyddar ingenting när inga saves finns', () => {
    const res = partitionBySaved(['a', 'b'], []);
    expect(res.toArchive).toEqual([]);
    expect(res.toDelete).toEqual(['a', 'b']);
  });
});
