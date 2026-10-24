/**
 * universal-extractor-date-range.test.ts — datumINTERVALL i svensk text.
 *
 * BUG (2026-10-24): "12-14 januari 2027" lästes av "European short"-mönstret
 * som dag 14 + månad 12 → 2026-12-14, nästan ett halvt år fel. Samma fel på
 * dansenshus.se ("12-13 maj 2026" → 2026-12-13).
 *
 * FIXEN: ett sifferpar som följs av ett svenskt månadsnamn är ett INTERVALL.
 * Startdagen blir eventets datum, slutdagen blir endDate.
 *
 * Negativa kontroller:
 *  - ett ENSTAKT datum ("15 januari 2027") får INTE få någon slutdag
 *  - ett sifferpar UTAN månadsnamn ("25-10") får INTE slås av intervallregeln
 *  - på en ARKIV-sida får ett årslöst intervall INTE få ett år infererat
 */

import { describe, it, expect } from 'vitest';
import {
  extractEvents,
  parseSwedishDateRange,
} from './universal-extractor';

const BASE_URL = 'https://www.pingst.se/pingstpastor2026/';

function card(html: string): string {
  return `<html><body><main>${html}</main></body></html>`;
}

describe('parseSwedishDateRange', () => {
  it('tolkar "12-14 januari 2027" som start + slut', () => {
    const r = parseSwedishDateRange('Konferensen 12-14 januari 2027 i Stockholm');
    expect(r).toEqual({ start: '2027-01-12', end: '2027-01-14' });
  });

  it('hanterar EN DASH och mellanslag mellan dagarna', () => {
    const r = parseSwedishDateRange('3 – 5 maj 2026');
    expect(r).toEqual({ start: '2026-05-03', end: '2026-05-05' });
  });

  it('fixar dansenshus-buggen: "12-13 maj 2026" (inte 2026-12-13)', () => {
    const r = parseSwedishDateRange('12-13 maj 2026');
    expect(r).toEqual({ start: '2026-05-12', end: '2026-05-13' });
  });

  it('årslöst intervall får närmaste framtida förekomst', () => {
    const r = parseSwedishDateRange('5-6 maj', { now: new Date('2026-01-01T00:00:00Z') });
    expect(r).toEqual({ start: '2026-05-05', end: '2026-05-06' });
  });

  it('årslöst intervall behåller året när starten passerat men slutet inte', () => {
    // 26 oktober: "23-28 oktober" PÅGÅR just nu. Start-dag-baserad
    // inferens skulle hoppa till 2027 och tappa evenemanget.
    const r = parseSwedishDateRange('23-28 oktober', { now: new Date('2026-10-26T00:00:00Z') });
    expect(r).toEqual({ start: '2026-10-23', end: '2026-10-28' });
  });

  it('årslöst intervall som passerat HELT hoppar ett år framåt', () => {
    const r = parseSwedishDateRange('23-28 oktober', { now: new Date('2026-11-01T00:00:00Z') });
    expect(r).toEqual({ start: '2027-10-23', end: '2027-10-28' });
  });

  it('NEATIV KONTROLL: utan månadsnamn är det INTE ett intervall', () => {
    expect(parseSwedishDateRange('Öppettider 12-14 varje dag')).toBeNull();
    expect(parseSwedishDateRange('25/03')).toBeNull();
    expect(parseSwedishDateRange('maj')).toBeNull();
  });

  it('NEATIV KONTROLL: allowInferredYear=false ger null för årslöst intervall', () => {
    expect(parseSwedishDateRange('5-6 maj', { allowInferredYear: false })).toBeNull();
    // Med år i texten fungerar det fortfarande — inget år infereras.
    expect(parseSwedishDateRange('5-6 maj 2026', { allowInferredYear: false }))
      .toEqual({ start: '2026-05-05', end: '2026-05-06' });
  });

  // 2026-10-24 — månadsnamnet måste vara ett HELT ord. "mar" i "Maria" är
  // inte mars. Utan skydden lästes "… lördag den 24/10 kl 12-17Maria
  // Larkman" som intervallet 12–17 mars.
  it('NEATIV KONTROLL: månadsnamnet måste vara ett helt ord', () => {
    expect(parseSwedishDateRange('Maria Larkman 12-17')).toBeNull();
    expect(parseSwedishDateRange('12-17 Maria')).toBeNull();
    expect(parseSwedishDateRange('12-17 Julia')).toBeNull();
    expect(parseSwedishDateRange('12-17 Janne')).toBeNull();
  });

  it('REGRESSION: "maj2026" (utan mellanslag) får fortfarande sitt år', () => {
    expect(parseSwedishDateRange('12-17 maj2026'))
      .toEqual({ start: '2026-05-12', end: '2026-05-17' });
  });
});

