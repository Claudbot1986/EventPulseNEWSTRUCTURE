import { describe, expect, it, vi } from 'vitest';
import { FailCategory } from '../C4-ai-analysis.js';
import { resolveSuggestedSubpageUrl, screenUrlWithDerivedRules } from './C1-preHtmlGate.js';
import { fetchHtml } from '../../tools/fetchTools.js';

vi.mock('../../tools/fetchTools.js', () => ({
  fetchHtml: vi.fn(),
}));

describe('resolveSuggestedSubpageUrl', () => {
  it('resolves relative suggested paths against the source origin', () => {
    expect(resolveSuggestedSubpageUrl('https://alltommat.se/recept/', '/evenemang')).toBe(
      'https://alltommat.se/evenemang'
    );
  });

  it('keeps absolute suggested URLs intact instead of prefixing the source origin', () => {
    expect(
      resolveSuggestedSubpageUrl('https://alltommat.se/', 'https://alltommat.expressen.se/')
    ).toBe('https://alltommat.expressen.se/');
  });

  it('returns null for malformed suggested URLs', () => {
    expect(resolveSuggestedSubpageUrl('https://alltommat.se/', 'http://[broken')).toBeNull();
  });

  it('returns null for already-concatenated malformed absolute URLs', () => {
    expect(
      resolveSuggestedSubpageUrl(
        'https://alltommat.se/',
        'https://alltommat.sehttps://alltommat.expressen.se/'
      )
    ).toBeNull();
  });

  it('returns null for non-HTTP absolute URLs', () => {
    expect(resolveSuggestedSubpageUrl('https://alltommat.se/', 'mailto:test@example.com')).toBeNull();
    expect(resolveSuggestedSubpageUrl('https://alltommat.se/', 'javascript:alert(1)')).toBeNull();
  });
});

describe('screenUrlWithDerivedRules', () => {
  it('skips invalid derived-rule subpages before adding them to testedSubpages', async () => {
    const mockedFetchHtml = vi.mocked(fetchHtml);
    mockedFetchHtml.mockResolvedValue({
      success: true,
      html: '<html><body>No main content here</body></html>',
    });

    const derivedRules = new Map([
      [
        `allt-om-mat__${FailCategory.NEEDS_SUBPAGE_DISCOVERY}`,
        {
          sourceId: 'allt-om-mat',
          failCategory: FailCategory.NEEDS_SUBPAGE_DISCOVERY,
          suggestedPaths: [
            'https://alltommat.sehttps://alltommat.expressen.se/',
            'mailto:test@example.com',
            'https://alltommat.expressen.se/',
          ],
          suggestedRules: [],
          suggestedQueue: 'retry-pool' as const,
          confidence: 0.9,
          createdAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    ]);

    const result = await screenUrlWithDerivedRules(
      'allt-om-mat',
      'https://alltommat.se/',
      derivedRules
    );

    expect(result.testedSubpages).toEqual(['https://alltommat.expressen.se/']);
    expect(mockedFetchHtml).toHaveBeenCalledWith('https://alltommat.se/', { timeout: 15000 });
    expect(mockedFetchHtml).toHaveBeenCalledWith('https://alltommat.expressen.se/', {
      timeout: 15000,
    });
    expect(mockedFetchHtml).not.toHaveBeenCalledWith(
      'https://alltommat.sehttps://alltommat.expressen.se/',
      expect.anything()
    );
    expect(mockedFetchHtml).not.toHaveBeenCalledWith('mailto:test@example.com', expect.anything());
  });
});
