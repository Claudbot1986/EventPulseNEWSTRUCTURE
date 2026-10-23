import { describe, it, expect, vi, afterEach } from 'vitest';
import { enqueueSideEffect } from './sideEffectQueue';

describe('enqueueSideEffect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true and does not throw when the side effect succeeds', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await expect(enqueueSideEffect('search_sync-köning', 'evt-1', fn)).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('swallows the error when the side effect fails — the event is already persisted', async () => {
    // Regression (2026-10-23): 26 normalizer-jobb dog med "Connection is
    // closed." i search_syncQueue.add() — EFTER att eventet skrivits till
    // Supabase. Jobbet markerades failed, vilket säger "inget persisterades"
    // fastän alla 26 events fanns i databasen.
    const fn = vi.fn().mockRejectedValue(new Error('Connection is closed.'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(enqueueSideEffect('search_sync-köning', 'evt-1', fn)).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('Connection is closed.');
    expect(String(spy.mock.calls[0][0])).toContain('evt-1');
  });

  it('handles a non-Error rejection without crashing', async () => {
    const fn = vi.fn().mockRejectedValue('boom');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(enqueueSideEffect('AI-bild-köning', 'evt-2', fn)).resolves.toBe(false);
    expect(String(spy.mock.calls[0][0])).toContain('boom');
  });
});
