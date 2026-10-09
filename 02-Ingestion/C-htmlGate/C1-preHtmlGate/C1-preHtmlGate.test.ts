import { describe, expect, it, vi } from 'vitest';
import { FailCategory } from '../C4-ai-analysis.js';
import { resolveSuggestedSubpageUrl, screenUrl, screenUrlWithDerivedRules } from './C1-preHtmlGate.js';
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

describe('screenUrl — alternative main-content fallback (Väg A)', () => {
  it('accepts <div class="content"> as alt-main (no <main>, no <article>)', async () => {
    const mockedFetchHtml = vi.mocked(fetchHtml);
    mockedFetchHtml.mockResolvedValue({
      success: true,
      html: '<html><body><header>Logo</header><div class="content"><h1>Konsert 2026-10-15</h1><time datetime="2026-10-15T19:00">19:00</time></div></body></html>',
    });

    const result = await screenUrl('https://example.com/events/');

    expect(result.fetchable).toBe(true);
    expect(result.hasMain).toBe(false);
    expect(result.hasArticle).toBe(false);
    expect(result.hasAltMain).toBe(true);
    expect(result.categorization).not.toBe('no-main');
  });

  it('accepts <section id="main-content"> as alt-main', async () => {
    const mockedFetchHtml = vi.mocked(fetchHtml);
    mockedFetchHtml.mockResolvedValue({
      success: true,
      html: '<html><body><nav>Menu</nav><section id="main-content"><h1>Festival 2026-10-20</h1><time datetime="2026-10-20T18:00">18:00</time></section></body></html>',
    });

    const result = await screenUrl('https://example.com/festival/');

    expect(result.hasMain).toBe(false);
    expect(result.hasArticle).toBe(false);
    expect(result.hasAltMain).toBe(true);
    expect(result.categorization).not.toBe('no-main');
  });

  it('keeps no-main when no alternative main-content found', async () => {
    const mockedFetchHtml = vi.mocked(fetchHtml);
    mockedFetchHtml.mockResolvedValue({
      success: true,
      html: '<html><body><header>Logo</header><div class="random"><p>Some text but no main content</p></div></body></html>',
    });

    const result = await screenUrl('https://example.com/');

    expect(result.hasMain).toBe(false);
    expect(result.hasArticle).toBe(false);
    expect(result.hasAltMain).toBe(false);
    expect(result.categorization).toBe('no-main');
  });

  it('regression: <main><article> still produces strong categorization', async () => {
    const mockedFetchHtml = vi.mocked(fetchHtml);
    mockedFetchHtml.mockResolvedValue({
      success: true,
      html: '<html><body><main><article><h1>Event 1</h1><time datetime="2026-10-15T19:00">2026-10-15 19:00</time></article><article><h1>Event 2</h1><time datetime="2026-10-16T19:00">2026-10-16 19:00</time></article><article><h1>Event 3</h1><time datetime="2026-10-17T19:00">2026-10-17 19:00</time></article></main></body></html>',
    });

    const result = await screenUrl('https://example.com/events/');

    expect(result.hasMain).toBe(true);
    expect(result.hasArticle).toBe(true);
    expect(result.categorization).toBe('strong');
  });
});
