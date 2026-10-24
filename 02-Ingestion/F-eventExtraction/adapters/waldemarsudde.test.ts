/**
 * Waldemarsudde-adapterns tester.
 *
 * Fixturen är NIO verkliga WordPress-"activity"-poster hämtade ur
 * waldemarsudde.se:s WP-REST-API den 24 oktober 2026 (sida 1–4 av
 * /wp-json/wp/v2/activity). Objekten är ordagranna kopior — inget är
 * handskrivet — så att testet speglar den markup som faktiskt lever.
 * Se `../__fixtures__/waldemarsudde-activities.json`.
 *
 * Posterna täcker varje uppmätt datumformat:
 *   veckodag + månad + tid, komma före kl, år i texten, saknad veckodag,
 *   numeriskt D/M, engelska poster och datum utan tid.
 *
 * Två poster är flerdagarskurser ("Tre lördagar: …", "Tisdag – torsdag
 * 11–13 augusti") och får INTE ge något event — en kurs med tre datum ska
 * inte bli ett event med ett godtyckligt datum.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  matches,
  parseActivities,
  parseEventDate,
  resolveYear,
  resolveUnprovenYear,
  isMultiDate,
  decodeHtml,
  extractPlainText,
  toEvent,
  extract,
  type WaldemarsuddeActivity,
} from './waldemarsudde';

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../__fixtures__/waldemarsudde-activities.json', import.meta.url),
    'utf8',
  ),
) as WaldemarsuddeActivity[];

const FIXTURE_JSON = JSON.stringify(FIXTURE);

/** Publiceringsdatumet för posten som innehåller den givna texten. */
function activityFor(fragment: string): WaldemarsuddeActivity {
  const found = FIXTURE.find((a) => extractPlainText(a.content?.rendered ?? '').includes(fragment));
  if (!found) throw new Error(`fixture saknar posten: ${fragment}`);
  return found;
}

/** Datum + tid som texten i adapterns egen format ger. */
function dateOf(fragment: string): { date: string; time?: string; endTime?: string } | null {
  const activity = activityFor(fragment);
  const parsed = parseEventDate(
    extractPlainText(activity.content?.rendered ?? ''),
    new Date(activity.date ?? ''),
  );
  if (!parsed) return null;
  return { date: parsed.date, time: parsed.time, endTime: parsed.endTime };
}

