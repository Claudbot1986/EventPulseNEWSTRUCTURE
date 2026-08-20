/**
 * Unit tests for `tools/url_variants.ts`.
 *
 * Coverage:
 *   - generateVariants: www/non-www, https/http, trailing slash, /index.html
 *   - generateVariants: idempotent (no duplicate variants in output)
 *   - generateVariants: invalid URL → returns [original]
 *   - testVariants: returns no-fetch results when fetchImpl is omitted
 *   - testVariants: returns winner when one variant returns 2xx
 *   - testVariants: respects maxVariants cap
 *   - testVariants: handles errors as data (timeout, dns-fail, ssl-fail)
 *   - shouldTestVariants: only true for redirect/SSL/ENOTFOUND + cf>=5
 *   - variantToProposal: returns null when no winner
 *   - variantToProposal: returns proposal when winner is a real variant
 *   - variantToProposal: returns null when winner equals original
 */

import { describe, expect, it } from 'vitest';
import {
  generateVariants,
  testVariants,
  shouldTestVariants,
  variantToProposal,
  type FetchLike,
} from '../tools/url_variants';

describe('generateVariants', () => {
  it('produces www + http + trailing-slash + index.html variants for non-www input', () => {
    const v = generateVariants('https://example.com/events');
    const kinds = v.map((x) => x.kind).sort();
    expect(kinds).toContain('original');
    expect(kinds).toContain('www');
    // non-www skipped because input is already non-www (would duplicate)
    expect(kinds).not.toContain('non-www');
    expect(kinds).toContain('http');
    expect(kinds).toContain('trailing-slash');
    expect(kinds).toContain('index-html');
    for (const variant of v) {
      expect(() => new URL(variant.url)).not.toThrow();
    }
  });

  it('produces non-www + http + trailing-slash + index-html variants for www input', () => {
    const v = generateVariants('https://www.example.com/events');
    const kinds = v.map((x) => x.kind).sort();
    expect(kinds).toContain('original');
    expect(kinds).toContain('non-www');
    // www skipped because input already has www
    expect(kinds).not.toContain('www');
    // http added (input is https); https would duplicate
    expect(kinds).toContain('http');
    expect(kinds).not.toContain('https');
    expect(kinds).toContain('trailing-slash');
    expect(kinds).toContain('index-html');
    for (const variant of v) {
      expect(() => new URL(variant.url)).not.toThrow();
    }
  });

  it('returns just [original] for invalid URL', () => {
    const v = generateVariants('not a url');
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('original');
  });

  it('is idempotent — no duplicate variants', () => {
    const v = generateVariants('https://example.com/events');
    const urls = v.map((x) => x.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('strips www when generating non-www variant from www input', () => {
    const v = generateVariants('https://www.example.com/events');
    const nonWww = v.find((x) => x.kind === 'non-www');
    expect(nonWww?.url).toBe('https://example.com/events');
  });

  it('adds www when generating www variant from non-www input', () => {
    const v = generateVariants('https://example.com/events');
    const www = v.find((x) => x.kind === 'www');
    expect(www?.url).toBe('https://www.example.com/events');
  });

  it('switches scheme between http and https', () => {
    const v = generateVariants('https://example.com/events');
    expect(v.find((x) => x.kind === 'http')?.url).toBe('http://example.com/events');
    const v2 = generateVariants('http://example.com/events');
    expect(v2.find((x) => x.kind === 'https')?.url).toBe('https://example.com/events');
  });
});

describe('testVariants', () => {
  it('returns no-fetch results when fetchImpl is omitted', async () => {
    const summary = await testVariants('https://example.com/events');
    expect(summary.winner).toBeNull();
    expect(summary.results.length).toBeGreaterThan(0);
    for (const r of summary.results) {
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('no-fetch');
      expect(r.status).toBeNull();
    }
  });

  it('returns winner when one variant returns 2xx', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('www.example.com')) return { status: 200, url };
      return { status: 404, url };
    };
    const summary = await testVariants('https://example.com/events', { fetchImpl });
    expect(summary.winner).not.toBeNull();
    expect(summary.winner?.variant.kind).toBe('www');
    expect(summary.winner?.status).toBe(200);
  });

  it('returns null winner when all variants fail', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ENOTFOUND example.com');
    };
    const summary = await testVariants('https://example.com/events', { fetchImpl });
    expect(summary.winner).toBeNull();
    expect(summary.results.every((r) => r.reason === 'dns-fail')).toBe(true);
  });

  it('respects maxVariants cap', async () => {
    let callCount = 0;
    const fetchImpl: FetchLike = async (url) => {
      callCount++;
      return { status: 200, url };
    };
    await testVariants('https://example.com/events', { fetchImpl, maxVariants: 2 });
    expect(callCount).toBe(2);
  });

  it('classifies SSL errors as ssl-fail', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('SSL routines: certificate verify failed');
    };
    const summary = await testVariants('https://example.com/events', { fetchImpl });
    expect(summary.results[0].reason).toBe('ssl-fail');
  });

  it('classifies timeout errors as timeout', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('The operation was aborted');
    };
    const summary = await testVariants('https://example.com/events', { fetchImpl });
    expect(summary.results[0].reason).toBe('timeout');
  });

  it('records 4xx as http-{status} reason', async () => {
    const fetchImpl: FetchLike = async () => ({ status: 404, url: '' });
    const summary = await testVariants('https://example.com/events', { fetchImpl });
    expect(summary.results[0].reason).toBe('http-404');
    expect(summary.results[0].ok).toBe(false);
  });

  it('totalDurationMs reflects actual elapsed time', async () => {
    const fetchImpl: FetchLike = async (url) => {
      await new Promise((r) => setTimeout(r, 10));
      return { status: 200, url };
    };
    const summary = await testVariants('https://example.com/events', { fetchImpl, maxVariants: 2 });
    expect(summary.totalDurationMs).toBeGreaterThanOrEqual(20);
  });
});

