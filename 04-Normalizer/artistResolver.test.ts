/**
 * artistResolver.test.ts — Tester för extractHeadliner + resolveArtist.
 *
 * Coverar:
 *   1. extractHeadliner: separatorer, casing, tomma strängar, ingen separator
 *   2. resolveArtist: happy path (MB + Last.fm + tags), MB miss, Last.fm tom,
 *      tvetydiga taggar, supabase fel
 *
 * resolveArtist mockar global fetch (samma mönster som musicLookup.test.ts)
 * för att testa hela kedjan mot simulerade API-svar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  extractHeadliner,
  resolveArtist,
  AUTO_WRITE_THRESHOLD,
} from './artistResolver';
import type { SupabaseClient } from '@supabase/supabase-js';

const ORIGINAL_ENV = { ...process.env };

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Mock Supabase client that supports the chained calls used in
 * artistResolver: from().select().ilike().limit().maybeSingle(),
 * from().insert().select().single(), from().update().eq().
 */
function makeSupabaseMock(opts: {
  existing?: { id: string; display_name: string; slug: string; metadata: Record<string, unknown> } | null;
  insertError?: { code?: string; message: string } | null;
  updateError?: { code?: string; message: string } | null;
} = {}) {
  const calls: { op: string; args?: unknown }[] = [];

  const supabase = {
    from: vi.fn((_table: string) => {
      const builder: Record<string, unknown> = {};
      builder['select'] = vi.fn(() => builder);
      builder['insert'] = vi.fn((data: unknown) => {
        calls.push({ op: 'insert', args: data });
        if (opts.insertError) {
          const result = { data: null, error: opts.insertError };
          const subBuilder: Record<string, unknown> = {};
          subBuilder['select'] = vi.fn(() => subBuilder);
          subBuilder['single'] = vi.fn(() => Promise.resolve(result));
          return subBuilder;
        }
        const d = data as { display_name?: string; slug?: string; metadata?: unknown };
        const subBuilder: Record<string, unknown> = {};
        subBuilder['select'] = vi.fn(() => subBuilder);
        subBuilder['single'] = vi.fn(() => Promise.resolve({
          data: {
            id: 'new-uuid',
            display_name: d?.display_name ?? 'X',
            slug: d?.slug ?? 'x',
            metadata: d?.metadata ?? {},
          },
          error: null,
        }));
        return subBuilder;
      });
      builder['update'] = vi.fn((data: unknown) => {
        calls.push({ op: 'update', args: data });
        const eqBuilder: Record<string, unknown> = {};
        eqBuilder['eq'] = vi.fn((_col: string, _val: unknown) => {
          if (opts.updateError) {
            return Promise.resolve({ data: null, error: opts.updateError });
          }
          return Promise.resolve({ data: null, error: null });
        });
        return eqBuilder;
      });
      builder['eq'] = vi.fn(() => builder);
      builder['ilike'] = vi.fn((_col: string, val: string) => {
        calls.push({ op: 'ilike', args: val });
        const sub: Record<string, unknown> = {};
        sub['limit'] = vi.fn(() => sub);
        sub['maybeSingle'] = vi.fn(() => {
          if (opts.existing && opts.existing.slug === val.toLowerCase()) {
            return Promise.resolve({ data: opts.existing, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        });
        sub['single'] = vi.fn(() => {
          if (opts.existing && opts.existing.slug === val.toLowerCase()) {
            return Promise.resolve({ data: opts.existing, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        });
        return sub;
      });
      builder['limit'] = vi.fn(() => builder);
      builder['maybeSingle'] = vi.fn(() => Promise.resolve({ data: opts.existing ?? null, error: null }));
      builder['single'] = vi.fn(() => Promise.resolve({ data: opts.existing ?? null, error: null }));
      return builder;
    }),
  };

  return { supabase: supabase as unknown as SupabaseClient, calls };
}

function mockFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  const fetchSpy = vi.fn();
  for (const r of responses) {
    fetchSpy.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.ok === false ? 500 : 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    });
  }
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

describe('extractHeadliner', () => {
  it('splittar på " - " (mellanslag-bindestreck-mellanslag)', () => {
    expect(extractHeadliner('Rodrigo y Gabriela - Stockholm')).toEqual({
      headliner: 'Rodrigo y Gabriela',
      extraction_hint: false,
    });
  });

  it('splittar på " – " (em-dash)', () => {
    expect(extractHeadliner('Anna Netrebko – Operan')).toEqual({
      headliner: 'Anna Netrebko',
      extraction_hint: false,
    });
  });

  it('splittar på " / " (slash)', () => {
    expect(extractHeadliner('Berlin Philharmonics / Brahms Night')).toEqual({
      headliner: 'Berlin Philharmonics',
      extraction_hint: false,
    });
  });

  it('splittar på " | " (pipe)', () => {
    expect(extractHeadliner('Opeth | Stockholm')).toEqual({
      headliner: 'Opeth',
      extraction_hint: false,
    });
  });

  it('splittar på ", " (komma)', () => {
    expect(extractHeadliner('Yo-Yo Ma, Bach Cello Suites')).toEqual({
      headliner: 'Yo-Yo Ma',
      extraction_hint: false,
    });
  });

  it('splittar på " · " (mellanslag-punkt-mellanslag)', () => {
    expect(extractHeadliner('Kraftwerk · Stockholm')).toEqual({
      headliner: 'Kraftwerk',
      extraction_hint: false,
    });
  });

  it('returnerar hela titeln med hint=true om ingen separator', () => {
    expect(extractHeadliner('Piano Recital')).toEqual({
      headliner: 'Piano Recital',
      extraction_hint: true,
    });
  });

  it('returnerar tom headliner + hint=true för tom sträng', () => {
    expect(extractHeadliner('')).toEqual({ headliner: '', extraction_hint: true });
    expect(extractHeadliner('   ')).toEqual({ headliner: '', extraction_hint: true });
  });

  it('ignorerar separator i början (negativt index)', () => {
    // "- Stockholm" → inget headliner före separatorn
    expect(extractHeadliner('- Stockholm')).toEqual({
      headliner: '- Stockholm',
      extraction_hint: true,
    });
  });
});

describe('resolveArtist — happy path', () => {
  beforeEach(() => {
    setEnv('MUSICBRAINZ_USER_AGENT', 'EventPulse/1.0 (test@example.com)');
    setEnv('LASTFM_API_KEY', 'lf-test-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv('MUSICBRAINZ_USER_AGENT', ORIGINAL_ENV.MUSICBRAINZ_USER_AGENT);
    setEnv('LASTFM_API_KEY', ORIGINAL_ENV.LASTFM_API_KEY);
  });

  it('returnerar ResolvedArtist med klassisk kategori när MB + Last.fm ger classical-taggar', async () => {
    const fetchSpy = mockFetchSequence([
      { body: { artists: [{ id: 'mb-abc-123', name: 'Berlin Philharmonic', score: 99, type: 'Group' }] } },
      { body: { toptags: { tag: [
        { name: 'classical', count: 200 },
        { name: 'symphony', count: 150 },
        { name: 'orchestra', count: 100 },
      ] } } },
    ]);
    const { supabase } = makeSupabaseMock();
    const result = await resolveArtist('Berlin Philharmonic', supabase);

    expect(result).not.toBeNull();
    expect(result?.display_name).toBe('Berlin Philharmonic');
    expect(result?.mbid).toBe('mb-abc-123');
    expect(result?.category_slug).toBe('classical');
    expect(result?.confidence).toBe(0.95);
    expect(result?.high_confidence_category).toBe(true);
    expect(result?.matched_tags).toContain('classical');
    expect(result?.matched_tags).toContain('symphony');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returnerar ResolvedArtist utan kategori när Last.fm-taggar är tvetydiga', async () => {
    mockFetchSequence([
      { body: { artists: [{ id: 'x', name: 'X', score: 90, type: 'Group' }] } },
      { body: { toptags: { tag: [{ name: 'classical', count: 50 }, { name: 'opera', count: 40 }] } } },
    ]);
    const { supabase } = makeSupabaseMock();
    const result = await resolveArtist('X', supabase);
    expect(result?.category_slug).toBeNull();
    expect(result?.confidence).toBe(0);
    expect(result?.high_confidence_category).toBe(false);
  });

  it('returnerar ResolvedArtist med catch-all musical när bara rock/pop-taggar finns', async () => {
    mockFetchSequence([
      { body: { artists: [{ id: 'x', name: 'Indie Band', score: 95, type: 'Group' }] } },
      { body: { toptags: { tag: [{ name: 'rock', count: 200 }, { name: 'indie', count: 150 }] } } },
    ]);
    const { supabase } = makeSupabaseMock();
    const result = await resolveArtist('Indie Band', supabase);
    expect(result?.category_slug).toBe('musical');
    expect(result?.confidence).toBe(0.70);
    expect(result?.high_confidence_category).toBe(false);
  });
});

describe('resolveArtist — fel-vägar', () => {
  beforeEach(() => {
    setEnv('MUSICBRAINZ_USER_AGENT', 'EventPulse/1.0 (test@example.com)');
    setEnv('LASTFM_API_KEY', 'lf-test-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv('MUSICBRAINZ_USER_AGENT', ORIGINAL_ENV.MUSICBRAINZ_USER_AGENT);
    setEnv('LASTFM_API_KEY', ORIGINAL_ENV.LASTFM_API_KEY);
  });

  it('returnerar null när MB saknar match', async () => {
    mockFetchSequence([{ body: { artists: [] } }]);
    const { supabase } = makeSupabaseMock();
    const result = await resolveArtist('Nobody Real', supabase);
    expect(result).toBeNull();
  });

  it('returnerar null när MB-anrop returnerar 503', async () => {
    mockFetchSequence([{ body: {}, ok: false }]);
    const { supabase } = makeSupabaseMock();
    const result = await resolveArtist('Anyone', supabase);
    expect(result).toBeNull();
  });

  it('returnerar ResolvedArtist utan kategori när Last.fm returnerar tom tag-lista', async () => {
    mockFetchSequence([
      { body: { artists: [{ id: 'x', name: 'NoTagArtist', score: 90, type: 'Group' }] } },
      { body: { toptags: { tag: [] } } },
    ]);
    const { supabase } = makeSupabaseMock();
    const result = await resolveArtist('NoTagArtist', supabase);
    expect(result).not.toBeNull();
    expect(result?.category_slug).toBeNull();
    expect(result?.confidence).toBe(0);
  });

  it('returnerar null vid tom headliner', async () => {
    const { supabase } = makeSupabaseMock();
    expect(await resolveArtist('', supabase)).toBeNull();
    expect(await resolveArtist('   ', supabase)).toBeNull();
  });

  it('returnerar null om supabase insert misslyckas (ej race condition)', async () => {
    mockFetchSequence([
      { body: { artists: [{ id: 'x', name: 'X', score: 90, type: 'Group' }] } },
      { body: { toptags: { tag: [{ name: 'classical', count: 100 }] } } },
    ]);
    const { supabase } = makeSupabaseMock({
      insertError: { code: '99999', message: 'generic db error' },
    });
    const result = await resolveArtist('X', supabase);
    expect(result).toBeNull();
  });

  it('hanterar race condition (23505) genom att refetcha befintlig artist', async () => {
    mockFetchSequence([
      { body: { artists: [{ id: 'x', name: 'Race Artist', score: 90, type: 'Group' }] } },
      { body: { toptags: { tag: [{ name: 'classical', count: 100 }, { name: 'symphony', count: 80 }] } } },
    ]);
    const existing = {
      id: 'race-uuid',
      display_name: 'Race Artist',
      slug: 'race-artist',
      metadata: {} as Record<string, unknown>,
    };
    const { supabase } = makeSupabaseMock({
      insertError: { code: '23505', message: 'unique_violation' },
      existing,
    });
    const result = await resolveArtist('Race Artist', supabase);
    expect(result).not.toBeNull();
    expect(result?.artist_id).toBe('race-uuid');
    expect(result?.category_slug).toBe('classical');
  });
});

describe('resolveArtist — befintlig artist uppdateras', () => {
  beforeEach(() => {
    setEnv('MUSICBRAINZ_USER_AGENT', 'EventPulse/1.0 (test@example.com)');
    setEnv('LASTFM_API_KEY', 'lf-test-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv('MUSICBRAINZ_USER_AGENT', ORIGINAL_ENV.MUSICBRAINZ_USER_AGENT);
    setEnv('LASTFM_API_KEY', ORIGINAL_ENV.LASTFM_API_KEY);
  });

  it('uppdaterar metadata.mbid om befintlig artist saknar det', async () => {
    mockFetchSequence([
      { body: { artists: [{ id: 'new-mbid', name: 'Existing Artist', score: 95, type: 'Group' }] } },
      { body: { toptags: { tag: [{ name: 'classical', count: 100 }, { name: 'symphony', count: 80 }] } } },
    ]);
    const existing = {
      id: 'existing-uuid',
      display_name: 'Existing Artist',
      slug: 'existing-artist',
      metadata: {} as Record<string, unknown>,
    };
    const { supabase } = makeSupabaseMock({ existing });
    const result = await resolveArtist('Existing Artist', supabase);
    expect(result?.artist_id).toBe('existing-uuid');
    expect(result?.mbid).toBe('new-mbid');
    expect(result?.category_slug).toBe('classical');
  });

  it('result.mbid reflekterar färsk MBID från MusicBrainz (även om persisted är gammal)', async () => {
    // resolveArtist returnerar mbid som MusicBrainz just levererade —
    // persistance-logiken "skriver inte över befintlig mbid" är separat.
    // Det här är medvetet: resultatet ska spegla vad vi faktiskt slog upp.
    mockFetchSequence([
      { body: { artists: [{ id: 'NEW-MBID', name: 'Existing Artist', score: 95, type: 'Group' }] } },
      { body: { toptags: { tag: [{ name: 'classical', count: 100 }] } } },
    ]);
    const existing = {
      id: 'existing-uuid',
      display_name: 'Existing Artist',
      slug: 'existing-artist',
      metadata: { mbid: 'OLD-MBID' } as Record<string, unknown>,
    };
    const { supabase, calls } = makeSupabaseMock({ existing });
    const result = await resolveArtist('Existing Artist', supabase);
    expect(result?.mbid).toBe('NEW-MBID'); // resultatet = vad vi just slog upp
    // men DB-uppdateringen ska INTE innehålla NEW-MBID (annars skriver vi över):
    const updateCall = calls.find((c) => c.op === 'update');
    const updatedMeta = (updateCall?.args as { metadata: Record<string, unknown> })?.metadata;
    expect(updatedMeta.mbid).toBe('OLD-MBID'); // persisted mbid är orörd
  });
});

describe('AUTO_WRITE_THRESHOLD', () => {
  it('är 0.80 (samma som Jevs rekommendation + användarens val)', () => {
    expect(AUTO_WRITE_THRESHOLD).toBe(0.80);
  });
});
