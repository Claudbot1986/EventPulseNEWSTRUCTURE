# 05-Supabase/queries

## Purpose

Contains reusable SQL query definitions, stored procedures, and query patterns for interacting with the EventPulse Supabase database.

## Key Query Patterns

### Fetch published events with venue

```sql
SELECT
  e.id, e.title_en, e.start_time, e.venue_id,
  v.name AS venue_name, v.address AS venue_address,
  e.category_slug, e.is_free, e.price_min_sek, e.price_max_sek,
  e.ticket_url, e.image_url
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id
WHERE e.status = 'published'
  AND e.start_time >= $1
  AND e.start_time <= $2
ORDER BY e.start_time ASC
LIMIT $3;
```

### Fetch ingestion stats (last 24h)

```sql
SELECT
  source,
  action,
  COUNT(*) AS count
FROM ingestion_logs
WHERE timestamp >= $1
GROUP BY source, action
ORDER BY count DESC;
```

### Fetch events by source

```sql
SELECT * FROM events
WHERE source = $1
  AND status = 'published'
ORDER BY start_time ASC;
```

### Count events by source

```sql
SELECT source, COUNT(*) AS count
FROM events
WHERE status = 'published'
  AND start_time >= $1
GROUP BY source;
```

## What belongs here

- Reusable SQL query definitions
- Query parameter documentation
- Stored procedure definitions
- Query performance notes

## What does NOT belong here

- Schema definitions (belongs to `../schema/`)
- Migration files (belongs to `../migrations/`)

## Status

**Status: Placeholder**

Add query definitions as they are used. Document parameters and return shapes.
