# 05-Supabase

## Purpose

05-Supabase is the persistence layer of EventPulse. It contains the database schema, migrations, SQL queries, and database-related documentation for all Supabase/PostgreSQL storage.

## What belongs here

- Supabase schema definitions (events, venues, categories, event_categories, ingestion_logs, etc.)
- Database migrations
- SQL query definitions and stored procedures
- Database connection configuration
- Table relationship documentation
- Index and constraint definitions

## What does NOT belong here

- Queue infrastructure (belongs to `03-Queue`)
- Normalization logic (belongs to `04-Normalizer`)
- UI components (belongs to `06-UI`)
- Ingestion source adapters (belongs to `02-Ingestion`)

## Core Tables

| Table | Purpose |
|-------|---------|
| `events` | Normalized event records — the primary output of the pipeline |
| `venues` | Venue records with name, address, lat/lng, PostGIS location |
| `categories` | Category lookup (slugs → UUIDs) |
| `event_categories` | Many-to-many join between events and categories |
| `ingestion_logs` | Per-source insert/update logs for health monitoring |

## Relationship to Adjacent Layers

- **02-Ingestion** outputs structured events that become `RawEventInput`
- **03-Queue** delivers `RawEventInput` as BullMQ jobs
- **04-Normalizer** writes normalized events to Supabase tables
- **06-UI** reads events from Supabase via API server (`/supabase-events`)
- **searchSyncQueue** (via 03-Queue) syncs events to Meilisearch after Supabase write

## API Access Pattern

```
06-UI → api-server.cjs (/supabase-events) → Supabase client (service role)
                                             │
                                             ├── SELECT events + venues JOIN
                                             ├── WHERE status = 'published'
                                             └── ORDER BY start_time ASC
```

## Supabase Configuration

- URL: `process.env.SUPABASE_URL`
- Service role key: `process.env.SUPABASE_SERVICE_ROLE_KEY`
- Client lives in `services/api-server.cjs` and `services/ingestion/src/normalizer.ts`

## Subfolders

| Subfolder | Purpose |
|-----------|---------|
| `schema/` | Table definitions, column types, relationships, indexes |
| `migrations/` | Migration files (sequential, versioned) |
| `queries/` | Pre-defined SQL queries, reusable query patterns |
| `notes/` | Database operational notes, connection issues |
| `testResults/` | Schema validation, migration test results |

## AI Guidance

When adding new fields to events:
1. Add to `events` table schema in `schema/`
2. Update `normalizer.ts` field mapping in `04-Normalizer/field-mapping/`
3. Update `api-server.cjs` unified event shape transformation
4. Run migration if schema change is needed
5. Verify via `/supabase-events` endpoint

When debugging missing data in UI:
1. Query `events` table directly — is data there?
2. Check `ingestion_logs` — were events inserted/updated?
3. Check `venues` table — venue resolution may have failed
4. Check `event_categories` — category links may be missing

## AI-regler som gäller här

- Global-regler: `AI/rules/global.md` (Domain Boundaries → supabase/)
- E2E-verifiering: `AI/workflows/verify-end-to-end.md`

AI-regler sammanfattade: `AI/rules-summary.md`

## Status

**Status: Active**

Supabase is connected and storing events. Schema is defined. API server reads from Supabase. Ingestion pipeline writes to Supabase via normalizer.
