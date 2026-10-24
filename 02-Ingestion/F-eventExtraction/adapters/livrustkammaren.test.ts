/**
 * Livrustkammaren-adapterns tester.
 *
 * Fixturen är en avskalad kopia av den riktiga `__NEXT_DATA__`-payloaden
 * från https://livrustkammaren.se/besok/kalender/ (2026-10-24): ett
 * `shm/event-list`-block med `attrs.teasers[]` av typen `shm/teaser-event`.
 * Datumtexterna är de faktiska formaten från sajten (år saknas i texten —
 * året härleds ur listans filterlabel "oktober 2035", ett framtida år så att
 * testet inte förfaller med tiden).
 */
import { describe, it, expect } from 'vitest';
import { matches, extract, parseWhen } from './livrustkammaren';

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
                baseUrl: 'https://livrustkammaren.se/besok/kalender/',
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
                  title: 'Riddarmaskerad',
                  description: 'Nu är det äntligen dags för årets stora Riddarmaskerad!',
                  link: { href: 'https://livrustkammaren.se/besok/kalender/riddarmaskerad/' },
                  image: { url: 'https://livrustkammaren.se/wp-content/uploads/2035/10/riddarmaskerad.webp' },
                  labelText: 'Riddarklubben',
                  price: '0-3 år kostnadsfritt. Ungdom under 19 år 50 kronor. Vuxen 180 kronor.',
                  warning: false,
                  notice: false,
                  date: 'Lördag 27 oktober klockan 10-12',
                  bookingLink: { href: 'https://secure.tickster.com/425cbdr52m0p4xn' },
                }),
                teaser({
                  title: 'Lilla klädkammaren',
                  description: 'Maxa höstlovet med en rolig dag på Livrustkammaren för familjen.',
                  link: { href: 'https://livrustkammaren.se/besok/kalender/lilla-kladkammaren-2/' },
                  image: { url: 'https://livrustkammaren.se/wp-content/uploads/2035/10/lilla-kladkammaren.webp' },
                  labelText: 'Lov',
                  price: 'Fri entré för alla riddare, prinsar och prinsessor under 18 år.',
                  warning: false,
                  notice: false,
                  date: '25 oktober-1 november',
                }),
                teaser({
                  title: 'Visning: I kunglig tjänst – drabanter, hovfröknar och lakejer',
                  description: 'I Livrustkammarens nya färgsprakande utställning får du en inblick i livet vid hovet.',
                  link: {
                    href: 'https://livrustkammaren.se/besok/kalender/visning-i-kunglig-tjanst-drabanter-hovfroknar-och-lakejer/',
                  },
                  image: { url: 'https://livrustkammaren.se/wp-content/uploads/2035/06/kammarpagelivre.webp' },
                  labelText: 'Temavisning',
                  price: '200 kronor',
                  warning: false,
                  notice: false,
                  date: 'torsdag 25 oktober 18.00',
                  bookingLink: { href: 'https://secure.tickster.com/nzebemfw6c490vc' },
                }),
                // Utan datum — kan inte överleva importens datumvakt.
                teaser({
                  title: 'Utan datum',
                  description: 'Rad utan datum.',
                  link: { href: 'https://livrustkammaren.se/besok/kalender/utan-datum/' },
                  labelText: 'Övrigt',
                  date: undefined,
                }),
                // Redan pågående — startdatumet ligger i det förflutna.
                teaser({
                  title: 'Utställning som redan öppnat',
                  description: 'Kördes i år.',
                  link: { href: 'https://livrustkammaren.se/besok/kalender/gammal/' },
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
            blockName: 'shm/split-teaser',
            attrs: {
              title: 'Hatt Couture',
              description: 'Hatt Couture är en färgstark utställning om accessoaren hatten.',
              link: { href: 'https://livrustkammaren.se/utstallningar/hatt-couture/' },
              image: { url: 'https://livrustkammaren.se/wp-content/uploads/2035/09/hatt-couture.webp' },
              actionText: 'Om utställningen',
              labelText: 'till och med 6 december 2035',
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

const LISTING_URL = 'https://livrustkammaren.se/besok/kalender/';

describe('livrustkammaren adapter', () => {
  it('matchar bara livrustkammaren.se', () => {
    expect(matches('https://livrustkammaren.se/besok/kalender/')).toBe(true);
    expect(matches('https://www.livrustkammaren.se/besok/kalender/')).toBe(true);
    expect(matches('https://example.com/besok/kalender/')).toBe(false);
    expect(matches('https://historiska.se/besok-oss/pa-gang/')).toBe(false);
    expect(matches('https://livrustkammaren.se.evil.com/')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });

  it('läser titel, datum, tid och url ur NEXT_DATA-teasern', () => {
    const res = extract(FIXTURE, LISTING_URL, 'livrustkammaren');
    expect(res.method).toBe('livrustkammaren-listing');
    expect(res.events.length).toBe(3);

    const masked = res.events.find((e) => e.title === 'Riddarmaskerad');
    expect(masked).toBeDefined();
    expect(masked?.date).toBe('2035-10-27');
    expect(masked?.time).toBe('10:00');
    expect(masked?.endTime).toBe('12:00');
    expect(masked?.url).toBe('https://livrustkammaren.se/besok/kalender/riddarmaskerad/');
    expect(masked?.ticketUrl).toBe('https://secure.tickster.com/425cbdr52m0p4xn');
    expect(masked?.source).toBe('livrustkammaren');
    expect(masked?.venue).toBe('Livrustkammaren');
    expect(masked?.address).toBe('Slottsbacken 3, 111 30 Stockholm');
    expect(masked?.city).toBe('Stockholm');
    expect(masked?.category).toBe('Riddarklubben');
  });

  it('tar startdatumet ur ett datumintervall', () => {
    const res = extract(FIXTURE, LISTING_URL);
    const wardrobe = res.events.find((e) => e.title === 'Lilla klädkammaren');
    expect(wardrobe?.date).toBe('2035-10-25');
    expect(wardrobe?.endDate).toBe('2035-11-01');
    expect(wardrobe?.time).toBeUndefined();
    expect(wardrobe?.ticketUrl).toBeUndefined();
  });

  it('läser tid utan "klockan" och pris ur texten', () => {
    const res = extract(FIXTURE, LISTING_URL);
    const tour = res.events.find((e) => e.title.startsWith('Visning: I kunglig tjänst'));
    expect(tour?.date).toBe('2035-10-25');
    expect(tour?.time).toBe('18:00');
    expect(tour?.priceMin).toBe(200);
    expect(tour?.priceMax).toBe(200);
    expect(tour?.isFree).toBeUndefined();
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
    expect(titles).not.toContain('Hatt Couture');
  });

  it('gör inget på tom HTML', () => {
    const res = extract('<html><body>inget</body></html>', LISTING_URL);
    expect(res.events.length).toBe(0);
    expect(res.showUrls.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(FIXTURE, 'https://example.com/besok/kalender/');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('returnerar evenemangslänkarna som showUrls', () => {
    const res = extract(FIXTURE, LISTING_URL);
    expect(res.showUrls.length).toBe(3);
    expect(res.showUrls).toContain('https://livrustkammaren.se/besok/kalender/riddarmaskerad/');
  });

  it('härleder året ur filterlabel och veckodag', () => {
    const reference = { year: 2035, month: 10 };
    expect(parseWhen('Lördag 27 oktober klockan 10-12', reference)).toEqual({
      date: '2035-10-27',
      endDate: undefined,
      time: '10:00',
      endTime: '12:00',
    });
    expect(parseWhen('torsdag 25 oktober 18.00', reference)?.date).toBe('2035-10-25');
    expect(parseWhen('till och med 6 december 2035', reference)).toBeNull();
    expect(parseWhen('ingen datumtext', reference)).toBeNull();
  });
});
