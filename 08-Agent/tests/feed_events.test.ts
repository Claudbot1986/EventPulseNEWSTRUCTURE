/**
 * Tests for feed_events — browse-window reader for the default-browse UI.
 *
 * Option A (2026-10-14): feed_events was rewritten to use direct PostgREST
 * fetch() instead of supabase-js. The legacy supabase-js chain-mock tests
 * no longer fit, so this file mocks `global.fetch` with a small in-memory
 * dispatcher that mirrors PostgREST's response shape:
 *   - GET → JSON body, no headers
 *   - HEAD → Content-Range: 0-0/TOTAL header
 *
 * Covers the production-critical behaviors only: date window, pagination,
 * count semantics, mood/category/free filter wiring, and the editorial flow
 * that option A fixes (supabase-js OpenAPI cache silently dropped the new
 * columns; direct fetch returns them).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  feedEvents,
  addDays,
  todayIso,
  buildSearchOrFilter,
  FEED_EVENTS_TABLE,
} from '../tools/feed_events';

// Minimal env vars so pgBaseUrl()/pgKey() don't throw.
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://postgrest.test';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-key';

interface PendingResponse {
  status?: number;
  body?: any;
  contentRange?: string | null;
}

const fetchMock = vi.fn<(input: any, init?: any) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  // Default: empty 200 with no content-range. Individual tests override.
  fetchMock.mockImplementation(async () => new Response('[]', { status: 200 }));
});

// @ts-expect-error — assignment for vi.fn mock; node 25 fetch is global.
global.fetch = fetchMock as any;

/** Convenience: build a JSON response with a synthetic content-range header. */
function jsonResponse(body: any, contentRange?: string | null): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (contentRange !== undefined && contentRange !== null) {
    headers['content-range'] = contentRange;
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/** Convenience: a HEAD-style response with only content-range. */
function emptyWithCount(n: number): Response {
  return new Response(null, {
    status: 200,
    headers: { 'content-range': `0-0/${n}` },
  });
}

/** Helper: build a synthetic events_public row that the legacy mocks
 *  emitted — preserves the full EventCard mapping coverage. */
function makeRow(overrides: Partial<Record<string, any>> = {}): Record<string, any> {
  const base: Record<string, any> = {
    id: 'evt-1',
    title_sv: 'Svensk titel',
    title_en: 'English title',
    description_sv: null,
    description_en: null,
    eventpulse_summary: null,
    editorial_description: 'Editorial text.',
    event_profile: { profile: {}, version: 1 },
    start_time: '2026-11-01T18:00:00.000Z',
    end_time: null,
    venue_id: 'venue-1',
    category_slug: 'music',
    is_free: false,
    price_min_sek: 150,
    price_max_sek: 200,
    ticket_url: null,
    image_url: null,
    image_license: null,
    image_attribution: null,
    image_source_url: null,
    image_ai_generated: false,
    image_ai_optout: false,
    image_generation_status: null,
    confidence_score: 0.9,
    freshness_at: '2026-10-14T00:00:00Z',
    lat: 59.33,
    lng: 18.07,
    is_online: false,
    online_url: null,
    source: 'kulturbiljetter',
    venues: { name: 'Konserthuset', city: 'Stockholm' },
  };
  // overrides may include explicit nulls — `??` would replace them with the
  // default; we use `in` so test fixtures can null-out a field.
  for (const [k, v] of Object.entries(overrides)) {
    base[k] = v;
  }
  return base;
}

describe('addDays', () => {
  it('adds days correctly across months', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });
  it('returns input unchanged for invalid date', () => {
    expect(addDays('not-a-date', 5)).toBe('not-a-date');
  });
});

