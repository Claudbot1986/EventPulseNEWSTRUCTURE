/**
 * Kammaren-adapterns tester.
 *
 * Fixturen är en rå skiva ur den RIKTIGA markupen (2026-10-24) från
 * `https://kammaren.com/program/` — se `../__fixtures__/kammaren-program.html`.
 * Den är genererad ur den nedladdade sidan, inte handskriven, så att
 * `&nbsp;`, `&#8211;`, de nästlade spannen och den "grå" yttre wrapperen
 * (`color: #999999`) som ibland bär BÅDE datum och titel finns med exakt som
 * de ser ut live.
 *
 * Sex programrader finns med: februari, mars, april, september, oktober
 * (förflutna) och november (framtid).
 *
 * Negativ kontroll: en sida utan "Program <år>" ska INTE ge några rader —
 * annars skulle adaptern hitta på ett år.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { matches, parseSeasonYear, parseConcertTimes, parseProgram, extract } from './kammaren';

const PROGRAM = readFileSync(
  new URL('../__fixtures__/kammaren-program.html', import.meta.url),
  'utf8'
);

describe('kammaren adapter', () => {
  it('matchar bara kammaren.com', () => {
    expect(matches('https://kammaren.com/program/')).toBe(true);
    expect(matches('https://www.kammaren.com/')).toBe(true);
    expect(matches('https://kungstradgarden.stockholm/evenemang/')).toBe(false);
  });

  it('läser säsongsåret ur rubriken', () => {
    expect(parseSeasonYear(PROGRAM)).toBe(2026);
  });

  it('läser konserttiderna ur säsongsnoten', () => {
    expect(parseConcertTimes(PROGRAM)).toEqual(['16:15', '19:45']);
  });

  it('läser programraderna med datum, titel och beskrivning', () => {
    const rows = parseProgram(PROGRAM);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      title: 'Lorenzo Coppola (chalumeaux) möter Orfeus Barock',
      dayStart: 11,
      dayEnd: 12,
      month: 2,
    });
    expect(rows[0].description).toContain('rivstartar säsongen');
    expect(rows[3].title).toBe('Opus13');
    expect(rows[5].title).toBe('Emil Holmström (piano) & Emma Nyman (violin)');
    expect(rows[5].description).toContain('Pianisten Emil Holmström');
  });

  it('skapar en rad per dag och konserttid', () => {
    const result = extract(PROGRAM, 'https://kammaren.com/program/');
    expect(result.method).toBe('kammaren-program');
    // 6 programrader × 2 dagar × 2 konserttider = 24 rader.
    expect(result.events).toHaveLength(24);
    expect(result.events.every((e) => e.venue === 'Kammaren')).toBe(true);
    expect(result.events.every((e) => e.city === 'Stockholm')).toBe(true);
  });

  it('sätter rätt datum på novemberraden (året kommer ur rubriken)', () => {
    const result = extract(PROGRAM, 'https://kammaren.com/program/');
    const november = result.events.filter((e) => e.title.includes('Holmström'));
    expect(november.map((e) => e.date)).toEqual([
      '2026-11-11',
      '2026-11-11',
      '2026-11-12',
      '2026-11-12',
    ]);
    expect([...new Set(november.map((e) => e.time))]).toEqual(['16:15', '19:45']);
  });

  it('NEGATIV KONTROLL — utan säsongsrubrik hittas inga rader', () => {
    const withoutYear = PROGRAM.replace('Program 2026', 'Program');
    expect(parseSeasonYear(withoutYear)).toBeNull();
    expect(extract(withoutYear, 'https://kammaren.com/program/').events).toHaveLength(0);
  });

  it('NEGATIV KONTROLL — en sida utan programrader ger inget', () => {
    const result = extract(
      '<html><body><p>Konserttid båda dagarna kl 16.15.</p></body></html>',
      'https://kammaren.com/program/',
    );
    expect(result.events).toHaveLength(0);
    expect(result.method).toBe('none');
  });
});
