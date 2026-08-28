/**
 * analytics.ts — Event type definitions for the analytics backend.
 *
 * Each event is captured client-side and POSTed to /api/events. The
 * server validates the payload against the Zod schema and persists
 * it (JSONL fallback; Supabase in Phase 2).
 *
 * GDPR: every event is anonymous. device_id_hash is a SHA-256 with
 * per-build salt, rotated every 30 days. No PII is collected.
 */

import { z } from 'zod';

/**
 * EventType — exhaustive list of event types the client can emit.
 * Adding a new type requires a corresponding Zod schema entry below.
 */
export const EVENT_TYPES = [
  'event_view',
  'event_hover',
  'event_click',
  'event_save',
  'event_dismiss',
  'session_start',
  'session_end',
  'section_impression',
  'search_query',
  'filter_change',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Payload by event type — what fields each event carries.
 * Keep these small. No PII. No free-text copies of user input.
 */
export const payloadSchemas = {
  event_view: z.object({
    event_id: z.string().min(1).max(128),
    source_slug: z.string().max(64).optional(),
    category_slug: z.string().max(64).optional(),
  }),
  event_hover: z.object({
    event_id: z.string().min(1).max(128),
    duration_ms: z.number().int().min(0).max(60_000),
  }),
  event_click: z.object({
    event_id: z.string().min(1).max(128),
    target: z.enum(['card', 'save', 'dismiss', 'external']),
  }),
  event_save: z.object({
    event_id: z.string().min(1).max(128),
    value: z.enum(['save', 'unsave']),
  }),
  event_dismiss: z.object({
    event_id: z.string().min(1).max(128),
  }),
  session_start: z.object({
    app_version: z.string().max(32).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
  }),
  session_end: z.object({
    duration_ms: z.number().int().min(0).max(86_400_000),
  }),
  section_impression: z.object({
    section: z.enum(['tonight', 'weekend', 'free', 'recommendations']),
  }),
  search_query: z.object({
    query_len: z.number().int().min(0).max(2048),
    has_filters: z.boolean(),
  }),
  filter_change: z.object({
    filter: z.enum(['category', 'price', 'date']),
  }),
} as const;

export const eventSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  page: z.string().max(64).default('unknown'),
  payload: z.record(z.unknown()).default({}),
  device_id_hash: z.string().regex(/^[a-f0-9]{64}$/),
  session_id: z.string().min(1).max(64),
});

export type AnalyticsEvent = z.infer<typeof eventSchema>;

/**
 * The shape written to JSONL storage. server.ts merges this with the
 * validated event plus a server-side timestamp.
 */
export interface StoredEvent extends AnalyticsEvent {
  ts: string; // ISO-8601 UTC
  received_at: string;
}
