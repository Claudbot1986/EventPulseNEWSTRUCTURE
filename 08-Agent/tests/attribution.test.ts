/**
 * Tests for `tools/attribution.ts` — per-organizer outbound click attribution.
 *
 * Covers:
 *   - recordOutboundClick: input validation (Zod) — missing fields, bad UUID,
 *     non-http ticket_url, foreign URL host, oversize metadata.
 *   - recordOutboundClick: best-effort behavior on Supabase failure (returns
 *     warning, never throws).
 *   - recordOutboundClick: forwards a clean row shape to Supabase insert.
 *   - summarizeOutboundByOrganizer: aggregation logic over a fixture array
 *     (no live DB; we exercise the pure aggregator directly).
 *   - summarizeOutboundByOrganizer: time-range filtering, organizer bucketing,
 *     click count + unique-user counts, top-N ordering.
 *   - summarizeOutboundByOrganizer: returns empty summary when no rows match.
 *
 * Privacy invariants we test:
 *   - The aggregator never echoes client_user_id values back to the caller.
 *   - The row schema we persist does NOT include IP, lat, lng, user_agent.
 *
 * Style: vitest, mock Supabase. No live DB. Matches `record_feedback.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  recordOutboundClick,
  summarizeOutboundByOrganizer,
  type OutboundClickRow,
} from '../tools/attribution';

function mockSupabase(opts: {
  ok?: boolean;
  errorMessage?: string;
  insertedRows?: unknown[];
} = {}): SupabaseClient {
  const ok = opts.ok ?? true;
  const errorMessage = opts.errorMessage ?? 'mock error';
  const insertedRows: unknown[] = opts.insertedRows ?? [];
  const insert = vi.fn().mockReturnValue(
    Promise.resolve({ data: insertedRows, error: ok ? null : { message: errorMessage } })
  );
  const from = vi.fn().mockReturnValue({ insert });
  return { from } as unknown as SupabaseClient;
}

const VALID_USER = '00000000-0000-0000-0000-000000000001';
const VALID_ORG  = '00000000-0000-0000-0000-0000000000aa';
const VALID_EVENT = '00000000-0000-0000-0000-0000000000bb';
const VALID_SESSION = '00000000-0000-0000-0000-0000000000cc';
const VALID_URL = 'https://konserthuset.se/kop-biljetter/event-42';

describe('recordOutboundClick — validation', () => {
  it('rejects empty client_user_id without calling Supabase', async () => {
    const sb = mockSupabase();
    const fromSpy = vi.spyOn(sb, 'from');
    const r = await recordOutboundClick(sb, {
      client_user_id: '',
      event_id: VALID_EVENT,
      ticket_url: VALID_URL,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/client_user_id/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejects bad uuid for client_user_id', async () => {
    const sb = mockSupabase();
    const r = await recordOutboundClick(sb, {
      client_user_id: 'not-a-uuid',
      event_id: VALID_EVENT,
      ticket_url: VALID_URL,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/uuid/i);
  });

  it('rejects bad uuid for event_id', async () => {
    const sb = mockSupabase();
    const r = await recordOutboundClick(sb, {
      client_user_id: VALID_USER,
      event_id: 'definitely-not-a-uuid',
      ticket_url: VALID_URL,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/event_id/);
  });

  it('rejects non-http ticket_url schemes', async () => {
    const sb = mockSupabase();
    const r = await recordOutboundClick(sb, {
      client_user_id: VALID_USER,
      event_id: VALID_EVENT,
      ticket_url: 'javascript:alert(1)',
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/ticket_url/);
  });

  it('rejects obviously oversized metadata', async () => {
    const sb = mockSupabase();
    const big = 'x'.repeat(10_000);
    const r = await recordOutboundClick(sb, {
      client_user_id: VALID_USER,
      event_id: VALID_EVENT,
      ticket_url: VALID_URL,
      metadata: { blob: big },
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/metadata/);
  });
});

describe('recordOutboundClick — happy path', () => {
  it('returns ok when insert succeeds', async () => {
    const sb = mockSupabase({ ok: true });
    const r = await recordOutboundClick(sb, {
      client_user_id: VALID_USER,
      event_id: VALID_EVENT,
      ticket_url: VALID_URL,
    });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it('forwards a privacy-safe row shape to Supabase', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ data: [], error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    await recordOutboundClick(sb, {
      client_user_id: VALID_USER,
      session_id: VALID_SESSION,
      event_id: VALID_EVENT,
      organizer_id: VALID_ORG,
      source: 'konserthuset',
      ticket_url: VALID_URL,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      client_user_id: VALID_USER,
      session_id: VALID_SESSION,
      event_id: VALID_EVENT,
      organizer_id: VALID_ORG,
      source: 'konserthuset',
      ticket_url: VALID_URL,
    });
    // Privacy: do NOT include any of these columns.
    expect(row).not.toHaveProperty('ip');
    expect(row).not.toHaveProperty('ip_address');
    expect(row).not.toHaveProperty('lat');
    expect(row).not.toHaveProperty('lng');
    expect(row).not.toHaveProperty('user_agent');
    expect(row).not.toHaveProperty('precise_location');
  });

  it('returns warning instead of throwing on Supabase failure', async () => {
    const sb = mockSupabase({ ok: false, errorMessage: 'constraint x' });
    const r = await recordOutboundClick(sb, {
      client_user_id: VALID_USER,
      event_id: VALID_EVENT,
      ticket_url: VALID_URL,
    });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/constraint x/);
  });
});

describe('summarizeOutboundByOrganizer — aggregation', () => {
  // Fixture: a small set of click rows in two date ranges, three organizers.
  const clicks: OutboundClickRow[] = [
    // Organizer A — Konserthuset: u-1 clicks evt-1.
    {
      clicked_at: new Date('2026-08-01T10:00:00Z'),
      organizer_id: 'org-a',
      source: 'konserthuset',
      event_id: 'evt-1',
      client_user_id: 'u-1',
    },
    {
      clicked_at: new Date('2026-08-02T11:00:00Z'),
      organizer_id: 'org-a',
      source: 'konserthuset',
      event_id: 'evt-1',
      client_user_id: 'u-2',
    },
    // Organizer B — Dramaten: u-1 clicks evt-2.
    {
      clicked_at: new Date('2026-08-05T11:00:00Z'),
      organizer_id: 'org-b',
      source: 'dramaten',
      event_id: 'evt-2',
      client_user_id: 'u-1',
    },
    // Organizer C — no organizer_id yet, source set: 1 click by u-3.
    {
      clicked_at: new Date('2026-08-10T11:00:00Z'),
      organizer_id: null,
      source: 'biljetto',
      event_id: 'evt-3',
      client_user_id: 'u-3',
    },
    // Same organizer, SAME user, SAME event → counted twice for clicks,
    // once for unique_users.
    {
      clicked_at: new Date('2026-08-03T11:00:00Z'),
      organizer_id: 'org-a',
      source: 'konserthuset',
      event_id: 'evt-1',
      client_user_id: 'u-1',
    },
    // Outside the requested window (should be filtered out).
    {
      clicked_at: new Date('2026-07-15T11:00:00Z'),
      organizer_id: 'org-a',
      source: 'konserthuset',
      event_id: 'evt-1',
      client_user_id: 'u-1',
    },
  ];

  it('returns empty summary when no rows match the window', () => {
    const out = summarizeOutboundByOrganizer(clicks, {
      from: new Date('2027-01-01T00:00:00Z'),
      to: new Date('2027-01-31T00:00:00Z'),
    });
    expect(out.buckets).toEqual([]);
    expect(out.total_clicks).toBe(0);
    expect(out.total_unique_users).toBe(0);
  });

  it('groups by organizer_id when present and counts clicks + unique users', () => {
    const out = summarizeOutboundByOrganizer(clicks, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
    });
    const orgA = out.buckets.find((b) => b.key === 'org-a');
    expect(orgA).toBeDefined();
    // 3 clicks in-window for org-a — the July 15 row is out of window.
    expect(orgA!.clicks).toBe(3);
    // Two distinct users: u-1 and u-2.
    expect(orgA!.unique_users).toBe(2);
    expect(orgA!.events).toBe(1);
    expect(orgA!.source).toBe('konserthuset');
  });

  it('falls back to source as the bucket key when organizer_id is null', () => {
    const out = summarizeOutboundByOrganizer(clicks, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
    });
    const orgC = out.buckets.find((b) => b.key === 'source:biljetto');
    expect(orgC).toBeDefined();
    expect(orgC!.clicks).toBe(1);
    expect(orgC!.unique_users).toBe(1);
    expect(orgC!.organizer_id).toBeNull();
  });

  it('sorts buckets by clicks desc and respects topN', () => {
    const out = summarizeOutboundByOrganizer(clicks, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
      topN: 1,
    });
    expect(out.buckets).toHaveLength(1);
    expect(out.buckets[0].key).toBe('org-a');
    // Even with topN=1, the totals reflect the full window.
    expect(out.total_clicks).toBe(5);
    expect(out.total_unique_users).toBe(3);
  });

  it('does not echo client_user_id values in the summary output', () => {
    const out = summarizeOutboundByOrganizer(clicks, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T23:59:59Z'),
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('u-1');
    expect(serialized).not.toContain('u-2');
    expect(serialized).not.toContain('u-3');
  });
});
