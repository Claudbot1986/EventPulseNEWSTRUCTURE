# 07-Discovery/notes

## Purpose

Operational notes for the discovery layer: known limitations, current state of expansion, and debugging procedures.

## Known Limitations

### Expansion simulation removed from legacy worker
`06-UI/services/ingestion/src/discovery/expansionWorker.ts` now delegates to `07-Discovery/src/venueGraph/expansionRunner.ts`, which writes measured expansion results via `venue_graph_expansion_results`.

Status: locally verified by focused tests/type-check and real Supabase dry-run; full ingestion package type-check still has unrelated pre-existing errors outside this worker path.

### Venue Graph tables require migration apply
`05-Supabase/migrations/20260427-0001-venue-graph.sql` defines the Venue Graph schema, but a real Supabase migration/apply run still needs verification.

### Multi-hop remains intentionally conservative
Venue Graph v0 builds deterministic nodes, edges, observations, and candidates from stored events/venues. Broader multi-hop should wait until dry-run/apply reports show useful hop-1 precision.

## What belongs here

- Known limitations
- Debugging procedures
- Operational runbooks for discovery

## What does NOT belong here

- Source code (lives in `services/ingestion/src/discovery/`)
- Schema definitions (belongs to `05-Supabase/schema/`)

## Status

**Status: Venue Graph v0 locally verified**

Update after real Supabase migration, dry-run, and small apply verification.
