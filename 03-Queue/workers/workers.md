# 03-Queue/workers

## Purpose

Documents the worker processes that consume from BullMQ queues and execute event normalization, search sync, and other background tasks.

## What belongs here

- Worker configuration documentation (concurrency, prefetch)
- Worker lifecycle management
- Processor function signatures
- Graceful shutdown procedures

## Worker Types

### NormalizerWorker (consumes `raw_events` queue)

- **Concurrency:** 5
- **Processor:** `processRawEvent(job: Job<RawEventInput>)` from `normalizer.ts`
- **Input:** RawEventInput from ingestion pipeline
- **Output:** Writes to Supabase `events` table, enqueues `search_sync` job
- **Error handling:** Exponential backoff, 3 retries

### SmokeTestWorker (consumes `ingestion_smoke` queue)

- **Concurrency:** 3 (lower than production)
- **Purpose:** Isolated test processing for smoke testing
- **Difference from NormalizerWorker:** Separate queue, lower concurrency, immediate cleanup

### SearchSyncWorker (consumes `search_sync` queue)

- **Concurrency:** 1 (synchronous Meilisearch updates)
- **Processor:** Upserts or deletes event documents in Meilisearch index
- **Input:** `{ event_id, action: 'upsert' | 'delete' }`

## Worker Factory

Defined in `queue.ts`:
- `createNormalizerWorker(processor, queueName)` — creates Worker instance
- `createSmokeTestWorker(processor)` — creates isolated smoke test worker

## What does NOT belong here

- Queue definitions (lives in `../jobs/`)
- Normalization logic itself (lives in `04-Normalizer`)

## Redis Dependency

All workers share the Redis connection from BullMQ.
Connection is lazy-initialized to avoid import-time ENOTFOUND errors.

## Status

**Status: Placeholder**

Worker factories defined in `services/ingestion/src/queue.ts`. Actual processor logic is in `normalizer.ts` and `searchWorker.ts`.
