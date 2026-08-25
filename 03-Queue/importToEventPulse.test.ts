import assert from 'node:assert/strict';
import test from 'node:test';

import { toRawEvent } from './importToEventPulse';

test('maps camelCase extracted event link and image aliases into RawEventInput', () => {
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

  assert.equal(raw.ticket_url, 'https://tickets.example.com/event/synthetic');
  assert.equal(raw.image_url, 'https://images.example.com/event.jpg');
  assert.equal(raw.start_time, '2026-05-02T19:30:00.000Z');
});
