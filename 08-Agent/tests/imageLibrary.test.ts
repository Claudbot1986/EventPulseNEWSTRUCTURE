/**
 * 08-Agent/tests/imageLibrary.test.ts
 *
 * Tests for the AI image library helper. Verifies:
 *   - pickLibraryFallback() returns category-match URL when one exists
 *   - pickLibraryFallback() falls back to default (NULL category) image
 *   - pickLibraryFallback() returns none when library is empty
 *   - addToLibrary() upserts idempotently via onConflict
 *   - bumpUsage() via RPC (mocked) handles errors silently
 *
 * Run:  npx vitest run 08-Agent/tests/imageLibrary.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock @supabase/supabase-js BEFORE importing imageLibrary
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

import {
  pickLibraryFallback,
  addToLibrary,
  markEventWithLibraryFallback,
} from '../utils/imageLibrary';

// ── Helpers ────────────────────────────────────────────────────────────────

interface MockQuery {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
}

function makeQuery(result: { data: unknown; error: unknown }): MockQuery {
  const q: MockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
  };
  return q;
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
});

// ── pickLibraryFallback ────────────────────────────────────────────────────

describe('pickLibraryFallback', () => {
  test('returns category match when one exists', async () => {
    // from() returns a query that yields the category-match image
    const categoryQuery = makeQuery({
      data: { id: 'lib-1', public_url: 'https://storage.example.com/music.png' },
      error: null,
    });
    const defaultQuery = makeQuery({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(categoryQuery)
      .mockReturnValueOnce(defaultQuery);
    rpcMock.mockResolvedValue({ error: null });

    const result = await pickLibraryFallback({ category_slug: 'music' });

    expect(result).toEqual({
      url: 'https://storage.example.com/music.png',
      library_id: 'lib-1',
      match_type: 'category',
    });
    expect(rpcMock).toHaveBeenCalledWith('image_library_bump_usage', { p_id: 'lib-1' });
  });

  test('falls back to default (NULL category) when no category match', async () => {
    const categoryQuery = makeQuery({ data: null, error: null });
    const defaultQuery = makeQuery({
      data: { id: 'lib-default', public_url: 'https://storage.example.com/default.png' },
      error: null,
    });
    fromMock
      .mockReturnValueOnce(categoryQuery)
      .mockReturnValueOnce(defaultQuery);
    rpcMock.mockResolvedValue({ error: null });

    const result = await pickLibraryFallback({ category_slug: 'community' });

    expect(result.match_type).toBe('default');
    expect(result.url).toBe('https://storage.example.com/default.png');
  });

  test('returns none when library is empty', async () => {
    fromMock.mockReturnValue(makeQuery({ data: null, error: null }));
    rpcMock.mockResolvedValue({ error: null });

    const result = await pickLibraryFallback({ category_slug: 'culture' });

    expect(result).toEqual({ url: null, library_id: null, match_type: 'none' });
  });

  test('does not query when category_slug is null', async () => {
    fromMock.mockReturnValue(makeQuery({ data: null, error: null }));
    rpcMock.mockResolvedValue({ error: null });

    const result = await pickLibraryFallback({ category_slug: null });

    expect(result.match_type).toBe('none');
    // Should only have queried the default-image path (1 call), not category
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('image_library');
  });
});

// ── addToLibrary ───────────────────────────────────────────────────────────

describe('addToLibrary', () => {
  test('upserts and returns the inserted library row', async () => {
    const query = makeQuery({
      data: { id: 'new-lib-1', storage_path: 'event-posters/ai/x.png' },
      error: null,
    });
    query.upsert = vi.fn().mockReturnThis();
    query.select = vi.fn().mockReturnThis();
    query.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'new-lib-1', storage_path: 'event-posters/ai/x.png' },
      error: null,
    });
    fromMock.mockReturnValue(query);

    const result = await addToLibrary({
      storage_path: 'event-posters/ai/x.png',
      category_slug: 'music',
      tags: ['test'],
    });

    expect(result).toBeTruthy();
    expect(result?.id).toBe('new-lib-1');
  });

  test('returns existing row on collision (upsert returns null)', async () => {
    // ignoreDuplicates=true → upsert returns 0 rader vid kollision.
    // addToLibrary ska då hämta befintlig rad via SELECT.
    const upsertQuery = makeQuery({ data: null, error: null });
    upsertQuery.upsert = vi.fn().mockReturnThis();
    upsertQuery.select = vi.fn().mockReturnThis();
    upsertQuery.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    upsertQuery.eq = vi.fn().mockReturnThis();

    const fetchQuery = makeQuery({
      data: { id: 'existing-lib', storage_path: 'event-posters/ai/x.png' },
      error: null,
    });
    fetchQuery.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'existing-lib', storage_path: 'event-posters/ai/x.png' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(upsertQuery)
      .mockReturnValueOnce(fetchQuery);

    const result = await addToLibrary({
      storage_path: 'event-posters/ai/x.png',
    });

    expect(result).toBeTruthy();
    expect(result?.id).toBe('existing-lib');
  });

  test('returns null on DB error', async () => {
    const query = makeQuery({ data: null, error: { message: 'duplicate' } });
    query.upsert = vi.fn().mockReturnThis();
    query.select = vi.fn().mockReturnThis();
    query.maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'duplicate' },
    });
    fromMock.mockReturnValue(query);
    // Silence console.warn in test output
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await addToLibrary({ storage_path: 'dup.png' });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── markEventWithLibraryFallback ──────────────────────────────────────────

describe('markEventWithLibraryFallback', () => {
  test('updates event with library URL when match is valid', async () => {
    const query = makeQuery({ data: null, error: null });
    query.update = vi.fn().mockReturnThis();
    query.eq = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue(query);

    await markEventWithLibraryFallback('event-1', {
      url: 'https://storage.example.com/music.png',
      library_id: 'lib-1',
      match_type: 'category',
    });

    expect(fromMock).toHaveBeenCalledWith('events');
  });

  test('skips when match has no URL', async () => {
    const query = makeQuery({ data: null, error: null });
    fromMock.mockReturnValue(query);

    await markEventWithLibraryFallback('event-1', {
      url: null,
      library_id: null,
      match_type: 'none',
    });

    // from() should NOT be called when match.url is null
    expect(fromMock).not.toHaveBeenCalled();
  });
});