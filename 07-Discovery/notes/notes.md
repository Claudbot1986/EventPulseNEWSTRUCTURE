# 07-Discovery/notes

## Purpose

Operational notes for the discovery layer: known limitations, current state of expansion, and debugging procedures.

## Known Limitations

### Expansion produces simulated results
Current `expansionWorker.ts` inserts into `discovery_expansion_results` but the result_summary is simulated. Real BFS traversal is not yet fully connected.

### Discovery tables may not exist
`discovery_expansion_queue` and `discovery_expansion_results` are referenced in code but may not have migrations in `05-Supabase/`.

### Multi-hop BFS is bounded but not fully producing
`MAX_HOPS = 3` is set in `multiHopDiscovery.ts`. Venue graph connections are tracked but new venue creation from expansion is limited.

## What belongs here

- Known limitations
- Debugging procedures
- Operational runbooks for discovery

## What does NOT belong here

- Source code (lives in `services/ingestion/src/discovery/`)
- Schema definitions (belongs to `05-Supabase/schema/`)

## Status

**Status: Under uppbyggnad**

Update as discovery matures.
