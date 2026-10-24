/**
 * Stockholm Jazz Festival-adapterns tester.
 *
 * Fixturen är kopplad ur den JS-renderade programsidan
 * (https://www.stockholmjazz.se/program, renderad 2026-10-24): 331 kort
 * med `aria-label="{titel}, {D} {månad} {HH:MM}, {scen}"` och datum i
 * URL-sluggen.
 *
 * Ett par rader är medvetet felställda (sluggen är stale på 12/283 rader):
 * `/program/pw-nilsson-trio-feat-leo-lindberg-2026-10-14-…` har aria-label
 * "9 oktober 17:00" och konsertsidans JSON-LD säger 2026-10-09 — alltså
 * vinner aria-labelns datum över sluggen.
 */
import { describe, it, expect } from 'vitest';
import { matches, extract, parseProgramCards, festivalYearFromHtml } from './stockholmJazz';

const LISTING_FIXTURE = `
<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-8">
  <a aria-label="Augusta Swing Band, 9 oktober 16:00, Källarbyn" href="/program/augusta-swing-band-2026-10-09-1784235123930" class="block"><img src="https://storage.googleapis.com/sthlmjazz-uploads/artwork/x.webp" alt=""></a>
  <a aria-label="Hannibal Jarrah's &quot;Swing Party&quot; feat. Björn Ingelstam, 9 oktober 17:00, Stampen" href="/program/pw-nilsson-trio-feat-leo-lindberg-2026-10-14-1784265500080" class="block"><img src="https://storage.googleapis.com/sthlmjazz-uploads/artwork/y.webp" alt=""></a>
  <a aria-label="Alexander Västberg kvintett, 9 oktober 17:30, St Eriks jazzbar" href="/program/alexander-vastberg-kvintett-2026-10-09-1784477110750" class="block"><img src="https://storage.googleapis.com/sthlmjazz-uploads/artwork/z.webp" alt=""></a>
  <a aria-label="En konsert utan datum" href="/program/utan-datum-1784230390369" class="block"></a>
</div>
`;

/** Riktig JSON-LD från https://stockholmjazz.se/program/augusta-swing-band-… */
const EVENT_PAGE_FIXTURE = `
<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"MusicEvent","name":"Augusta Swing Band","startDate":"2026-10-09T16:00:00+02:00","url":"https://stockholmjazz.se/program/augusta-swing-band-2026-10-09-1784235123930","eventStatus":"https://schema.org/EventScheduled","eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode","description":"Varmt välkomna till Augustas Folksalong!","image":"https://storage.googleapis.com/sthlmjazz-uploads/images/1784317188653-246769.jpg","location":{"@type":"Place","name":"Källarbyn ","url":"https://stockholmjazz.se/scener/kallarbyn","address":{"@type":"PostalAddress","streetAddress":"Stora Nygatan 27","addressLocality":"Stockholm","addressCountry":"SE"}},"organizer":{"@type":"Organization","name":"Stockholm Jazz Festival","url":"https://stockholmjazz.se"}}
</script></head><body><h1>Augusta Swing Band</h1></body></html>
`;

describe('stockholm jazz adapter', () => {
  it('matchar bara festivalens riktiga domän', () => {
    expect(matches('https://www.stockholmjazz.se/program')).toBe(true);
    expect(matches('https://stockholmjazz.se/')).toBe(true);
    expect(matches('https://www.pingst.se/program')).toBe(false);
    expect(matches('https://example.com/program')).toBe(false);
  });

  it('matchar INTE den kapade .com-domänen', () => {
    // stockholmjazz.com är en spam-site ("Insights on WoW Raid Carry"),
    // inte festivalen. Den ska aldrig gå in i adaptern.
    expect(matches('https://stockholmjazz.com/')).toBe(false);
    expect(matches('https://www.stockholmjazz.com/')).toBe(false);
  });

  it('läser festivalåret ur sluggarna', () => {
    expect(festivalYearFromHtml(LISTING_FIXTURE)).toBe(2026);
  });

  it('läser titel, datum, tid, scen och url ur listan', () => {
    const rows = parseProgramCards(LISTING_FIXTURE, 2026);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({
      title: 'Augusta Swing Band',
      date: '2026-10-09',
      time: '16:00',
      venue: 'Källarbyn',
      url: 'https://www.stockholmjazz.se/program/augusta-swing-band-2026-10-09-1784235123930',
    });
  });

  it('tar aria-labelns datum när sluggen är stale', () => {
    const rows = parseProgramCards(LISTING_FIXTURE, 2026);
    const hannibal = rows.find((r) => r.title.includes('Hannibal'));
    expect(hannibal?.date).toBe('2026-10-09');
    expect(hannibal?.venue).toBe('Stampen');
  });

  it('hoppar över rader utan datum', () => {
    const res = extract(LISTING_FIXTURE, 'https://www.stockholmjazz.se/program');
    expect(res.events.length).toBe(3);
    expect(res.events.map((e) => e.title)).not.toContain('En konsert utan datum');
  });

  it('extraherar hela listan', () => {
    const res = extract(LISTING_FIXTURE, 'https://www.stockholmjazz.se/program');
    expect(res.method).toBe('stockholmjazz-listing');
    expect(res.events.length).toBe(3);
    const first = res.events[0];
    expect(first.title).toBe('Augusta Swing Band');
    expect(first.date).toBe('2026-10-09');
    expect(first.time).toBe('16:00');
    expect(first.venue).toBe('Källarbyn');
    expect(first.url).toBe(
      'https://www.stockholmjazz.se/program/augusta-swing-band-2026-10-09-1784235123930'
    );
    expect(first.city).toBe('Stockholm');
    expect(first.source).toBe('stockholm-jazz-festival');
    expect(res.showUrls.length).toBe(3);
  });

  it('läser JSON-LD MusicEvent från en konsertsida', () => {
    const res = extract(
      EVENT_PAGE_FIXTURE,
      'https://stockholmjazz.se/program/augusta-swing-band-2026-10-09-1784235123930'
    );
    expect(res.method).toBe('stockholmjazz-jsonld');
    expect(res.events.length).toBe(1);
    const evt = res.events[0];
    expect(evt.title).toBe('Augusta Swing Band');
    expect(evt.date).toBe('2026-10-09');
    expect(evt.time).toBe('16:00');
    expect(evt.venue).toBe('Källarbyn');
    expect(evt.address).toBe('Stora Nygatan 27');
    expect(evt.city).toBe('Stockholm');
    expect(evt.imageUrl).toContain('sthlmjazz-uploads');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(LISTING_FIXTURE, 'https://example.com/program');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan program', () => {
    const res = extract('<html><body>inget</body></html>', 'https://www.stockholmjazz.se/program');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
