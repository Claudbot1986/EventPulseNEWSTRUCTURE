# 05-Supabase/notes

## Purpose

Operational notes about the Supabase database: connection issues, performance tuning, schema changes, and troubleshooting.

## Connection Configuration

Supabase is accessed via:
- `services/api-server.cjs` — reads events for UI (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`)
- `services/ingestion/src/normalizer.ts` — writes events, venues, logs

Required env vars:
- `SUPABASE_URL` — e.g. `https://bsllkpvkowwndhhxtlln.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (never expose to client)

## Health Monitoring

Check via `/health` endpoint on api-server:
- `supabase: connected` or `supabase: error`
- `last_ingestion_run` — most recent ingestion log timestamp
- `events_last_24h` — count of ingestion log entries in last 24h
- `active_sources_count` — distinct sources with events

Direct query:
```sql
SELECT * FROM ingestion_logs ORDER BY timestamp DESC LIMIT 10;
```

## Common Issues

### Supabase connection failure
- Symptom: `Supabase not configured` warning in api-server
- Fix: Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars

### Events not appearing after ingestion
1. Check `ingestion_logs` — were they inserted?
2. Check `events` table — direct query
3. Check `venues` — venue resolution may have failed, causing insert to fail silently
4. Check `status` column — should be 'published'

### Unique constraint violations
- On `venues.name`: race condition handled (re-fetch)
- On `events.dedup_hash`: upsert behavior — should not fail

## What belongs here

- Connection configuration notes
- Health monitoring procedures
- Troubleshooting guides

## What does NOT belong here

- Schema definitions (belongs to `../schema/`)
- Query definitions (belongs to `../queries/`)

## Status

**Status: Active**

Database is connected and operational. Notes should be updated as issues arise.
