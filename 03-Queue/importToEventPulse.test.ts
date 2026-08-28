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
});
