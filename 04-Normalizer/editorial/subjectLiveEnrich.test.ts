/**
 * subjectLiveEnrich.test.ts — verifierar Wikidata live-uppslag.
 * Mockar fetch för att undvika riktiga nätverksanrop.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  lookupSubjectLive,
  lookupSubjectsLive,
  __resetSubjectLiveCacheForTests,
} from './subjectLiveEnrich';

const REAL_FETCH = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetSubjectLiveCacheForTests();
  mockFetch = vi.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = REAL_FETCH;
});

function mockWikidataResponse(qid: string, label: string, opts: {
  country?: string;
  language?: string;
  inception?: string;
} = {}) {
  return {
    results: {
      bindings: [
        {
          item: { value: `http://www.wikidata.org/entity/${qid}` },
          itemLabel: { value: label },
          itemDescription: { value: `${label} description` },
          country: opts.country ? { value: `http://www.wikidata.org/entity/${opts.country}` } : undefined,
          language: opts.language ? { value: `http://www.wikidata.org/entity/${opts.language}` } : undefined,
          inception: opts.inception ? { value: opts.inception } : undefined,
        },
      ],
    },
  };
}

describe('subjectLiveEnrich', () => {
  describe('curated JSON har förtur', () => {
    it('Hamlet returneras från curated JSON, INTE från Wikidata', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockWikidataResponse('Q99999', 'Different Hamlet', { country: 'Q30' }),
      });
      const r = await lookupSubjectLive('Hamlet');
      expect(r?.wikidata_id).toBe('Q41567'); // curated value
      expect(r?.metadata?.author).toBe('William Shakespeare'); // curated
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('live cache', () => {
    it('cache-hit returnerar utan fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockWikidataResponse('Q12345', 'Some Work'),
      });
      await lookupSubjectLive('Some Unknown Work');
      await lookupSubjectLive('Some Unknown Work');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('cache-null cachelagrar misslyckad lookup', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: { bindings: [] } }) });
      await lookupSubjectLive('Nothing Here');
      await lookupSubjectLive('Nothing Here');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful degradation', () => {
    it('null vid null/empty input', async () => {
      expect(await lookupSubjectLive(null)).toBeNull();
      expect(await lookupSubjectLive('')).toBeNull();
      expect(await lookupSubjectLive('   ')).toBeNull();
    });

    it('null när Wikidata returnerar tomt', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: { bindings: [] } }) });
      const r = await lookupSubjectLive('No Such Subject');
      expect(r).toBeNull();
    });

    it('null när HTTP 503', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });
      const r = await lookupSubjectLive('Some Subject');
      expect(r).toBeNull();
    });

    it('null vid timeout/fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network timeout'));
      const r = await lookupSubjectLive('Some Subject');
      expect(r).toBeNull();
    });
  });

  describe('Wikidata → SubjectEntry mapping', () => {
    it('mappar Q-id, label, country=SE, language=en', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockWikidataResponse('Q99999', 'Test Subject', {
          country: 'Q34', // SE
          language: 'Q1860', // en
          inception: '1900-01-01T00:00:00Z',
        }),
      });
      const r = await lookupSubjectLive('Test Subject');
      expect(r).not.toBeNull();
      expect(r?.wikidata_id).toBe('Q99999');
      expect(r?.name).toBe('Test Subject');
      expect(r?.country).toBe('SE');
      expect(r?.language).toBe('en');
      expect(r?.inception_year).toBe(1900);
      expect(r?._source.license).toBe('CC0');
      expect(r?._source.primary).toBe('wikidata');
    });

    it('mappar Q-id utan country/language', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockWikidataResponse('Q88888', 'Minimal Subject'),
      });
      const r = await lookupSubjectLive('Minimal Subject');
      expect(r?.country).toBeUndefined();
      expect(r?.language).toBeUndefined();
    });
  });

  describe('User-Agent header', () => {
    it('skickar EventPulse User-Agent', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: { bindings: [] } }) });
      await lookupSubjectLive('Test');
      const callArgs = mockFetch.mock.calls[0];
      const url = callArgs[0] as URL;
      expect(url).toBeInstanceOf(URL);
      expect(url.searchParams.get('query')).toBeTruthy();
      expect(url.searchParams.get('format')).toBe('json');
      const opts = callArgs[1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['User-Agent']).toContain('EventPulse');
      expect(headers['Accept']).toContain('sparql-results');
    });
  });

  describe('rate-limit', () => {
    it('sekventiella anrop respekterar 200ms gap', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: { bindings: [] } }) });
      const start = Date.now();
      await lookupSubjectLive('Subject A');
      await lookupSubjectLive('Subject B');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(200);
    });
  });

  describe('lookupSubjectsLive batch', () => {
    it('blandad curated + live', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockWikidataResponse('Q12345', 'Live Subject'),
      });
      const r = await lookupSubjectsLive(['Hamlet', 'Live Subject', null]);
      expect(r['Hamlet']?.metadata?.author).toBe('William Shakespeare'); // curated
      expect(r['Live Subject']?.wikidata_id).toBe('Q12345'); // live
      expect(r['']).toBeUndefined(); // null-filter
    });
  });
});
