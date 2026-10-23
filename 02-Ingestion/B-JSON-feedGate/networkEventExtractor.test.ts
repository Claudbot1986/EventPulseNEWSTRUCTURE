/**
 * Tests for networkEventExtractor.ts — B-gatets API-extraherare
 *
 * Bakgrund (2026-10-23): B-gatet rapporterade "N events" för källor som i
 * verkligheten inte gav en enda händelse. Två sammanfallande fel:
 *
 *  1. Ett odaterat JSON-objekt (t.ex. WordPress `/wp-json/`-index) räknades
 *     som 1 event → källan markerades "success" → aldrig köades igen.
 *  2. WordPress `wp/v2/*` exponerar bara *publiceringsdatumet* i `date`.
 *     Det är INTE händelsedatumet — att använda det vore att hitta på ett
 *     datum (CLAUDE.md: "AI may not invent events, venues, dates").
 *
 * Dessa tester låser båda beteendena: bara objekt med ett upplösbart
 * händelsedatum räknas som events, och publiceringsdatum räknas aldrig som
 * händelsedatum.
 *
 * Run: npx vitest run 02-Ingestion/B-JSON-feedGate/networkEventExtractor.test.ts
 */

import { describe, it, expect } from 'vitest';
import { extractEventsFromPayload } from './networkEventExtractor';

describe('extractEventsFromPayload — odaterade objekt räknas inte som events', () => {
  it('WordPress /wp-json/-index → 0 events', () => {
    // Ett API-index-dokument. Har namn och URL men INGEN tidsangivelse.
    const wpIndex = {
      name: 'Kammaren',
      description: 'Kammaren – scen för musik och teater i Stockholm',
      url: 'https://kammaren.com',
      home: 'https://kammaren.com',
      namespaces: ['wp/v2'],
      routes: { '/': { namespace: '', methods: ['GET'] } },
    };
    expect(extractEventsFromPayload(wpIndex, 'kammaren')).toEqual([]);
  });

  it('tom array → 0 events', () => {
    expect(extractEventsFromPayload([], 'empty')).toEqual([]);
  });

  it('icke-objekt-payload → 0 events', () => {
    expect(extractEventsFromPayload('text', 'str')).toEqual([]);
    expect(extractEventsFromPayload(null, 'null')).toEqual([]);
    expect(extractEventsFromPayload(42, 'num')).toEqual([]);
  });

  it('WordPress wp/v2-posts med ENDA publiceringsdatum → 0 events', () => {
    // `date` = publiceringsdatum. `acf` = [] (ej exponerat publikt).
    // Händelsedatumet finns INTE i payloaden → får inte gissas.
    const wpPosts = [
      {
        id: 42,
        date: '2026-09-01T10:00:00',
        date_gmt: '2026-09-01T08:00:00',
        modified: '2026-09-02T10:00:00',
        slug: 'konsert-2026',
        status: 'publish',
        title: { rendered: 'Konsert i Kammaren' },
        content: { rendered: '<p>Vi ses!</p>' },
        acf: [],
      },
    ];
    expect(extractEventsFromPayload(wpPosts, 'kammaren')).toEqual([]);
  });

  it('objekt utan titel → 0 events', () => {
    expect(extractEventsFromPayload({ startDate: '2026-11-15' }, 'no-title')).toEqual([]);
  });
});

