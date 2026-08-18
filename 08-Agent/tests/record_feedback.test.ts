/**
 * Tests for record_feedback — Phase 1 success tracking (CTR, outbound).
 *
 * Mocks the Supabase client so we don't need live DB for unit coverage.
 * Validates that bad inputs are tolerated (best-effort, never throws).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordFeedback } from '../tools/record_feedback';

function mockSupabase(opts: { ok?: boolean; errorMessage?: string } = {}): SupabaseClient {
  const ok = opts.ok ?? true;
  const errorMessage = opts.errorMessage ?? 'mock error';
  const from = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue(
      Promise.resolve({ error: ok ? null : { message: errorMessage } })
    ),
  });
  return { from } as unknown as SupabaseClient;
}

describe('recordFeedback', () => {
  it('returns ok when insert succeeds', async () => {
    const sb = mockSupabase({ ok: true });
    const result = await recordFeedback(sb, {
      client_user_id: '00000000-0000-0000-0000-000000000001',
      event_id: '11111111-1111-1111-1111-111111111111',
      interaction: 'click',
    });
    expect(result.ok).toBe(true);
  });

  it('returns warning instead of throwing when insert fails', async () => {
    const sb = mockSupabase({ ok: false, errorMessage: 'constraint X' });
    const result = await recordFeedback(sb, {
      client_user_id: '00000000-0000-0000-0000-000000000001',
      event_id: '11111111-1111-1111-1111-111111111111',
      interaction: 'outbound',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/constraint X/);
  });

  it('rejects missing required fields without calling Supabase', async () => {
    const sb = mockSupabase({ ok: true });
    const fromSpy = vi.spyOn(sb, 'from');
    const result = await recordFeedback(sb, {
      client_user_id: '',
      event_id: '11111111-1111-1111-1111-111111111111',
      interaction: 'click',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/missing/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('passes rank_position and reasons through to the row', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    await recordFeedback(sb, {
      client_user_id: '00000000-0000-0000-0000-000000000001',
      event_id: '11111111-1111-1111-1111-111111111111',
      interaction: 'impression',
      rank_position: 2,
      reasons: ['time_fit', 'under_budget'],
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        rank_position: 2,
        reasons: ['time_fit', 'under_budget'],
        interaction: 'impression',
      })
    );
  });
});
