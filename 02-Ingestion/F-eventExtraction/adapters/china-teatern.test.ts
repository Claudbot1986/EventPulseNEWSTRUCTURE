/**
 * China Teatern (chinateatern.se) adapter tests — synthetic HTML fixtures
 */
import { describe, it, expect } from 'vitest';
import * as chinaTeatern from './china-teatern';

const SHOW_HTML = `
<!doctype html>
<html lang="sv">
<head>
  <title>Oh What a Night - China Teatern</title>
  <meta property="og:title" content="Oh What a Night" />
  <meta property="og:description" content="Musikalmagi" />
  <meta property="og:image" content="https://www.chinateatern.se/media/oh-what.jpg" />
</head>
<body>
  <h1>Oh What a Night</h1>
  <div class="show-hero__date"><p> 7 jan, 2027 - 16 jan, 2027 </p></div>

  <h3>Kommande speltillfällen</h3>
  <div class="ticket-card">
    <div class="ticket-card__wrapper">
      <h4>Torsdag 7 jan, 19:30</h4>
      <p class="ticket-card__date">Torsdag 7 jan, 19:30 • China Teatern, Stockholm</p>
      <p>från 395 kr</p>
    </div>
    <div class="ticket-card__cta-wrapper">
      <a class="ticket-card__cta" href="https://shop.showtic.se/abc123">Boka biljett</a>
    </div>
  </div>
  <div class="ticket-card">
    <div class="ticket-card__wrapper">
      <h4>Fredag 8 jan, 19:30</h4>
      <p class="ticket-card__date">Fredag 8 jan, 19:30 • China Teatern, Stockholm</p>
      <p>från 395 kr</p>
    </div>
    <div class="ticket-card__cta-wrapper">
      <a class="ticket-card__cta" href="https://shop.showtic.se/def456">Boka biljett</a>
    </div>
  </div>
  <div class="ticket-card">
    <div class="ticket-card__wrapper">
      <h4>Lördag 9 jan, 15:00</h4>
      <p class="ticket-card__date">Lördag 9 jan, 15:00 • China Teatern, Stockholm</p>
      <p>från 295 kr</p>
    </div>
    <div class="ticket-card__cta-wrapper">
      <a class="ticket-card__cta" href="https://shop.showtic.se/ghi789">Boka biljett</a>
    </div>
  </div>

  <h3>Turné</h3>
  <ul>
    <li>2 oktober kl. 19.30: Skellefteå Sara Kulturhus</li>
    <li>10 oktober kl. 19.30: Örebro Conventum Arena</li>
  </ul>

  <h5>Spelas</h5>
  <div class="info-section__wrapper"><p>7 jan - 16 jan 2027</p></div>
</body>
</html>
`;

const LISTING_HTML = `
<!doctype html>
<html lang="sv">
<head><title>Föreställningar - China Teatern</title></head>
<body>
  <a href="https://www.chinateatern.se/shower/oh-what-a-night">Oh What a Night</a>
  <a href="/shower/lena-fran-vetlanda/">Lena från Vetlanda</a>
  <a href="/shower/spoktimmen-10-ar-av-skrack">Spöktimmen</a>
  <a href="/shower/oh-what-a-night">dup</a>
</body>
</html>
`;

describe('china-teatern adapter', () => {
  describe('matches', () => {
    it('matches chinateatern.se URLs', () => {
      expect(chinaTeatern.matches('https://www.chinateatern.se/forestallningar/')).toBe(true);
      expect(chinaTeatern.matches('https://chinateatern.se/shower/foo/')).toBe(true);
    });
    it('rejects other domains', () => {
      expect(chinaTeatern.matches('https://example.com/forestallningar/')).toBe(false);
      expect(chinaTeatern.matches('not-a-url')).toBe(false);
    });
  });

  describe('show extraction', () => {
    it('extracts Stockholm performances from ticket-card section', () => {
      const r = chinaTeatern.extract(
        SHOW_HTML,
        'https://www.chinateatern.se/shower/oh-what-a-night/'
      );
      expect(r.method).toBe('china-teatern-show');
      expect(r.events.length).toBe(3);
      expect(r.events[0].title).toBe('Oh What a Night');
      expect(r.events[0].date).toBe('2027-01-07');
      expect(r.events[0].time).toBe('19:30');
      expect(r.events[0].venue).toBe('China Teatern');
      expect(r.events[0].city).toBe('Stockholm');
      expect(r.events[0].priceMin).toBe(395);
      expect(r.events[0].category).toBe('musikaler');
      expect(r.events[0].ticketUrl).toBe('https://shop.showtic.se/abc123');
    });

    it('returns method=none for non-chinateatern URL', () => {
      const r = chinaTeatern.extract(
        SHOW_HTML,
        'https://example.com/shower/oh-what-a-night/'
      );
      expect(r.method).toBe('none');
    });
  });

  describe('listing extraction', () => {
    it('extracts show URLs from /forestallningar/ (deduped)', () => {
      const r = chinaTeatern.extract(LISTING_HTML, 'https://www.chinateatern.se/forestallningar/');
      expect(r.method).toBe('china-teatern-listing');
      expect(r.showUrls.length).toBe(3);
      expect(r.showUrls).toContain('https://www.chinateatern.se/shower/oh-what-a-night/');
    });
  });
});
