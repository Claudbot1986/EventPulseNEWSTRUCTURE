/**
 * Månadsnamnens ordgräns — 2026-10-24.
 *
 * VARFÖR detta test finns: månadsnamnen i extraktorn avslutades med `\b`
 * (word boundary). Men en siffra ÄR ett "word-tecken" — mellan "oktober" och
 * "1" finns alltså INGEN word boundary. Földen:
 *
 *   "29 oktober185 - 325 kr"   (berwaldhallen.se)
 *
 * lästes som "29 oktober" UTAN datum, eftersom månadsnamnet aldrig matchade.
 * Kortet fick då ingen datum-signal, C3 expanderade upp till en behållare
 * med ett enda annat datum ("6 november") — och ALLA konserter i listan
 * fick samma datum. 21 av 22 rader blev fel.
 *
 * Filen innehåller redan rätt regel (`SWE_MONTH_NOT_LETTER` = "efter
 * månadsnamnet får inte komma en bokstav") — men tre regexar använde ändå
 * `\b`. Det här testet låser rätt form.
 *
 * BEVIS FÖR GENERAL (Generalization Protection Rule): samma felform mätte på
 * fem orelaterade domäner — berwaldhallen.se (22 rader), fotografiska.se
 * (16), konserthuset-2 (1), nationalmuseum.se (1), rival.se (1). Det är
 * HTML-kontraktet "månadsnamn följt av en siffra", inte ett sitedomänproblem.
 */

import { describe, it, expect } from 'vitest';
import { extractEvents } from './universal-extractor';

const TODAY_ISO = new Date().toISOString().slice(0, 10);

/**
 * Ett evenemangskort där månadsnamnet sitter i ett eget element och
 * PRISET direkt efter — utan mellanrum. Det är formen som gav
 * "29 oktober185".
 */
const BERWALDHALLEN_HTML = `<!doctype html>
<html lang="sv">
<body>
  <div class="Post-content">
    <ul class="Post-list">
      <li class="Blurb Blurb--default">
        <div class="Blurb-info"><span class="Blurb-date">29 oktober</span><span class="Blurb-price">185 kr</span></div>
        <a class="Blurb-link" href="/konsert/streetstar-dance-school-challenge-2026/">Streetstar Dance School Challenge 2026</a>
      </li>
      <li class="Blurb Blurb--default">
        <div class="Blurb-info"><span class="Blurb-date">6 november</span> <span class="Blurb-price">325 kr</span></div>
        <a class="Blurb-link" href="/konsert/annan-konsert/">En annan konsert</a>
      </li>
    </ul>
  </div>
</body>
</html>`;

/** C1-kort: ett årslöst datum som följs direkt av en siffra. */
const C1_HTML = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h2>Jazzkväll</h2>
    <span>23 okt</span><span>185 kr</span>
    <a href="/jazzkvall/">Jazzkväll</a>
  </div>
</body>
</html>`;

describe('extraktorn — månadsnamn följt av en siffra', () => {
  it('C3 — läser "29 oktober185" som 29 oktober, inte som konsertens datum', () => {
    const result = extractEvents(BERWALDHALLEN_HTML, 'berwaldhallen', 'https://berwaldhallen.se/');
    const streetstar = result.events.find(
      (e) => e.title === 'Streetstar Dance School Challenge 2026',
    );
    expect(streetstar).toBeDefined();
    // Månad + dag är stabila; året rullas över när datumet passerat.
    expect(streetstar!.date.slice(5)).toBe('10-29');
    expect(streetstar!.date >= TODAY_ISO).toBe(true);
  });

  it('C3 — den andra konserten behåller SITT datum (29 oktober får inte smitta)', () => {
    const result = extractEvents(BERWALDHALLEN_HTML, 'berwaldhallen', 'https://berwaldhallen.se/');
    const other = result.events.find((e) => e.title === 'En annan konsert');
    expect(other).toBeDefined();
    expect(other!.date.slice(5)).toBe('11-06');
  });

  it('C1 — läser "23 okt185" som 23 oktober', () => {
    const result = extractEvents(C1_HTML, 'jazzkvall', 'https://jazzkvall.se/');
    const jazz = result.events.find((e) => e.title === 'Jazzkväll');
    expect(jazz).toBeDefined();
    expect(jazz!.date.slice(5)).toBe('10-23');
    expect(jazz!.date >= TODAY_ISO).toBe(true);
  });
});

describe('extraktorn — månadsnamnet måste vara ett helt ord', () => {
  it('NEGATIV KONTROLL — "12 maria" är inte 12 mars', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h2>Maria Larkmans konsert</h2>
    <p>12 maria Björk</p>
    <a href="/maria-larkman/">Maria Larkmans konsert</a>
  </div>
</body>
</html>`;
    const result = extractEvents(html, 'maria-larkman', 'https://maria-larkman.se/');
    expect(result.events.some((e) => e.date === '2026-03-12')).toBe(false);
    expect(result.events.length).toBe(0);
  });

  it('NEGATIV KONTROLL — "Julia" i ett namn ger inget mars-datum', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h2>Julia Larssons julkonsert</h2>
    <p>Julia spelar i jul</p>
    <a href="/julia-larsson/">Boka</a>
  </div>
</body>
</html>`;
    const result = extractEvents(html, 'julia-larsson', 'https://julia-larsson.se/');
    expect(result.events.some((e) => e.date.slice(5) === '07-01')).toBe(false);
  });
});

describe('extraktorn — datumintervall med år överlever månadsnamnregeln', () => {
  it('NEGATIV KONTROLL — "12-14 januari 2027" är fortfarande ett intervall', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h2>Tre dagar i januari</h2>
    <p>12-14 januari 2027</p>
    <a href="/tre-dagar/">Tre dagar i januari</a>
  </div>
</body>
</html>`;
    const result = extractEvents(html, 'tre-dagar', 'https://tre-dagar.se/');
    const evt = result.events.find((e) => e.title === 'Tre dagar i januari');
    expect(evt).toBeDefined();
    expect(evt!.date).toBe('2027-01-12');
    expect(evt!.endDate).toBe('2027-01-14');
  });
});
