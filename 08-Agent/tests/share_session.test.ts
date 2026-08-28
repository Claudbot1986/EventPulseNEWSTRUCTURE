/**
 * Tests for share_session — T0061 / MVP-gap §78.
 *
 * Validates:
 *   - generateShortHash is deterministic + 6-char base32 output
 *   - generateShortHash differs across `ts` (no collision with same input)
 *   - clampTtl clamps to [MIN_TTL_HOURS, MAX_TTL_HOURS]
 *   - buildShareInsert: empty query rejected
 *   - buildShareInsert: oversized query rejected
 *   - buildShareInsert: non-UUID event_id rejected
 *   - buildShareInsert: caps event_ids at MAX_EVENT_IDS_PER_SHARE
 *   - buildShareInsert: produces a sane ISO expires_at
 */

import { describe, it, expect } from 'vitest';
import {
  generateShortHash,
  buildShareInsert,
  clampTtl,
  HASH_ALPHABET,
  HASH_LEN,
  MIN_TTL_HOURS,
  MAX_TTL_HOURS,
  MAX_QUERY_LENGTH,
  MAX_EVENT_IDS_PER_SHARE,
} from '../tools/share_session';

// ─── generateShortHash ──────────────────────────────────────────────────────

describe('generateShortHash', () => {
  it('produces HASH_LEN-char output in HASH_ALPHABET', () => {
    const h = generateShortHash(['test-session', 'konsert'], 1700000000);
    expect(h).toHaveLength(HASH_LEN);
    for (const ch of h) {
      expect(HASH_ALPHABET.includes(ch)).toBe(true);
    }
  });

  it('is deterministic for the same args', () => {
    const a = generateShortHash(['session-a', 'query'], 1700000000);
    const b = generateShortHash(['session-a', 'query'], 1700000000);
    expect(a).toBe(b);
  });

  it('differs across timestamp with same payload', () => {
    const a = generateShortHash(['session-a', 'query'], 1700000000);
    const b = generateShortHash(['session-a', 'query'], 1700000001);
    expect(a).not.toBe(b);
  });

  it('produces different hashes for different payloads', () => {
    const a = generateShortHash(['session-a', 'query-one'], 1700000000);
    const b = generateShortHash(['session-a', 'query-two'], 1700000000);
    expect(a).not.toBe(b);
  });
});

// ─── clampTtl ───────────────────────────────────────────────────────────────

describe('clampTtl', () => {
  it('returns the input when within range', () => {
    expect(clampTtl(168)).toBe(168);
  });
  it('clamps below MIN to MIN', () => {
    expect(clampTtl(0)).toBe(MIN_TTL_HOURS);
    expect(clampTtl(-100)).toBe(MIN_TTL_HOURS);
  });
  it('clamps above MAX to MAX', () => {
    expect(clampTtl(MAX_TTL_HOURS + 1000)).toBe(MAX_TTL_HOURS);
  });
  it('rounds non-integer values', () => {
    expect(clampTtl(23.7)).toBe(24);
  });
  it('returns MIN when input is not a finite number', () => {
    expect(clampTtl(Number.NaN)).toBe(MIN_TTL_HOURS);
    expect(clampTtl(Number.POSITIVE_INFINITY)).toBe(MIN_TTL_HOURS);
  });
});

// ─── buildShareInsert — validation ──────────────────────────────────────────

describe('buildShareInsert — validation', () => {
  const baseArgs = {
    query: 'Konsert ikväll',
    eventIds: ['550e8400-e29b-41d4-a716-446655440000'],
    sessionId: 'cd58bbed-1c76-4030-b9f5-2acd83b52758',
    now: new Date('2026-08-22T00:00:00.000Z'),
  };

  it('returns ok with a populated row on valid input', () => {
    const result = buildShareInsert(baseArgs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.session_id).toBe(baseArgs.sessionId);
    expect(result.row.query).toBe('Konsert ikväll');
    expect(result.row.event_ids).toEqual(baseArgs.eventIds);
    // 30 days * 24 hours * 3600s * 1000ms = 2_592_000_000 ms later
    expect(new Date(result.row.expires_at).getTime() - baseArgs.now.getTime()).toBe(
      30 * 24 * 3600 * 1000
    );
  });

  it('rejects empty query with ok:false + warning', () => {
    const result = buildShareInsert({ ...baseArgs, query: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning).toMatch(/empty/i);
  });

  it('rejects query above MAX_QUERY_LENGTH', () => {
    const long = 'x'.repeat(MAX_QUERY_LENGTH + 1);
    const result = buildShareInsert({ ...baseArgs, query: long });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning).toMatch(/≤ \d+ chars/);
  });

  it('rejects non-uuid event_id', () => {
    const result = buildShareInsert({ ...baseArgs, eventIds: ['not-a-uuid'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warning).toMatch(/not a uuid/i);
  });

  it('caps event_ids at MAX_EVENT_IDS_PER_SHARE', () => {
    const ids = Array.from({ length: 30 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
    );
    const result = buildShareInsert({ ...baseArgs, eventIds: ids });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.event_ids).toHaveLength(MAX_EVENT_IDS_PER_SHARE);
  });

  it('accepts zero event_ids (recipient re-runs query on open)', () => {
    const result = buildShareInsert({ ...baseArgs, eventIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.event_ids).toEqual([]);
  });

  it('omits session_id when not provided (cron-style share)', () => {
    const result = buildShareInsert({ ...baseArgs, sessionId: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.session_id).toBeNull();
  });

  it('respects custom ttlHours within range', () => {
    const result = buildShareInsert({ ...baseArgs, ttlHours: 48 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Date(result.row.expires_at).getTime() - baseArgs.now.getTime()).toBe(
      48 * 3600 * 1000
    );
  });
});
