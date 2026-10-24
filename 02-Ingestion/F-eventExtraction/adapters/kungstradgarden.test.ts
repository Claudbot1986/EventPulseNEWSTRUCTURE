/**
 * Kungsträdgården-adapterns tester.
 *
 * Fixturen är klippt ur den RIKTIGA markupen (2026-10-24) från
 * `https://kungstradgarden.stockholm/evenemang/`. Wayback-snapshotet
 * 2025-08-01 innehöll 9 riktiga evenemang; tre av dem ligger i fixturen.
 * Den LIVE-sidan är tom (0 artiklar) — det fallet täcks också.
 */
import { describe, it, expect } from 'vitest';
import { matches, parseListing, parseTimeRange, extract } from './kungstradgarden';

const LISTING = `
<section class="block block-event-list">
  <div class="article-list">
    <article class="article article-list__item article-list__item--narrow slidein__item">
      <header class="article__head article__head--narrow">
        <div class="media">
          <div class="media__image">
            <div class="date-label"><p class="date-label__date">2</p><p class="date-label__month">aug</p></div>
          </div>
          <div class="media__body">
            <h2 class="article__header article__header--small"><a href="https://kungstradgarden.stockholm/evenemang/sverige-tillber-jesus/" class="article__link">Sverige Tillber Jesus</a></h2>
            <time datetime="2025-08-02 00:00:00" class="article__date article__date--small article__date--uppercase">
              2 augusti 2025 <span class="article__date__time">13:00–22:00</span>
            </time>
          </div>
        </div>
      </header>
      <div class="article__text text">
        <a href="https://kungstradgarden.stockholm/evenemang/sverige-tillber-jesus/" class="article__link">
          <p>Över 60 församlingar och organisationer från olika samfund finns med bakom den här dagen. På plats finns Food Trucks för mat och gemenskap.</p>
        </a>
      </div>
    </article>
    <article class="article article-list__item article-list__item--narrow slidein__item">
      <header class="article__head article__head--narrow">
        <div class="media">
          <div class="media__image">
            <div class="date-label"><p class="date-label__date">23</p><p class="date-label__month">aug</p></div>
          </div>
          <div class="media__body">
            <h2 class="article__header article__header--small"><a href="https://kungstradgarden.stockholm/evenemang/hjarta-stockholm-festival-for-fred/" class="article__link">Hjärta Stockholm – festival för fred</a></h2>
            <time datetime="2025-08-23 00:00:00" class="article__date article__date--small article__date--uppercase">
              23 augusti 2025 <span class="article__date__time">11:00–16:00</span>
            </time>
          </div>
        </div>
      </header>
      <div class="article__text text">
        <a href="https://kungstradgarden.stockholm/evenemang/hjarta-stockholm-festival-for-fred/" class="article__link">
          <p>Kyrkorna inom Sveriges kristna råd bjuder in stockholmare och förbipasserande till en folkfest för alla åldrar.</p>
        </a>
      </div>
    </article>
    <article class="article article-list__item article-list__item--narrow slidein__item">
      <header class="article__head article__head--narrow">
        <div class="media">
          <div class="media__image">
            <div class="date-label"><p class="date-label__date">28</p><p class="date-label__month">aug</p></div>
          </div>
          <div class="media__body">
            <h2 class="article__header article__header--small"><a href="https://kungstradgarden.stockholm/evenemang/adidas-stockholm-halvmarathon-expo-28-30-augusti-2025/" class="article__link">Adidas Stockholm Halvmarathon Expo 28-30 augusti 2025</a></h2>
            <time datetime="2025-08-28 00:00:00" class="article__date article__date--small article__date--uppercase">
              28 augusti 2025 <span class="article__date__time">16:00–19:00</span>
            </time>
          </div>
        </div>
      </header>
      <div class="article__text text">
        <a href="https://kungstradgarden.stockholm/evenemang/adidas-stockholm-halvmarathon-expo-28-30-augusti-2025/" class="article__link">
          <p>Välkommen att besöka Stockholm Halvmarathons Expo i Kungsträdgården torsdag 28 augusti kl. 16-19.</p>
        </a>
      </div>
    </article>
    <article class="article article-list__item article-list__item--narrow slidein__item">
      <header class="article__head article__head--narrow">
        <div class="media"><div class="media__body">
          <h2 class="article__header article__header--small"><a href="https://kungstradgarden.stockholm/evenemang/evenemang-utan-datum/" class="article__link">Evenemang utan datum</a></h2>
        </div></div>
      </header>
      <div class="article__text text"><p>Datumet meddelas senare.</p></div>
    </article>
  </div>
</section>
`;

