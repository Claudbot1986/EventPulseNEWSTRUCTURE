/**
 * Tests for canonical_event_id — entity resolution key computation.
 *
 * Covers: normalizeTitle (diacritics, case, punctuation, whitespace,
 * idempotency), stockholmDay (UTC→Europe/Stockholm conversion in
 * CEST and CET, DST boundary, invalid input), pickTitle (sv preference,
 * en fallback), computeCanonicalEventId (idempotency, day/venue
 * discrimination, no_venue sentinel), backfillCanonicalEventIds
 * (happy path, collisions counted, skipped on missing fields, batch
 * termination, error propagation).
 *
 * Run with:  npx vitest run 08-Agent/tests/canonical_event_id.test.ts
 */

import { describe, expect, it, vi } from 'vitest';
import {
  normalizeTitle,
  stockholmDay,
  pickTitle,
  computeCanonicalEventId,
  backfillCanonicalEventIds,
} from '../tools/canonical_event_id';

// ─── normalizeTitle ─────────────────────────────────────────────────────────

describe('normalizeTitle', () => {
  it('strips diacritics from Swedish characters', () => {
    expect(normalizeTitle('Söder')).toBe('soder');
    expect(normalizeTitle('Östermalm')).toBe('ostermalm');
    expect(normalizeTitle('Årsta')).toBe('arsta');
    expect(normalizeTitle('Jazz på Söder')).toBe('jazz pa soder');
  });

  it('lowercases', () => {
    expect(normalizeTitle('CONCERT')).toBe('concert');
    expect(normalizeTitle('JaZz')).toBe('jazz');
  });

  it('strips punctuation, keeps digits', () => {
    expect(normalizeTitle('Concert: Live!')).toBe('concert live');
    expect(normalizeTitle('Concert #5')).toBe('concert 5');
    expect(normalizeTitle('"Hello, World!"')).toBe('hello world');
  });

  it('collapses multiple spaces and trims', () => {
    expect(normalizeTitle('  Konsert   Live  ')).toBe('konsert live');
    expect(normalizeTitle('A\t\nB')).toBe('a b');
  });

  it('handles empty and whitespace-only', () => {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle('   ')).toBe('');
    expect(normalizeTitle('\n\n')).toBe('');
  });

  it('is idempotent', () => {
    const s = 'Konsert på Södermalm! 2026';
    expect(normalizeTitle(normalizeTitle(s))).toBe(normalizeTitle(s));
  });

  it('preserves stopwords (does not collapse "Concert A" → "concert")', () => {
    expect(normalizeTitle('Concert A')).toBe('concert a');
    expect(normalizeTitle('Concert B')).toBe('concert b');
    expect(normalizeTitle('Concert A')).not.toBe(normalizeTitle('Concert B'));
  });

  it('handles emoji and non-Latin scripts (strips non a-z0-9)', () => {
    // Emoji become spaces via the [^a-z0-9\s] rule, then collapse.
    expect(normalizeTitle('Concert 🎵')).toBe('concert');
    // Non-Latin scripts become empty (no a-z match) — fine for our use
    // because our events are Swedish/English titles.
    expect(normalizeTitle('コンサート')).toBe('');
  });
});

// ─── stockholmDay ───────────────────────────────────────────────────────────

describe('stockholmDay', () => {
  it('formats a UTC time in Europe/Stockholm during CEST (summer)', () => {
    // 2026-08-19 22:00 UTC = 2026-08-20 00:00 CEST → day is the 20th
    expect(stockholmDay('2026-08-19T22:00:00.000Z')).toBe('2026-08-20');
    // 2026-08-19 10:00 UTC = 12:00 CEST → same day
    expect(stockholmDay('2026-08-19T10:00:00.000Z')).toBe('2026-08-19');
    // 2026-08-19 21:59 UTC = 23:59 CEST → same day
    expect(stockholmDay('2026-08-19T21:59:00.000Z')).toBe('2026-08-19');
  });

  it('formats a UTC time in Europe/Stockholm during CET (winter)', () => {
    // 2026-01-15 23:00 UTC = 2026-01-16 00:00 CET → next day
    expect(stockholmDay('2026-01-15T23:00:00.000Z')).toBe('2026-01-16');
    // 2026-01-15 22:00 UTC = 23:00 CET → same day
    expect(stockholmDay('2026-01-15T22:00:00.000Z')).toBe('2026-01-15');
  });

  it('handles DST boundary (Europe/Stockholm springs forward late March)', () => {
    // 2026-03-29 is the DST jump day in Europe (clocks go 02:00 → 03:00).
    // 01:30 UTC on 2026-03-29 = 02:30 CET (before jump) — still 2026-03-29.
    // We don't assert exact hour (zoneinfo matters); we just confirm
    // the day bucketing doesn't crash and stays on the 29th.
    expect(stockholmDay('2026-03-29T01:30:00.000Z')).toBe('2026-03-29');
    // After the jump, 04:00 CEST on 2026-03-30 = 02:00 UTC.
    expect(stockholmDay('2026-03-30T02:00:00.000Z')).toBe('2026-03-30');
  });

  it('accepts timestamps with offset other than Z', () => {
    // 2026-08-19 23:30:00+02:00 = 21:30 UTC → same day in Stockholm
    expect(stockholmDay('2026-08-19T23:30:00+02:00')).toBe('2026-08-19');
  });

  it('throws on invalid ISO string (caller should skip)', () => {
    expect(() => stockholmDay('not-a-date')).toThrow();
    expect(() => stockholmDay('')).toThrow();
  });
});

