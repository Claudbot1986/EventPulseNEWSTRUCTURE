/**
 * universe.test.ts — tester för Universe.com-adaptern.
 *
 * Nätverket mockas: adaptern ska kunna verifieras utan live-API. Live-mätningen
 * (2 events från Stockholmsstadshus, 2026-10-24) ligger i kommentaren i
 * universe.ts.
 *
 * Negativ kontroll: förflutna events och events utan tidslucka ska INNE bilda
 * rader — annars skulle adaptern rapportera "events" som importen kastar bort.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readUniverseConfig, naiveLocalToUtc, detectLanguage, runUniverseAdapter } from './universe';
import type { SourceTruth } from '../../tools/sourceRegistry';

function makeSource(overrides: Partial<SourceTruth> = {}): SourceTruth {
  return {
    id: 'universe-stockholm',
    url: 'https://www.universe.com/events/stockholm',
    name: 'Universe Stockholm',
    city: 'Stockholm',
    metadata: {},
    ...overrides,
  } as unknown as SourceTruth;
}

function mockSearch(payload: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('naiveLocalToUtc', () => {
  it('tolkar naiv tid som Europe/Stockholm (vinter = CET, +01:00)', () => {
    // 2026-11-14 12:00 lokal tid = 11:00 UTC (CET)
    expect(naiveLocalToUtc('2026-11-14T12:00:00', 'Europe/Stockholm')).toBe('2026-11-14T11:00:00.000Z');
  });

  it('tolkar naiv tid som Europe/Stockholm (sommar = CEST, +02:00)', () => {
    // 2026-06-14 12:00 lokal tid = 10:00 UTC (CEST)
    expect(naiveLocalToUtc('2026-06-14T12:00:00', 'Europe/Stockholm')).toBe('2026-06-14T10:00:00.000Z');
  });

  it('returnerar null för trasiga värden', () => {
    expect(naiveLocalToUtc('not-a-date', 'Europe/Stockholm')).toBeNull();
    expect(naiveLocalToUtc(null, 'Europe/Stockholm')).toBeNull();
    expect(naiveLocalToUtc(undefined, null)).toBeNull();
  });
});

describe('readUniverseConfig', () => {
  it('faller tillbaka på Stockholms-standardvärden', () => {
    const cfg = readUniverseConfig(makeSource());
    expect(cfg.latitude).toBeCloseTo(59.3293, 4);
    expect(cfg.longitude).toBeCloseTo(18.0686, 4);
    expect(cfg.distanceKm).toBe(25);
  });

  it('läser overrides ur metadata.universe', () => {
    const cfg = readUniverseConfig(
      makeSource({ metadata: { universe: { latitude: 1, longitude: 2, distanceKm: 5 } } } as Partial<SourceTruth>),
    );
    expect(cfg.latitude).toBe(1);
    expect(cfg.longitude).toBe(2);
    expect(cfg.distanceKm).toBe(5);
  });
});

describe('detectLanguage', () => {
  it('känner igen svensk text', () => {
    expect(detectLanguage('Den 14 november är det efterlängtad nypremiär för dagen. Vi hälsar dig varmt välkommen.')).toBe('sv');
  });

  it('känner igen engelsk text', () => {
    expect(detectLanguage('Join us for an evening with music and food. Get your tickets for the show with your friends.')).toBe('en');
  });

  it('returnerar other när språket är okänt', () => {
    expect(detectLanguage('Heroes, Hits & Holidays')).toBe('other');
  });
});

describe('runUniverseAdapter', () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  it('gör en rad per tidslucka med korrekt datum, tid och URL', async () => {
    mockSearch({
      data: {
        search: {
          totalCount: 1,
          events: [
            {
              id: 'evt-1',
              title: 'FRANSKA VINDAGEN 2026',
              slug: 'Q2ZG30',
              description: 'Mat och vin',
              type: 'event',
              category: 'FOOD_DRINK',
              price: 425,
              timezone: 'Europe/Stockholm',
              timeSlots: {
                nodes: [
                  { startAt: `${future}T12:00:00`, endAt: `${future}T16:00:00` },
                  { startAt: `${future}T18:30:00`, endAt: `${future}T22:00:00` },
                ],
              },
              geo: { city: 'Stockholm', address: 'Torkel Knutssonsgatan 2', latitude: 59.32, longitude: 18.05 },
              host: { name: 'Wine Vision AB', url: 'https://winevision.se' },
              source: { url: 'https://www.universe.com/events/franska-vindagen-2026-tickets-Q2ZG30' },
              coverPhoto: { url: 'https://images.universe.com/x' },
            },
          ],
        },
      },
    });

    const result = await runUniverseAdapter(makeSource());
    expect(result.status).toBe('completed');
    expect(result.events).toHaveLength(2);

    const [row] = result.events;
    expect(row.title).toBe('FRANSKA VINDAGEN 2026');
    expect(row.date).toBe(future);
    expect(row.time).toBe('12:00');
    expect(row.start_time).toMatch(/Z$/);
    expect(row.url).toBe('https://www.universe.com/events/franska-vindagen-2026-tickets-Q2ZG30');
    expect(row.venue).toBe('Wine Vision AB');
    expect(row.source).toBe('universe-stockholm');
  });

  it('kastar förflutna events — negativ kontroll', async () => {
    mockSearch({
      data: {
        search: {
          totalCount: 1,
          events: [
            {
              id: 'evt-old',
              title: 'GAMMAL EVENT',
              slug: 'OLD1',
              timezone: 'Europe/Stockholm',
              timeSlots: { nodes: [{ startAt: `${past}T12:00:00`, endAt: `${past}T16:00:00` }] },
              geo: { city: 'Stockholm' },
              source: { url: 'https://www.universe.com/events/gammal-tickets-OLD1' },
            },
          ],
        },
      },
    });

    const result = await runUniverseAdapter(makeSource());
    expect(result.events).toHaveLength(0);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('0 sparbara events');
  });

  it('rapporterar fel när API:t svarar med HTTP 500', async () => {
    mockSearch('{}', 500);
    const result = await runUniverseAdapter(makeSource());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('HTTP 500');
  });

  it('rapporterar fel när svaret saknar events', async () => {
    mockSearch({ data: { search: { totalCount: 0, events: [] } } });
    const result = await runUniverseAdapter(makeSource());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('0 sparbara events');
  });
});
