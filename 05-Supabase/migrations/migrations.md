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

**Status: Placeholder**

Add migration files as schema changes are made. Keep a clear record of what each migration does.
