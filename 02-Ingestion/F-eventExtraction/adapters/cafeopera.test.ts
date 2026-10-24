/**
 * Tester för Café Opera-adaptern.
 *
 * Fixturerna bygger på den riktiga markupen (mätt 2026-10-24):
 * Attendium lägger kvällarna i `<script>window.appInitData = "…"</script>`
 * där payloaden är trippelkodad:
 *   JSON.parse(JSON.parse(JSON.parse("<literal>")))
 * och posterna har `__typename: "Event"` / `"Venue"` / `"OpenInvitation"`.
 */
import { describe, expect, it } from 'vitest';
import { extract, matches, parseNights, parseRelayRecords } from './cafeopera';

const FRIDAYS_URL = 'https://attendium.com/.iWtScj8PkQ2KSQOkBu-p0xA';
const WEDNESDAYS_URL = 'https://attendium.com/.it6Eut260Sr-AjZuXJPXAyg';
const HOME_URL = 'https://www.cafeopera.se/';

interface FixtureEvent {
  id: string;
  name: string;
  startsAt?: string;
  endsAt?: string;
  venueName?: string;
}

/** Bygger en Attendium-sida med den riktiga payload-strukturen. */
function buildAttendiumHtml(events: FixtureEvent[]): string {
  const relayRecords: Record<string, unknown> = {
    'client:root': { __typename: 'Root' },
    'iWtScj8PkQ2KSQOkBu-p0xA': {
      __typename: 'OpenInvitation',
      id: 'iWtScj8PkQ2KSQOkBu-p0xA',
      renderedAdditionalInformationMessage:
        '![](INSTA_kopiera.png)\nGuest List: Apply for reduced entrance (95SEK) before 23:30 (11.30pm) with your name on the guest list. Age 20+.',
      additionalInformationMessageFiles: { __refs: ['fobU5LOsLSh66oiZxKIADlg'] },
    },
    'fobU5LOsLSh66oiZxKIADlg': {
      __typename: 'File',
      id: 'fobU5LOsLSh66oiZxKIADlg',
      url: 'https://files.attendium.com/fobU5LOsLSh66oiZxKIADlg',
    },
  };

  for (const event of events) {
    const venueId = `ve-${event.id}`;
    relayRecords[venueId] = {
      __typename: 'Venue',
      id: venueId,
      name: event.venueName ?? 'Café Opera',
      timeZone: 'Europe/Stockholm',
    };
    relayRecords[event.id] = {
      __typename: 'Event',
      id: event.id,
      name: event.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venue: { __ref: venueId },
    };
  }

  const payload = JSON.stringify({
    routerHydrationData: {},
    env: {},
    countryCode: 'SE',
    globalPrivacyControl: false,
    relayRecords,
  });
  // Trippelkodning: JSON.parse tre gånger ger tillbaka payloaden.
  const encoded = JSON.stringify(JSON.stringify(JSON.stringify(payload)));

  return `<!doctype html><html><body><script>window.appInitData = ${encoded};</script></body></html>`;
}

/** De tre riktiga kvällarna på "Fridays & Saturdays" (mätt 2026-10-24). */
const FRIDAY_EVENTS: FixtureEvent[] = [
  {
    id: 'evrNoeMrHdS5K6zqAZTCy7Hw',
    name: 'Café Opera - Saturday October 24',
    startsAt: '2026-10-24T21:00:38Z',
    endsAt: '2026-10-25T02:00:44Z',
  },
  {
    id: 'evNmzAlEf8QtS455z0WJ6bBA',
    name: 'Café Opera - Friday October 30',
    startsAt: '2026-10-30T22:00:39Z',
    endsAt: '2026-10-31T02:00:44Z',
  },
  {
    id: 'evsnQ0VeqRRdahvWzE5_7MAQ',
    name: 'Café Opera - Saturday October 31',
    startsAt: '2026-10-31T22:00:00Z',
    endsAt: '2026-11-01T02:00:05Z',
  },
];

