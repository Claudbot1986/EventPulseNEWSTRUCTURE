/**
 * Historiska museet-adapterns tester.
 *
 * Fixturen är en avskalad kopia av den riktiga `__NEXT_DATA__`-payloaden
 * från https://historiska.se/besok-oss/pa-gang/ (2026-10-24): ett
 * `shm/event-list`-block med `attrs.teasers[]` av typen `shm/teaser-event`.
 * Datumtexterna är de faktiska formaten från sajten (år saknas i texten —
 * året härleds ur listans filterlabel "oktober 2035", ett framtida år så att
 * testet inte förfaller med tiden).
 */
import { describe, it, expect } from 'vitest';
import { matches, extract, parseWhen } from './historiskaMuseet';

const teaser = (attrs: Record<string, unknown>) => ({ blockName: 'shm/teaser-event', attrs, innerBlocks: [] });

const NEXT_DATA = {
  props: {
    pageProps: {
      page: {
        blocks: [
          {
            blockName: 'shm/event-list',
            attrs: {
              route: '/wp-json/shm/event-list',
              query: {
                baseUrl: 'https://historiska.se/besok-oss/pa-gang/',
                lang: 'sv',
                postType: 'shm_event',
                teaserType: 'event',
                filter: 'month',
                date: { startDate: '2035-10-01', endDate: '2035-10-31', type: 'month', label: 'oktober 2035' },
                perPage: 10,
                currentPage: 0,
              },
              allowPast: false,
              date: '2035-10-01',
              filter: 'month',
              teasers: [
                teaser({
                  title: 'Pianokonsert',
                  description: 'Upplev en av våra främsta musikkonstnärer i ett program där Eva Sidén spelar egen pianomusik.',
                  link: { href: 'https://historiska.se/besok-oss/pa-gang/pianokonsert/' },
                  image: { url: 'https://historiska.se/wp-content/uploads/2035/10/pianokonsert.webp' },
                  labelText: 'Musik på Historiska',
                  price: 'Fri entré till konserten. ',
                  warning: false,
                  notice: false,
                  date: 'Lördag 27 oktober klockan 15.00-16.00',
                }),
                teaser({
                  title: 'När historien blir ett slagfält',
                  description: 'Välkommen på boksläpp av Museer och omstridda kulturarv.',
                  link: { href: 'https://historiska.se/besok-oss/pa-gang/nar-historien-blir-ett-slagfalt/' },
                  image: { url: 'https://historiska.se/wp-content/uploads/2035/10/slagfalt.webp' },
                  labelText: 'Föreläsning',
                  price: 'Kostnad 180 kronor.',
                  warning: false,
                  notice: false,
                  date: 'Onsdag 31 oktober klockan 18.00-19.00',
                  bookingLink: { href: 'https://secure.tickster.com/dytv6ny3b5jkm7f' },
                }),
                teaser({
                  title: 'Höstlov: Pannlampsäventyr',
                  description: 'Välkommen till ett pannlampsäventyr bland gamla skatter och vikingatida hjältar.',
                  link: { href: 'https://historiska.se/besok-oss/pa-gang/hostlov-pannlampsaventyr/' },
                  image: { url: 'https://historiska.se/wp-content/uploads/2035/07/hostlov.webp' },
                  labelText: 'Barn och familj',
                  price: 'Kostnadsfritt för barn till och med 18 år. Vuxna betalar museientré (180 kronor).',
                  warning: false,
                  notice: false,
                  date: 'Lördag 27 oktober - söndag 4 november',
                  bookingLink: { href: 'https://secure.tickster.com/dytv6ny3b5jkm7f' },
                }),
                teaser({
                  title: 'Pärlor för framtiden',
                  description: 'Från augusti till november pryds Historiska museets Pireuslejon av ett pärlhalsband.',
                  link: { href: 'https://historiska.se/besok-oss/pa-gang/parlor-for-framtiden/' },
                  image: { url: 'https://historiska.se/wp-content/uploads/2035/06/parlor.webp' },
                  labelText: 'Tillfällig utställning',
                  price: 'Kostnadsfritt',
                  warning: false,
                  notice: false,
                  date: '26 augusti - 15 november',
                }),
                // Utan datum — kan inte överleva importens datumvakt.
                teaser({
                  title: 'Utan datum',
                  description: 'Rad utan datum.',
                  link: { href: 'https://historiska.se/besok-oss/pa-gang/utan-datum/' },
                  labelText: 'Övrigt',
                  date: undefined,
                }),
                // Redan pågående — startdatumet ligger i det förflutna.
                teaser({
                  title: 'Utställning som redan öppnat',
                  description: 'Kördes i år.',
                  link: { href: 'https://historiska.se/besok-oss/pa-gang/gammal/' },
                  labelText: 'Övrigt',
                  date: '26 augusti 2020',
                }),
              ],
            },
            innerBlocks: [],
          },
          // Utställningskort bär bara SLUTDATUM ("till och med …") — de ska
          // inte ge något startdatum.
          {
            blockName: 'shm/teaser',
            attrs: {
              title: 'Vikingaliv med Halvdan och Meia',
              description: 'En lekfull utställning för yngre barn.',
              link: { href: 'https://historiska.se/utstallningar/vikingaliv-hos-halvdan-och-meia/' },
              image: { url: 'https://historiska.se/wp-content/uploads/2035/02/vikingaliv.webp' },
              labelText: 'till och med 1 november 2035',
              showLabel: true,
            },
            innerBlocks: [],
          },
        ],
      },
    },
  },
};

