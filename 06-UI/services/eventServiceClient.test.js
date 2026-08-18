import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExternalLinkLabel,
  normalizeSupabaseEvent,
  validateExternalUrl,
  validateImageUrl,
} from './eventServiceClient.js';

test('normalizes Supabase events into the renderable UI contract', () => {
  const event = normalizeSupabaseEvent({
    id: 'evt-1',
    source: 'ticketmaster',
    source_id: 'tm-1',
    title_sv: 'Jazzkvall pa torget',
    title_en: 'Jazz night',
    start_time: '2026-05-02T19:30:00+02:00',
    end_time: '2026-05-02T21:00:00+02:00',
    venues: {
      name: 'Stadsteatern',
      address: 'Storgatan 1',
    },
    description_sv: 'Livekvall med lokala musiker.',
    is_free: true,
    price_min_sek: null,
    price_max_sek: null,
    ticket_url: 'https://www.ticketmaster.se/event/jazz',
    image_url: 'https://example.com/image.jpg',
    status: 'published',
    category_slug: 'music',
  });

  assert.equal(event.title, 'Jazzkvall pa torget');
  assert.equal(event.date, '2026-05-02');
  assert.equal(event.time, '19:30');
  assert.equal(event.venue, 'Stadsteatern');
  assert.equal(event.area, null);
  assert.equal(event.address, 'Storgatan 1');
  assert.equal(event.description, 'Livekvall med lokala musiker.');
  assert.equal(event.category, 'music');
  assert.equal(event.url, 'https://www.ticketmaster.se/event/jazz');
  assert.equal(event.hasExternalLink, true);
  assert.equal(event.externalLinkLabel, 'Köp biljett via Ticketmaster');
  assert.equal(event.externalLinkChipLabel, 'Biljett');
  assert.equal(event.imageUrl, 'https://example.com/image.jpg');
  assert.equal(event.isFree, true);
});

test('normalizes partial events honestly without fabricating venue or title', () => {
  const event = normalizeSupabaseEvent({
    id: 'evt-2',
    source: 'kulturhuset',
    start_time: null,
    venue_id: 'venue-2',
    title_sv: null,
    title_en: null,
    ticket_url: null,
    image_url: null,
    category_slug: null,
  });

  assert.equal(event.title, 'Titel saknas');
  assert.equal(event.date, null);
  assert.equal(event.time, null);
  assert.equal(event.venue, null);
  assert.equal(event.area, null);
  assert.equal(event.url, null);
  assert.equal(event.hasExternalLink, false);
  assert.equal(event.externalLinkLabel, null);
  assert.equal(event.externalLinkChipLabel, null);
  assert.equal(event.category, 'unknown');
  assert.equal(event.imageUrl, null);
});

test('rejects unsafe external URLs from event data', () => {
  assert.equal(validateExternalUrl('javascript:alert(1)', 'ticketmaster'), null);
  assert.equal(validateExternalUrl('http://ticketmaster.se/event', 'ticketmaster'), null);
  assert.equal(validateExternalUrl('https://evil.example/event', 'ticketmaster'), null);
  assert.equal(validateExternalUrl('https://example.com/event', 'unknown-source'), null);
  assert.equal(
    validateExternalUrl('https://www.ticketmaster.se/event/demo', 'ticketmaster'),
    'https://www.ticketmaster.se/event/demo'
  );
});

test('keeps valid event links for source variants and serialized source metadata', () => {
  assert.equal(
    validateExternalUrl('https://kulturhusetstadsteatern.se/barn-ung/skolbesok', 'kulturhuset-barn-ung'),
    'https://kulturhusetstadsteatern.se/barn-ung/skolbesok'
  );
  assert.equal(
    validateExternalUrl('https://kulturhusetstadsteatern.se/barn-ung/skolbesok', 'kulturhusetBarnUng'),
    'https://kulturhusetstadsteatern.se/barn-ung/skolbesok'
  );
  assert.equal(
    validateExternalUrl(
      'https://kulturhusetstadsteatern.se/program/upptacktsfard',
      '{"name":"kulturhuset","requiresQueue":false}'
    ),
    'https://kulturhusetstadsteatern.se/program/upptacktsfard'
  );
});

test('allows trusted ticketing hosts for venue sources', () => {
  assert.equal(
    validateExternalUrl('https://www.ticketmaster.se/event/darin-akustiskt', 'malmo-live'),
    'https://www.ticketmaster.se/event/darin-akustiskt'
  );
  assert.equal(
    validateExternalUrl('https://www.ticketmaster.se/event/darin-akustiskt', 'malmolive'),
    'https://www.ticketmaster.se/event/darin-akustiskt'
  );
});

test('derives external link labels without fabricating links', () => {
  assert.equal(getExternalLinkLabel('ticketmaster'), 'Köp biljett via Ticketmaster');
  assert.equal(getExternalLinkLabel('kulturhusetBarnUng'), 'Läs mer på Kulturhuset');
  assert.equal(
    getExternalLinkLabel('malmo-live', 'https://www.ticketmaster.se/event/darin-akustiskt'),
    'Köp biljett via Ticketmaster'
  );
  assert.equal(getExternalLinkLabel('unknown-source'), 'Öppna extern eventsida');

  const unsafeEvent = normalizeSupabaseEvent({
    id: 'evt-unsafe',
    source: 'unknown-source',
    title_sv: 'Unsafe link',
    start_time: '2026-05-02T19:30:00+02:00',
    ticket_url: 'https://example.com/event',
    image_url: null,
    category_slug: 'music',
  });

  assert.equal(unsafeEvent.url, null);
  assert.equal(unsafeEvent.hasExternalLink, false);
  assert.equal(unsafeEvent.externalLinkLabel, null);
  assert.equal(unsafeEvent.externalLinkChipLabel, null);
});

test('rejects non-https image URLs', () => {
  assert.equal(validateImageUrl('http://example.com/image.jpg'), null);
  assert.equal(validateImageUrl('data:image/svg+xml;base64,PHN2Zy8+'), null);
  assert.equal(validateImageUrl('https://example.com/image.jpg'), 'https://example.com/image.jpg');
});