describe('universal-extractor — datumintervall', () => {
  it('REGRESSION: "12-14 januari 2027" ger inte 2026-12-14', () => {
    const html = card(`
      <article class="event">
        <h2>Varmt välkommen till Pingst Pastor Konferens den 12–14 januari 2027</h2>
        <p>2027 möts vi 12-14 januari i Filadelfiakyrkan, Stockholm</p>
        <a href="/om-pingst/pastor/">Läs mer</a>
      </article>
    `);
    const result = extractEvents(html, 'pingstkyrkan', BASE_URL);
    const evts = result.events.filter(e => /Konferens/i.test(e.title));
    expect(evts.length).toBeGreaterThan(0);
    for (const e of evts) {
      expect(e.date).not.toBe('2026-12-14');
      expect(e.date).toBe('2027-01-12');
      expect(e.endDate).toBe('2027-01-14');
    }
  });

  it('NEATIV KONTROLL: ett enstakat datum får ingen slutdag', () => {
    const html = card(`
      <article class="event">
        <h2>Konsert i Filadelfiakyrkan</h2>
        <p>15 januari 2027 kl 19:00</p>
        <a href="/konsert/">Läs mer</a>
      </article>
    `);
    const result = extractEvents(html, 'testkalla', BASE_URL);
    const evts = result.events.filter(e => /Konsert/i.test(e.title));
    expect(evts.length).toBeGreaterThan(0);
    expect(evts[0].date).toBe('2027-01-15');
    expect(evts[0].endDate).toBeUndefined();
  });

  it('NEATIV KONTROLL: sifferpar utan månadsnamn fungerar fortfarande', () => {
    const html = card(`
      <article class="event">
        <h2>Event 25-10 i Stockholm</h2>
        <a href="/event/">Läs mer</a>
      </article>
    `);
    const result = extractEvents(html, 'testkalla', BASE_URL);
    const evts = result.events.filter(e => /Event 25-10/i.test(e.title));
    expect(evts.length).toBeGreaterThan(0);
    expect(evts[0].date).toMatch(/^\d{4}-10-25$/);
    expect(evts[0].endDate).toBeUndefined();
  });

  // 2026-10-24 — REGRESSION: "Maria" är inte "mars". Utan skyddet läste
  // extractorn "… lördag den 24/10 kl 12-17" (där "17" följs av namnet
  // "Maria") som intervallet 12–17 mars.
  it('REGRESSION: ett namn som BÖRjar med ett månadsnamn är inte ett datum', () => {
    // Länken bär namnet — precis som på dn-kalendariet. Där blir texten
    // "… kl 12-17" + "Maria Larkman", alltså "12-17Maria" utan mellanslag.
    const html = card(`
      <article class="event">
        <h2>Maria Larkman</h2>
        <p>”Attraktion” en utställning med vernissage lördag den 24/10 kl 12-17</p>
        <a href="/x/maria-larkman/">Maria Larkman</a>
      </article>
    `);
    const result = extractEvents(html, 'dn-kalendariet', BASE_URL);
    const evts = result.events.filter(e => /Maria Larkman/i.test(e.title));
    expect(evts.length).toBeGreaterThan(0);
    expect(evts[0].date).toBe('2026-10-24');
    expect(evts[0].endDate).toBeUndefined();
  });
});
