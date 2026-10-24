/**
 * Tester för Teater Galeasen-adaptern.
 *
 * Fixturerna bygger på den riktiga markupen (mätt 2026-10-24):
 * - Presslistan: `<ul class='forestallningar'><li><a …><div>titel</div>
 *   … <h6>Premiär 5 oktober 2026</h6></a></li>`.
 * - Speldagslistan hos nordic (Dagny): `<div class="show-listing-show
 *   pointer sd2026-10-05 numbered-show" data-tags="teatergaleasen,…"
 *   data-ticketurl="/ticket/show/350916">` med `.show-name`,
 *   `.large-screen-date` och `.price-range`.
 */
import { describe, expect, it } from 'vitest';
import { extract, matches, parseShowListings, parseShows, parseSwedishDate } from './teaterGaleasen';

const PRESS_URL = 'https://galeasen.se/pressrum/forestallningar/';
const NORTIC_URL =
  'https://www.nortic.se/dagny/ajax/organizer/calendar/shows/2703?from=2026-10-01&to=2026-11-30';

/** Riktig markup från galeasen.se/pressrum/forestallningar/ (utklippt). */
const PRESS_HTML = `
<html><body>
  <ul class='forestallningar'>
    <li>
      <a href='https://galeasen.se/?post_type=forestallningar&#038;p=5024'>
        <div style='width:30%;float:left'>Vernon Subutex</div>
        <div style='width:30%;float:left'></div>
        <div style='width:30%;float:left'><h6>Premiär 5 oktober 2026</h6></div>
        <i style='float:right;font-size:27px' class='fa fa-arrow-circle-o-right'></i>
      </a>
    </li>
    <li>
      <a href='https://galeasen.se/?post_type=forestallningar&#038;p=4889'>
        <div style='width:30%;float:left'>Eurotrash</div>
        <div style='width:30%;float:left'></div>
        <div style='width:30%;float:left'><h6>Premiär 23 mars 2026</h6></div>
        <i style='float:right;font-size:27px' class='fa fa-arrow-circle-o-right'></i>
      </a>
    </li>
    <li>
      <a href='https://galeasen.se/?post_type=forestallningar&#038;p=4900'>
        <div style='width:30%;float:left'>Personer på teatern</div>
        <div style='width:30%;float:left'></div>
        <div style='width:30%;float:left'></div>
      </a>
    </li>
  </ul>
</body></html>`;

/** En föreställning i nordics kalenderlista (utklippt ur den riktiga HTML:en). */
function showListing(options: {
  date?: string;
  title?: string;
  time?: string;
  tags?: string;
  ticketId?: string;
}): string {
  const classes = [
    'show-listing-show',
    'pointer',
    ...(options.date ? [`sd${options.date}`] : []),
    'numbered-show',
  ].join(' ');
  const tags = options.tags ?? 'teatergaleasen,vernonsubutex';
  const ticketId = options.ticketId ?? '350916';
  return `
    <div style="position: relative;"
         class="${classes}"
         data-showtype="numbered-show"
         data-showid="${ticketId}"
         data-eventid="84167"
         data-arenacity="stockholm"
         data-eventname="${(options.title ?? 'Vernon Subutex').toLowerCase()}"
         data-tags="${tags}"
         data-ticketurl="/ticket/show/${ticketId}">
      <div class="row no-margin valign-wrapper">
        <div class="col s3 m3 l3 hide-on-small-and-down large-screen-date">
          <span class="capitalize bold">Monday</span>
          <br/>
          ${options.time ?? '18:00'}
        </div>
        <div class="col s3 m3 hide-on-small-and-down left-align show-name-container">
          <div class="bold show-name">${options.title ?? 'Vernon Subutex'}</div>
          <div class="show-info">${options.title ?? 'Vernon Subutex'}</div>
        </div>
        <div class="col s2 m2 hide-on-small-and-down price-range">
          från 150 SEK
        </div>
        <div class="col s3 m2 hide-on-small-and-down location-med-and-up right-align">
          <span>Teater Galeasen<br/><span class="bold">Stockholm</span></span>
        </div>
      </div>
    </div>`;
}