describe('waldemarsudde adapter', () => {
  it('matchar bara waldemarsudde.se', () => {
    expect(matches('https://waldemarsudde.se/')).toBe(true);
    expect(matches('https://www.waldemarsudde.se/wp-json/wp/v2/activity')).toBe(true);
    expect(matches('https://kammaren.com/program/')).toBe(false);
    expect(matches('inte en url')).toBe(false);
  });

  it('läser WP-REST-svaret som en lista aktiviteter', () => {
    const parsed = parseActivities(FIXTURE_JSON);
    expect(parsed).toHaveLength(9);
    expect(parsed[0].title?.rendered).toBeTruthy();
    expect(parseActivities('inte json')).toEqual([]);
    expect(parseActivities('{"a":1}')).toEqual([]);
  });

  it('läser veckodag + månad + tid — och bevisar året', () => {
    const result = dateOf('Torsdag 29 oktober kl 13.00-15.00');
    expect(result).toEqual({ date: '2026-10-29', time: '13:00', endTime: '15:00' });
  });

  it('läser komma före kl ("Söndag 29 november, kl. 10.00")', () => {
    const result = dateOf('Söndag 29 november, kl. 10.00');
    expect(result).toEqual({ date: '2026-11-29', time: '10:00', endTime: '11:30' });
  });

  it('läser året som står i texten', () => {
    const result = dateOf('Söndag 11 oktober 2026 Kl. 13.00');
    expect(result).toEqual({ date: '2026-10-11', time: '13:00', endTime: '15:00' });
  });

  it('läser numeriskt D/M ("Torsdag 13/8, kl.13.00")', () => {
    const result = dateOf('Torsdag 13/8, kl.13.00');
    expect(result).toEqual({ date: '2026-08-13', time: '13:00', endTime: undefined });
  });

  it('läser engelska poster ("Friday, August 15 at 1 p.m.")', () => {
    const result = dateOf('Friday, August 15 at 1 p.m.');
    expect(result).toEqual({ date: '2025-08-15', time: '13:00', endTime: undefined });
  });

  it('läser datum utan tid ("Söndag 2 juni")', () => {
    const result = dateOf('Söndag 2 juni');
    expect(result).toEqual({ date: '2024-06-02', time: undefined, endTime: undefined });
  });

  it('löser ett datum UTAN veckodag men markerar året som gissat', () => {
    const result = dateOf('8 november kl 13-16');
    expect(result).toEqual({ date: '2026-11-08', time: '13:00', endTime: '16:00' });

    const activity = activityFor('8 november kl 13-16');
    const parsed = parseEventDate(
      extractPlainText(activity.content?.rendered ?? ''),
      new Date(activity.date ?? ''),
    );
    expect(parsed?.yearProven).toBe(false);
  });

  it('NEGATIV KONTROLL — datumserie ("Tre lördagar: …") ger INGET event', () => {
    expect(dateOf('Tre lördagar: 29 augusti, 26 september och 24 oktober')).toBeNull();
  });

  it('NEGATIV KONTROLL — dagsintervall ("Tisdag – torsdag 11–13 augusti") ger INGET event', () => {
    expect(dateOf('Tisdag – torsdag 11–13 augusti')).toBeNull();
  });

  it('NEGATIV KONTROLL — text utan datum ger INGET event', () => {
    const publish = new Date('2026-08-24T08:42:59Z');
    expect(parseEventDate('Välkommen på Waldemarsudde! Vi ses i parken.', publish)).toBeNull();
  });

  it('löser ut året ur veckodagen när den stämmer', () => {
    // "Tisdag 27 oktober" ÄR en tisdag 2026 (mätt: 2025-10-27 var en måndag).
    const publish = new Date('2026-09-16T00:00:00Z');
    expect(parseEventDate('Tisdag 27 oktober kl 13.00', publish)).toEqual({
      date: '2026-10-27',
      time: '13:00',
      endTime: undefined,
      yearProven: true,
    });
  });

  it('NEGATIV KONTROLL — en veckodag som inte stämmer med något år kastas', () => {
    // Publiceringsåret 2024 är ett SKOTTÅR, så 2024 och 2025 är 2 veckodagar
    // ifrån varandra. "Tisdag 1 januari" är en måndag 2024 och en onsdag 2025
    // — ingen kandidat stämmer, alltså ska posten kastas.
    const publish = new Date('2024-06-01T00:00:00Z');
    expect(parseEventDate('Tisdag 1 januari kl 13.00', publish)).toBeNull();
  });

  it('bevisar året ur veckodagen', () => {
    const publish = new Date('2026-08-23T12:36:13Z');
    // 2026-11-29 är en söndag (index 6), 2025-11-29 en lördag.
    expect(resolveYear(6, 11, 29, publish)).toBe(2026);
    // Ingen kandidat stämmer → null (hellre inget än fel).
    expect(resolveYear(0, 2, 30, publish)).toBeNull();
  });

  it('gissar året från publiceringen när veckodagen saknas', () => {
    const publish = new Date('2026-08-24T08:42:59Z');
    expect(resolveUnprovenYear(11, 8, publish)).toBe(2026);
    // Ett datum FÖRE publiceringen kan inte vara evenemanget.
    expect(resolveUnprovenYear(1, 5, publish)).toBe(2027);
  });

  it('känner igen flerdagarsaktiviteter', () => {
    const text = 'Hem Kurs Tisdag – torsdag 11–13 augusti, kl. 13.00';
    expect(isMultiDate(text, text.indexOf('13 augusti'))).toBe(true);
    const single = 'Hem Höstlov Torsdag 29 oktober kl 13.00-15.00 Välkommen';
    expect(isMultiDate(single, single.indexOf('Torsdag'))).toBe(false);
  });

  it('avkodar HTML-entiteter i titeln', () => {
    expect(decodeHtml('Skapa &amp; skåla &#8211; collage')).toBe('Skapa & skåla – collage');
  });

  it('bygger rader med venue, stad och källsignal', () => {
    const activity = activityFor('Torsdag 29 oktober kl 13.00-15.00');
    const event = toEvent(activity, 'waldemarsudde');
    expect(event).not.toBeNull();
    expect(event?.venue).toBe('Prins Eugens Waldemarsudde');
    expect(event?.city).toBe('Stockholm');
    expect(event?.source).toBe('waldemarsudde');
    expect(event?.url).toContain('waldemarsudde.se/aktiviteter/');
    expect(event?.confidence.signals).toContain('veckodag-bevisad:2026-10-29');
  });

  it('extraherar 7 events ur fixture med 9 poster (2 flerdagarskurser kastas)', () => {
    const result = extract(FIXTURE_JSON, 'https://waldemarsudde.se/wp-json/wp/v2/activity');
    expect(result.method).toBe('waldemarsudde-wp-activity');
    expect(result.events).toHaveLength(7);
    expect(result.events.every((e) => e.date !== '')).toBe(true);
    // Ingen flerdagarskurs får ett datum.
    expect(result.events.map((e) => e.title)).not.toContain(
      'Höstens målarkurs för vuxna – Blommor, färg och friluftsmåleri',
    );
    expect(result.events.map((e) => e.title)).not.toContain(
      'Konstkurs för barn 7-10 år – Slutsåld!',
    );
  });

  it('NEGATIV KONTROLL — en URL som inte är waldemarsudde ger inget', () => {
    const result = extract(FIXTURE_JSON, 'https://kammaren.com/program/');
    expect(result.events).toHaveLength(0);
    expect(result.method).toBe('none');
  });

  it('NEGATIV KONTROLL — ett svar utan aktiviteter ger inget', () => {
    const result = extract('[]', 'https://waldemarsudde.se/wp-json/wp/v2/activity');
    expect(result.events).toHaveLength(0);
    expect(result.method).toBe('none');
  });
});