describe('shouldTestVariants', () => {
  it('returns true for redirect + cf>=5', () => {
    expect(shouldTestVariants('REDIRECT LOOP exceeded 30 redirects', 10)).toBe(true);
    expect(shouldTestVariants('Exceeded 3 redirects', 5)).toBe(true);
  });

  it('returns true for SSL + cf>=5', () => {
    expect(shouldTestVariants('unable to verify the first certificate', 8)).toBe(true);
  });

  it('returns true for ENOTFOUND + cf>=5', () => {
    expect(shouldTestVariants('getaddrinfo ENOTFOUND foo.example', 12)).toBe(true);
  });

  it('returns true for timeout + cf>=5', () => {
    expect(shouldTestVariants('timeout of 20000ms exceeded', 7)).toBe(true);
  });

  it('returns false for NO_JSONLD (not a transport error)', () => {
    expect(shouldTestVariants('toolA: no-jsonld-or-no-events', 15)).toBe(false);
  });

  it('returns false for cf<5 (too few failures to bother)', () => {
    expect(shouldTestVariants('REDIRECT LOOP', 2)).toBe(false);
    expect(shouldTestVariants('SSL error', 4)).toBe(false);
  });

  it('returns false when lastRoutingReason is null', () => {
    expect(shouldTestVariants(null, 10)).toBe(false);
  });
});

describe('variantToProposal', () => {
  it('returns null when winner is null', () => {
    const proposal = variantToProposal('foo', {
      baseUrl: 'https://example.com/events',
      results: [],
      winner: null,
      totalDurationMs: 0,
    });
    expect(proposal).toBeNull();
  });

  it('returns proposal when winner has 2xx status and differs from original', () => {
    const proposal = variantToProposal('foo', {
      baseUrl: 'https://example.com/events',
      results: [],
      winner: {
        variant: { url: 'https://www.example.com/events', kind: 'www' },
        ok: true,
        status: 200,
        reason: 'ok',
        durationMs: 50,
      },
      totalDurationMs: 50,
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.proposal.action).toBe('update-url');
    expect(proposal!.proposal.before.url).toBe('https://example.com/events');
    expect(proposal!.proposal.after.url).toBe('https://www.example.com/events');
    expect(proposal!.proposal.confidence).toBe('high');
    expect(proposal!.proposal.needsHumanReview).toBe(false);
  });

  it('returns null when winner equals original URL (no change needed)', () => {
    const proposal = variantToProposal('foo', {
      baseUrl: 'https://example.com/events',
      results: [],
      winner: {
        variant: { url: 'https://example.com/events', kind: 'original' },
        ok: true,
        status: 200,
        reason: 'ok',
        durationMs: 50,
      },
      totalDurationMs: 50,
    });
    expect(proposal).toBeNull();
  });
});