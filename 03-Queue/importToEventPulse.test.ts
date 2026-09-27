import { describe, it, expect } from 'vitest';

import { toRawEvent } from './importToEventPulse';

describe('toRawEvent', () => {
  it('maps camelCase extracted event link and image aliases into RawEventInput', () => {
    const raw = toRawEvent('synthetic-source', {
      title: 'Synthetic event',
      description: 'Synthetic description',
      date: '2026-05-02',
      time: '19:30',
      venue: 'Synthetic venue',
      address: 'Synthetic address',
      category: 'music',
      is_free: false,
      ticketUrl: 'https://tickets.example.com/event/synthetic',
      imageUrl: 'https://images.example.com/event.jpg',
      source_id: 'synthetic-1',
    });

    expect(raw.ticket_url).toBe('https://tickets.example.com/event/synthetic');
    expect(raw.image_url).toBe('https://images.example.com/event.jpg');
    expect(raw.start_time).toBe('2026-05-02T19:30:00.000Z');
  });

  it('maps boka.berwaldhallen.se ticket_url to canonical source "berwaldhallen"', () => {
    // Regression: 2026-09-27, 178 events kom in med source=NULL eftersom
    // Tixly-API:t returnerar purchase-URL:er på bokningssubdomänen. Boknings-
    // domänen måste mappas tillbaka till source='berwaldhallen' så att
    // source-quality-rapporter och category-mapping fungerar.
    const raw = toRawEvent('boka.berwaldhallen', {
      title: 'Test concert',
      date: '2026-05-02',
      time: '19:30',
      ticketUrl: 'https://boka.berwaldhallen.se/sv/buyingflow/tickets/30538/124898/',
      source_id: 'berwaldhallen-124898',
    });

    expect(raw.source).toBe('berwaldhallen');
    expect(raw.source_id).toBe('berwaldhallen-124898');
  });

  it('maps www.berwaldhallen.se ticket_url to canonical source "berwaldhallen"', () => {
    // Även om filnamnet är korrekt vill vi skydda mot framtida ändringar.
    const raw = toRawEvent('berwaldhallen', {
      title: 'Test concert 2',
      date: '2026-05-02',
      time: '19:30',
      ticketUrl: 'https://www.berwaldhallen.se/konsert/test',
      source_id: 'berwaldhallen-999',
    });

    expect(raw.source).toBe('berwaldhallen');
  });

  it('infers "berwaldhallen" from source_id prefix even if filename was missing', () => {
    // Edge case: filename är okänt (t.ex. legacy-fil) men source_id pekar
    // på berwaldhallen-API:t.
    const raw = toRawEvent('unknown-source', {
      title: 'Berwaldhallen event',
      date: '2026-05-02',
      time: '19:30',
      source_id: 'berwaldhallen-prod-30538-1',
    });

    expect(raw.source).toBe('berwaldhallen');
  });

  it('preserves non-berwaldhallen sources unchanged', () => {
    const raw = toRawEvent('kulturhuset', {
      title: 'Kulturhuset event',
      date: '2026-05-02',
      time: '19:30',
      ticketUrl: 'https://kulturhuset.se/event/x',
      source_id: 'kulturhuset-1',
    });

    expect(raw.source).toBe('kulturhuset');
  });
});
