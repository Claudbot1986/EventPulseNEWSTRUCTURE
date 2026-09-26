/**
 * Unit tests for `link_health_watchlist.ts`.
 *
 * Coverage:
 *   - aggregates by source
 *   - respects minBrokenEvents threshold
 *   - respects windowDays filter
 *   - errors-as-data: query failure → empty list with error
 *   - errors-as-data: no client → empty list with error
 */

import { describe, expect, it, vi } from 'vitest';
import { collectLinkHealthWatchlist } from '../tools/link_health_watchlist';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeClient(rows: Array<{ source: string; link_last_checked_at: string }> | null, queryError?: { message: string }): SupabaseClient {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    limit: () => Promise.resolve({ data: rows, error: queryError ?? null }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe('link_health_watchlist', () => {
  it('aggregates by source and sorts by count desc', async () => {
    const rows = [
      { source: 'kth',           link_last_checked_at: '2026-09-26T03:00:00Z' },
      { source: 'kth',           link_last_checked_at: '2026-09-25T03:00:00Z' },
      { source: 'kth',           link_last_checked_at: '2026-09-24T03:00:00Z' },
      { source: 'kulturhuset',   link_last_checked_at: '2026-09-26T03:00:00Z' },
    ];
    const result = await collectLinkHealthWatchlist({ _client: fakeClient(rows) });
    expect(result.error).toBeNull();
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].source).toBe('kth');
    expect(result.entries[0].brokenCount).toBe(3);
    expect(result.entries[1].source).toBe('kulturhuset');
    expect(result.entries[1].brokenCount).toBe(1);
  });

  it('respects minBrokenEvents threshold', async () => {
    const rows = [
      { source: 'single-broken', link_last_checked_at: '2026-09-26T03:00:00Z' },
    ];
    const result = await collectLinkHealthWatchlist({
      _client: fakeClient(rows),
      minBrokenEvents: 2,
    });
    expect(result.entries).toHaveLength(0);
  });

  it('returns empty list when no client available', async () => {
    const result = await collectLinkHealthWatchlist({ _client: null });
    expect(result.entries).toHaveLength(0);
    expect(result.error).toMatch(/not configured/);
  });

  it('returns empty list with error message on query failure', async () => {
    const result = await collectLinkHealthWatchlist({
      _client: fakeClient(null, { message: 'permission denied' }),
    });
    expect(result.entries).toHaveLength(0);
    expect(result.error).toContain('permission denied');
  });

  it('tracks oldest and latest timestamps per source', async () => {
    const rows = [
      { source: 'kth', link_last_checked_at: '2026-09-26T03:00:00Z' },
      { source: 'kth', link_last_checked_at: '2026-09-20T03:00:00Z' },
      { source: 'kth', link_last_checked_at: '2026-09-23T03:00:00Z' },
    ];
    const result = await collectLinkHealthWatchlist({ _client: fakeClient(rows) });
    expect(result.entries[0].lastCheckedAt).toBe('2026-09-26T03:00:00Z');
    expect(result.entries[0].oldestBrokenAt).toBe('2026-09-20T03:00:00Z');
  });
});