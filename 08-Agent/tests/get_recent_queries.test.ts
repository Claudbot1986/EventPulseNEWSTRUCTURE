/**
 * Tests for get_recent_queries — T0071 / MVP-gap §79.
 *
 * Mocks the Supabase client. Validates:
 *   - reads only `interaction = 'impression'` rows for this client_user_id
 *   - filters out null/empty query_text
 *   - enforces 7-day lookback via .gte('created_at', since)
 *   - dedupes case-insensitively on trimmed text
 *   - respects explicit limit, capped at MAX_LIMIT=20
 *   - default limit is 5
 *   - returns empty queries + warning on DB error
 *   - orders most-recent-first (first occurrence wins)
 *   - makeQueryId transliterates å/ä/ö and replaces non-alnum with dashes
 *   - cleanQuery collapses internal whitespace
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getRecentQueries,
  GET_RECENT_QUERIES_DEFAULT_LIMIT,
  GET_RECENT_QUERIES_MAX_LIMIT,
} from '../tools/get_recent_queries';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-08-22T12:00:00.000Z');

function isoDaysAgo(days: number, base: Date = NOW): string {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

interface MockState {
  rows: Array<{ query_text: unknown; created_at: unknown }>;
  selectError?: { message: string };
  captured?: {
    clientUserId?: string;
    interaction?: string;
    sinceGte?: string;
    limit?: number;
    orderField?: string;
    orderAsc?: boolean;
  };
}

function makeChain(state: MockState): any {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((field: string, value: unknown) => {
      if (field === 'client_user_id') state.captured!.clientUserId = String(value);
      if (field === 'interaction') state.captured!.interaction = String(value);
      return chain;
    }),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn((field: string, value: unknown) => {
      if (field === 'created_at') state.captured!.sinceGte = String(value);
      return chain;
    }),
    order: vi.fn((field: string, opts: { ascending?: boolean } = {}) => {
      state.captured!.orderField = field;
      state.captured!.orderAsc = opts.ascending !== false;
      return chain;
    }),
    limit: vi.fn((n: number) => {
      state.captured!.limit = n;
      return chain;
    }),
    then: (resolve: (v: { data: any[] | null; error: null | { message: string } }) => void) => {
      if (state.selectError) {
        Promise.resolve({ data: null, error: state.selectError }).then(resolve);
      } else {
        Promise.resolve({ data: state.rows, error: null }).then(resolve);
      }
    },
  };
  return chain;
}

function mockSupabase(state: MockState): SupabaseClient {
  state.captured = {};
  const from = vi.fn().mockReturnValue(makeChain(state));
  return { from } as unknown as SupabaseClient;
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('getRecentQueries — happy path', () => {
  it('returns distinct recent queries newest-first, capped at default 5', async () => {
    const state: MockState = {
      rows: [
        { query_text: 'Konserter i Stockholm?', created_at: isoDaysAgo(0.1) },
        { query_text: 'Gratis i helgen?', created_at: isoDaysAgo(0.5) },
        { query_text: 'Jazz ikväll', created_at: isoDaysAgo(1) },
        { query_text: 'Utställningar', created_at: isoDaysAgo(2) },
        { query_text: 'Familjevänligt', created_at: isoDaysAgo(3) },
      ],
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.warning).toBeUndefined();
    expect(result.queries).toHaveLength(5);
    expect(result.queries[0].query_text).toBe('Konserter i Stockholm?');
    expect(result.queries[0].last_used_at).toBe(isoDaysAgo(0.1));
  });

  it('returns empty list when there are no impression rows', async () => {
    const state: MockState = { rows: [] };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.queries).toEqual([]);
    expect(result.warning).toBeUndefined();
  });
});

// ─── Dedupe behavior ─────────────────────────────────────────────────────────

describe('getRecentQueries — dedupe', () => {
  it('dedupes case-insensitively (first/most-recent wins)', async () => {
    const state: MockState = {
      rows: [
        { query_text: 'Konserter i Stockholm?', created_at: isoDaysAgo(0.1) },
        { query_text: 'KONSERTER I STOCKHOLM?', created_at: isoDaysAgo(0.2) },
        { query_text: 'Konserter i Stockholm?', created_at: isoDaysAgo(0.3) },
        { query_text: 'Gratis i helgen?', created_at: isoDaysAgo(0.4) },
      ],
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.queries).toHaveLength(2);
    expect(result.queries[0].query_text).toBe('Konserter i Stockholm?');
    expect(result.queries[1].query_text).toBe('Gratis i helgen?');
  });

  it('dedupes on trimmed text (whitespace differences do not create new chips)', async () => {
    const state: MockState = {
      rows: [
        { query_text: 'Jazz ikväll', created_at: isoDaysAgo(0.1) },
        { query_text: '  jazz   ikväll  ', created_at: isoDaysAgo(0.2) },
      ],
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query_text).toBe('Jazz ikväll');
  });

  it('drops null and empty query_text', async () => {
    const state: MockState = {
      rows: [
        { query_text: null, created_at: isoDaysAgo(0.1) },
        { query_text: '', created_at: isoDaysAgo(0.2) },
        { query_text: '   ', created_at: isoDaysAgo(0.3) },
        { query_text: 'Real query', created_at: isoDaysAgo(0.4) },
      ],
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query_text).toBe('Real query');
  });
});

// ─── Limit handling ──────────────────────────────────────────────────────────

describe('getRecentQueries — limits', () => {
  it('respects explicit limit parameter', async () => {
    const state: MockState = {
      rows: [
        { query_text: 'A', created_at: isoDaysAgo(0.1) },
        { query_text: 'B', created_at: isoDaysAgo(0.2) },
        { query_text: 'C', created_at: isoDaysAgo(0.3) },
        { query_text: 'D', created_at: isoDaysAgo(0.4) },
        { query_text: 'E', created_at: isoDaysAgo(0.5) },
        { query_text: 'F', created_at: isoDaysAgo(0.6) },
        { query_text: 'G', created_at: isoDaysAgo(0.7) },
      ],
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
      limit: 3,
    });
    expect(result.queries).toHaveLength(3);
    expect(result.queries.map((q) => q.query_text)).toEqual(['A', 'B', 'C']);
  });

  it('caps limit at MAX_LIMIT (20)', async () => {
    const state: MockState = { rows: [] };
    await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
      limit: 999,
    });
    expect(state.captured!.limit).toBe(GET_RECENT_QUERIES_MAX_LIMIT * 4);
  });

  it('clamps negative/zero limit to 1', async () => {
    const state: MockState = { rows: [] };
    await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
      limit: 0,
    });
    expect(state.captured!.limit).toBe(4); // 1 * FETCH_MULTIPLIER
  });

  it('default limit is GET_RECENT_QUERIES_DEFAULT_LIMIT (5)', async () => {
    expect(GET_RECENT_QUERIES_DEFAULT_LIMIT).toBe(5);
    const state: MockState = { rows: [] };
    await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(state.captured!.limit).toBe(5 * 4);
  });
});

// ─── Wire filter shape ───────────────────────────────────────────────────────

describe('getRecentQueries — query shape', () => {
  it('filters on client_user_id, interaction=impression, and since=now-7d', async () => {
    const state: MockState = { rows: [] };
    await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(state.captured!.clientUserId).toBe(USER_ID);
    expect(state.captured!.interaction).toBe('impression');
    expect(state.captured!.sinceGte).toBe(isoDaysAgo(7));
    expect(state.captured!.orderField).toBe('created_at');
    expect(state.captured!.orderAsc).toBe(false);
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe('getRecentQueries — error handling', () => {
  it('returns empty + warning on DB error (never throws)', async () => {
    const state: MockState = {
      rows: [],
      selectError: { message: 'connection refused' },
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.queries).toEqual([]);
    expect(result.warning).toContain('connection refused');
  });
});

// ─── ID format ───────────────────────────────────────────────────────────────

describe('getRecentQueries — id format', () => {
  it('produces stable kebab-case ids with åäö transliterated', async () => {
    const state: MockState = {
      rows: [
        { query_text: 'Gratis åäö', created_at: isoDaysAgo(0.1) },
        { query_text: 'A very long query ' + 'x'.repeat(200), created_at: isoDaysAgo(0.2) },
        { query_text: '!@#$%', created_at: isoDaysAgo(0.3) },
      ],
    };
    const result = await getRecentQueries({
      supabase: mockSupabase(state),
      client_user_id: USER_ID,
      now: NOW,
    });
    expect(result.queries[0].id).toBe('gratis-aao');
    // Truncated to 80 chars and non-alnum replaced.
    expect(result.queries[1].id.length).toBeLessThanOrEqual(80);
    expect(result.queries[1].id).not.toMatch(/[^a-z0-9-]/);
    // Punctuation-only query still gets a fallback id, not an empty string.
    expect(result.queries[2].id.length).toBeGreaterThan(0);
  });
});
