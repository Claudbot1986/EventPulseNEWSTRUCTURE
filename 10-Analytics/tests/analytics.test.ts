/**
 * analytics.test.ts — validate event schema accepts what we send.
 */

import { describe, it, expect } from 'vitest';
import { eventSchema, payloadSchemas, EVENT_TYPES } from '../analytics.js';

describe('eventSchema', () => {
  it('accepts a minimal valid event', () => {
    const result = eventSchema.safeParse({
      event_type: 'event_view',
      page: 'agent',
      payload: { event_id: 'e1' },
      device_id_hash: 'a'.repeat(64),
      session_id: 's1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a device_id_hash that is not 64 hex', () => {
    const result = eventSchema.safeParse({
      event_type: 'event_view',
      page: 'agent',
      payload: { event_id: 'e1' },
      device_id_hash: 'short',
      session_id: 's1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown event_type', () => {
    const result = eventSchema.safeParse({
      event_type: 'event_undefined',
      page: 'agent',
      payload: {},
      device_id_hash: 'a'.repeat(64),
      session_id: 's1',
    });
    expect(result.success).toBe(false);
  });

  it('defaults payload to {} when omitted', () => {
    const result = eventSchema.safeParse({
      event_type: 'session_start',
      page: 'app',
      device_id_hash: 'a'.repeat(64),
      session_id: 's1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toEqual({});
    }
  });
});

describe('payloadSchemas', () => {
  it('event_view requires event_id', () => {
    const r = payloadSchemas.event_view.safeParse({});
    expect(r.success).toBe(false);
  });

  it('event_hover duration_ms has bounds', () => {
    const tooLong = payloadSchemas.event_hover.safeParse({
      event_id: 'e1',
      duration_ms: 99_999_999,
    });
    expect(tooLong.success).toBe(false);
  });

  it('event_click target must be enum', () => {
    const r = payloadSchemas.event_click.safeParse({
      event_id: 'e1',
      target: 'something-else',
    });
    expect(r.success).toBe(false);
  });
});

describe('EVENT_TYPES exhaustiveness', () => {
  it('every type has a payload schema', () => {
    for (const t of EVENT_TYPES) {
      expect(payloadSchemas).toHaveProperty(t);
    }
  });
});