// ─── pickTitle ──────────────────────────────────────────────────────────────

describe('pickTitle', () => {
  it('prefers title_sv when non-empty', () => {
    expect(pickTitle({ title_sv: 'Konsert', title_en: 'Concert' })).toBe('Konsert');
  });

  it('falls back to title_en when title_sv is empty', () => {
    expect(pickTitle({ title_sv: '', title_en: 'Concert' })).toBe('Concert');
    expect(pickTitle({ title_sv: null, title_en: 'Concert' })).toBe('Concert');
  });

  it('falls back to title_en when title_sv is whitespace-only', () => {
    expect(pickTitle({ title_sv: '   ', title_en: 'Concert' })).toBe('Concert');
  });

  it('returns empty when both empty', () => {
    expect(pickTitle({ title_sv: '', title_en: '' })).toBe('');
    expect(pickTitle({})).toBe('');
  });
});

// ─── computeCanonicalEventId ────────────────────────────────────────────────

describe('computeCanonicalEventId', () => {
  it('joins normalize(title) | stockholmDay(start_time) | venue_id', () => {
    const id = computeCanonicalEventId({
      title: 'Jazz på Söder',
      start_time: '2026-08-19T20:00:00.000Z',
      venue_id: 'venue-uuid-1',
    });
    expect(id).toBe('jazz pa soder|2026-08-19|venue-uuid-1');
  });

  it('is idempotent', () => {
    const input = {
      title: 'Konsert!',
      start_time: '2026-08-19T20:00:00.000Z',
      venue_id: 'venue-uuid-1',
    };
    const a = computeCanonicalEventId(input);
    const b = computeCanonicalEventId(input);
    expect(a).toBe(b);
  });

  it('different title → different id', () => {
    const base = { start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v1' };
    const a = computeCanonicalEventId({ ...base, title: 'Konsert' });
    const b = computeCanonicalEventId({ ...base, title: 'Teater' });
    expect(a).not.toBe(b);
  });

  it('different day → different id', () => {
    const base = { title: 'Konsert', venue_id: 'v1' };
    const a = computeCanonicalEventId({ ...base, start_time: '2026-08-19T20:00:00.000Z' });
    const b = computeCanonicalEventId({ ...base, start_time: '2026-08-20T20:00:00.000Z' });
    expect(a).not.toBe(b);
  });

  it('different venue_id → different id', () => {
    const base = { title: 'Konsert', start_time: '2026-08-19T20:00:00.000Z' };
    const a = computeCanonicalEventId({ ...base, venue_id: 'v1' });
    const b = computeCanonicalEventId({ ...base, venue_id: 'v2' });
    expect(a).not.toBe(b);
  });

  it('uses "no_venue" sentinel when venue_id is missing', () => {
    const a = computeCanonicalEventId({
      title: 'Konsert',
      start_time: '2026-08-19T20:00:00.000Z',
      venue_id: null,
    });
    const b = computeCanonicalEventId({
      title: 'Konsert',
      start_time: '2026-08-19T20:00:00.000Z',
    });
    expect(a).toBe(b);
    expect(a).toContain('|no_venue');
  });

  it('two events with the same (title, day, venue) produce the same id (the entity-resolution contract)', () => {
    const idA = computeCanonicalEventId({
      title: 'Stockholm Phil — Beethoven 5',
      start_time: '2026-08-19T19:00:00.000Z',
      venue_id: 'venue-konserthuset',
    });
    const idB = computeCanonicalEventId({
      title: '  stockholm  phil: beethoven 5 ', // same event, different formatting
      start_time: '2026-08-19T18:00:00.000Z', // within the same Stockholm day (20:00 local)
      venue_id: 'venue-konserthuset',
    });
    expect(idA).toBe(idB);
  });
});

// ─── backfillCanonicalEventIds ──────────────────────────────────────────────

interface FakeRow {
  id: string;
  title_sv?: string | null;
  title_en?: string | null;
  start_time?: string;
  venue_id?: string | null;
}

/** Build a chainable Supabase mock that returns rows in batches then
 *  an empty array. select/eq/is/limit are mocked with vi.fn so we
 *  can assert on the calls. update is mocked to simulate success
 *  or unique-violation. */
function makeSupabaseMock(opts: {
  batches: FakeRow[][];
  updateErrorByRowId?: Record<string, { code: string; message: string }>;
}) {
  let batchIndex = 0;
  const select = vi.fn(() => ({
    is: vi.fn(() => ({
      limit: vi.fn(async () => {
        const next = opts.batches[batchIndex++] ?? [];
        return { data: next, error: null };
      }),
    })),
  }));
  const update = vi.fn((payload: { canonical_event_id: string }) => ({
    eq: vi.fn(async (_col: string, idVal: string) => {
      const e = opts.updateErrorByRowId?.[idVal];
      if (e) return { data: null, error: e };
      return { data: { id: idVal, ...payload }, error: null };
    }),
  }));
  const from = vi.fn((table: string) => {
    if (table !== 'events') throw new Error(`unexpected table: ${table}`);
    return { select, update };
  });
  return { from, select, update };
}

describe('backfillCanonicalEventIds', () => {
  it('updates rows missing canonical_event_id', async () => {
    const rows: FakeRow[] = [
      { id: 'e1', title_sv: 'Konsert', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v1' },
      { id: 'e2', title_en: 'Concert', start_time: '2026-08-19T21:00:00.000Z', venue_id: 'v1' },
      { id: 'e3', title_sv: 'Teater', start_time: '2026-08-20T19:00:00.000Z', venue_id: 'v2' },
    ];
    const sb = makeSupabaseMock({ batches: [rows, []] });
    const result = await backfillCanonicalEventIds(sb as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(result.updated).toBe(3);
    expect(result.collisions).toBe(0);
    expect(result.skipped).toBe(0);
    expect(sb.update).toHaveBeenCalledTimes(3);
    const calls = sb.update.mock.calls.map((c) => (c[0] as { canonical_event_id: string }).canonical_event_id);
    expect(calls).toContain('konsert|2026-08-19|v1');
    expect(calls).toContain('concert|2026-08-19|v1');
    expect(calls).toContain('teater|2026-08-20|v2');
  });

  it('counts collisions when update fails with code 23505 (unique violation)', async () => {
    const rows: FakeRow[] = [
      { id: 'e1', title_sv: 'Konsert', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v1' },
    ];
    const sb = makeSupabaseMock({
      batches: [rows, []],
      updateErrorByRowId: {
        e1: { code: '23505', message: 'duplicate key value violates unique constraint' },
      },
    });
    const result = await backfillCanonicalEventIds(sb as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(result.updated).toBe(0);
    expect(result.collisions).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('throws on non-23505 update error (genuine failure)', async () => {
    const rows: FakeRow[] = [
      { id: 'e1', title_sv: 'Konsert', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v1' },
    ];
    const sb = makeSupabaseMock({
      batches: [rows, []],
      updateErrorByRowId: {
        e1: { code: '42P01', message: 'undefined_table' },
      },
    });
    await expect(
      backfillCanonicalEventIds(sb as unknown as import('@supabase/supabase-js').SupabaseClient)
    ).rejects.toThrow(/update e1 failed/);
  });

  it('skips rows with missing title or start_time', async () => {
    const rows: FakeRow[] = [
      { id: 'e1', title_sv: '', title_en: '', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v1' },
      { id: 'e2', title_sv: 'Konsert', start_time: undefined, venue_id: 'v1' },
      { id: 'e3', title_sv: 'Teater', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v1' },
    ];
    const sb = makeSupabaseMock({ batches: [rows, []] });
    const result = await backfillCanonicalEventIds(sb as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('terminates loop when batch comes back smaller than batchSize', async () => {
    const rows = [
      { id: 'a', title_sv: 'A', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v' },
      { id: 'b', title_sv: 'B', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v' },
      { id: 'c', title_sv: 'C', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v' },
    ];
    const sb = makeSupabaseMock({ batches: [rows, []] });
    await backfillCanonicalEventIds(sb as unknown as import('@supabase/supabase-js').SupabaseClient, { batchSize: 10 });
    // First batch returned 3 rows (< batchSize 10) → loop exits. No
    // second select happens because the early-exit check runs inside
    // the iteration after processing.
    expect(sb.select).toHaveBeenCalledTimes(1);
  });

  it('terminates immediately on empty batch', async () => {
    const sb = makeSupabaseMock({ batches: [[]] });
    const result = await backfillCanonicalEventIds(sb as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(result.updated).toBe(0);
    expect(sb.select).toHaveBeenCalledTimes(1);
  });

  it('respects maxRows cap', async () => {
    const rows = [
      { id: 'a', title_sv: 'A', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v' },
      { id: 'b', title_sv: 'B', start_time: '2026-08-19T20:00:00.000Z', venue_id: 'v' },
    ];
    const sb = makeSupabaseMock({ batches: [rows, rows, rows] });
    const result = await backfillCanonicalEventIds(
      sb as unknown as import('@supabase/supabase-js').SupabaseClient,
      { batchSize: 2, maxRows: 3 }
    );
    expect(result.updated).toBe(3); // first batch of 2 + 1 from second
  });
});