const FIXTURE = `<!doctype html><html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
  NEXT_DATA
)}</script></body></html>`;

const LISTING_URL = 'https://historiska.se/besok-oss/pa-gang/';

describe('historiska museet adapter', () => {
  it('matchar bara historiska.se (inkl. legacy-domänen)', () => {
    expect(matches('https://historiska.se/besok-oss/pa-gang/')).toBe(true);
    expect(matches('https://www.historiska.se/utstallningar/')).toBe(true);
    expect(matches('https://www.historiskamuseet.se/utstallningar/')).toBe(true);
    expect(matches('https://example.com/utstallningar/')).toBe(false);
    expect(matches('https://livrustkammaren.se/besok/kalender/')).toBe(false);
    expect(matches('https://historiska.se.evil.com/')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });

  it('läser titel, datum, tid och url ur NEXT_DATA-teasern', () => {
    const res = extract(FIXTURE, LISTING_URL, 'historiska-museet');
    expect(res.method).toBe('historiska-listing');
    expect(res.events.length).toBe(4);

    const concert = res.events.find((e) => e.title === 'Pianokonsert');
    expect(concert).toBeDefined();
    expect(concert?.date).toBe('2035-10-27');
    expect(concert?.time).toBe('15:00');
    expect(concert?.endTime).toBe('16:00');
    expect(concert?.url).toBe('https://historiska.se/besok-oss/pa-gang/pianokonsert/');
    expect(concert?.source).toBe('historiska-museet');
    expect(concert?.venue).toBe('Historiska museet');
    expect(concert?.address).toBe('Narvavägen 17, Stockholm');
    expect(concert?.city).toBe('Stockholm');
    expect(concert?.category).toBe('Musik på Historiska');
    expect(concert?.imageUrl).toContain('pianokonsert.webp');
  });

  it('tar startdatumet ur ett datumintervall', () => {
    const res = extract(FIXTURE, LISTING_URL);
    const pannlamp = res.events.find((e) => e.title === 'Höstlov: Pannlampsäventyr');
    expect(pannlamp?.date).toBe('2035-10-27');
    expect(pannlamp?.endDate).toBe('2035-11-04');
    expect(pannlamp?.time).toBeUndefined();
    expect(pannlamp?.ticketUrl).toBe('https://secure.tickster.com/dytv6ny3b5jkm7f');
  });

  it('läser tid utan "klockan" och pris ur texten', () => {
    const res = extract(FIXTURE, LISTING_URL);
    const lecture = res.events.find((e) => e.title === 'När historien blir ett slagfält');
    expect(lecture?.date).toBe('2035-10-31');
    expect(lecture?.time).toBe('18:00');
    expect(lecture?.priceMin).toBe(180);
    expect(lecture?.priceMax).toBe(180);
    expect(lecture?.isFree).toBeUndefined();
  });

  it('skippar rader utan datum och rader som redan börjat', () => {
    const res = extract(FIXTURE, LISTING_URL);
    const titles = res.events.map((e) => e.title);
    expect(titles).not.toContain('Utan datum');
    expect(titles).not.toContain('Utställning som redan öppnat');
  });

  it('behandlar inte "till och med" som startdatum', () => {
    const res = extract(FIXTURE, LISTING_URL);
    const titles = res.events.map((e) => e.title);
    expect(titles).not.toContain('Vikingaliv med Halvdan och Meia');
  });

  it('gör inget på tom HTML', () => {
    const res = extract('<html><body>inget</body></html>', LISTING_URL);
    expect(res.events.length).toBe(0);
    expect(res.showUrls.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(FIXTURE, 'https://example.com/besok-oss/pa-gang/');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('returnerar evenemangslänkarna som showUrls', () => {
    const res = extract(FIXTURE, LISTING_URL);
    expect(res.showUrls.length).toBe(4);
    expect(res.showUrls).toContain('https://historiska.se/besok-oss/pa-gang/pianokonsert/');
  });

  it('härleder året ur filterlabel och veckodag', () => {
    const reference = { year: 2035, month: 10 };
    expect(parseWhen('Lördag 27 oktober klockan 15.00-16.00', reference)).toEqual({
      date: '2035-10-27',
      endDate: undefined,
      time: '15:00',
      endTime: '16:00',
    });
    expect(parseWhen('torsdag 25 oktober 18.00', reference)?.date).toBe('2035-10-25');
    expect(parseWhen('till och med 1 november 2035', reference)).toBeNull();
    expect(parseWhen('ingen datumtext', reference)).toBeNull();
  });
});
