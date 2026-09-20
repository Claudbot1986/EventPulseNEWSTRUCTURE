/**
 * Tests for the Din helg weekly push cron (S6, 2026-09-20).
 *
 * Mocks the Supabase client + global Expo Push fetch (no live DB/network).
 * Validates:
 *   - pickEligibleUsers: opt-in + token filtering, UUID gate, locale resolve
 *   - buildPushCopy: {count} interpolation, copy length discipline (sv ≤10 words)
 *   - runPushDinHelgPass: message shape, skip on empty weekend cache,
 *     DeviceNotRegistered → token cleared via read-modify-write,
 *     send failure → errors, scan failure → ok:false
 *   - summarize format is a single parseable line
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildPushCopy,
  loadWeekendCardCount,
  pickEligibleUsers,
  resolvePushLocale,
  runPushDinHelgPass,
  summarize,
  DIN_HELG_DEEP_LINK,
  EXPO_PUSH_URL,
  PUSH_COPY,
} from '../cron/push_din_helg';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

interface MockDbOpts {
  prefsRows: Array<{ client_user_id: string; preferences: unknown }>;
  prefsScanError?: { message: string };
  weekendByUser: Record<string, unknown>;
  weekendError?: Record<string, { message: string }>;
}

function makeMockDb(opts: MockDbOpts) {
  const upserts: Array<Record<string, unknown>> = [];
  const from = (table: string) => {
    const chain: any = {};
    if (table === 'user_preferences') {
      let eqUser: string | null = null;
      chain.select = () => chain;
      chain.eq = (_col: string, val: string) => {
        eqUser = val;
        return chain;
      };
      chain.limit = () => ({
        then: (resolve: (v: unknown) => void) =>
          resolve(
            opts.prefsScanError
              ? { data: null, error: opts.prefsScanError }
              : { data: opts.prefsRows, error: null }
          ),
      });
      chain.maybeSingle = async () => {
        const row = opts.prefsRows.find((r) => r.client_user_id === eqUser);
        return { data: row ? { preferences: row.preferences } : null, error: null };
      };
      chain.upsert = async (payload: Record<string, unknown>) => {
        upserts.push(payload);
        // Keep the mock row in sync so subsequent reads see the cleared token.
        const prefs = payload.preferences as Record<string, unknown>;
        const idx = opts.prefsRows.findIndex(
          (r) => r.client_user_id === payload.client_user_id
        );
        if (idx >= 0) opts.prefsRows[idx] = { ...opts.prefsRows[idx], preferences: prefs };
        return { data: null, error: null };
      };
    } else if (table === 'cached_recommendations') {
      let eqUser = '';
      chain.select = () => chain;
      chain.eq = (_col: string, val: string) => {
        eqUser = val;
        return chain;
      };
      chain.maybeSingle = async () => {
        const err = opts.weekendError?.[eqUser];
        if (err) return { data: null, error: err };
        return { data: opts.weekendByUser[eqUser] ?? null, error: null };
      };
    }
    return chain;
  };
  const client = { from } as unknown as SupabaseClient;
  return { client, upserts };
}

const card = (title: string) => ({
  event_id: 'e1',
  title,
  start_time: '2026-09-25T18:00:00.000Z',
  venue_name: 'Fasching',
  image_url: null,
  rank_reason: 'category_match',
});

// ─── resolvePushLocale / buildPushCopy ──────────────────────────────────────

describe('resolvePushLocale', () => {
  it('keeps supported locales verbatim', () => {
    for (const tag of ['sv', 'en', 'de', 'no', 'fi', 'da', 'nl', 'fr', 'zh-Hans', 'it'] as const) {
      expect(resolvePushLocale(tag)).toBe(tag);
    }
  });

  it('falls back to en for unknown/missing locales', () => {
    expect(resolvePushLocale('hi')).toBe('en');
    expect(resolvePushLocale(undefined)).toBe('en');
    expect(resolvePushLocale(null)).toBe('en');
    expect(resolvePushLocale(42)).toBe('en');
  });
});

describe('buildPushCopy', () => {
  it('interpolates {count} into the body', () => {
    const copy = buildPushCopy('sv', 2);
    expect(copy.title).toBe('Din helg är här');
    expect(copy.body).toBe('2 kort för fredag–söndag');
  });

  it('clamps count to ≥1 (a lone card still says "1 kort")', () => {
    expect(buildPushCopy('sv', 0).body).toContain('1 ');
  });

  it('has copy for all 10 locales and none contain the placeholder', () => {
    for (const locale of Object.keys(PUSH_COPY) as Array<keyof typeof PUSH_COPY>) {
      const copy = buildPushCopy(locale, 3);
      expect(copy.body).not.toContain('{count}');
      expect(copy.title.length).toBeGreaterThan(0);
    }
  });

  it('keeps the sv body within the ≤10-words research cap', () => {
    const words = buildPushCopy('sv', 3).body.split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(10);
  });
});

// ─── pickEligibleUsers ──────────────────────────────────────────────────────

describe('pickEligibleUsers', () => {
  it('selects only opted-in users with a non-empty token and valid UUID', async () => {
    const { client } = makeMockDb({
      prefsRows: [
        // eligible
        { client_user_id: USER_A, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[a]', locale: 'sv' } },
        // opt-in off
        { client_user_id: USER_B, preferences: { din_helg_push_enabled: false, push_token: 'ExponentPushToken[b]' } },
        // token missing
        { client_user_id: USER_C, preferences: { din_helg_push_enabled: true } },
        // bad uuid
        { client_user_id: 'not-a-uuid', preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[x]' } },
        // whitespace token
        { client_user_id: USER_B, preferences: { din_helg_push_enabled: true, push_token: '  ' } },
      ],
      weekendByUser: {},
    });
    const scan = await pickEligibleUsers(client);
    expect(scan.ok).toBe(true);
    expect(scan.users).toHaveLength(1);
    expect(scan.users[0].userId).toBe(USER_A);
    expect(scan.users[0].pushToken).toBe('ExponentPushToken[a]');
    expect(scan.users[0].locale).toBe('sv');
  });

  it('surfaces scan failures as ok:false + warning', async () => {
    const { client } = makeMockDb({
      prefsRows: [],
      prefsScanError: { message: 'boom' },
      weekendByUser: {},
    });
    const scan = await pickEligibleUsers(client);
    expect(scan.ok).toBe(false);
    expect(scan.warning).toContain('boom');
  });
});

// ─── runPushDinHelgPass ─────────────────────────────────────────────────────

describe('runPushDinHelgPass', () => {
  it('sends one localized message per user with cached weekend cards', async () => {
    const { client } = makeMockDb({
      prefsRows: [
        { client_user_id: USER_A, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[a]', locale: 'sv' } },
        { client_user_id: USER_B, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[b]', locale: 'de' } },
      ],
      weekendByUser: {
        [USER_A]: { slot_2_card_1: card('Jazzkväll'), slot_2_card_2: card('Marknad') },
        [USER_B]: { slot_2_card_1: card('Konzert'), slot_2_card_2: null },
      },
    });
    const sentBodies: unknown[] = [];
    const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
      sentBodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        json: async () => ({ data: [{ status: 'ok' }, { status: 'ok' }] }),
      } as Response;
    }) as typeof fetch;

    const summary = await runPushDinHelgPass({ supabase: client, fetchImpl, now: new Date('2026-09-24T15:00:00Z') });
    expect(summary.ok).toBe(true);
    expect(summary.users_scanned).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.tokens_cleared).toBe(0);

    const messages = sentBodies[0] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0].to).toBe('ExponentPushToken[a]');
    expect(messages[0].sound).toBe('default');
    expect(messages[0].title).toBe('Din helg är här');
    expect(messages[0].body).toBe('2 kort för fredag–söndag');
    expect((messages[0].data as { url: string }).url).toBe(DIN_HELG_DEEP_LINK);
    // German user gets German copy with 1 card.
    expect(messages[1].title).toBe(PUSH_COPY.de.title);
    expect(messages[1].body).toContain('1 ');
    // Internal field must never hit the wire.
    expect(JSON.stringify(sentBodies[0])).not.toContain('_userId');
  });

  it('skips users without cached weekend cards and clears dead tokens', async () => {
    const { client, upserts } = makeMockDb({
      prefsRows: [
        { client_user_id: USER_A, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[a]', categories: ['music'] } },
        { client_user_id: USER_B, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[b]' } },
        { client_user_id: USER_C, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[c]' } },
      ],
      weekendByUser: {
        // A: dead device → receipt DeviceNotRegistered
        [USER_A]: { slot_2_card_1: card('X'), slot_2_card_2: null },
        // B: no cached row → skipped
        // C: sends fine
        [USER_C]: { slot_2_card_1: null, slot_2_card_2: card('Y') },
      },
    });
    const fetchImpl = (async (url: unknown) => {
      expect(url).toBe(EXPO_PUSH_URL);
      return {
        ok: true,
        json: async () => ({
          data: [
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok' },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const summary = await runPushDinHelgPass({ supabase: client, fetchImpl });
    expect(summary.users_scanned).toBe(3);
    expect(summary.skipped).toBe(1); // B
    expect(summary.sent).toBe(1); // C
    expect(summary.tokens_cleared).toBe(1); // A
    expect(summary.errors).toBe(0);

    // Token cleared via read-modify-write preserving other keys.
    expect(upserts).toHaveLength(1);
    const prefs = upserts[0].preferences as Record<string, unknown>;
    expect(upserts[0].client_user_id).toBe(USER_A);
    expect(prefs.push_token).toBeNull();
    expect(prefs.categories).toEqual(['music']);
    expect(prefs.din_helg_push_enabled).toBe(true);
  });

  it('counts the whole chunk as errors when the Expo API fails', async () => {
    const { client } = makeMockDb({
      prefsRows: [
        { client_user_id: USER_A, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[a]' } },
        { client_user_id: USER_B, preferences: { din_helg_push_enabled: true, push_token: 'ExponentPushToken[b]' } },
      ],
      weekendByUser: {
        [USER_A]: { slot_2_card_1: card('A'), slot_2_card_2: null },
        [USER_B]: { slot_2_card_1: card('B'), slot_2_card_2: null },
      },
    });
    const fetchImpl = (async () => ({ ok: false, status: 500 }) as Response) as typeof fetch;
    const summary = await runPushDinHelgPass({ supabase: client, fetchImpl });
    expect(summary.sent).toBe(0);
    expect(summary.errors).toBe(2);
  });

  it('returns ok:false when the user scan fails', async () => {
    const { client } = makeMockDb({
      prefsRows: [],
      prefsScanError: { message: 'db down' },
      weekendByUser: {},
    });
    const fetchImpl = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;
    const summary = await runPushDinHelgPass({ supabase: client, fetchImpl });
    expect(summary.ok).toBe(false);
    expect(summary.warning).toContain('db down');
    expect(summary.users_scanned).toBe(0);
  });
});

// ─── loadWeekendCardCount ───────────────────────────────────────────────────

describe('loadWeekendCardCount', () => {
  it('counts only cards with a non-empty title', async () => {
    const { client } = makeMockDb({
      prefsRows: [],
      weekendByUser: {
        [USER_A]: { slot_2_card_1: card('A'), slot_2_card_2: { title: '' } },
      },
    });
    const res = await loadWeekendCardCount(client, USER_A);
    expect(res).toEqual({ ok: true, count: 1 });
  });

  it('returns count 0 when the user has no cache row', async () => {
    const { client } = makeMockDb({ prefsRows: [], weekendByUser: {} });
    const res = await loadWeekendCardCount(client, USER_B);
    expect(res).toEqual({ ok: true, count: 0 });
  });
});

// ─── summarize ──────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('emits one parseable line with all counters', () => {
    const line = summarize({
      ok: true,
      started_at: '2026-09-24T15:00:00.000Z',
      duration_ms: 812,
      users_scanned: 12,
      sent: 9,
      skipped: 2,
      tokens_cleared: 1,
      errors: 0,
    });
    expect(line).toBe(
      '[push_din_helg-cron] 2026-09-24T15:00:00.000Z users=12 sent=9 skipped=2 tokens_cleared=1 errors=0 duration_ms=812'
    );
  });

  it('appends warning when present', () => {
    const line = summarize({
      ok: false,
      started_at: '2026-09-24T15:00:00.000Z',
      duration_ms: 3,
      users_scanned: 0,
      sent: 0,
      skipped: 0,
      tokens_cleared: 0,
      errors: 1,
      warning: 'db down',
    });
    expect(line).toContain('warning="db down"');
  });
});