describe('todayIso', () => {
  it('returns YYYY-MM-DD shape', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('buildSearchOrFilter', () => {
  it('returns null for empty / whitespace / null input', () => {
    expect(buildSearchOrFilter(null)).toBeNull();
    expect(buildSearchOrFilter('')).toBeNull();
    expect(buildSearchOrFilter('   ')).toBeNull();
  });
  it('builds single-term .or() filter against title + description (sv/en)', () => {
    expect(buildSearchOrFilter('konsert')).toBe(
      'title_sv.ilike.%konsert%,title_en.ilike.%konsert%,description_sv.ilike.%konsert%,description_en.ilike.%konsert%',
    );
  });
  it('strips PostgREST syntax characters', () => {
    expect(buildSearchOrFilter('50%')).toBe(
      'title_sv.ilike.%50%,title_en.ilike.%50%,description_sv.ilike.%50%,description_en.ilike.%50%',
    );
  });
});

describe('feedEvents — date window + pagination', () => {
  it('honors [from, to] and sends a +1 sentinel for has_more', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      const isCount =
        (init as any)?.method === 'HEAD' || u.searchParams.get('Range-Unit') === 'items';
      if (!isCount && u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        // Data read.
        const rows = Array.from({ length: 6 }, (_, i) =>
          makeRow({ id: `evt-${i}`, start_time: `2026-11-0${i + 1}T18:00:00.000Z` }),
        );
        // Verify the request has the +1 sentinel row.
        expect(u.searchParams.get('limit')).toBe('6'); // limit=5 + 1
        return jsonResponse(rows);
      }
      // Count read.
      return emptyWithCount(120);
    });

    const result = await feedEvents({} as any, {
      from: '2026-11-01',
      limit: 5,
    });

    expect(result.events).toHaveLength(5);
    expect(result.has_more).toBe(true);
    expect(result.total).toBe(120);
  });

  it('clears has_more when the row count fits within limit', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      const isCount =
        (init as any)?.method === 'HEAD' || u.searchParams.get('Range-Unit') === 'items';
      if (!isCount && u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        const rows = [makeRow({ id: 'evt-A' }), makeRow({ id: 'evt-B' })];
        // limit param is limit+1 over-fetch (5+1=6).
        expect(u.searchParams.get('limit')).toBe('6');
        return jsonResponse(rows); // 2 < 6 sentinel → has_more=false
      }
      return emptyWithCount(2);
    });

    const result = await feedEvents({} as any, { from: '2026-11-01', limit: 5 });
    expect(result.events).toHaveLength(2);
    expect(result.has_more).toBe(false);
    expect(result.total).toBe(2);
  });

  it('passes start_time.gt.now AND start_time.gte.from AND start_time.lte.to (AND via duplicates)', async () => {
    let capturedUrl: URL | null = null;
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (!u.searchParams.has('Range-Unit')) {
        capturedUrl = u;
        return jsonResponse([makeRow()]);
      }
      return emptyWithCount(1);
    });

    await feedEvents({} as any, { from: '2026-11-01', days: 7 });

    expect(capturedUrl).not.toBeNull();
    const startTimes = capturedUrl!.searchParams.getAll('start_time');
    // 3 constraints — 1 gt (now), 1 gte (from floor), 1 lte (to ceil).
    expect(startTimes).toHaveLength(3);
    expect(startTimes.some((v) => v.startsWith('gt.'))).toBe(true);
    expect(startTimes.some((v) => v.startsWith('gte.2026-11-01'))).toBe(true);
    expect(startTimes.some((v) => v.startsWith('lte.'))).toBe(true);
  });
});

