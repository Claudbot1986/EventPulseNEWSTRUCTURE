/**
 * 08-Agent/tests/imageGen.matchLibraryFirst.test.ts
 *
 * Smoke-test för matchLibraryFirst: verifierar att biblioteket provas FÖRST
 * och BFL bara anropas när biblioteket returnerar match_type='none'.
 *
 * Run:  npx vitest run 08-Agent/tests/imageGen.matchLibraryFirst.test.ts
 *
 * Säkerhet: alla BFL-anrop mockas — inga riktiga BFL-credits dras.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

// 1. Mock @supabase/supabase-js — vi vill styra alla events-frågor.
const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

// 2. Mock imageGen.generateBatch — vi vill veta exakt när (om) BFL anropas.
const generateBatchMock = vi.fn();
vi.mock('../services/imageGen.js', () => ({
  generateBatch: (...args: unknown[]) => generateBatchMock(...args),
}));

// 3. Importera EFTER alla mocks.
const { matchLibraryFirst } = await import('../services/imageGen.matchLibraryFirst.js');

// ── Helpers ────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  category_slug: string | null;
  venues: { name: string } | null;
}

function makeEventsQuery(rows: EventRow[]) {
  // Supabase select().eq().order().limit() returnerar builder; sista .limit()
  // returnerar builder tills await — då ska den resolve:a. Vi använder thenable.
  const q: Record<string, unknown> = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    is: vi.fn(() => builder),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null }),
  };
  return builder;
}

function makeMatchQuery(result: { data: unknown; error: unknown }) {
  // Supabase-buildern är både chainable OCH thenable: sista metoden kan
  // returnera builder (för fortsatt kedja) eller Promise (för await).
  // Vår mock gör alla kedje-metoder till chainable och sedan sätts thenable
  // EFTER, så await på buildern fungerar.
  const q: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
  };
  // .not() ska returnera ett thenable (avslutar venue-steget med await).
  q.not = vi.fn(() => {
    const t = { ...q, then: (resolve: (v: unknown) => void) => resolve(result) };
    return t;
  });
  // Gör q själv thenable så await db().from()... fungerar även utan .single().
  q.then = (resolve: (v: unknown) => void) => resolve(result);
  return q;
}

function makeUpdateQuery() {
  const q = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return q;
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  generateBatchMock.mockReset();
  // bump_usage är redan en tyst no-op i imageLibrary.ts (rad 224 — loggar bara warn vid fel).
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('matchLibraryFirst', () => {
  test('library hit → no BFL call', async () => {
    const rows: EventRow[] = [
      { id: 'ev-1', title_sv: 'Konsert', title_en: null, category_slug: 'music', venues: { name: 'Berwaldhallen' } },
    ];
    // Sekvens av from()-anrop i matchLibraryFirst:
    //   1) events select (limit) → rader
    //   2) image_library select (venue_pattern) → kan vara tom
    //   3) image_library select (category) → LIBRARY HIT
    //   4) events update (markEventWithLibraryFallback)
    fromMock
      .mockReturnValueOnce(makeEventsQuery(rows))
      .mockReturnValueOnce(makeMatchQuery({ data: [], error: null }))
      .mockReturnValueOnce(makeMatchQuery({
        data: { id: 'lib-1', storage_path: 'import-original/foo.png', public_url: 'x', times_used: 0, rating: 5 },
        error: null,
      }))
      .mockReturnValueOnce(makeUpdateQuery());
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await matchLibraryFirst({ limit: 10, onlyMissing: true });

    expect(result.totalFetched).toBe(1);
    expect(result.libraryMatched).toBe(1);
    expect(result.bflGenerated).toBe(0);
    expect(result.bflCallsAttempted).toBe(0);
    expect(result.unmatched).toBe(0);
    expect(generateBatchMock).not.toHaveBeenCalled();
  });

  test('library miss → BFL called as fallback', async () => {
    const rows: EventRow[] = [
      { id: 'ev-2', title_sv: 'Mystisk', title_en: null, category_slug: 'unknown-cat', venues: { name: 'Mystery Venue' } },
    ];
    // Sekvens:
    //   1) events select → rader
    //   2) image_library (venue) → tom
    //   3) image_library (category 'unknown-cat') → tom
    //   4) image_library (category alias) → tom
    //   5) image_library (default NULL) → tom → match_type='none'
    fromMock
      .mockReturnValueOnce(makeEventsQuery(rows))
      .mockReturnValueOnce(makeMatchQuery({ data: [], error: null }))
      .mockReturnValueOnce(makeMatchQuery({ data: null, error: null }))
      .mockReturnValueOnce(makeMatchQuery({ data: null, error: null }))
      .mockReturnValueOnce(makeMatchQuery({ data: null, error: null }));
    rpcMock.mockResolvedValue({ data: null, error: null });

    generateBatchMock.mockResolvedValue({
      totalFetched: 1,
      uniqueGroups: 1,
      okCount: 1,
      failCount: 0,
      results: [],
      errors: [],
    });

    const result = await matchLibraryFirst({ limit: 10, onlyMissing: true });

    expect(result.totalFetched).toBe(1);
    expect(result.libraryMatched).toBe(0);
    expect(result.bflGenerated).toBe(1);
    expect(result.bflCallsAttempted).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(generateBatchMock).toHaveBeenCalledTimes(1);
    expect(result.matchTypeBreakdown.none).toBeGreaterThanOrEqual(1);
  });

  test('no events to process → no BFL call', async () => {
    fromMock.mockReturnValueOnce(makeEventsQuery([]));
    const result = await matchLibraryFirst({ limit: 10 });
    expect(result.totalFetched).toBe(0);
    expect(result.libraryMatched).toBe(0);
    expect(result.bflGenerated).toBe(0);
    expect(generateBatchMock).not.toHaveBeenCalled();
  });

  test('library crash is non-fatal — event falls through to BFL', async () => {
    const rows: EventRow[] = [
      { id: 'ev-3', title_sv: 'X', title_en: null, category_slug: 'music', venues: { name: 'Y' } },
    ];
    // Steg 2 (venue-pattern query) returnerar fel → matchLibraryFirst fångar
    // det och pushar event till bflCandidates.
    fromMock
      .mockReturnValueOnce(makeEventsQuery(rows))
      .mockReturnValueOnce(makeMatchQuery({ data: null, error: { message: 'simulated DB error' } }));
    generateBatchMock.mockResolvedValue({
      totalFetched: 1, uniqueGroups: 1, okCount: 1, failCount: 0, results: [], errors: [],
    });

    const result = await matchLibraryFirst({ limit: 10 });
    expect(result.libraryMatched).toBe(0);
    expect(result.bflGenerated).toBe(1);
    expect(result.firstError).toBeTruthy();
    expect(generateBatchMock).toHaveBeenCalledTimes(1);
  });
});
