/**
 * Tests for follow_entity — T0050 / MVP-gap §77.
 *
 * Mocks the Supabase client (no live DB needed). Validates:
 *   - readFollowedVenueIds defends against malformed jsonb
 *   - followVenue is idempotent + caps + preserves categories
 *   - unfollowVenue is idempotent + preserves categories
 *   - loadFollowedVenues reads + caches
 *   - isUuid guards all inputs
 *   - readFollowedArtistSlugs lowercases + defends against malformed jsonb
 *   - followArtist / unfollowArtist mirror venue helpers (idempotent,
 *     cap, kebab validation, slug lowercasing on write)
 *   - loadFollowedArtists reads + caches
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  followVenue,
  unfollowVenue,
  loadFollowedVenues,
  readFollowedVenueIds,
  clearFollowedVenuesCache,
  isUuid,
  MAX_FOLLOWED_VENUES,
  followArtist,
  unfollowArtist,
  loadFollowedArtists,
  readFollowedArtistSlugs,
  isArtistSlug,
  clearFollowedArtistsCache,
  MAX_FOLLOWED_ARTISTS,
} from '../tools/follow_entity';

const USER_ID    = '00000000-0000-0000-0000-000000000001';
const VENUE_A    = '11111111-1111-1111-1111-111111111111';
const VENUE_B    = '22222222-2222-2222-2222-222222222222';
const VENUE_C    = '33333333-3333-3333-3333-333333333333';

interface MockState {
  preferences: Record<string, unknown> | null;
  upserts: Array<{ client_user_id: string; preferences: Record<string, unknown>; updated_at: string }>;
}

function makeClient(state: MockState, opts: { readError?: { message: string }; upsertError?: { message: string } } = {}) {
  const handlers: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => {
      if (opts.readError) return { data: null, error: opts.readError };
      return { data: state.preferences === null ? null : { preferences: state.preferences }, error: null };
    }),
    upsert: vi.fn(async (payload: any) => {
      if (opts.upsertError) return { data: null, error: opts.upsertError };
      state.upserts.push(payload);
      state.preferences = payload.preferences;
      return { data: null, error: null };
    }),
    single: vi.fn().mockReturnThis(),
    then: undefined,
  };
  // Chain: supabase.from(table).select(...).eq(...).maybeSingle()
  const client: any = {
    from: vi.fn(() => handlers),
  };
  return client as unknown as SupabaseClient;
}

afterEach(() => {
  clearFollowedVenuesCache();
  clearFollowedArtistsCache();
});

describe('isUuid', () => {
  it('accepts a real uuid', () => {
    expect(isUuid(USER_ID)).toBe(true);
    expect(isUuid(VENUE_A)).toBe(true);
  });
  it('rejects empty / non-string / non-uuid', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(123 as unknown as string)).toBe(false);
  });
});

describe('readFollowedVenueIds', () => {
  it('returns [] for null / non-object input', () => {
    expect(readFollowedVenueIds(null)).toEqual([]);
    expect(readFollowedVenueIds(undefined)).toEqual([]);
    expect(readFollowedVenueIds('not-an-object' as unknown as Record<string, unknown>)).toEqual([]);
  });
  it('returns [] when key is missing', () => {
    expect(readFollowedVenueIds({ categories: ['music'] })).toEqual([]);
  });
  it('returns [] when key is not an array', () => {
    expect(readFollowedVenueIds({ followed_venue_ids: 'oops' })).toEqual([]);
    expect(readFollowedVenueIds({ followed_venue_ids: 42 })).toEqual([]);
  });
  it('filters non-string entries', () => {
    expect(readFollowedVenueIds({ followed_venue_ids: [VENUE_A, 42, null, VENUE_B] })).toEqual([VENUE_A, VENUE_B]);
  });
  it('returns the array verbatim when all entries are strings', () => {
    expect(readFollowedVenueIds({ followed_venue_ids: [VENUE_A, VENUE_B] })).toEqual([VENUE_A, VENUE_B]);
  });
});

describe('followVenue', () => {
  it('rejects non-uuid client_user_id without touching the DB', async () => {
    const client = makeClient({ preferences: null, upserts: [] });
    const result = await followVenue(client, { client_user_id: 'bad', venue_id: VENUE_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/client_user_id/);
  });
  it('rejects non-uuid venue_id without touching the DB', async () => {
    const client = makeClient({ preferences: null, upserts: [] });
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: 'bad' });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/venue_id/);
  });
  it('adds a venue id to a fresh row', async () => {
    const state: MockState = { preferences: null, upserts: [] };
    const client = makeClient(state);
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.count).toBe(1);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].preferences.followed_venue_ids).toEqual([VENUE_A]);
    expect(state.upserts[0].client_user_id).toBe(USER_ID);
  });
  it('appends to an existing list', async () => {
    const state: MockState = { preferences: { followed_venue_ids: [VENUE_A] }, upserts: [] };
    const client = makeClient(state);
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_B });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.count).toBe(2);
    expect(state.preferences.followed_venue_ids).toEqual([VENUE_A, VENUE_B]);
  });
  it('preserves the existing categories key', async () => {
    const state: MockState = {
      preferences: { categories: ['music'], followed_venue_ids: [VENUE_A] },
      upserts: [],
    };
    const client = makeClient(state);
    await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_B });
    expect(state.preferences.categories).toEqual(['music']);
    expect(state.preferences.followed_venue_ids).toEqual([VENUE_A, VENUE_B]);
  });
  it('is idempotent — re-following returns added:false and no upsert', async () => {
    const state: MockState = { preferences: { followed_venue_ids: [VENUE_A] }, upserts: [] };
    const client = makeClient(state);
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(false);
    expect(result.count).toBe(1);
    expect(state.upserts).toHaveLength(0);
  });
  it('rejects when the cap is reached', async () => {
    const big = Array.from({ length: MAX_FOLLOWED_VENUES }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    );
    const state: MockState = { preferences: { followed_venue_ids: big }, upserts: [] };
    const client = makeClient(state);
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(false);
    expect(result.added).toBe(false);
    expect(result.warning).toMatch(/cap/);
  });
  it('propagates read errors', async () => {
    const client = makeClient({ preferences: null, upserts: [] }, { readError: { message: 'read failed' } });
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/read failed/);
  });
  it('propagates upsert errors', async () => {
    const client = makeClient({ preferences: null, upserts: [] }, { upsertError: { message: 'upsert failed' } });
    const result = await followVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/upsert failed/);
  });
});

describe('unfollowVenue', () => {
  it('rejects non-uuid inputs', async () => {
    const client = makeClient({ preferences: null, upserts: [] });
    expect((await unfollowVenue(client, { client_user_id: 'bad', venue_id: VENUE_A })).ok).toBe(false);
    expect((await unfollowVenue(client, { client_user_id: USER_ID, venue_id: 'bad' })).ok).toBe(false);
  });
  it('removes an existing venue id', async () => {
    const state: MockState = {
      preferences: { followed_venue_ids: [VENUE_A, VENUE_B] },
      upserts: [],
    };
    const client = makeClient(state);
    const result = await unfollowVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(true);
    expect(result.count).toBe(1);
    expect(state.preferences.followed_venue_ids).toEqual([VENUE_B]);
  });
  it('is idempotent — unfollowing an unknown venue is a no-op', async () => {
    const state: MockState = { preferences: { followed_venue_ids: [VENUE_A] }, upserts: [] };
    const client = makeClient(state);
    const result = await unfollowVenue(client, { client_user_id: USER_ID, venue_id: VENUE_C });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });
  it('is a no-op when there is no row at all', async () => {
    const state: MockState = { preferences: null, upserts: [] };
    const client = makeClient(state);
    const result = await unfollowVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
    expect(result.count).toBe(0);
    expect(state.upserts).toHaveLength(0);
  });
  it('preserves the existing categories key', async () => {
    const state: MockState = {
      preferences: { categories: ['music'], followed_venue_ids: [VENUE_A] },
      upserts: [],
    };
    const client = makeClient(state);
    await unfollowVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(state.preferences.categories).toEqual(['music']);
    expect(state.preferences.followed_venue_ids).toEqual([]);
  });
  it('propagates upsert errors', async () => {
    const state: MockState = { preferences: { followed_venue_ids: [VENUE_A] }, upserts: [] };
    const client = makeClient(state, { upsertError: { message: 'upsert failed' } });
    const result = await unfollowVenue(client, { client_user_id: USER_ID, venue_id: VENUE_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/upsert failed/);
  });
});

describe('loadFollowedVenues', () => {
  it('returns [] for non-uuid client_user_id (no DB call)', async () => {
    let called = false;
    const fakeClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { called = true; return { data: null, error: null }; } }) }) }),
    } as unknown as SupabaseClient;
    const result = await loadFollowedVenues(fakeClient, 'bad');
    expect(result.venue_ids).toEqual([]);
    expect(called).toBe(false);
  });
  it('reads + caches followed ids', async () => {
    clearFollowedVenuesCache();
    let readCount = 0;
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              readCount++;
              return {
                data: { preferences: { followed_venue_ids: [VENUE_A, VENUE_B] } },
                error: null,
              };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const first = await loadFollowedVenues(fakeClient, USER_ID);
    const second = await loadFollowedVenues(fakeClient, USER_ID);
    expect(first.venue_ids).toEqual([VENUE_A, VENUE_B]);
    expect(second.venue_ids).toEqual([VENUE_A, VENUE_B]);
    expect(readCount).toBe(1); // cached
  });
  it('skips cache on skipCache:true', async () => {
    clearFollowedVenuesCache();
    let readCount = 0;
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              readCount++;
              return { data: { preferences: { followed_venue_ids: [VENUE_A] } }, error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    await loadFollowedVenues(fakeClient, USER_ID, { skipCache: true });
    await loadFollowedVenues(fakeClient, USER_ID, { skipCache: true });
    expect(readCount).toBe(2);
  });
  it('returns [] when the row is missing', async () => {
    clearFollowedVenuesCache();
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const result = await loadFollowedVenues(fakeClient, USER_ID);
    expect(result.venue_ids).toEqual([]);
  });
  it('returns [] on a Supabase error', async () => {
    clearFollowedVenuesCache();
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const result = await loadFollowedVenues(fakeClient, USER_ID);
    expect(result.venue_ids).toEqual([]);
  });
});

// ─── T0050 — artist follows (mirror of the venue surface) ──────────────────

const ARTIST_A = 'kent';
const ARTIST_B = 'the-cardigans';
const ARTIST_C = 'abba';

describe('isArtistSlug', () => {
  it('accepts lowercase kebab slugs', () => {
    expect(isArtistSlug('kent')).toBe(true);
    expect(isArtistSlug('the-cardigans')).toBe(true);
    expect(isArtistSlug('abba')).toBe(true);
    expect(isArtistSlug('a-b-c-1-2-3')).toBe(true);
  });
  it('rejects empty / null / non-string', () => {
    expect(isArtistSlug('')).toBe(false);
    expect(isArtistSlug(null)).toBe(false);
    expect(isArtistSlug(undefined)).toBe(false);
    expect(isArtistSlug(42 as unknown as string)).toBe(false);
  });
  it('rejects uppercase / whitespace / special chars', () => {
    expect(isArtistSlug('Kent')).toBe(false);
    expect(isArtistSlug('kent ')).toBe(false);
    expect(isArtistSlug(' kent')).toBe(false);
    expect(isArtistSlug('k_ent')).toBe(false);
    expect(isArtistSlug('kent/se')).toBe(false);
    expect(isArtistSlug('-kent')).toBe(false); // leading hyphen
    expect(isArtistSlug('kent--')).toBe(false); // trailing hyphen
  });
  it('rejects slugs longer than 120 chars', () => {
    const tooLong = 'a'.repeat(121);
    expect(isArtistSlug(tooLong)).toBe(false);
    expect(isArtistSlug('a'.repeat(120))).toBe(true);
  });
});

describe('readFollowedArtistSlugs', () => {
  it('returns [] for null / non-object input', () => {
    expect(readFollowedArtistSlugs(null)).toEqual([]);
    expect(readFollowedArtistSlugs(undefined)).toEqual([]);
    expect(readFollowedArtistSlugs('not-an-object' as unknown as Record<string, unknown>)).toEqual([]);
  });
  it('returns [] when key is missing', () => {
    expect(readFollowedArtistSlugs({ categories: ['music'] })).toEqual([]);
  });
  it('returns [] when key is not an array', () => {
    expect(readFollowedArtistSlugs({ followed_artist_slugs: 'oops' })).toEqual([]);
    expect(readFollowedArtistSlugs({ followed_artist_slugs: 42 })).toEqual([]);
  });
  it('filters non-string entries', () => {
    expect(readFollowedArtistSlugs({ followed_artist_slugs: [ARTIST_A, 42, null, ARTIST_B] })).toEqual([ARTIST_A, ARTIST_B]);
  });
  it('lowercases entries on read (defensive against legacy mixed-case data)', () => {
    expect(readFollowedArtistSlugs({ followed_artist_slugs: ['Kent', 'The-Cardigans'] })).toEqual([ARTIST_A, ARTIST_B]);
  });
});

describe('followArtist', () => {
  it('rejects non-uuid client_user_id without touching the DB', async () => {
    const client = makeClient({ preferences: null, upserts: [] });
    const result = await followArtist(client, { client_user_id: 'bad', artist_slug: ARTIST_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/client_user_id/);
  });
  it('rejects malformed (underscore / empty / trailing-hyphen) artist_slugs without touching the DB', async () => {
    const client = makeClient({ preferences: null, upserts: [] });
    const r1 = await followArtist(client, { client_user_id: USER_ID, artist_slug: 'k_ent' });
    const r2 = await followArtist(client, { client_user_id: USER_ID, artist_slug: '' });
    const r3 = await followArtist(client, { client_user_id: USER_ID, artist_slug: 'kent--' });
    expect(r1.ok).toBe(false);
    expect(r1.warning).toMatch(/artist_slug/);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled(); // rejected at validation, before any IO
  });
  it('normalizes mixed-case input to lowercase before storing', async () => {
    const state: MockState = { preferences: null, upserts: [] };
    const client = makeClient(state);
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: 'Kent' });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.count).toBe(1);
    expect(state.preferences.followed_artist_slugs).toEqual(['kent']); // lowercased
  });
  it('adds an artist slug to a fresh row', async () => {
    const state: MockState = { preferences: null, upserts: [] };
    const client = makeClient(state);
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.count).toBe(1);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].preferences.followed_artist_slugs).toEqual([ARTIST_A]);
  });
  it('appends to an existing list', async () => {
    const state: MockState = {
      preferences: { followed_artist_slugs: [ARTIST_A] },
      upserts: [],
    };
    const client = makeClient(state);
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_B });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(true);
    expect(result.count).toBe(2);
    expect(state.preferences.followed_artist_slugs).toEqual([ARTIST_A, ARTIST_B]);
  });
  it('preserves the existing categories and followed_venue_ids keys', async () => {
    const state: MockState = {
      preferences: {
        categories: ['music'],
        followed_venue_ids: [VENUE_A],
        followed_artist_slugs: [ARTIST_A],
      },
      upserts: [],
    };
    const client = makeClient(state);
    await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_B });
    expect(state.preferences.categories).toEqual(['music']);
    expect(state.preferences.followed_venue_ids).toEqual([VENUE_A]);
    expect(state.preferences.followed_artist_slugs).toEqual([ARTIST_A, ARTIST_B]);
  });
  it('is idempotent — re-following returns added:false and no upsert', async () => {
    const state: MockState = {
      preferences: { followed_artist_slugs: [ARTIST_A] },
      upserts: [],
    };
    const client = makeClient(state);
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(true);
    expect(result.added).toBe(false);
    expect(result.count).toBe(1);
    expect(state.upserts).toHaveLength(0);
  });
  it('rejects when the cap is reached', async () => {
    const big = Array.from({ length: MAX_FOLLOWED_ARTISTS }, (_, i) => `artist-${i}`);
    const state: MockState = {
      preferences: { followed_artist_slugs: big },
      upserts: [],
    };
    const client = makeClient(state);
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(false);
    expect(result.added).toBe(false);
    expect(result.warning).toMatch(/cap/);
  });
  it('propagates read errors', async () => {
    const client = makeClient({ preferences: null, upserts: [] }, { readError: { message: 'read failed' } });
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/read failed/);
  });
  it('propagates upsert errors', async () => {
    const client = makeClient({ preferences: null, upserts: [] }, { upsertError: { message: 'upsert failed' } });
    const result = await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/upsert failed/);
  });
});

describe('unfollowArtist', () => {
  it('rejects non-uuid client_user_id and malformed artist_slug', async () => {
    const client = makeClient({ preferences: null, upserts: [] });
    expect((await unfollowArtist(client, { client_user_id: 'bad', artist_slug: ARTIST_A })).ok).toBe(false);
    expect((await unfollowArtist(client, { client_user_id: USER_ID, artist_slug: 'k_ent' })).ok).toBe(false);
  });
  it('removes an existing artist slug', async () => {
    const state: MockState = {
      preferences: { followed_artist_slugs: [ARTIST_A, ARTIST_B] },
      upserts: [],
    };
    const client = makeClient(state);
    const result = await unfollowArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(true);
    expect(result.count).toBe(1);
    expect(state.preferences.followed_artist_slugs).toEqual([ARTIST_B]);
  });
  it('is idempotent — unfollowing an unknown artist is a no-op', async () => {
    const state: MockState = {
      preferences: { followed_artist_slugs: [ARTIST_A] },
      upserts: [],
    };
    const client = makeClient(state);
    const result = await unfollowArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_C });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });
  it('is a no-op when there is no row at all', async () => {
    const state: MockState = { preferences: null, upserts: [] };
    const client = makeClient(state);
    const result = await unfollowArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
    expect(result.count).toBe(0);
    expect(state.upserts).toHaveLength(0);
  });
  it('preserves the existing categories and followed_venue_ids keys', async () => {
    const state: MockState = {
      preferences: {
        categories: ['music'],
        followed_venue_ids: [VENUE_A],
        followed_artist_slugs: [ARTIST_A],
      },
      upserts: [],
    };
    const client = makeClient(state);
    await unfollowArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(state.preferences.categories).toEqual(['music']);
    expect(state.preferences.followed_venue_ids).toEqual([VENUE_A]);
    expect(state.preferences.followed_artist_slugs).toEqual([]);
  });
  it('propagates upsert errors', async () => {
    const state: MockState = {
      preferences: { followed_artist_slugs: [ARTIST_A] },
      upserts: [],
    };
    const client = makeClient(state, { upsertError: { message: 'upsert failed' } });
    const result = await unfollowArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/upsert failed/);
  });
});

describe('loadFollowedArtists', () => {
  it('returns [] for non-uuid client_user_id (no DB call)', async () => {
    let called = false;
    const fakeClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { called = true; return { data: null, error: null }; } }) }) }),
    } as unknown as SupabaseClient;
    const result = await loadFollowedArtists(fakeClient, 'bad');
    expect(result.artist_slugs).toEqual([]);
    expect(called).toBe(false);
  });
  it('reads + caches followed slugs', async () => {
    clearFollowedArtistsCache();
    let readCount = 0;
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              readCount++;
              return {
                data: { preferences: { followed_artist_slugs: [ARTIST_A, ARTIST_B] } },
                error: null,
              };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const first = await loadFollowedArtists(fakeClient, USER_ID);
    const second = await loadFollowedArtists(fakeClient, USER_ID);
    expect(first.artist_slugs).toEqual([ARTIST_A, ARTIST_B]);
    expect(second.artist_slugs).toEqual([ARTIST_A, ARTIST_B]);
    expect(readCount).toBe(1); // cached
  });
  it('skips cache on skipCache:true', async () => {
    clearFollowedArtistsCache();
    let readCount = 0;
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              readCount++;
              return { data: { preferences: { followed_artist_slugs: [ARTIST_A] } }, error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    await loadFollowedArtists(fakeClient, USER_ID, { skipCache: true });
    await loadFollowedArtists(fakeClient, USER_ID, { skipCache: true });
    expect(readCount).toBe(2);
  });
  it('returns [] when the row is missing', async () => {
    clearFollowedArtistsCache();
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const result = await loadFollowedArtists(fakeClient, USER_ID);
    expect(result.artist_slugs).toEqual([]);
  });
  it('returns [] on a Supabase error', async () => {
    clearFollowedArtistsCache();
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const result = await loadFollowedArtists(fakeClient, USER_ID);
    expect(result.artist_slugs).toEqual([]);
  });
  it('followArtist invalidates the cached artists list', async () => {
    clearFollowedArtistsCache();
    const state: MockState = { preferences: null, upserts: [] };
    const client = makeClient(state);
    // Cache miss → first call writes the cold-cache entry ([]).
    const cold = await loadFollowedArtists(client, USER_ID);
    expect(cold.artist_slugs).toEqual([]);
    // Now followArtist should invalidate the cache.
    await followArtist(client, { client_user_id: USER_ID, artist_slug: ARTIST_A });
    // Re-read — must hit the DB again and pick up the new slug.
    const fresh = await loadFollowedArtists(client, USER_ID);
    expect(fresh.artist_slugs).toEqual([ARTIST_A]);
  });
});
