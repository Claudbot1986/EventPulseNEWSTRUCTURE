# 05-Supabase/migrations

## Purpose

Contains database migration files for Supabase schema changes. Migrations are sequential and versioned — each applies in order to build the current schema.

## Migration Naming Convention

Format: `YYYYMMDD-NNNN-description.sql`

Example:
- `20260329-0001-initial-schema.sql`
- `20260330-0002-add-ingestion-logs.sql`

## How Migrations Work

Migrations are applied by Supabase's migration system or manually via `psql` / Supabase dashboard.

## What belongs here

- Sequential migration files
- Rollback scripts (if applicable)
- Schema version history

## What does NOT belong here

- Raw SQL queries (belongs to `../queries/`)
- Schema overview (belongs to `../schema/`)

## Status

**Status: Active**

Current migrations:

- `20260427-0001-venue-graph.sql` — adds Venue Graph tables for `07-Discovery`: graph nodes, edges, observations, venue/source candidates, expansion queue/results, and immutable run summaries.
- `20260427-0002-source-candidate-testing.sql` — adds source candidate test queue, measured A/B/C/D run evidence, decisions, atomic claim RPC, and enqueue RPC for testing `source_candidates` before canonical promotion.

Keep a clear record of what each migration does. Once a migration is applied outside local development, do not edit it; add a new forward migration instead.
