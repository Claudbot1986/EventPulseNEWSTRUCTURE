/**
 * Tests for runD-pilot (Val C, 2026-10-09).
 *
 * Per CLAUDE.md Generalization Protection Rule + "DO NOT BUILD YET":
 * - source-not-in-allowlist must return early with exitReason set
 * - renderPage failure must not throw, must capture error
 * - successful render must call both runAdapters and extractEvents,
 *   merging their events
 *
 * Mocks renderPage + extractEvents + runAdapters; we don't hit the
 * network in unit tests.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./renderGate', () => ({
  renderPage: vi.fn(),
}));

vi.mock('../F-eventExtraction/adapters', () => ({
  runAdapters: vi.fn(),
}));

vi.mock('../F-eventExtraction/universal-extractor', () => ({
  extractEvents: vi.fn(),
}));

import { renderPage } from './renderGate';
import { runAdapters } from '../F-eventExtraction/adapters';
import { extractEvents } from '../F-eventExtraction/universal-extractor';
import { runPilotSource } from './runD-pilot';
import { RENDER_PILOT_SOURCES, RENDER_PILOT_URLS } from './sourceAllowlist';

const mockRender = renderPage as unknown as ReturnType<typeof vi.fn>;
const mockAdapters = runAdapters as unknown as ReturnType<typeof vi.fn>;
const mockExtract = extractEvents as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRender.mockReset();
  mockAdapters.mockReset();
  mockExtract.mockReset();
});

describe('runD-pilot — source allowlist (Val C, source-specific)', () => {
  it('rejects sourceId not in the allowlist (D-render is NOT default path)', async () => {
    const result = await runPilotSource('biljettshop', {});
    expect(result.exitReason).toBe('source-not-in-allowlist');
    expect(result.renderSuccess).toBe(false);
    expect(result.events).toEqual([]);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('rejects unknown sourceId (covers typo, non-existent source)', async () => {
    const result = await runPilotSource('riksdagshuset', {});
    expect(result.exitReason).toBe('source-not-in-allowlist');
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('accepts the 5 batch-209 D-route sources', () => {
    // Sanity: the 5 sources we agreed to pilot are in the allowlist.
    for (const sid of ['dramaten', 'hallsberg', 'jonkoping', 'djurgarden', 'jarfalla']) {
      expect(RENDER_PILOT_SOURCES.has(sid)).toBe(true);
      expect(RENDER_PILOT_URLS[sid]).toMatch(/^https?:\/\//);
    }
  });
});

describe('runD-pilot — render failure', () => {
  it('captures render error without throwing', async () => {
    mockRender.mockResolvedValueOnce({
      url: 'https://www.dramaten.se/...',
      success: false,
      error: 'HTTP 403',
      metrics: { renderTimeMs: 100, htmlLength: 0, hasEventContent: false, creditsCharged: 5 },
    });

    const result = await runPilotSource('dramaten', {});
    expect(result.exitReason).toBe('render-failed');
    expect(result.renderError).toBe('HTTP 403');
    expect(result.events).toEqual([]);
    expect(result.creditsCharged).toBe(5);
    expect(mockAdapters).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('handles missing HTML (success=true but no html)', async () => {
    mockRender.mockResolvedValueOnce({
      url: 'https://www.dramaten.se/...',
      success: true,
      html: '',
      metrics: { renderTimeMs: 50, htmlLength: 0, hasEventContent: false, creditsCharged: 5 },
    });
    const result = await runPilotSource('dramaten', {});
    expect(result.exitReason).toBe('render-failed');
  });
});

describe('runD-pilot — successful render + extraction', () => {
  it('merges adapter events + universal events', async () => {
    mockRender.mockResolvedValueOnce({
      url: RENDER_PILOT_URLS.dramaten,
      success: true,
      html: '<html><body>...</body></html>',
      metrics: {
        renderTimeMs: 2000,
        htmlLength: 12345,
        hasEventContent: true,
        behavior: 'premium-only',
        creditsCharged: 25,
      },
    });

    const adapterEvent = { title: 'Adapter event', date: '2026-10-15' } as any;
    const universalEvents = [
      { title: 'Universal 1', date: '2026-10-16' } as any,
      { title: 'Universal 2', date: '2026-10-17' } as any,
    ];
    mockAdapters.mockReturnValueOnce({
      adapter: 'biljettshop',
      showUrls: [],
      events: [adapterEvent],
    });
    mockExtract.mockReturnValueOnce({
      events: universalEvents,
      rawCount: 2,
      parseErrors: [],
      sourceUrl: RENDER_PILOT_URLS.dramaten,
      methodsUsed: ['iso-date'],
      methodBreakdown: { 'iso-date': 2 },
    });

    const result = await runPilotSource('dramaten', {});
    expect(result.exitReason).toBe('ok');
    expect(result.renderSuccess).toBe(true);
    // htmlLength is the actual rendered HTML's byte length (29 chars for the
    // fixture), NOT the metrics.htmlLength — the runner uses render.html.length
    // because that's the source of truth for downstream consumers.
    expect(result.htmlLength).toBe(29);
    expect(result.creditsCharged).toBe(25);
    expect(result.adapterHits).toEqual(['biljettshop']);
    expect(result.universalEventsFound).toBe(2);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toBe(adapterEvent);
  });

  it('returns universal events only when no adapter matches', async () => {
    mockRender.mockResolvedValueOnce({
      url: RENDER_PILOT_URLS.djurgarden,
      success: true,
      html: '<html></html>',
      metrics: { renderTimeMs: 100, htmlLength: 100, hasEventContent: false, behavior: 'premium-only', creditsCharged: 25 },
    });
    mockAdapters.mockReturnValueOnce(null);
    mockExtract.mockReturnValueOnce({
      events: [{ title: 'X', date: '2026-11-01' }] as any,
      rawCount: 1,
      parseErrors: [],
      sourceUrl: RENDER_PILOT_URLS.djurgarden,
      methodsUsed: [],
      methodBreakdown: {},
    });

    const result = await runPilotSource('djurgarden', {});
    expect(result.exitReason).toBe('ok');
    expect(result.adapterHits).toEqual([]);
    expect(result.events).toHaveLength(1);
  });

  it('honors explicit url override', async () => {
    const customUrl = 'https://www.dramaten.se/other-page';
    mockRender.mockResolvedValueOnce({
      url: customUrl,
      success: true,
      html: '<html></html>',
      metrics: { renderTimeMs: 100, htmlLength: 100, hasEventContent: false, behavior: 'premium-only', creditsCharged: 25 },
    });
    mockAdapters.mockReturnValueOnce(null);
    mockExtract.mockReturnValueOnce({
      events: [], rawCount: 0, parseErrors: [],
      sourceUrl: customUrl, methodsUsed: [], methodBreakdown: {},
    });

    const result = await runPilotSource('dramaten', { url: customUrl });
    expect(result.url).toBe(customUrl);
    expect(mockRender).toHaveBeenCalledWith(customUrl, expect.any(Object));
  });
});