describe('extractEventsFromPayload — datum får lösas upp', () => {
  it('generic array med startDate → 1 event med UTC-instant', () => {
    const events = extractEventsFromPayload(
      [{ id: 7, name: 'Jazzkväll', startDate: '2026-11-15', venue: 'Kammaren' }],
      'generic',
    );
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Jazzkväll');
    // 2026-11-15 är CET (+01:00) → midnatt Stockholm = 2026-11-14T23:00Z
    expect(events[0].startTime).toBe('2026-11-14T23:00:00.000Z');
    expect(events[0].venue).toBe('Kammaren');
  });

  it('naiv datetime tolkas som Europe/Stockholm (CEST sommar)', () => {
    const events = extractEventsFromPayload(
      [{ id: 8, name: 'Sommarkonsert', startDate: '2026-06-15T18:00:00' }],
      'naive-summer',
    );
    expect(events).toHaveLength(1);
    // CEST = +02:00 → 18:00 lokal = 16:00Z
    expect(events[0].startTime).toBe('2026-06-15T16:00:00.000Z');
  });

  it('naiv datetime tolkas som Europe/Stockholm (CET vinter)', () => {
    const events = extractEventsFromPayload(
      [{ id: 9, name: 'Vinterkonsert', startDate: '2026-01-15T18:00:00' }],
      'naive-winter',
    );
    expect(events).toHaveLength(1);
    // CET = +01:00 → 18:00 lokal = 17:00Z
    expect(events[0].startTime).toBe('2026-01-15T17:00:00.000Z');
  });

  it('tz-medveten sträng lämnas orörd', () => {
    const events = extractEventsFromPayload(
      [{ id: 10, name: 'Redan UTC', startDate: '2026-11-15T18:00:00.000Z' }],
      'tz-aware',
    );
    expect(events).toHaveLength(1);
    expect(events[0].startTime).toBe('2026-11-15T18:00:00.000Z');
  });

  it('explicit offset lämnas orörd (normaliserad till UTC)', () => {
    const events = extractEventsFromPayload(
      [{ id: 11, name: 'Med offset', startDate: '2026-11-15T18:00:00+02:00' }],
      'offset',
    );
    expect(events).toHaveLength(1);
    expect(events[0].startTime).toBe('2026-11-15T16:00:00.000Z');
  });

  it('epoch-millisekunder accepteras', () => {
    const events = extractEventsFromPayload(
      [{ id: 12, name: 'Epoch', startDate: 1794765600000 }],
      'epoch',
    );
    expect(events).toHaveLength(1);
    expect(events[0].startTime).toBe(new Date(1794765600000).toISOString());
  });

  it('endTime löses upp separat från startTime', () => {
    const events = extractEventsFromPayload(
      [{ id: 13, name: 'Med slut', startDate: '2026-11-15T18:00:00', endDate: '2026-11-15T21:00:00' }],
      'with-end',
    );
    expect(events).toHaveLength(1);
    expect(events[0].startTime).toBe('2026-11-15T17:00:00.000Z');
    expect(events[0].endTime).toBe('2026-11-15T20:00:00.000Z');
  });

  it('nested dates[].date används som start', () => {
    const events = extractEventsFromPayload(
      [{ id: 14, name: 'Nested', dates: [{ date: '2026-11-15' }] }],
      'nested',
    );
    expect(events).toHaveLength(1);
    expect(events[0].startTime).toBe('2026-11-14T23:00:00.000Z');
  });
});

describe('extractEventsFromPayload — WordPress/CMS-form', () => {
  it('{rendered}-objekt packas upp till text', () => {
    const events = extractEventsFromPayload(
      [
        {
          id: 20,
          title: { rendered: 'Konsert i Kammaren' },
          content: { rendered: '<p>Beskrivning</p>' },
          startDate: '2026-11-15',
          link: 'https://kammaren.com/konsert',
        },
      ],
      'rendered',
    );
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Konsert i Kammaren');
    expect(events[0].description).toBe('<p>Beskrivning</p>');
    expect(events[0].url).toBe('https://kammaren.com/konsert');
  });

  it('camelCase-fält (startDate/startDate) plockas upp', () => {
    const events = extractEventsFromPayload(
      [{ id: 21, Name: 'Klassiskt', StartDate: '2026-12-01' }],
      'camel',
    );
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Klassiskt');
    expect(events[0].startTime).toBe('2026-11-30T23:00:00.000Z');
  });
});

describe('extractEventsFromPayload — Tixly', () => {
  it('Events-array ger daterade events', () => {
    const tixly = {
      Events: [
        {
          EventId: 555,
          Name: 'Tixly-konsert',
          StartDate: '2026-11-20T19:00:00',
          EndDate: '2026-11-20T21:00:00',
          Venue: 'Cirkus',
          MinPrice: 100,
          MaxPrice: 400,
          PurchaseUrl: 'https://tixly.se/konsert',
        },
      ],
      Productions: [],
    };
    const events = extractEventsFromPayload(tixly, 'tixly');
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Tixly-konsert');
    expect(events[0].startTime).toBe('2026-11-20T18:00:00.000Z');
    expect(events[0].endTime).toBe('2026-11-20T20:00:00.000Z');
    expect(events[0].venue).toBe('Cirkus');
    expect(events[0].price).toEqual({ min: 100, max: 400 });
  });

  it('Productions-dates ger events', () => {
    const tixly = {
      Events: [],
      Productions: [
        {
          EventGroupId: 900,
          Name: 'Turné',
          Dates: ['2026-11-20T19:00:00', '2026-11-21T19:00:00'],
          Venue: 'Cirkus',
        },
      ],
    };
    const events = extractEventsFromPayload(tixly, 'tixly-prod');
    expect(events).toHaveLength(2);
    expect(events[0].startTime).toBe('2026-11-20T18:00:00.000Z');
    expect(events[1].startTime).toBe('2026-11-21T18:00:00.000Z');
  });
});