/** Så ser den live-sidan ut 2026-10-24: blocket finns men är tomt. */
const EMPTY_LISTING = `
<section class="block block-event-list">
  <div class="article-list"></div>
</section>
`;

describe('kungstradgarden adapter', () => {
  it('matchar bara kungstradgarden-domänerna', () => {
    expect(matches('https://kungstradgarden.stockholm/evenemang/')).toBe(true);
    expect(matches('https://www.kungstradgarden.stockholm/evenemang/')).toBe(true);
    expect(matches('https://kungstradgarden.se/')).toBe(true);
    expect(matches('https://example.com/evenemang/')).toBe(false);
    expect(matches('https://www.kultur1.se/calendar_lan.php')).toBe(false);
    expect(matches('https://riksarkivet.se/kalendarium')).toBe(false);
    expect(matches('ingen url')).toBe(false);
  });

  it('läser tidsfönstret ur article__date__time', () => {
    expect(parseTimeRange('13:00–22:00')).toEqual({ time: '13:00', endTime: '22:00' });
    expect(parseTimeRange('16:00-19:00')).toEqual({ time: '16:00', endTime: '19:00' });
    expect(parseTimeRange('09:00')).toEqual({ time: '09:00', endTime: null });
    expect(parseTimeRange(null)).toEqual({ time: null, endTime: null });
  });

  it('läser titel, datum och tid ur artiklarna', () => {
    const rows = parseListing(LISTING);
    expect(rows.length).toBe(4);
    expect(rows[0].title).toBe('Sverige Tillber Jesus');
    expect(rows[0].date).toBe('2025-08-02');
    expect(rows[0].time).toBe('13:00');
    expect(rows[0].endTime).toBe('22:00');
    expect(rows[0].url).toBe('https://kungstradgarden.stockholm/evenemang/sverige-tillber-jesus/');
  });

  it('hoppar över artiklar utan datum', () => {
    const res = extract(LISTING, 'https://kungstradgarden.stockholm/evenemang/');
    expect(res.events.length).toBe(3);
    expect(res.events.some((e) => e.title === 'Evenemang utan datum')).toBe(false);
  });

  it('läser inte den dekorativa date-label som datum', () => {
    const res = extract(LISTING, 'https://kungstradgarden.stockholm/evenemang/');
    expect(res.events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
  });

  it('extraherar tre evenemang ur listan', () => {
    const res = extract(LISTING, 'https://kungstradgarden.stockholm/evenemang/');
    expect(res.method).toBe('kungstradgarden-listing');
    expect(res.events.length).toBe(3);
    expect(res.events[0].venue).toBe('Kungsträdgården');
    expect(res.events[0].address).toBe('Jussi Björlings allé 10, Kungsträdgården');
    expect(res.events[0].city).toBe('Stockholm');
    expect(res.events[0].source).toBe('kungstradgarden-2');
    expect(res.events[0].description).toContain('församlingar');
    expect(res.showUrls.length).toBe(3);
  });

  it('hittar inget på den tomma live-sidan', () => {
    const res = extract(EMPTY_LISTING, 'https://kungstradgarden.stockholm/evenemang/');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('gör inget på främmande URL', () => {
    const res = extract(LISTING, 'https://example.com/evenemang/');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });

  it('hanterar HTML utan evenemang', () => {
    const res = extract('<html><body>inget</body></html>', 'https://kungstradgarden.stockholm/evenemang/');
    expect(res.events.length).toBe(0);
    expect(res.method).toBe('none');
  });
});
