/**
 * universal-extractor-date-title.test.ts — datum i rubriken får inte bli
 * eventets titel.
 *
 *vasamuseet.se lägger datumet i en `<h2>` och evenemangets namn i en `<h3>`
 * i samma kort:
 *
 *   <h2><span class="icon icon-clock"></span> 6 NOV, 14:30</h2>
 *   <h3 class="heading-arrow lowercase">Gustav Adolf - dagen</h3>
 *
 * Extractorn tog den FÖRSTA rubriken → sex events i databasen med titeln
 * "6 NOV, 14:30". Fixten: hoppa över rubriker som bara är ett datum.
 *
 * Negativ kontroll: kort där den första rubriken ÄR titeln (och bara den)
 * ska fortfarande fungera — vi får inte tappa bort events.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { extractEvents } from './universal-extractor';

const VASA_KALENDER = readFileSync(
  new URL('./__fixtures__/vasa-museum-kalender.html', import.meta.url),
  'utf8',
);

const BASE_URL = 'https://www.vasamuseet.se/sv/besok/aktuellt-program-pa-museet';

describe('universal-extractor — datum i rubriken är inte titeln', () => {
  it('hämtar riktiga titeln från vasa-museum-kalendern', () => {
    const result = extractEvents(VASA_KALENDER, 'vasa-museum', BASE_URL);
    expect(result.events.length).toBe(3);

    const titles = result.events.map(e => e.title);
    expect(titles).toContain('Gustav Adolf - dagen');
    expect(titles).toContain('FULLBOKAT! Magasinsvisning');
    expect(titles).toContain('Undergång – ett interaktivt deckarspel');
  });

  it('NEATIV KONTROLL: ingen titel får vara datum-formad', () => {
    const result = extractEvents(VASA_KALENDER, 'vasa-museum', BASE_URL);
    for (const evt of result.events) {
      expect(evt.title).not.toMatch(/^\d{1,2}\s+[A-ZÅÄÖ]{3,9},?\s*\d{1,2}[:.]\d{2}$/);
    }
  });

  it('behåller datum och tid oförändrade', () => {
    const result = extractEvents(VASA_KALENDER, 'vasa-museum', BASE_URL);
    const gustav = result.events.find(e => e.title === 'Gustav Adolf - dagen');
    expect(gustav).toBeDefined();
    expect(gustav?.date).toBe('2026-11-06');
    expect(gustav?.time).toBe('14:30');
  });

  it('NEATIV KONTROLL: kort med ENDAST en titel-rubrik ger fortfarande event', () => {
    const html = `
      <article class="calendar-item-partial tag-item partial-block">
        <a href="/sv/besok/kalender/program/enkelt-evenemang/" class="block-inner-box">
          <time datetime="2026-11-06T14:30">6 nov 14:30</time>
          <div class="special-block-heading without-tags">
            <h2>En kväll i salongen</h2>
          </div>
          <div class="calendar-event__info-container without-tags">
            <h3 class="heading-arrow lowercase">En kväll i salongen</h3>
          </div>
        </a>
      </article>`;
    const result = extractEvents(html, 'vasa-museum', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.map(e => e.title)).toContain('En kväll i salongen');
  });

  it('NEATIV KONTROLL: en titel som BÖRJAR med ett datum behålls', () => {
    const html = `
      <article class="calendar-item-partial tag-item partial-block">
        <a href="/sv/besok/kalender/program/1-maj/" class="block-inner-box">
          <time datetime="2026-05-01T20:00">1 maj 20:00</time>
          <div class="special-block-heading without-tags">
            <h2>1 MAJ – EFTERFESTEN MED KSMB</h2>
          </div>
          <div class="calendar-event__info-container without-tags">
            <h3 class="heading-arrow lowercase">1 MAJ – EFTERFESTEN MED KSMB</h3>
          </div>
        </a>
      </article>`;
    const result = extractEvents(html, 'debaser', BASE_URL);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.map(e => e.title)).toContain('1 MAJ – EFTERFESTEN MED KSMB');
  });
});
