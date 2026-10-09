/**
 * autoHealFailedSources.test.ts — Fas P (2026-10-09)
 *
 * Verifierar:
 *  1. URL-kandidat-generering (original + root + suffix)
 *  2. selectHealCandidates (cf≤3, Stockholm, 0 events)
 *  3. testUrl (mockad fetchHtml + universal-extractor)
 *  4. runHeal — heal_candidate vs still_dead outcomes
 *  5. CLI-flagga-parsning
 *
 * Run: npx vitest run 02-Ingestion/tools/autoHealFailedSources.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ─── Mocks (måste vara EFTER import av impl-klasser pga hoisting) ─────────────

vi.mock('./fetchTools', () => ({
  fetchHtml: vi.fn(),
}));

vi.mock('./sourceRegistry', () => ({
  getAllSources: vi.fn(),
  getAllStatuses: vi.fn(),
  getSource: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    appendFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
  };
});

import {
  generateUrlCandidates,
  selectHealCandidates,
  testUrl,
  runHeal,
  computeNextRecheckAt,
} from './autoHealFailedSources';
import { fetchHtml } from './fetchTools';
import { getAllSources, getAllStatuses, getSource } from './sourceRegistry';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const fetchHtmlMock = fetchHtml as unknown as ReturnType<typeof vi.fn>;
const getAllSourcesMock = getAllSources as unknown as ReturnType<typeof vi.fn>;
const getAllStatusesMock = getAllStatuses as unknown as ReturnType<typeof vi.fn>;
const getSourceMock = getSource as unknown as ReturnType<typeof vi.fn>;

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── generateUrlCandidates ───────────────────────────────────────────────────

describe('generateUrlCandidates', () => {
  test('returnerar original + max 3 unika URLs', () => {
    const urls = generateUrlCandidates('https://example.com/events');
    expect(urls.length).toBeLessThanOrEqual(3);
    expect(urls[0]).toBe('https://example.com/events');
  });

  test('använder root-URL om path har multipla segment', () => {
    const urls = generateUrlCandidates('https://kulturhuset.se/foobar/baz');
    // Borde vara https://kulturhuset.se/foobar/baz + https://kulturhuset.se + suffix
    expect(urls.some(u => u === 'https://kulturhuset.se' || u === 'https://kulturhuset.se/')).toBe(true);
  });

  test('behåller original-form även om den slutar med /', () => {
    const urls = generateUrlCandidates('https://example.com/events/');
    expect(urls[0]).toBe('https://example.com/events/');
  });

  test('hanterar URL utan path', () => {
    const urls = generateUrlCandidates('https://example.com');
    expect(urls[0]).toBe('https://example.com');
  });

  test('filtrerar bort duplikat', () => {
    const urls = generateUrlCandidates('https://example.com');
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  test('inkluderar typiska suffix-kandidater', () => {
    const urls = generateUrlCandidates('https://kulturhuset.se/foobar');
    const hasSuffix = urls.some(u => /\/evenemang|\/events|\/kalender/.test(u));
    expect(hasSuffix).toBe(true);
  });
});

// ─── selectHealCandidates ────────────────────────────────────────────────────

describe('selectHealCandidates', () => {
  test('filtrerar bort success-källor', () => {
    getAllSourcesMock.mockReturnValue([
      { id: 'a', url: 'https://a.se', name: 'A', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
    ]);
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'a', status: 'success', lastEventsFound: 5, consecutiveFailures: 0, attempts: 1 },
    ]);

    const result = selectHealCandidates();
    expect(result).toHaveLength(0);
  });

  test('filtrerar bort non-Stockholm-källor (via getAllSources scope)', () => {
    // Verifierar att getAllSources anropas med scope: 'stockholm'
    getAllSourcesMock.mockReturnValue([]);
    getAllStatusesMock.mockReturnValue([]);
    selectHealCandidates();
    expect(getAllSourcesMock).toHaveBeenCalledWith({ scope: 'stockholm' });
  });

  test('inkluderar cf=1 Stockholm-fail med 0 events', () => {
    getAllSourcesMock.mockReturnValue([
      { id: 'x', url: 'https://x.se', name: 'X', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
    ]);
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'x', status: 'fail', lastEventsFound: 0, consecutiveFailures: 1, attempts: 2, lastError: 'no-jsonld' },
    ]);

    const result = selectHealCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('x');
    expect(result[0].consecutiveFailures).toBe(1);
  });

  test('filtrerar bort cf=4 (nära auto-quarantine)', () => {
    getAllSourcesMock.mockReturnValue([
      { id: 'y', url: 'https://y.se', name: 'Y', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
    ]);
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'y', status: 'fail', lastEventsFound: 0, consecutiveFailures: 4, attempts: 5, lastError: 'no-jsonld' },
    ]);

    const result = selectHealCandidates();
    expect(result).toHaveLength(0);
  });

  test('filtrerar bort permanent döda (SSL/redirect_loop)', () => {
    getAllSourcesMock.mockReturnValue([
      { id: 'z1', url: 'https://z1.se', name: 'Z1', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
      { id: 'z2', url: 'https://z2.se', name: 'Z2', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
    ]);
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'z1', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'TLS cert mismatch' },
      { sourceId: 'z2', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'redirect_loop detected' },
    ]);

    const result = selectHealCandidates();
    expect(result).toHaveLength(0);
  });

  test('sorterar med lägst cf först', () => {
    getAllSourcesMock.mockReturnValue([
      { id: 'cf3', url: 'https://cf3.se', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
      { id: 'cf1', url: 'https://cf1.se', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
      { id: 'cf2', url: 'https://cf2.se', city: 'Stockholm', type: 'venue', preferredPath: 'html' },
    ]);
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'cf3', status: 'fail', lastEventsFound: 0, consecutiveFailures: 3, attempts: 4, lastError: 'no-jsonld' },
      { sourceId: 'cf1', status: 'fail', lastEventsFound: 0, consecutiveFailures: 1, attempts: 2, lastError: 'no-jsonld' },
      { sourceId: 'cf2', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'no-jsonld' },
    ]);

    const result = selectHealCandidates();
    expect(result.map(r => r.id)).toEqual(['cf1', 'cf2', 'cf3']);
  });
});

// ─── testUrl ─────────────────────────────────────────────────────────────────

describe('testUrl', () => {
  test('returnerar 0 events vid fetch-fel', async () => {
    fetchHtmlMock.mockResolvedValue({ success: false, error: 'timeout', statusCode: 504 });

    const result = await testUrl('https://broken.example.com');
    expect(result.events).toBe(0);
    expect(result.error).toBe('timeout');
    expect(result.statusCode).toBe(504);
  });

  test('returnerar events>0 vid lyckad extraktion', async () => {
    fetchHtmlMock.mockResolvedValue({
      success: true,
      html: '<html><body><script type="application/ld+json">{"@type":"Event","name":"Test"}</script></body></html>',
      finalUrl: 'https://example.com',
    });

    const result = await testUrl('https://example.com');
    expect(result.events).toBeGreaterThan(0);
    expect(result.methods.length).toBeGreaterThan(0);
  });
});

// ─── runHeal ─────────────────────────────────────────────────────────────────

describe('runHeal', () => {
  test('sourceIds-läge: heal_candidate när annan URL ger events>0', async () => {
    // Tom state — ingen exhausted, inga prior attempts
    (existsSync as any).mockReturnValue(false);
    (readFileSync as any).mockReturnValue('');

    getSourceMock.mockImplementation((id: string) => {
      if (id === 'broken') return { id: 'broken', url: 'https://broken.se/wrong-path', name: 'B', city: 'Stockholm', type: 'venue', preferredPath: 'html' };
      return null;
    });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'broken', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'no-jsonld' },
    ]);

    // DEBUG: verifiera att mock-HTML returnerar korrekt innehåll
    fetchHtmlMock.mockImplementation((url: string) => {
      // Original-URL: 0 events; alla suffix-versioner: 5 events
      if (url === 'https://broken.se/wrong-path') {
        return Promise.resolve({ success: true, html: '<html><body>no events</body></html>', finalUrl: url });
      }
      // Allt annat (root + suffix-versioner): 5 events
      const html = `<html><body>
          <article class="event"><h2>Event One</h2><time datetime="2026-10-15T19:00">15 okt 2026</time></article>
          <article class="event"><h2>Event Two</h2><time datetime="2026-10-16T19:00">16 okt 2026</time></article>
          <article class="event"><h2>Event Three</h2><time datetime="2026-10-17T19:00">17 okt 2026</time></article>
          <article class="event"><h2>Event Four</h2><time datetime="2026-10-18T19:00">18 okt 2026</time></article>
          <article class="event"><h2>Event Five</h2><time datetime="2026-10-19T19:00">19 okt 2026</time></article>
        </body></html>`;
      return Promise.resolve({ success: true, html, finalUrl: url });
    });

    const summary = await runHeal({ sourceIds: ['broken'] });
    expect(summary.candidatesChecked).toBe(1);
    expect(summary.healCandidatesFound).toBe(1);
    expect(summary.results[0].outcome).toBe('heal_candidate');
    expect(summary.results[0].bestUrl).not.toBe('https://broken.se/wrong-path');
  });

  test('still_dead när alla URLs ger 0 events', async () => {
    getSourceMock.mockReturnValue({ id: 'dead', url: 'https://dead.se', name: 'D', city: 'Stockholm', type: 'venue', preferredPath: 'html' });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'dead', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockResolvedValue({ success: true, html: '<html><body>no events anywhere</body></html>', finalUrl: 'https://dead.se' });

    const summary = await runHeal({ sourceIds: ['dead'] });
    expect(summary.stillDeadCount).toBe(1);
    expect(summary.healCandidatesFound).toBe(0);
    expect(summary.results[0].outcome).toBe('still_dead');
  });

  test('returnerar summary med startedAt + completedAt', async () => {
    getSourceMock.mockReturnValue({ id: 'q', url: 'https://q.se', name: 'Q', city: 'Stockholm', type: 'venue', preferredPath: 'html' });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'q', status: 'fail', lastEventsFound: 0, consecutiveFailures: 1, attempts: 2, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockResolvedValue({ success: true, html: '<html></html>', finalUrl: 'https://q.se' });

    const summary = await runHeal({ sourceIds: ['q'] });
    expect(summary.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(summary.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('exhausted-flagga: källa med redan MAX_HEAL_ATTEMPTS state körs inte', async () => {
    // Injicera state via override (mock av fs readFileSync binding är omöjligt pga hoisting)
    getSourceMock.mockReturnValue({ id: 'old-dead', url: 'https://old-dead.se', name: 'O', city: 'Stockholm', type: 'venue', preferredPath: 'html' });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'old-dead', status: 'fail', lastEventsFound: 0, consecutiveFailures: 1, attempts: 2, lastError: 'no-jsonld' },
    ]);

    // Försök sourceIds-läge med exhausted override: ska respektera och skippa
    const summary = await runHeal({
      sourceIds: ['old-dead'],
      healStateOverride: {
        attempts: { 'old-dead': 3 },
        exhausted: { 'old-dead': { since: '2026-10-09T12:00:00Z', reason: 'Still dead efter 3 försök', nextRecheckAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString() } }
      }
    });
    expect(summary.candidatesChecked).toBe(0); // exhausted → exkluderas
  });

  test('still_dead som övergår till exhausted vid MAX_HEAL_ATTEMPTS', async () => {
    // state override: 2 tidigare misslyckade försök
    getSourceMock.mockReturnValue({ id: 'doomed', url: 'https://doomed.se', name: 'D', city: 'Stockholm', type: 'venue', preferredPath: 'html' });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'doomed', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockResolvedValue({ success: true, html: '<html></html>', finalUrl: 'https://doomed.se' });

    const summary = await runHeal({
      sourceIds: ['doomed'],
      healStateOverride: { attempts: { 'doomed': 2 }, exhausted: {} }
    });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].outcome).toBe('exhausted'); // 3:e försöket → exhausted
    expect(summary.results[0].healAttempts).toBe(3);
  });

  test('heal_candidate nollställer attempts-räknare', async () => {
    // State: 2 tidigare misslyckade försök (via override pga hoisting-problem)
    getSourceMock.mockImplementation((id: string) => {
      if (id === 'recovered') return { id: 'recovered', url: 'https://recovered.se/wrong-path', name: 'R', city: 'Stockholm', type: 'venue', preferredPath: 'html' };
      return null;
    });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'recovered', status: 'fail', lastEventsFound: 0, consecutiveFailures: 2, attempts: 3, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockImplementation((url: string) => {
      if (url === 'https://recovered.se/wrong-path') {
        return Promise.resolve({ success: true, html: '<html></html>', finalUrl: url });
      }
      return Promise.resolve({
        success: true,
        html: `<html><body>
          <article class="event"><h2>Event One</h2><time datetime="2026-10-15T19:00">15 okt 2026</time></article>
          <article class="event"><h2>Event Two</h2><time datetime="2026-10-16T19:00">16 okt 2026</time></article>
        </body></html>`,
        finalUrl: url,
      });
    });

    const summary = await runHeal({
      sourceIds: ['recovered'],
      healStateOverride: { attempts: { 'recovered': 2 }, exhausted: {} }
    });
    // Förväntar heal_candidate INTE exhausted — recovered har events i root
    expect(summary.results[0].outcome).toBe('heal_candidate');
    expect(summary.results[0].healAttempts).toBe(0); // nollställd vid framgång
  });

  test('selectHealCandidates med attempts=2 men ej exhausted → inkluderas', async () => {
    const { selectHealCandidates } = await import('./autoHealFailedSources');
    const result = selectHealCandidates(
      [{ id: 'almost', url: 'https://almost.se', city: 'Stockholm', type: 'venue', preferredPath: 'html' } as any],
      [{ sourceId: 'almost', status: 'fail', lastEventsFound: 0, consecutiveFailures: 1, attempts: 2, lastError: 'no-jsonld' } as any],
      { attempts: { 'almost': 2 }, exhausted: {} } // 2 attempts men inte exhausted
    );
    expect(result).toHaveLength(1); // Ska fortfarande inkluderas
  });
});

// ─── CLI-flagga ──────────────────────────────────────────────────────────────

describe('CLI', () => {
  test('--source flagga parsas korrekt (verifierar sourceIds-anrop)', async () => {
    getSourceMock.mockImplementation((id: string) => {
      if (id === 'cli-test') return { id: 'cli-test', url: 'https://cli.se', name: 'C', city: 'Stockholm', type: 'venue', preferredPath: 'html' };
      return null;
    });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'cli-test', status: 'fail', lastEventsFound: 0, consecutiveFailures: 1, attempts: 2, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockResolvedValue({ success: true, html: '<html></html>', finalUrl: 'https://cli.se' });

    // Simulera --source cli-test-anrop
    const summary = await runHeal({ sourceIds: ['cli-test'] });
    expect(summary.candidatesChecked).toBe(1);
  });
});

// ─── computeNextRecheckAt ────────────────────────────────────────────────────

describe('computeNextRecheckAt', () => {
  test('före 1 maj: returnerar 1 maj innevarande år', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const result = computeNextRecheckAt(now);
    expect(result).toBe('2026-05-01T00:00:00.000Z');
  });

  test('exakt 1 maj: returnerar 1 maj NÄSTA år (vi vill inte köra samma dag)', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const result = computeNextRecheckAt(now);
    expect(result).toBe('2027-05-01T00:00:00.000Z');
  });

  test('efter 1 maj: returnerar 1 maj nästa år', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const result = computeNextRecheckAt(now);
    expect(result).toBe('2027-05-01T00:00:00.000Z');
  });

  test('default utan arg → använder now()', () => {
    const result = computeNextRecheckAt();
    expect(result).toMatch(/^\d{4}-05-01T00:00:00\.000Z$/);
  });
});

// ─── nextRecheckAt-flödet ────────────────────────────────────────────────────

describe('nextRecheckAt-flödet', () => {
  test('exhausted med nextRecheckAt i framtiden → hoppas över', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString();
    const { selectHealCandidates } = await import('./autoHealFailedSources');
    const result = selectHealCandidates(
      [{ id: 'sleeping', url: 'https://sleeping.se', city: 'Stockholm', type: 'venue', preferredPath: 'html' } as any],
      [{ sourceId: 'sleeping', status: 'fail', lastEventsFound: 0, consecutiveFailures: 3, attempts: 4, lastError: 'no-jsonld' } as any],
      {
        attempts: { 'sleeping': 3 },
        exhausted: { 'sleeping': { since: '2026-10-01', reason: '3 misslyckade försök', nextRecheckAt: futureDate } }
      }
    );
    expect(result).toHaveLength(0);
  });

  test('exhausted med nextRecheckAt i dåtid → inkluderas (årlig maj-re-check)', async () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();
    const { selectHealCandidates } = await import('./autoHealFailedSources');
    const result = selectHealCandidates(
      [{ id: 'wake-up', url: 'https://wake-up.se', city: 'Stockholm', type: 'venue', preferredPath: 'html' } as any],
      [{ sourceId: 'wake-up', status: 'fail', lastEventsFound: 0, consecutiveFailures: 3, attempts: 4, lastError: 'no-jsonld' } as any],
      {
        attempts: { 'wake-up': 3 },
        exhausted: { 'wake-up': { since: '2025-10-01', reason: '3 misslyckade försök', nextRecheckAt: pastDate } }
      }
    );
    expect(result).toHaveLength(1);
  });

  test('forceRecheckExhausted=true ignorerar nextRecheckAt', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString();
    getSourceMock.mockImplementation((id: string) => {
      if (id === 'forced') return { id: 'forced', url: 'https://forced.se', name: 'F', city: 'Stockholm', type: 'venue', preferredPath: 'html' };
      return null;
    });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'forced', status: 'fail', lastEventsFound: 0, consecutiveFailures: 3, attempts: 4, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockResolvedValue({ success: true, html: '<html></html>', finalUrl: 'https://forced.se' });

    const summary = await runHeal({
      sourceIds: ['forced'],
      forceRecheckExhausted: true,
      healStateOverride: {
        attempts: { 'forced': 3 },
        exhausted: { 'forced': { since: '2026-10-01', reason: 'old', nextRecheckAt: futureDate } }
      }
    });
    expect(summary.candidatesChecked).toBe(1);
  });

  test('lyckad re-check resettar exhausted och attempts', async () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

    getSourceMock.mockImplementation((id: string) => {
      if (id === 'comeback') return { id: 'comeback', url: 'https://comeback.se/wrong-path', name: 'C', city: 'Stockholm', type: 'venue', preferredPath: 'html' };
      return null;
    });
    getAllStatusesMock.mockReturnValue([
      { sourceId: 'comeback', status: 'fail', lastEventsFound: 0, consecutiveFailures: 3, attempts: 4, lastError: 'no-jsonld' },
    ]);
    fetchHtmlMock.mockImplementation((url: string) => {
      if (url === 'https://comeback.se/wrong-path') {
        return Promise.resolve({ success: true, html: '<html></html>', finalUrl: url });
      }
      return Promise.resolve({
        success: true,
        html: `<html><body>
          <article class="event"><h2>Event One</h2><time datetime="2026-10-15T19:00">15 okt 2026</time></article>
          <article class="event"><h2>Event Two</h2><time datetime="2026-10-16T19:00">16 okt 2026</time></article>
        </body></html>`,
        finalUrl: url,
      });
    });

    const summary = await runHeal({
      sourceIds: ['comeback'],
      healStateOverride: {
        attempts: { 'comeback': 3 },
        exhausted: { 'comeback': { since: '2025-10-01', reason: 'old', nextRecheckAt: pastDate } }
      }
    });
    expect(summary.results[0].outcome).toBe('heal_candidate');
    expect(summary.results[0].healAttempts).toBe(0);
  });
});