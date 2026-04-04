# 03-Queue

## Purpose

03-Queue is the job orchestration layer between 02-Ingestion and 04-Normalizer/Supabase. It receives structured events from the ingestion pipeline and distributes them as jobs to background workers for normalization, deduplication, and database persistence.

## What belongs here

- BullMQ queue definitions (`rawEventsQueue`, `smokeTestQueue`, `searchSyncQueue`)
- Worker factory functions (`createNormalizerWorker`, `createSmokeTestWorker`)
- Queue cleanup utilities
- Redis connection configuration
- Job retry/backoff configuration
- Queue health monitoring logic

## What does NOT belong here

- Normalization logic (belongs to `04-Normalizer`)
- Database schema (belongs to `05-Supabase`)
- Source adapters (belongs to `02-Ingestion`)
- UI rendering (belongs to `06-UI`)

## Queue Architecture

```
Ingestion Pipeline
    │
    ▼
rawEventsQueue ──────► NormalizerWorker (04-Normalizer)
    │                       │
    │                       ▼
    │                 Supabase (events table)
    │                       │
    │                       ▼
    │                 searchSyncQueue ──► Meilisearch
    │
    └──► smokeTestQueue ──► Isolated test processing

Queues use Redis as broker with BullMQ.
Concurrency: 5 for normalizers, 3 for smoke tests.
Retry: exponential backoff, 3 attempts max.
```

## Active Queues

| Queue | Purpose | Concurrency | Retry |
|-------|---------|-------------|-------|
| `raw_events` | Production event normalization | 5 | 3 attempts, exp. backoff |
| `ingestion_smoke` | Isolated smoke test processing | 3 | 3 attempts |
| `search_sync` | Meilisearch upsert/delete | 1 | none |

## Redis Connection

- Uses `REDIS_URL` env var (default: `redis://host.docker.internal:6379`)
- TLS support for `rediss://` URLs
- Lazy connection initialization (avoids ENOTFOUND at import time)
- `maxRetriesPerRequest: null` for BullMQ compatibility

## Relationship to Adjacent Layers

- **02-Ingestion** feeds processed events into `rawEventsQueue` via `phase1ToQueue.ts`
- **04-Normalizer** consumes from `rawEventsQueue` and writes to Supabase
- **05-Supabase** stores normalized events and venues
- **searchSyncQueue** bridges Supabase writes to Meilisearch search index
- **03-Queue** is purely infrastructure — it orchestrates, it does not transform

## Subfolders

| Subfolder | Purpose |
|-----------|---------|
| `jobs/` | Job-level documentation, retry strategies, job data schemas |
| `workers/` | Worker process documentation, concurrency settings |
| `notes/` | Operational notes: queue monitoring, failure handling |
| `testResults/` | Smoke test results, queue drain tests |

## AI Guidance

When working with queue issues:
1. Check Redis connectivity (`REDIS_URL`)
2. Check queue depth (`rawEventsQueue.getJobCounts()`)
3. Check failed jobs (`smokeTestQueue.getFailed()`)
4. Determine if failure is in queue infrastructure or downstream (normalizer/Supabase)
5. Never assume a queue failure is a queue problem — trace to actual cause

## AI-regler som gäller här

- Queue-regler: `AI/rules/ingestion.md` (Queue Rules-sektion)
- Workflow: `AI/workflows/ingestion-loop.md`
- E2E-verifiering: `AI/workflows/verify-end-to-end.md`

AI-regler sammanfattade: `AI/rules-summary.md`

## Status

**Status: Active**

Queue infrastructure is functional. BullMQ queues are configured and running. The `normalizer.ts` worker consumes from `rawEventsQueue`. Redis is the shared state between queue and workers.
