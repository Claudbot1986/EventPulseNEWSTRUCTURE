/**
 * Tests for datumupplösning i F-eventExtraction/extractor.ts
 *
 * Bakgrund (2026-10-23): `toRawEventInput` läste bara `date`/`time`, medan
 * B-gatets extractor producerar `startTime`/`endTime` med hela ISO-instanten.
 * Alla network-path-events fick därför `start_time: null` och droppades av
 * normalizer ("passerat datum/saknar datum") — trots att B-gatet loggade
 * "N events" och markerade källan som lyckad.
 *
 * Dessa tester låser:
 *  - legacy `startTime`/`endTime` överlever mappningen
 *  - kanonisk `date`+`time` tolkas som Europe/Stockholm
 *  - tz-medvetna strängar skjuts INTE om (2-timmarstappet som nästan
 *    slank igenom)
 *  - händelser utan datum får `start_time: null` (aldrig "idag")
 *
 * Run: npx vitest run 02-Ingestion/F-eventExtraction/extractor-date-resolution.test.ts
 */

import { describe, it, expect } from 'vitest';
import { toRawEventInput } from './extractor';
import type { ParsedEvent } from './schema';

function baseEvent(overrides: Partial<ParsedEvent> & Record<string, unknown> = {}): ParsedEvent {
  return {
    title: 'Testevent',
    description: '',
    date: '',
    time: '',
    venue: '',
    address: '',
    category: '',
    organizer: '',
    url: '',
    imageUrl: '',
    source: 'test-source',
    confidence: {
      score: 0,
      hasTitle: true,
      hasDate: true,
      hasVenue: false,
      hasUrl: false,
      hasDescription: false,
      hasTicketInfo: false,
      eventStatus: 'unknown',
      signals: [],
    },
    ...overrides,
  } as unknown as ParsedEvent;
}

describe('toRawEventInput — legacy network-form', () => {
  it('startTime (ISO-instant) blir start_time', () => {
    const raw = toRawEventInput(
      baseEvent({ startTime: '2026-11-15T18:00:00.000Z' }) as ParsedEvent & { startTime: string },
    );
    expect(raw.start_time).toBe('2026-11-15T18:00:00.000Z');
  });

  it('endTime (ISO-instant) blir end_time', () => {
    const raw = toRawEventInput(
      baseEvent({
        startTime: '2026-11-15T18:00:00.000Z',
        endTime: '2026-11-15T21:00:00.000Z',
      }) as ParsedEvent & { startTime: string; endTime: string },
    );
    expect(raw.start_time).toBe('2026-11-15T18:00:00.000Z');
    expect(raw.end_time).toBe('2026-11-15T21:00:00.000Z');
  });

  it('naiv legacy startTime tolkas som Europe/Stockholm', () => {
    const raw = toRawEventInput(
      baseEvent({ startTime: '2026-06-15T18:00:00' }) as ParsedEvent & { startTime: string },
    );
    // CEST = +02:00
    expect(raw.start_time).toBe('2026-06-15T16:00:00.000Z');
  });

  it('kanonisk endTime ("HH:MM") skrivs INTE som end_time', () => {
    // ParsedEvent.endTime bär 'HH:MM' — det är inte ett instant och ska
    // inte tolkas som ett.
    const raw = toRawEventInput(
      baseEvent({ date: '2026-11-15', time: '18:00', endTime: '21:00' }) as ParsedEvent & {
        endTime: string;
      },
    );
    expect(raw.start_time).toBe('2026-11-15T17:00:00.000Z');
    expect(raw.end_time).toBeNull();
  });

  it('händelse utan datum får start_time null (aldrig "idag")', () => {
    const raw = toRawEventInput(baseEvent());
    expect(raw.start_time).toBeNull();
    expect(raw.end_time).toBeNull();
  });
});

describe('toRawEventInput — kanonisk ParsedEvent-form', () => {
  it('date + time → UTC med Stockholms offset', () => {
    const raw = toRawEventInput(baseEvent({ date: '2026-11-15', time: '18:00' }));
    // November = CET (+01:00) → 17:00Z
    expect(raw.start_time).toBe('2026-11-15T17:00:00.000Z');
  });

  it('date + time sommar → UTC med CEST (+02:00)', () => {
    const raw = toRawEventInput(baseEvent({ date: '2026-06-15', time: '18:00' }));
    expect(raw.start_time).toBe('2026-06-15T16:00:00.000Z');
  });

  it('endDate + date/time → end_time', () => {
    const raw = toRawEventInput(baseEvent({ date: '2026-11-15', time: '18:00', endDate: '2026-11-15' }));
    // endDate utan egen tid → samma tid som start
    expect(raw.end_time).toBe('2026-11-15T17:00:00.000Z');
  });

  it('naiv datetime i date får INTE tappa tiden', () => {
    const raw = toRawEventInput(baseEvent({ date: '2026-11-15T18:00:00', time: '' }));
    // Utan split skulle detta landa på midnatt (23:00Z föregående dag).
    expect(raw.start_time).toBe('2026-11-15T17:00:00.000Z');
  });

  it('tz-medvetn date lämnas orörd (ingen 2-timmarstapp)', () => {
    const raw = toRawEventInput(baseEvent({ date: '2026-11-15T18:00:00.000Z', time: '' }));
    expect(raw.start_time).toBe('2026-11-15T18:00:00.000Z');
  });

  it('explicit offset i date normaliseras till UTC', () => {
    const raw = toRawEventInput(baseEvent({ date: '2026-11-15T18:00:00+02:00', time: '' }));
    expect(raw.start_time).toBe('2026-11-15T16:00:00.000Z');
  });
});
