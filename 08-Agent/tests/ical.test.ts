import { describe, it, expect } from 'vitest';
import { generateIcs } from '../tools/ical';
import type { CalendarEvent } from '../tools/get_event_for_calendar';

const BASE_EVENT: CalendarEvent = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Konsert med Emmylou Harris',
  start_time: '2026-08-26T20:00:00+02:00',
  end_time: '2026-08-26T22:30:00+02:00',
  venue_name: 'Filadelfia',
  city: 'Stockholm',
  ticket_url: 'https://billetto.se/e/123',
  source: 'billetto.se',
};

describe('generateIcs', () => {
  it('produces a valid VCALENDAR with one VEVENT', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('uses the event title as SUMMARY', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toContain('SUMMARY:Konsert med Emmylou Harris');
  });

  it('includes venue and city as LOCATION', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toContain('LOCATION:Filadelfia\\, Stockholm');
  });

  it('includes ticket URL as URL field', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toContain('URL:https://billetto.se/e/123');
  });

  it('includes source as DESCRIPTION with Källa prefix', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toContain('DESCRIPTION:Källa: billetto.se');
  });

  it('derives DTSTART and DTEND from event start_time and end_time', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toMatch(/DTSTART;TZID=Europe\/Stockholm:20260826T200000/);
    expect(ics).toMatch(/DTEND;TZID=Europe\/Stockholm:20260826T223000/);
  });

  it('generates UID from event id and PRODID', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toContain('UID:550e8400-e29b-41d4-a716-446655440000@eventpulse');
    expect(ics).toContain('PRODID:-//EventPulse//Calendar Export//SE');
  });

  it('uses 2-hour default duration when end_time is null', () => {
    const noEnd: CalendarEvent = { ...BASE_EVENT, end_time: null };
    const ics = generateIcs(noEnd);
    expect(ics).toMatch(/DTEND;TZID=Europe\/Stockholm:20260826T220000/);
  });

  it('uses custom duration when specified', () => {
    const noEnd: CalendarEvent = { ...BASE_EVENT, end_time: null };
    const ics = generateIcs(noEnd, 3);
    expect(ics).toMatch(/DTEND;TZID=Europe\/Stockholm:20260826T230000/);
  });

  it('omits URL field when ticket_url is null', () => {
    const noUrl: CalendarEvent = { ...BASE_EVENT, ticket_url: null };
    const ics = generateIcs(noUrl);
    expect(ics).not.toContain('URL:');
    expect(ics).not.toContain('DESCRIPTION:Källa:');
  });

  it('omits DESCRIPTION when source is null', () => {
    const noSource: CalendarEvent = { ...BASE_EVENT, source: null };
    const ics = generateIcs(noSource);
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('escapes semicolons and commas in title', () => {
    const special: CalendarEvent = { ...BASE_EVENT, title: 'Rock & Roll; Metal, Blues' };
    const ics = generateIcs(special);
    expect(ics).toContain('SUMMARY:Rock \\& Roll\\; Metal\\, Blues');
  });

  it('escapes semicolons and commas in location', () => {
    const special: CalendarEvent = { ...BASE_EVENT, venue_name: 'Stora Teatern; Hall 1, A' };
    const ics = generateIcs(special);
    expect(ics).toContain('LOCATION:Stora Teatern\\; Hall 1\\, A\\, Stockholm');
  });

  it('omits empty LOCATION when venue_name is empty', () => {
    const noVenue: CalendarEvent = { ...BASE_EVENT, venue_name: '' };
    const ics = generateIcs(noVenue);
    expect(ics).not.toContain('LOCATION:');
  });

  it('includes DTSTAMP as a valid UTC timestamp', () => {
    const ics = generateIcs(BASE_EVENT);
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });

  it('each line is at most 75 octets (RFC-5545 folding)', () => {
    const longTitle: CalendarEvent = { ...BASE_EVENT, title: 'A'.repeat(200) };
    const ics = generateIcs(longTitle);
    const lines = ics.split('\r\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});