describe('teaterGaleasen.matches', () => {
  it('matchar galeasen.se och www.galeasen.se', () => {
    expect(matches('https://galeasen.se/')).toBe(true);
    expect(matches('https://www.galeasen.se/pressrum/forestallningar/')).toBe(true);
  });

  it('matchar nordics kalenderlista för Teater Galeasen (organizer 2703)', () => {
    expect(matches(NORTIC_URL)).toBe(true);
    expect(matches('https://www.nortic.se/dagny/ajax/organizer/calendar/shows/2703')).toBe(true);
  });

  it('matchar INTE andra domäner eller andra nordic-arrangörer', () => {
    expect(matches('https://www.nortic.se/dagny/ajax/organizer/calendar/shows/1234')).toBe(false);
    expect(matches('https://www.nortic.se/dagny/ajax/organizer/eventcards/2703')).toBe(false);
    expect(matches('https://www.nortic.se/')).toBe(false);
    expect(matches('https://cafeopera.se/')).toBe(false);
    expect(matches('https://example.com/galeasen')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });
});

describe('teaterGaleasen.parseSwedishDate', () => {
  it('läser svenska datum med år', () => {
    expect(parseSwedishDate('Premiär 5 oktober 2026')).toBe('2026-10-05');
    expect(parseSwedishDate('Urpremiär 4 mars 2024')).toBe('2024-03-04');
    expect(parseSwedishDate('Nypremiär 7 mars 2017')).toBe('2017-03-07');
  });

  it('läser datum utan år som nästa förekomst', () => {
    // 5 oktober 2026 har redan varit → nästa förekomst blir 2027.
    expect(parseSwedishDate('Premiär 5 oktober', new Date('2026-10-24T00:00:00Z'))).toBe('2027-10-05');
    // 5 november 2026 har inte varit ännu → samma år.
    expect(parseSwedishDate('Premiär 5 november', new Date('2026-10-24T00:00:00Z'))).toBe('2026-11-05');
  });

  it('avvisar trasiga datum', () => {
    expect(parseSwedishDate('31 februari 2026')).toBeNull();
    expect(parseSwedishDate(null)).toBeNull();
    expect(parseSwedishDate('Personer på teatern')).toBeNull();
  });
});

describe('teaterGaleasen.parseShows', () => {
  it('läser titel, datum och länk ur presslistan', () => {
    const shows = parseShows(PRESS_HTML);

    expect(shows).toHaveLength(3);
    expect(shows[0].title).toBe('Vernon Subutex');
    expect(shows[0].dateText).toBe('Premiär 5 oktober 2026');
    expect(shows[0].href).toContain('post_type=forestallningar');
    expect(shows[2].dateText).toBeNull();
  });
});

describe('teaterGaleasen.parseShowListings', () => {
  it('läser datum, tid, titel, pris och biljettlänk ur nordic-listan', () => {
    const listings = parseShowListings(showListing({ date: '2026-10-05' }));

    expect(listings).toHaveLength(1);
    expect(listings[0].date).toBe('2026-10-05');
    expect(listings[0].time).toBe('18:00');
    expect(listings[0].title).toBe('Vernon Subutex');
    expect(listings[0].priceText).toBe('från 150 SEK');
    expect(listings[0].ticketPath).toBe('/ticket/show/350916');
  });
});

describe('teaterGaleasen.extract', () => {
  it('extraherar uppsättningarna ur presslistan', () => {
    const result = extract(PRESS_HTML, PRESS_URL);

    expect(result.method).toBe('galeasen-listing');
    expect(result.events).toHaveLength(2);

    const first = result.events[0];
    expect(first.title).toBe('Vernon Subutex');
    expect(first.date).toBe('2026-10-05');
    expect(first.venue).toBe('Teater Galeasen');
    expect(first.address).toBe('Slupskjulsvägen 30-32, 111 49 Stockholm');
    expect(first.city).toBe('Stockholm');
    expect(first.category).toBe('theatre-drama');
    expect(first.source).toBe('teater-galeasen');
    expect(first.sourceUrl).toBe(PRESS_URL);
    expect(first.url).toContain('galeasen.se');
  });

  it('hoppar över rader utan datum', () => {
    const result = extract(PRESS_HTML, PRESS_URL);

    expect(result.events).toHaveLength(2);
    expect(result.events.some((e) => e.title === 'Personer på teatern')).toBe(false);
  });

  it('extraherar speldagar ur nordics kalenderlista', () => {
    const html = `<html><body>${showListing({ date: '2026-10-05', ticketId: '350916' })}${showListing({
      date: '2026-10-07',
      time: '19:00',
      ticketId: '351057',
    })}</body></html>`;
    const result = extract(html, NORTIC_URL);

    expect(result.method).toBe('galeasen-nortic-shows');
    expect(result.events).toHaveLength(2);

    const first = result.events[0];
    expect(first.title).toBe('Vernon Subutex');
    expect(first.date).toBe('2026-10-05');
    expect(first.time).toBe('18:00');
    expect(first.venue).toBe('Teater Galeasen');
    expect(first.city).toBe('Stockholm');
    expect(first.category).toBe('theatre-drama');
    expect(first.priceMin).toBe(150);
    expect(first.ticketUrl).toBe('https://www.nortic.se/ticket/show/350916');
    expect(first.sourceUrl).toBe(NORTIC_URL);
    expect(first.confidence.hasTicketInfo).toBe(true);

    expect(result.events[1].date).toBe('2026-10-07');
    expect(result.events[1].time).toBe('19:00');
  });

  it('hoppar över föreställningar utan datum och utan Galeasen-tag', () => {
    const html = `<html><body>${showListing({ date: '2026-10-05' })}${showListing({
      ticketId: '999999',
    })}${showListing({ date: '2026-10-09', ticketId: '888888', tags: 'annanvenue,annat' })}</body></html>`;
    const result = extract(html, NORTIC_URL);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe('2026-10-05');
  });

  it('ger inget resultat för tom HTML', () => {
    const result = extract('', PRESS_URL);

    expect(result.method).toBe('none');
    expect(result.events).toHaveLength(0);
    expect(result.showUrls).toHaveLength(0);
  });

  it('ger inget resultat för en URL som inte matchar', () => {
    const result = extract(PRESS_HTML, 'https://example.com/');

    expect(result.method).toBe('none');
    expect(result.events).toHaveLength(0);
  });
});
