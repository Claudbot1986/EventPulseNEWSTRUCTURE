# 04-Normalizer/deduplication

## Purpose

Documents the event deduplication strategy that prevents the same event from being inserted twice. Every event gets a deterministic hash that serves as the primary dedup key.

## Dedup Hash Algorithm

```typescript
import { createHash } from 'crypto';

function buildDedupHash(source: string, sourceId: string): string {
  return createHash('sha256')
    .update(`${source}::${sourceId}`)
    .digest('hex');
}
```

## Primary vs Fallback

**Primary:** `SHA-256(source :: source_id)`

Used when `source_id` is available. This is stable and unique per event.

**Fallback:** `SHA-256(source :: title :: start_time)`

Used when `source_id` is null. This is less stable but still useful for avoiding exact duplicates.

## Deduplication Check

Before insert, the normalizer checks:
```sql
SELECT id FROM events WHERE dedup_hash = :hash;
```

- If exists → UPDATE the existing record
- If not exists → INSERT new record

## Why Hash-Based?

Hash-based dedup (vs. raw ID storage) allows:
- Consistent key regardless of source ID format
- Same-event detection across different source representations
- No reliance on source-side ID stability

## What belongs here

- Dedup hash algorithm documentation
- Primary vs fallback strategy
- Edge cases (null source_id, title changes, etc.)

## What does NOT belong here

- Venue deduplication (different problem — see `../venue-matching/`)
- Source-level dedup (handled by ingestion pipeline)

## Status

**Status: Active**

Dedup logic is implemented in `normalizer.ts` via `buildDedupHash()`. It is functional and prevents duplicate events from being inserted.
