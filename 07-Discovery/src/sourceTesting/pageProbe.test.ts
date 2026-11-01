/**
 * pageProbe — vilka sidor som faktiskt läses.
 *
 * 2026-11-01 — gaten blockerade musikaliskase.se (30 riktiga evenemang) för
 * att sidorna den läste var KATEGORISIDOR, inte evenemangssidor. Kategorisidan
 * bär JSON-LD-typen `article` som en mallartefakt. Det här testet fångar
 * urvalet: endast rader med en egen detaljsida läses.
 */
import { describe, expect, it } from 'vitest';
import { probeRowPages } from './pageProbe.js';

function recorder() {
  const fetched: string[] = [];
  return {
    fetched,
    fetchImpl: async (url: string) => {
      fetched.push(url);
      return { status: 200, body: '<html><body>ok</body></html>' };
    },
  };
}

describe('probeRowPages — vilka sidor läses', () => {
  it('läser INTE listningsrader (url === sourceUrl)', async () => {
    const rec = recorder();
    await probeRowPages(
      [
        { title: 'Pop', url: 'https://musikaliska.se/musikstilar/popmusik/', sourceUrl: 'https://musikaliska.se/musikstilar/popmusik/' },
        { title: 'rock', url: 'https://musikaliska.se/musikstilar/rock/', sourceUrl: 'https://musikaliska.se/musikstilar/rock/' },
      ],
      { fetchImpl: rec.fetchImpl },
    );
    expect(rec.fetched).toEqual([]);
  });

  it('läser detaljrader (url ≠ sourceUrl)', async () => {
    const rec = recorder();
    await probeRowPages(
      [
        { title: 'Tigran Hamasyan', url: 'https://example.se/konsert/tigran', sourceUrl: 'https://example.se/konserter' },
      ],
      { fetchImpl: rec.fetchImpl },
    );
    expect(rec.fetched).toEqual(['https://example.se/konsert/tigran']);
  });

  it('läser INTE mailto:/tel: (de är inte hämtbara)', async () => {
    const rec = recorder();
    await probeRowPages(
      [{ title: 'Kontakt', url: 'mailto:kulturfestivalen@stockholm.se', sourceUrl: 'https://kulturfestivalen.stockholm.se/fragor-svar/' }],
      { fetchImpl: rec.fetchImpl },
    );
    expect(rec.fetched).toEqual([]);
  });

  it('hämtar högst limit sidor', async () => {
    const rec = recorder();
    const rows = Array.from({ length: 10 }, (_, i) => ({
      title: `Event ${i}`,
      url: `https://example.se/e/${i}`,
      sourceUrl: 'https://example.se/list',
    }));
    await probeRowPages(rows, { limit: 3, fetchImpl: rec.fetchImpl });
    expect(rec.fetched).toHaveLength(3);
  });

  it('prioriterar detaljrader framför listningsrader', async () => {
    const rec = recorder();
    const signals = await probeRowPages(
      [
        { title: 'Listningsrad', url: 'https://example.se/list', sourceUrl: 'https://example.se/list' },
        { title: 'Detaljrad', url: 'https://example.se/e/1', sourceUrl: 'https://example.se/list' },
      ],
      { limit: 5, fetchImpl: rec.fetchImpl },
    );
    expect(rec.fetched).toEqual(['https://example.se/e/1']);
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toBe('Detaljrad');
  });

  it('nätverksfel ger okänd signal — aldrig ett bevis', async () => {
    const signals = await probeRowPages(
      [{ title: 'Något', url: 'https://example.se/e/1', sourceUrl: 'https://example.se/list' }],
      {
        fetchImpl: async () => {
          throw new Error('nätverksfel');
        },
      },
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].jsonLdTypes).toBeUndefined();
    expect(signals[0].ogType).toBeUndefined();
  });
});
