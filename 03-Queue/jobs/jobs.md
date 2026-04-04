# 03-Queue/jobs

## Purpose

Contains documentation about BullMQ job types, job data schemas, retry strategies, and job lifecycle management for the EventPulse queue system.

## What belongs here

- Job data schema definitions (RawEventInput payload structure)
- Retry/backoff configuration documentation
- Job lifecycle states (waiting, active, completed, failed)
- Job options documentation (attempts, backoff, removeOnComplete, etc.)

## Active Job Types

### `process-raw-event` (rawEventsQueue)

Payload: `RawEventInput`
```typescript
{
  source: string;           // e.g. 'eventbrite', 'ticketmaster'
  source_id: string | null;
  title: string;
  description: string | null;
  start_time: string;       // ISO timestamp
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
  url: string | null;
  ticket_url: string | null;
  image_url: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  price_max_sek: number | null;
  categories: string[] | undefined;
  detected_language: string | null;
  raw_payload: object | null;  // Original API/HTML response
}
```

Job options:
- `attempts: 3` — retry up to 3 times on failure
- `backoff: exponential, 5000ms` — wait 5s, then 10s, then 20s
- `removeOnComplete: 100` — keep last 100 completed jobs
- `removeOnFail: 500` — keep last 500 failed jobs

### `sync` (searchSyncQueue)

Payload:
```typescript
{
  event_id: string;
  action: 'upsert' | 'delete';
}
```

No retry. Synchronous Meilisearch update.

## What does NOT belong here

- Worker implementation (belongs to `../workers/`)
- Queue creation code (lives in `services/ingestion/src/queue.ts`)

## Status

**Status: Placeholder**

Job schemas defined in `@eventpulse/shared`. Job options defined in `queue.ts`. This folder documents the intent.