describe('feedEvents — count semantics', () => {
  it('window-bounds the count when isFree is set (non-pure-category)', async () => {
    let countUrl: URL | null = null;
    fetchMock.mockImplementation(async (url, init) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      const isCount =
        (init as any)?.method === 'HEAD' || u.searchParams.get('Range-Unit') === 'items';
      if (!isCount) return jsonResponse([]);
      countUrl = u;
      return emptyWithCount(42);
    });

    // category + isFree → not pure-category → lte constrained (matches
    // header count to what the user actually scrolls through).
    const r = await feedEvents({} as any, {
      from: '2026-11-01',
      days: 7,
      category: 'music',
      isFree: true,
    });
    expect(r.total).toBe(42);
    const sts = countUrl!.searchParams.getAll('start_time');
    expect(sts.some((v) => v.startsWith('lte.'))).toBe(true);
  });

  it('pure-category requests skip the upper bound so total = all future events', async () => {
    let countUrl: URL | null = null;
    fetchMock.mockImplementation(async (url, init) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      const isCount =
        (init as any)?.method === 'HEAD' || u.searchParams.get('Range-Unit') === 'items';
      if (!isCount) return jsonResponse([makeRow()]);
      countUrl = u;
      return emptyWithCount(274);
    });

    const r = await feedEvents({} as any, {
      from: '2026-11-01',
      days: 7,
      category: 'opera',
    });
    expect(r.total).toBe(274);
    // No lte constraint on the count URL.
    const sts = countUrl!.searchParams.getAll('start_time');
    expect(sts.some((v) => v.startsWith('lte.'))).toBe(false);
  });

  it('falls back to GET when HEAD returns 4xx/5xx (PostgREST quirk) and reports the count header', async () => {
    let headAttempted = false;
    fetchMock.mockImplementation(async (url, init) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      const method = (init as any)?.method ?? 'GET';
      const hdrs = (init as any)?.headers ?? {};
      if (method === 'HEAD' && u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        headAttempted = true;
        // 405 Method Not Allowed → pgCount falls back to GET + Range.
        return new Response('', { status: 405 });
      }
      if (
        method === 'GET' &&
        u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`) &&
        hdrs['Range-Unit'] === 'items'
      ) {
        // GET fallback for count: returns Content-Range header.
        return new Response('[]', {
          status: 200,
          headers: { 'content-range': '0-0/77' },
        });
      }
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    const r = await feedEvents({} as any, { from: '2026-11-01' });
    expect(headAttempted).toBe(true);
    expect(r.total).toBe(77);
  });
});

describe('feedEvents — city filter', () => {
  it('keeps rows whose venue city matches and drops the rest', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (u.searchParams.has('Range-Unit')) return emptyWithCount(0);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        return jsonResponse([
          makeRow({ id: 'a', venues: { name: 'A', city: 'Stockholm' } }),
          makeRow({ id: 'b', venues: { name: 'B', city: 'Göteborg' } }),
          makeRow({ id: 'c', venues: { name: 'C', city: null } }),
        ]);
      }
      return jsonResponse([]);
    });

    const r = await feedEvents({} as any, { from: '2026-11-01', city: 'Stockholm' });
    expect(r.events.map((e) => e.id)).toEqual(['a']);
  });
});

describe('feedEvents — title/description priority', () => {
  it('uses sv title over en', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (u.pathname.endsWith('/event_translations')) return jsonResponse([]);
      if (u.searchParams.has('Range-Unit')) return emptyWithCount(0);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        return jsonResponse([
          makeRow({
            id: 'a',
            title_sv: 'Svenska A',
            title_en: 'English A',
            description_sv: 'Beskrivning SV',
            description_en: 'Description EN',
            eventpulse_summary: null,
          }),
        ]);
      }
      return jsonResponse([]);
    });
    const r = await feedEvents({} as any, { from: '2026-11-01' });
    expect(r.events[0].title).toBe('Svenska A');
    expect(r.events[0].description).toBe('Beskrivning SV');
  });

  it('falls back to en when sv is null', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (u.pathname.endsWith('/event_translations')) return jsonResponse([]);
      if (u.searchParams.has('Range-Unit')) return emptyWithCount(0);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        return jsonResponse([
          makeRow({
            id: 'a',
            title_sv: null,
            title_en: 'English A',
            description_sv: null,
            description_en: 'Description EN',
            eventpulse_summary: null,
          }),
        ]);
      }
      return jsonResponse([]);
    });
    const r = await feedEvents({} as any, { from: '2026-11-01' });
    expect(r.events[0].title).toBe('English A');
    expect(r.events[0].description).toBe('Description EN');
  });

  it('prefers eventpulse_summary when present', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (u.pathname.endsWith('/event_translations')) return jsonResponse([]);
      if (u.searchParams.has('Range-Unit')) return emptyWithCount(0);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        return jsonResponse([
          makeRow({
            id: 'a',
            description_sv: 'Beskrivning SV',
            eventpulse_summary: 'FACT-beskrivning.',
          }),
        ]);
      }
      return jsonResponse([]);
    });
    const r = await feedEvents({} as any, { from: '2026-11-01' });
    expect(r.events[0].description).toBe('FACT-beskrivning.');
  });
});

describe('feedEvents — editorial_description + event_profile flow (option A)', () => {
  it('passes editorial_description and event_profile through to the card', async () => {
    const editorial = 'Dave Keller live at Hartwig. Typ: music. Pris: 125 kr.';
    const profile = { profile: { genres: ['musik'], event_type: 'music' }, version: 1 };
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (u.pathname.endsWith('/event_translations')) return jsonResponse([]);
      if (u.searchParams.has('Range-Unit')) return emptyWithCount(0);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        return jsonResponse([
          makeRow({
            id: 'a',
            editorial_description: editorial,
            event_profile: profile,
          }),
        ]);
      }
      return jsonResponse([]);
    });
    const r = await feedEvents({} as any, { from: '2026-11-01' });
    expect(r.events[0].editorial_description).toBe(editorial);
    expect(r.events[0].event_profile).toEqual(profile);
  });

  it('sends editorial_description + event_profile in the SELECT column list', async () => {
    let dataUrl: URL | null = null;
    fetchMock.mockImplementation(async (url, init) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      const isCount =
        (init as any)?.method === 'HEAD' || u.searchParams.get('Range-Unit') === 'items';
      if (isCount) return emptyWithCount(0);
      if (u.pathname.endsWith(`/event_translations`)) return jsonResponse([]);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) {
        dataUrl = u;
        return jsonResponse([makeRow()]);
      }
      return jsonResponse([]);
    });
    await feedEvents({} as any, { from: '2026-11-01' });
    const select = dataUrl!.searchParams.get('select') ?? '';
    // Pre-option-A these columns were silently dropped by supabase-js.
    expect(select).toContain('editorial_description');
    expect(select).toContain('event_profile');
  });
});

describe('feedEvents — withArtistSlugs', () => {
  it('does not call event_artists when withArtistSlugs is not set', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (u.searchParams.has('Range-Unit')) return emptyWithCount(0);
      if (u.pathname.endsWith(`/${FEED_EVENTS_TABLE}`)) return jsonResponse([makeRow()]);
      if (u.pathname.endsWith('/event_artists')) {
        throw new Error('event_artists read should not happen without withArtistSlugs');
      }
      return jsonResponse([]);
    });
    await expect(
      feedEvents({} as any, { from: '2026-11-01' }),
    ).resolves.toBeDefined();
    const calls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes('/event_artists'))).toBe(false);
  });
});
