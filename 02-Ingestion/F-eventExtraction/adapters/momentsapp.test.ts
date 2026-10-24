/**
 * momentsapp.test.ts — verifierar momentsapp.no-adaptern.
 *
 * Fixturen är kopierad från en riktig ScrapingBee-render
 * (premium-only, 2026-10-24) av
 * https://momentsapp.no/events/stockholm/kalender/2026-10-24
 * — se momentsapp.ts för hela mätningen.
 */
import { describe, it, expect } from 'vitest';
import { matches, extract } from './momentsapp';
import { extractFromHtml } from '../extractor';

const PAGE_URL = 'https://momentsapp.no/events/stockholm/kalender/2026-10-24';

/** Ett kort i exakt den markup som mätningen hittade. */
function card(opts: {
  uuid: string;
  datetime: string;
  timeText: string;
  title: string;
  venue?: string;
  price?: string;
}): string {
  const inner = [
    `<span class="block font-bold text-[#30234B]">${opts.title}</span>`,
    opts.venue !== undefined
      ? `<span class="mt-0.5 block text-sm text-[#6B5E8B]">${opts.venue}</span>`
      : '',
  ].join('');
  const pill =
    opts.price !== undefined
      ? `<span class="w-fit rounded-full bg-[#E7F7EC] px-2.5 py-1 text-xs font-bold text-[#236F3D]">${opts.price}</span>`
      : '';
  return `<li><a class="grid gap-1" href="/event/${opts.uuid}"><time datetime="${opts.datetime}" class="text-sm font-extrabold">${opts.timeText}</time><span class="min-w-0">${inner}</span>${pill}</a></li>`;
}

function page(cards: string): string {
  return `<!doctype html><html><body><ul class="divide-y">${cards}</ul></body></html>`;
}

const THREE_CARDS = page(
  [
    card({
      uuid: '22dde823-bf24-449b-9789-ecde70a3d1fc',
      datetime: '2026-10-23T22:00:00+00:00',
      timeText: '00:00',
      title: 'Helgpyssel',
      venue: 'Stadsbiblioteket Spelbomskan',
      price: 'Free',
    }),
    card({
      uuid: '3ea00c5a-0000-4000-8000-000000000000',
      datetime: '2026-10-24T07:00:00+00:00',
      timeText: '09:00',
      title: 'Flemingsberg Badminton Intermediate',
      venue: 'Fleminghallen',
      price: 'Free',
    }),
    card({
      uuid: 'dfe586cd-0000-4000-8000-000000000000',
      datetime: '2026-10-24T08:00:00+00:00',
      timeText: '10:00',
      title: 'Harmoni Expo - A Weekend for Body & Soul',
      venue: 'Solnahallen, Ankdammsgatan 46, Solna',
    }),
  ].join('')
);

describe('momentsapp adapter — matches()', () => {
  it('matchar momentsapp.no', () => {
    expect(matches(PAGE_URL)).toBe(true);
  });
  it('matchar www.momentsapp.no', () => {
    expect(matches('https://www.momentsapp.no/events/stockholm/kalender')).toBe(true);
  });

  it('NEGATIV KONTROLL — matchar inte annan domän', () => {
    expect(matches('https://example.com/events/stockholm/kalender')).toBe(false);
  });
  it('NEGATIV KONTROLL — matchar inte en domän som bara innehåller "momentsapp"', () => {
    expect(matches('https://momentsapp.no.evil.example/events/')).toBe(false);
  });
});

describe('momentsapp adapter — extract()', () => {
  it('extraherar alla tre korten', () => {
    const res = extract(THREE_CARDS, PAGE_URL);
    expect(res.method).toBe('momentsapp-calendar');
    expect(res.events).toHaveLength(3);
  });

  it('flyttar UTC-ögonblick till Europe/Stockholm', () => {
    const res = extract(THREE_CARDS, PAGE_URL);
    // 2026-10-23T22:00Z = 2026-10-24 00:00 i Stockholm (CEST, UTC+2)
    expect(res.events[0].date).toBe('2026-10-24');
    expect(res.events[0].time).toBe('00:00');
    expect(res.events[1].date).toBe('2026-10-24');
    expect(res.events[1].time).toBe('09:00');
  });

  it('läser titel, venue och url', () => {
    const res = extract(THREE_CARDS, PAGE_URL);
    expect(res.events[0].title).toBe('Helgpyssel');
    expect(res.events[0].venue).toBe('Stadsbiblioteket Spelbomskan');
    expect(res.events[0].url).toBe(
      'https://momentsapp.no/event/22dde823-bf24-449b-9789-ecde70a3d1fc'
    );
    expect(res.events[2].venue).toBe('Solnahallen, Ankdammsgatan 46, Solna');
  });

  it('sätter isFree när priset är "Free" och lämnar det odefinierat annars', () => {
    const res = extract(THREE_CARDS, PAGE_URL);
    expect(res.events[0].isFree).toBe(true);
    expect(res.events[2].isFree).toBeUndefined();
  });

  it('NEGATIV KONTROLL — sida utan kort ger noll events', () => {
    const res = extract(page(''), PAGE_URL);
    expect(res.events).toHaveLength(0);
    expect(res.method).toBe('none');
  });

  it('NEGATIV KONTROLL — länk utan <time> hoppas över', () => {
    const noTime = page(
      `<li><a href="/event/22dde823-bf24-449b-9789-ecde70a3d1fc"><span class="min-w-0"><span>Rubrik</span></span></a></li>`
    );
    expect(extract(noTime, PAGE_URL).events).toHaveLength(0);
  });

  it('NEGATIV KONTROLL — /events/stockholm-länkar är inte eventkort', () => {
    const wrongLink = page(
      `<li><a href="/events/stockholm/kalender/2026-10-25"><time datetime="2026-10-25T08:00:00+00:00">10:00</time><span class="min-w-0"><span>Rubrik</span></span></a></li>`
    );
    expect(extract(wrongLink, PAGE_URL).events).toHaveLength(0);
  });

  it('NEGATIV KONTROLL — trasigt datum hoppas över', () => {
    const badDate = page(
      card({
        uuid: '22dde823-bf24-449b-9789-ecde70a3d1fc',
        datetime: 'inte-ett-datum',
        timeText: '00:00',
        title: 'Helgpyssel',
        venue: 'Stadsbiblioteket Spelbomskan',
      })
    );
    expect(extract(badDate, PAGE_URL).events).toHaveLength(0);
  });

  it('NEGATIV KONTROLL — främmande URL ger noll events', () => {
    expect(extract(THREE_CARDS, 'https://example.com/kalender').events).toHaveLength(0);
  });
});

describe('momentsapp adapter — integrering med extractFromHtml', () => {
  it('UniversalExtractor-hjälpare ger skräp, adaptern ger rena events', () => {
    const res = extractFromHtml(THREE_CARDS, 'momentsapp-stockholm', PAGE_URL);
    expect(res.events).toHaveLength(3);
    for (const e of res.events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title).not.toMatch(/\\"|\{\\\"/);
    }
  });
});
