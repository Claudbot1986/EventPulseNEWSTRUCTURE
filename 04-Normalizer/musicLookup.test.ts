/**
 * musicLookup.test.ts — Tester för MusicBrainz + Last.fm wrappers.
 *
 * Coverar:
 *   1. musicBrainzLookup: korrekt URL + User-Agent, score-tröskel, null vid fel
 *   2. lastFmGetTopTags: korrekt URL-parametrar, filter på minCount, null vid fel
 *   3. parseLastFmTags: svar utan taggar, fel format, sortering
 *   4. pickBestArtist: MB-svar utan träff, under tröskel, korrekt plock
 *
 * Följer mönstret från 09-DiscoveryAgent/tests/exaLookup.test.ts (vitest
 * med global fetch-mock).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  musicBrainzLookup,
  lastFmGetTopTags,
  pickBestArtist,
  parseLastFmTags,
} from './musicLookup';

const ORIGINAL_ENV = { ...process.env };

function mockFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('musicBrainzLookup', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setEnv('MUSICBRAINZ_USER_AGENT', 'EventPulse/1.0 (test@example.com)');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv('MUSICBRAINZ_USER_AGENT', ORIGINAL_ENV.MUSICBRAINZ_USER_AGENT);
  });

  it('returnerar null när MUSICBRAINZ_USER_AGENT saknas', async () => {
    setEnv('MUSICBRAINZ_USER_AGENT', undefined);
    const result = await musicBrainzLookup('Rodrigo y Gabriela');
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returnerar null för tom headliner', async () => {
    const result = await musicBrainzLookup('   ');
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('anropar MB med korrekt URL och User-Agent header', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      artists: [{ id: 'abc-123', name: 'Rodrigo y Gabriela', score: 95, type: 'Group' }],
    }));
    const result = await musicBrainzLookup('Rodrigo y Gabriela');
    expect(result).not.toBeNull();
    expect(result?.mbid).toBe('abc-123');
    expect(result?.type).toBe('Group');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('musicbrainz.org/ws/2/artist');
    expect(url).toContain('fmt=json');
    expect(url).toContain('limit=5');
    expect(url).toContain(encodeURIComponent('artist:Rodrigo y Gabriela'));
    expect((opts as RequestInit).headers).toMatchObject({
      'User-Agent': 'EventPulse/1.0 (test@example.com)',
    });
  });

  it('returnerar null när MB-svar är 503 (rate limit)', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { ok: false, status: 503 }));
    const result = await musicBrainzLookup('Rodrigo y Gabriela');
    expect(result).toBeNull();
  });

  it('returnerar null när svaret inte är JSON', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ unexpected: 'shape' }));
    const result = await musicBrainzLookup('Nobody Real');
    expect(result).toBeNull();
  });

  it('returnerar null vid nätverksfel (fetch reject)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await musicBrainzLookup('Anyone');
    expect(result).toBeNull();
  });

  it('returnerar null om alla artister ligger under minScore', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      artists: [{ id: 'low-score', name: 'Someone', score: 50, type: 'Person' }],
    }));
    const result = await musicBrainzLookup('Someone', { minScore: 85 });
    expect(result).toBeNull();
  });

  it('plockar första artisten som är ≥ minScore (MB sorterar desc)', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      artists: [
        { id: 'high-1', name: 'Best Match', score: 99, type: 'Group' },
        { id: 'high-2', name: 'Second', score: 90, type: 'Group' },
      ],
    }));
    const result = await musicBrainzLookup('Best Match');
    expect(result?.mbid).toBe('high-1');
    expect(result?.score).toBe(99);
  });
});

describe('pickBestArtist', () => {
  it('plockar första kvalificerande artisten', () => {
    const body = {
      artists: [
        { id: 'a-1', name: 'X', score: 90, type: 'Group' },
        { id: 'a-2', name: 'Y', score: 50, type: 'Person' }, // under 85
      ],
    };
    const result = pickBestArtist(body, 'X', 85);
    expect(result?.mbid).toBe('a-1');
  });

  it('extraherar country från area.iso-3166-1-code', () => {
    const body = {
      artists: [
        { id: 'a-1', name: 'X', score: 90, type: 'Group', area: { 'iso-3166-1-code': ['SE'] } },
      ],
    };
    const result = pickBestArtist(body, 'X', 85);
    expect(result?.country).toBe('SE');
  });

  it('normaliserar type till Person/Group/Other/Unknown', () => {
    const cases: Array<[unknown, 'Person' | 'Group' | 'Other' | 'Unknown']> = [
      ['Person', 'Person'],
      ['Group', 'Group'],
      ['Orchestra', 'Other'],
      ['Choir', 'Other'],
      ['Other', 'Other'],
      [undefined, 'Unknown'],
      [42, 'Unknown'],
    ];
    for (const [raw, expected] of cases) {
      const body = { artists: [{ id: 'a', name: 'X', score: 90, type: raw }] };
      expect(pickBestArtist(body, 'X', 85)?.type).toBe(expected);
    }
  });

  it('returnerar null vid tom artists-array', () => {
    expect(pickBestArtist({ artists: [] }, 'X', 85)).toBeNull();
    expect(pickBestArtist({}, 'X', 85)).toBeNull();
    expect(pickBestArtist(null, 'X', 85)).toBeNull();
  });

  it('returnerar null vid fel saknad id/name/score', () => {
    const body = { artists: [{ id: 'a', name: 'X' }] }; // no score
    expect(pickBestArtist(body, 'X', 85)).toBeNull();
  });
});

describe('lastFmGetTopTags', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    setEnv('LASTFM_API_KEY', 'lf-test-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv('LASTFM_API_KEY', ORIGINAL_ENV.LASTFM_API_KEY);
  });

  it('returnerar null när LASTFM_API_KEY saknas', async () => {
    setEnv('LASTFM_API_KEY', undefined);
    const result = await lastFmGetTopTags('abc-123');
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('anropar Last.fm med korrekta parametrar (mbid, method, api_key, format)', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      toptags: {
        tag: [
          { name: 'classical', count: 142 },
          { name: 'symphony', count: 89 },
        ],
      },
    }));
    const result = await lastFmGetTopTags('abc-123');
    expect(result?.mbid).toBe('abc-123');
    expect(result?.tags).toHaveLength(2);
    expect(result?.tags[0]).toEqual({ name: 'classical', count: 142 });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('ws.audioscrobbler.com/2.0/');
    expect(url).toContain('method=artist.getTopTags');
    expect(url).toContain('mbid=abc-123');
    expect(url).toContain('api_key=lf-test-key-123');
    expect(url).toContain('format=json');
  });

  it('filtrerar bort taggar under minCount', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      toptags: {
        tag: [
          { name: 'classical', count: 100 }, // OK
          { name: 'seen live', count: 3 },   // bortfiltrerad
          { name: 'symphony', count: 5 },    // OK (== minCount)
        ],
      },
    }));
    const result = await lastFmGetTopTags('abc-123', { minCount: 5 });
    expect(result?.tags.map((t) => t.name)).toEqual(['classical', 'symphony']);
  });

  it('returnerar null vid HTTP-fel', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, { ok: false, status: 500 }));
    const result = await lastFmGetTopTags('abc-123');
    expect(result).toBeNull();
  });

  it('returnerar null när svaret saknar toptags.tag', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ toptags: {} }));
    const result = await lastFmGetTopTags('abc-123');
    expect(result).toBeNull();
  });

  it('returnerar null när alla taggar filtreras bort', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      toptags: { tag: [{ name: 'unheard', count: 1 }] },
    }));
    const result = await lastFmGetTopTags('abc-123', { minCount: 5 });
    expect(result).toBeNull();
  });
});

describe('parseLastFmTags', () => {
  it('sorterar taggar efter count desc', () => {
    const body = {
      toptags: {
        tag: [
          { name: 'B', count: 10 },
          { name: 'A', count: 100 },
          { name: 'C', count: 50 },
        ],
      },
    };
    const result = parseLastFmTags(body, 0, 10);
    expect(result?.map((t) => t.name)).toEqual(['A', 'C', 'B']);
  });

  it('begränsar till topN', () => {
    const body = {
      toptags: {
        tag: Array.from({ length: 50 }, (_, i) => ({ name: `tag-${i}`, count: 100 - i })),
      },
    };
    const result = parseLastFmTags(body, 0, 5);
    expect(result).toHaveLength(5);
    expect(result?.[0].name).toBe('tag-0');
  });

  it('skippar taggar med fel format (name saknas, count är NaN)', () => {
    const body = {
      toptags: {
        tag: [
          { name: 'good', count: 10 },
          { count: 5 },                          // no name
          { name: 'bad-count' },                 // no count
          { name: 'nan-count', count: 'lots' },  // non-numeric count
          null,
        ],
      },
    };
    const result = parseLastFmTags(body, 0, 10);
    expect(result?.map((t) => t.name)).toEqual(['good']);
  });

  it('returnerar null vid tom tag-lista', () => {
    expect(parseLastFmTags({ toptags: { tag: [] } }, 0, 10)).toBeNull();
    expect(parseLastFmTags({ toptags: {} }, 0, 10)).toBeNull();
    expect(parseLastFmTags(null, 0, 10)).toBeNull();
  });
});
