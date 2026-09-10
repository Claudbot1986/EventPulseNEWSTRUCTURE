/**
 * 08-Agent/tests/activeLearning.test.ts
 *
 * P2C tester (2026-09-10): verifierar att activeLearning identifierar och
 * flaggar låg-confidence events korrekt.
 *
 * Säkerhet: alla Supabase-anrop mockas — inga riktiga DB-anrop.
 *
 * Run: npx vitest run 08-Agent/tests/activeLearning.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();
const inMock = vi.fn();
const ltMock = vi.fn();
const orderMock = vi.fn();
const limitMock = vi.fn();
const selectMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

const { run } = await import('../tools/activeLearning.js');

interface EventRow {
  id: string;
  title_sv: string;
  title_en: string | null;
  confidence_score: number;
  needs_human_review: boolean;
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  updateMock.mockReset();
  eqMock.mockReset();
  inMock.mockReset();
  ltMock.mockReset();
  orderMock.mockReset();
  limitMock.mockReset();
  selectMock.mockReset();

  // Bygg en chainable query
  selectMock.mockReturnThis();
  eqMock.mockReturnThis();
  ltMock.mockReturnThis();
  orderMock.mockReturnThis();
  limitMock.mockReturnThis();
});

describe('activeLearning', () => {
  test('inga events under tröskel → 0/0/0', async () => {
    fromMock.mockReturnValueOnce({
      select: selectMock,
      eq: eqMock,
      lt: ltMock,
      order: orderMock,
      limit: limitMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    });

    const result = await run({ threshold: 50 });
    expect(result.candidatesFound).toBe(0);
    expect(result.flagged).toBe(0);
    expect(result.flaggedIds).toEqual([]);
  });

  test('3 events under tröskel, alla behöver flaggas → 3 flaggade', async () => {
    const rows: EventRow[] = [
      { id: 'e1', title_sv: 'Osäker 1', title_en: null, confidence_score: 30, needs_human_review: false },
      { id: 'e2', title_sv: 'Osäker 2', title_en: null, confidence_score: 40, needs_human_review: false },
      { id: 'e3', title_sv: 'Osäker 3', title_en: null, confidence_score: 45, needs_human_review: false },
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      eq: eqMock,
      lt: ltMock,
      order: orderMock,
      limit: limitMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    });

    // Mock update().in() → success
    inMock.mockResolvedValueOnce({ error: null });
    fromMock.mockReturnValueOnce({
      update: updateMock.mockReturnValue({ in: inMock }),
    });

    const result = await run({ threshold: 50 });
    expect(result.candidatesFound).toBe(3);
    expect(result.alreadyFlagged).toBe(0);
    expect(result.flagged).toBe(3);
    expect(result.flaggedIds).toEqual(['e1', 'e2', 'e3']);
  });

  test('redan-flaggade events räknas som alreadyFlagged, flaggas EJ igen', async () => {
    const rows: EventRow[] = [
      { id: 'e1', title_sv: 'Ny', title_en: null, confidence_score: 30, needs_human_review: false },
      { id: 'e2', title_sv: 'Redan', title_en: null, confidence_score: 40, needs_human_review: true },
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      eq: eqMock,
      lt: ltMock,
      order: orderMock,
      limit: limitMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    });

    // Endast 1 event ska flaggas → 1 anrop till update
    inMock.mockResolvedValueOnce({ error: null });
    fromMock.mockReturnValueOnce({
      update: updateMock.mockReturnValue({ in: inMock }),
    });

    const result = await run({ threshold: 50 });
    expect(result.candidatesFound).toBe(2);
    expect(result.alreadyFlagged).toBe(1);
    expect(result.flagged).toBe(1);
    expect(result.flaggedIds).toEqual(['e1']);
  });

  test('dryRun=true → skriver inte till DB, returnerar flagged som räknear', async () => {
    const rows: EventRow[] = [
      { id: 'e1', title_sv: 'Osäker', title_en: null, confidence_score: 30, needs_human_review: false },
    ];

    fromMock.mockReturnValueOnce({
      select: selectMock,
      eq: eqMock,
      lt: ltMock,
      order: orderMock,
      limit: limitMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    });

    const result = await run({ threshold: 50, dryRun: true });
    expect(result.candidatesFound).toBe(1);
    expect(result.flagged).toBe(1);
    expect(result.dryRun).toBe(true);

    // Inga update-anrop gjordes
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('fetch-fel → returnerar firstError, inga flaggade', async () => {
    fromMock.mockReturnValueOnce({
      select: selectMock,
      eq: eqMock,
      lt: ltMock,
      order: orderMock,
      limit: limitMock,
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'connection timeout' } }),
    });

    const result = await run({ threshold: 50 });
    expect(result.firstError).toContain('connection timeout');
    expect(result.flagged).toBe(0);
  });
});