describe('cafeopera.matches', () => {
  it('matchar cafeopera.se och www.cafeopera.se', () => {
    expect(matches('https://cafeopera.se/')).toBe(true);
    expect(matches('https://www.cafeopera.se/')).toBe(true);
    expect(matches('https://www.cafeopera.se/guestlist')).toBe(true);
  });

  it('matchar Café Operas två Attendium-inbjudningar', () => {
    expect(matches(FRIDAYS_URL)).toBe(true);
    expect(matches(WEDNESDAYS_URL)).toBe(true);
    expect(matches('https://www.attendium.com/.iWtScj8PkQ2KSQOkBu-p0xA')).toBe(true);
    expect(matches('https://attendium.com/sv/.iWtScj8PkQ2KSQOkBu-p0xA')).toBe(true);
  });

  it('matchar INTE andra domäner eller andra Attendium-inbjudningar', () => {
    expect(matches('https://attendium.com/.someOtherInvitationSlug')).toBe(false);
    expect(matches('https://attendium.com/')).toBe(false);
    expect(matches('https://galeasen.se/')).toBe(false);
    expect(matches('https://example.com/cafeopera')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });
});

describe('cafeopera.parseRelayRecords', () => {
  it('packar upp den trippelkodade payloaden', () => {
    const records = parseRelayRecords(buildAttendiumHtml(FRIDAY_EVENTS));
    expect(records).not.toBeNull();
    expect(Object.keys(records ?? {}).length).toBeGreaterThan(0);
  });

  it('returnerar null när payloaden saknas', () => {
    expect(parseRelayRecords('<html><body>inget här</body></html>')).toBeNull();
  });
});

describe('cafeopera.parseNights', () => {
  it('läser kvällarna med venue och tidszon', () => {
    const nights = parseNights(buildAttendiumHtml(FRIDAY_EVENTS));
    expect(nights).toHaveLength(3);
    expect(nights[0].name).toBe('Café Opera - Saturday October 24');
    expect(nights[0].venueName).toBe('Café Opera');
    expect(nights[0].timeZone).toBe('Europe/Stockholm');
  });
});

describe('cafeopera.extract', () => {
  it('extraherar kvällarna med titel, datum och lokal tid', () => {
    const result = extract(buildAttendiumHtml(FRIDAY_EVENTS), FRIDAYS_URL);

    expect(result.method).toBe('cafeopera-listing');
    expect(result.events).toHaveLength(3);

    const first = result.events[0];
    expect(first.title).toBe('Café Opera - Saturday October 24');
    expect(first.date).toBe('2026-10-24');
    expect(first.time).toBe('23:00');
    expect(first.endDate).toBe('2026-10-25');
    expect(first.endTime).toBe('03:00');
    expect(first.venue).toBe('Café Opera');
    expect(first.address).toBe('Karl XII:s torg 5, 111 47 Stockholm');
    expect(first.city).toBe('Stockholm');
    expect(first.category).toBe('music');
    expect(first.source).toBe('cafe-opera');
    expect(first.sourceUrl).toBe(FRIDAYS_URL);
    expect(first.confidence.score).toBeGreaterThan(0.5);
    expect(first.confidence.hasDate).toBe(true);
    expect(first.confidence.hasVenue).toBe(true);
  });

  it('räknar om UTC till Europe/Stockholm (CEST/CET)', () => {
    const result = extract(buildAttendiumHtml(FRIDAY_EVENTS), FRIDAYS_URL);
    const byName = new Map(result.events.map((e) => [e.title, e]));

    expect(byName.get('Café Opera - Friday October 30')?.date).toBe('2026-10-30');
    expect(byName.get('Café Opera - Friday October 30')?.time).toBe('23:00');
    expect(byName.get('Café Opera - Saturday October 31')?.date).toBe('2026-10-31');
    expect(byName.get('Café Opera - Saturday October 31')?.time).toBe('23:00');
  });

  it('hoppar över rader utan starttid', () => {
    const html = buildAttendiumHtml([
      ...FRIDAY_EVENTS,
      { id: 'evNoDate', name: 'Café Opera - Utan datum' },
    ]);
    const result = extract(html, FRIDAYS_URL);

    expect(result.events).toHaveLength(3);
    expect(result.events.some((e) => e.title === 'Café Opera - Utan datum')).toBe(false);
  });

  it('hoppar över kvällar som tillhör en annan venue', () => {
    const html = buildAttendiumHtml([
      { id: 'evOther', name: 'Annat ställe - Friday', startsAt: '2026-10-30T22:00:00Z', venueName: 'Nakiska' },
    ]);
    const result = extract(html, FRIDAYS_URL);

    expect(result.method).toBe('none');
    expect(result.events).toHaveLength(0);
  });

  it('följer gästlistelänkarna från startsidan', () => {
    const html = `
      <html><body>
        <a href="https://attendium.com/.iWtScj8PkQ2KSQOkBu-p0xA">Fridays &amp; Saturdays</a>
        <a href="https://attendium.com/.it6Eut260Sr-AjZuXJPXAyg">Wednesdays</a>
      </body></html>`;
    const result = extract(html, HOME_URL);

    expect(result.method).toBe('cafeopera-guestlist-links');
    expect(result.events).toHaveLength(0);
    expect(result.showUrls).toEqual([FRIDAYS_URL, WEDNESDAYS_URL]);
  });

  it('ger inget resultat för tom HTML', () => {
    const result = extract('', FRIDAYS_URL);

    expect(result.method).toBe('none');
    expect(result.events).toHaveLength(0);
    expect(result.showUrls).toHaveLength(0);
  });

  it('ger inget resultat för en URL som inte matchar', () => {
    const result = extract(buildAttendiumHtml(FRIDAY_EVENTS), 'https://example.com/');

    expect(result.method).toBe('none');
    expect(result.events).toHaveLength(0);
  });
});
