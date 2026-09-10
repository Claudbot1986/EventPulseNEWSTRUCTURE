/**
 * 07-Discovery/src/venueGraph/geoExpansion.test.ts
 *
 * P3B tester (2026-09-10): verifierar haversine + single-linkage klustring
 * samt Supabase-write-flödet med mock.
 *
 * Run: npx vitest run 07-Discovery/src/venueGraph/geoExpansion.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

const fromMock = vi.fn();
const selectMock = vi.fn();
const notMock = vi.fn();
const eqMock = vi.fn();
const upsertMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

const { run, haversineMeters } = await import('./geoExpansion.js');

interface VenueRow {
  id: string;
  name: string;
  city: string;
  lat: number | null;
  lng: number | null;
}

beforeEach(() => {
  fromMock.mockReset();
  selectMock.mockReset();
  notMock.mockReset();
  eqMock.mockReset();
  upsertMock.mockReset();

  selectMock.mockReturnThis();
  notMock.mockReturnThis();
  eqMock.mockReturnThis();
});

// ── Pure-function tests ───────────────────────────────────────────────────

describe('haversineMeters', () => {
  test('Stockholm → Göteborg ≈ 400 km', () => {
    // Stockholm: 59.33, 18.07 — Göteborg: 57.71, 11.97
    const d = haversineMeters({ lat: 59.33, lng: 18.07 }, { lat: 57.71, lng: 11.97 });
    // Förväntat ~ 400 km; tillåt 5% marginal (400km är inte exakt p.g.a. sfärisk form)
    expect(d).toBeGreaterThan(380_000);
    expect(d).toBeLessThan(420_000);
  });

  test('samma punkt → 0 m', () => {
    expect(haversineMeters({ lat: 59.33, lng: 18.07 }, { lat: 59.33, lng: 18.07 })).toBe(0);
  });

  test('100m norrut ≈ 100 m', () => {
    const d = haversineMeters({ lat: 59.3300, lng: 18.0700 }, { lat: 59.3309, lng: 18.0700 });
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

// ── Supabase flow tests ───────────────────────────────────────────────────

describe('geoExpansion.run', () => {
  test('inga venues → 0/0/0', async () => {
    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    });

    const result = await run({ city: 'Stockholm' });
    expect(result.totalVenuesWithCoords).toBe(0);
    expect(result.clustersFound).toBe(0);
    expect(result.clustersWritten).toBe(0);
  });

  test('2 venues nära (<500m) → 1 kluster, 1 write', async () => {
    const venues: VenueRow[] = [
      { id: 'v1', name: 'Konserthuset', city: 'Stockholm', lat: 59.33258, lng: 18.06490 },
      { id: 'v2', name: 'Nalen', city: 'Stockholm', lat: 59.33240, lng: 18.06480 }, // ~20m bort
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: venues, error: null }),
    });

    fromMock.mockReturnValueOnce({
      upsert: upsertMock.mockReturnValue({ then: (resolve: (v: unknown) => void) => resolve({ error: null }) }),
    });

    const result = await run({ city: 'Stockholm', radiusMeters: 500 });
    expect(result.totalVenuesWithCoords).toBe(2);
    expect(result.clustersFound).toBe(1);
    expect(result.clustersWritten).toBe(1);
    expect(result.topClusters[0].size).toBe(2);
    expect(result.topClusters[0].representativeName).toMatch(/Konserthuset|Nalen/);
  });

  test('2 venues långt ifrån (>10km) → 0 kluster', async () => {
    const venues: VenueRow[] = [
      { id: 'v1', name: 'A', city: 'Stockholm', lat: 59.33, lng: 18.07 },
      { id: 'v2', name: 'B', city: 'Stockholm', lat: 59.50, lng: 18.30 }, // ~22km bort
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: venues, error: null }),
    });

    const result = await run({ city: 'Stockholm', radiusMeters: 500 });
    expect(result.totalVenuesWithCoords).toBe(2);
    expect(result.clustersFound).toBe(0);
    expect(result.clustersWritten).toBe(0);
  });

  test('singletons (1 venue) ignoreras', async () => {
    const venues: VenueRow[] = [
      { id: 'v1', name: 'Ensam', city: 'Stockholm', lat: 59.33, lng: 18.07 },
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: venues, error: null }),
    });

    const result = await run({ city: 'Stockholm' });
    expect(result.totalVenuesWithCoords).toBe(1);
    expect(result.clustersFound).toBe(0);
  });

  test('venues med null-coordinates filtreras bort', async () => {
    const venues: VenueRow[] = [
      { id: 'v1', name: 'Med coords', city: 'Stockholm', lat: 59.33, lng: 18.07 },
      { id: 'v2', name: 'Utan coords', city: 'Stockholm', lat: null, lng: null },
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: venues, error: null }),
    });

    const result = await run({ city: 'Stockholm' });
    expect(result.totalVenuesWithCoords).toBe(1);
  });

  test('dryRun=true → skriver inte till DB', async () => {
    const venues: VenueRow[] = [
      { id: 'v1', name: 'A', city: 'Stockholm', lat: 59.33, lng: 18.07 },
      { id: 'v2', name: 'B', city: 'Stockholm', lat: 59.33001, lng: 18.07001 },
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: venues, error: null }),
    });

    const result = await run({ city: 'Stockholm', radiusMeters: 500, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.clustersWritten).toBe(result.clustersFound);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  test('fetch-fel → returnerar firstError, inga kluster', async () => {
    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'connection refused' } }),
    });

    const result = await run({ city: 'Stockholm' });
    expect(result.firstError).toContain('connection refused');
    expect(result.clustersFound).toBe(0);
  });

  test('3 venues i två kluster (en stor, en liten)', async () => {
    // Kluster 1: v1+v2 (inom 100m), Kluster 2: v3 (ensam → skip)
    const venues: VenueRow[] = [
      { id: 'v1', name: 'Konserthuset', city: 'Stockholm', lat: 59.33258, lng: 18.06490 },
      { id: 'v2', name: 'Nalen', city: 'Stockholm', lat: 59.33240, lng: 18.06480 }, // ~20m från v1
      { id: 'v3', name: 'Avlägsen', city: 'Stockholm', lat: 59.40, lng: 18.50 }, // >10km bort
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      not: notMock,
      eq: eqMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: venues, error: null }),
    });

    fromMock.mockReturnValueOnce({
      upsert: upsertMock.mockReturnValue({ then: (resolve: (v: unknown) => void) => resolve({ error: null }) }),
    });

    const result = await run({ city: 'Stockholm', radiusMeters: 500 });
    expect(result.totalVenuesWithCoords).toBe(3);
    expect(result.clustersFound).toBe(1); // bara ett kluster (v3 ensam → skip)
    expect(result.clustersWritten).toBe(1);
    expect(result.topClusters[0].size).toBe(2);
  });
});