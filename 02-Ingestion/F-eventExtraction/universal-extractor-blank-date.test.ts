/**
 * Blankstegsdatum i extraktorn — 2026-10-24.
 *
 * VARFÖR detta test finns: en tom `datetime`-attribut ("<time datetime='\n  '>")
 * gav ett "datum" av blanksteg. Följden var dubbel:
 *
 *   1. Importen kastade bort raden (datumet var inte giltigt), så eventet
 *      kom aldrig in i databasen.
 *   2. Extraktorn AVSLUTADE sin datumjakt så fort den sett attributet, så
 *      kortets riktiga datum ("17 oktober 2026") lästes aldrig.
 *
 * Punkt 2 är den som gjorde källor "fastna": kortet varje gång gav 0
 * användbara events trots att sidan tydligt stod med datum i brödtexten.
 *
 * BEVIS FÖR GENERAL (Generalization Protection Rule): 15 orelaterade
 * domaner gav blanksteg-datum — 3arena.se, liseberg.se, lund.se,
 * malm-konserthus.se, malm-live.se, molndals-futsal.se, oland.se,
 * studio-acusticum.se, kungsbacka.se, goteborgs-litteraturhus.se,
 * svenska-tennisf-rbundet.se, lth.se, malarenergi-arena.se, liseberg-n-je.se,
 * malmo-live.se. Det är inte ett sitedomändrag — det är HTML-kontraktet.
 */

import { describe, it, expect } from 'vitest';
import { extractEvents } from './universal-extractor';

const BASE_URL = 'https://3arena.se/';

/** Ett kort med en TOM datetime-attribut — formen 3arena.se levererar. */
function cardWithBlankDatetime(inner: string): string {
  return `<!doctype html>
<html lang="sv">
<body>
  <article class="event-card">
    <h2>${inner}</h2>
    <time datetime="
    ">${inner}</time>
    <a href="/evenemang/musik-show/robyn/">Robyn</a>
  </article>
</body>
</html>`;
}

describe('extraktorn — tom datetime-attribut', () => {
  it('läser datumet i korttexten när datetime-attributet är tomt', () => {
    const html = cardWithBlankDatetime('17 oktober 2026 Robyn The Sexistential Tour');
    const result = extractEvents(html, '3arena', BASE_URL);
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-10-17');
  });

  it('läser ett datumINTERVALL i korttexten när datetime-attributet är tomt', () => {
    const html = cardWithBlankDatetime(
      '11 oktober – 23 november 2026 Hammarby Fotboll Herrar, säsongen 2026',
    );
    const result = extractEvents(html, '3arena', BASE_URL);
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-10-11');
    expect(result.events[0].endDate).toBe('2026-11-23');
  });

  it('NEGATIV KONTROLL — hittar INTE på ett datum när kortet saknar datum', () => {
    const html = cardWithBlankDatetime(
      'Hemmaborgen för två av Stockholmslagen i fotbollsallsvenskan och arenan för de stora världsartisterna.',
    );
    const result = extractEvents(html, '3arena', BASE_URL);
    expect(result.events.length).toBe(0);
  });

  it('NEGATIV KONTROLL — skriver aldrig ut blanksteg som datum', () => {
    const html = cardWithBlankDatetime('17 oktober 2026 Robyn');
    const result = extractEvents(html, '3arena', BASE_URL);
    for (const evt of result.events) {
      expect(evt.date.trim()).toBe(evt.date);
      expect(evt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('extraktorn — giltig datetime-attribut vinner fortfarande', () => {
  it('NEGATIV KONTROLL — attributet används när det är giltigt, även om texten har ett annat datum', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <article class="event-card">
    <h2>Robyn</h2>
    <time datetime="2026-08-22T19:00">17 oktober 2026</time>
    <a href="/evenemang/musik-show/robyn/">Robyn</a>
  </article>
</body>
</html>`;
    const result = extractEvents(html, '3arena', BASE_URL);
    expect(result.events.length).toBe(1);
    // Maskinläsbart attribut (absolut) slår brödtexten (undantag).
    expect(result.events[0].date).toBe('2026-08-22');
    expect(result.events[0].time).toBe('19:00');
  });

  it('NEGATIV KONTROLL — data-date med blanksteg faller tillbaka till korttexten', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <article class="event-card" data-date="  ">
    <h2>Robyn</h2>
    <p>17 oktober 2026 Robyn The Sexistential Tour</p>
    <a href="/evenemang/musik-show/robyn/">Robyn</a>
  </article>
</body>
</html>`;
    const result = extractEvents(html, '3arena', BASE_URL);
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-10-17');
  });
});

describe('extraktorn — datumfältet får aldrig bära en klocktid', () => {
  it('NEGATIV KONTROLL — en ISO-stämpel med klockslag ger ett rent datum i date-fältet', () => {
    const html = `<!doctype html>
<html lang="sv">
<body>
  <article class="event-card">
    <h2>Trollhättan</h2>
    <p>Start 2026-11-13T01:00:00 i hallen</p>
    <a href="/evenemang/trollhattan/">Trollhättan</a>
  </article>
</body>
</html>`;
    const result = extractEvents(html, 'trollhattan', 'https://trollhattan.se/');
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe('2026-11-13');
    expect(result.events[0].date).not.toContain(' ');
  });
});
