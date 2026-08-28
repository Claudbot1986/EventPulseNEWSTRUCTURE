/**
 * Tests for record_feedback — Phase 1 success tracking (CTR, outbound).
 *
 * Mocks the Supabase client so we don't need live DB for unit coverage.
 * Validates that bad inputs are tolerated (best-effort, never throws).
 *
 * Coverage:
 *   - All five funnel interactions persist (impression, click, save,
 *     reject, outbound)
 *   - reject_reason defaults to 'not_interested' for reject aliases
 *   - reject_reason is merged into metadata.reject_reason
 *   - invalid interaction / reject_reason / uuid shapes return warnings
 *     without calling Supabase
 *   - DB insert failure returns warning instead of throwing
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  recordFeedback,
  validateFeedbackInput,
  ALLOWED_INTERACTIONS,
  ALLOWED_REJECT_REASONS,
  DEFAULT_REJECT_REASON,
} from '../tools/record_feedback';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const EVENT_ID = '11111111-1111-1111-1111-111111111111';

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
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'click',
    });
    expect(result.ok).toBe(true);
    expect(result.interaction).toBe('click');
  });

  it('returns warning instead of throwing when insert fails', async () => {
    const sb = mockSupabase({ ok: false, errorMessage: 'constraint X' });
    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
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
      event_id: EVENT_ID,
      interaction: 'click',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/client_user_id/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('passes rank_position and reasons through to the row', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
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

  // ─── Phase 1 funnel interactions ────────────────────────────────────

  it.each(['impression', 'click', 'save', 'reject', 'outbound'] as const)(
    'persists the %s interaction',
    async (interaction) => {
      const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
      const from = vi.fn().mockReturnValue({ insert });
      const sb = { from } as unknown as SupabaseClient;

      const result = await recordFeedback(sb, {
        client_user_id: USER_ID,
        event_id: EVENT_ID,
        interaction,
      });
      expect(result.ok).toBe(true);
      expect(result.interaction).toBe(interaction);
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ interaction })
      );
    }
  );

  // ─── reject_reason handling ─────────────────────────────────────────

  it('defaults reject_reason to not_interested when reject is sent without reason', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'reject',
    });
    expect(result.ok).toBe(true);
    expect(result.reject_reason).toBe('not_interested');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        interaction: 'reject',
        metadata: expect.objectContaining({ reject_reason: 'not_interested' }),
      })
    );
  });

  it('persists the explicit reject_reason in metadata.reject_reason', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'reject',
      reject_reason: 'too_expensive',
    });
    expect(result.ok).toBe(true);
    expect(result.reject_reason).toBe('too_expensive');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reject_reason: 'too_expensive' }),
      })
    );
  });

  it('merges reject_reason into existing metadata without dropping caller keys', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'reject',
      reject_reason: 'wrong_category',
      metadata: { experiment_id: 'PERSONALIZATION_PRIORS', experiment_variant: 'treatment' },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          experiment_id: 'PERSONALIZATION_PRIORS',
          experiment_variant: 'treatment',
          reject_reason: 'wrong_category',
        },
      })
    );
  });

  it('does not write reject_reason field for non-reject interactions', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'click',
    });
    expect(result.ok).toBe(true);
    expect(result.reject_reason).toBeNull();
    const inserted = (insert.mock.calls[0]?.[0] ?? {}) as { metadata?: Record<string, unknown> };
    expect(inserted.metadata?.reject_reason).toBeUndefined();
  });

  it('still defaults reject_reason for legacy dismiss alias', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    const sb = { from } as unknown as SupabaseClient;

    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'dismiss',
    });
    expect(result.ok).toBe(true);
    expect(result.reject_reason).toBe('not_interested');
  });

  // ─── Validation ─────────────────────────────────────────────────────

  it('rejects an unknown interaction string without calling Supabase', async () => {
    const sb = mockSupabase({ ok: true });
    const fromSpy = vi.spyOn(sb, 'from');
    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'rainbow' as 'click',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/interaction/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown reject_reason without calling Supabase', async () => {
    const sb = mockSupabase({ ok: true });
    const fromSpy = vi.spyOn(sb, 'from');
    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'reject',
      reject_reason: 'definitely_not_a_real_reason' as 'not_interested',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/reject_reason/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid client_user_id without calling Supabase', async () => {
    const sb = mockSupabase({ ok: true });
    const fromSpy = vi.spyOn(sb, 'from');
    const result = await recordFeedback(sb, {
      client_user_id: 'not-a-uuid',
      event_id: EVENT_ID,
      interaction: 'click',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/uuid/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid event_id without calling Supabase', async () => {
    const sb = mockSupabase({ ok: true });
    const fromSpy = vi.spyOn(sb, 'from');
    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: 'seven-eleven',
      interaction: 'click',
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/uuid/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejects a negative rank_position without calling Supabase', async () => {
    const sb = mockSupabase({ ok: true });
    const fromSpy = vi.spyOn(sb, 'from');
    const result = await recordFeedback(sb, {
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'impression',
      rank_position: -1,
    });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/rank_position/);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  // ─── Constant sanity ────────────────────────────────────────────────

  it('ALLOWED_INTERACTIONS includes the Phase 1 funnel set', () => {
    for (const k of ['impression', 'click', 'save', 'reject', 'outbound']) {
      expect(ALLOWED_INTERACTIONS.has(k as 'impression')).toBe(true);
    }
  });

  it('ALLOWED_REJECT_REASONS covers the documented enum', () => {
    expect(ALLOWED_REJECT_REASONS.size).toBeGreaterThanOrEqual(6);
    expect(ALLOWED_REJECT_REASONS.has(DEFAULT_REJECT_REASON)).toBe(true);
  });

  it('validateFeedbackInput returns null for a well-formed payload', () => {
    expect(validateFeedbackInput({
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'reject',
      reject_reason: 'too_far',
    })).toBeNull();
  });

  it('validateFeedbackInput rejects unknown interaction', () => {
    expect(validateFeedbackInput({
      client_user_id: USER_ID,
      event_id: EVENT_ID,
      interaction: 'hate_it',
    })).toMatch(/interaction/);
  });
});
