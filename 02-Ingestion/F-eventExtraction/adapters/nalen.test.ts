/**
 * Nalen-adapterns tester.
 *
 * Fixturen är en avskalad version av den riktiga `__NEXT_DATA__`-strukturen
 * (2026-10-24): Storyblok `artistCard`-block med artistnamn (rich text),
 * startDate/endDate, pris, support och slug.
 */
import { describe, it, expect } from 'vitest';
import { matches, findArtistCards, extract } from './nalen';

function card(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    component: 'artistCard',
    artistName: { content: [{ content: [{ text: 'Daniel Lanois' }] }] },
    startDate: '2027-04-30 19:00',
    endDate: '2027-04-30 21:30',
    price: '695 kr',
    sideKickName: 'support: Someone',
    artistPageUrl: { story: { full_slug: 'konsert/daniel-lanois' } },
    ...over,
  };
}

function page(cards: unknown[]): string {
  const payload = { props: { pageProps: { blocks: cards } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    payload
  )}</script></body></html>`;
}

describe('nalen adapter', () => {
  it('matchar bara nalen.com', () => {
    expect(matches('https://nalen.com/sv/konserter-event')).toBe(true);
    expect(matches('https://www.nalen.com/sv/konserter-event')).toBe(true);
    expect(matches('https://example.com/konserter-event')).toBe(false);
  });

  it('hittar artistCard-block i trädet', () => {
    const cards = findArtistCards({ a: [{ component: 'artistCard' }], b: { component: 'other' } });
    expect(cards.length).toBe(1);
  });

  it('extraherar artist, datum, tid, pris och länk', () => {
    const res = extract(page([card()]), 'https://nalen.com/sv/konserter-event');
    expect(res.method).toBe('nalen-next-data');
    expect(res.events.length).toBe(1);
    const e = res.events[0];
    expect(e.title).toBe('Daniel Lanois');
    expect(e.date).toBe('2027-04-30');
    expect(e.time).toBe('19:00');
    expect(e.venue).toBe('Nalen');
    expect(e.address).toBe('Regeringsgatan 29, Stockholm');
    expect(e.city).toBe('Stockholm');
    expect(e.url).toBe('https://nalen.com/sv/konsert/daniel-lanois');
    expect(e.ticketUrl).toBe('https://nalen.com/sv/konsert/daniel-lanois');
    expect(e.description).toContain('support: Someone');
    expect(e.description).toContain('Pris: 695 kr');
    expect(e.source).toBe('nalencom');
  });

  it('behandlar 00:00 som datum utan tid', () => {
    const res = extract(
      page([card({ startDate: '2027-05-01 00:00' })]),
      'https://nalen.com/sv/konserter-event'
    );
    expect(res.events[0].date).toBe('2027-05-01');
    expect(res.events[0].time).toBeUndefined();
  });

  it('skopar kort utan namn eller utan datum', () => {
    const res = extract(
      page([
        card({ artistName: { content: [{ content: [{ text: '' }] }] } }),
        card({ startDate: undefined }),
      ]),
      'https://nalen.com/sv/konserter-event'
    );
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('deduperar den dubblerade listan', () => {
    const res = extract(page([card(), card(), card({ startDate: '2027-04-30 21:00' })]), 'https://nalen.com/sv/konserter-event');
    expect(res.events.length).toBe(2);
    expect(res.events.map((e) => e.time).sort()).toEqual(['19:00', '21:00']);
  });

  it('gör inget på främmande URL', () => {
    const res = extract(page([card()]), 'https://example.com/konserter-event');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan __NEXT_DATA__', () => {
    const res = extract('<html><body>inget</body></html>', 'https://nalen.com/sv/konserter-event');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
