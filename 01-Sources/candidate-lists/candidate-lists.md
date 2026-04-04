# Candidate Lists

## Purpose

Sources being evaluated for adoption into production. Tracks evaluation progress and routing decisions.

## What Belongs

- Candidate evaluations
- Phase 1-3 test results
- next_path routing decisions
- Batch diagnostic summaries

## What Does Not Belong

- Active sources (go to `active/`)
- Archived sources (go to `archive/`)

## Testing Phases

Sources follow three-phase testing (per `source-testing.md`):

1. **Sanity** — Basic fetch and structure check
2. **Breadth** — Event count and diversity validation
3. **Smoke** — End-to-end pipeline verification

## Current Status

**Under construction.** Actual candidate tracking lives in `services/ingestion/src/`.

From `batch-diagnostic` (phase1-verified-e2e.md):
- 25 candidates tested
- 0 approved in batch

## Reference

- Phase definitions: `source-testing.md`
- Batch results: `phase1-verified-e2e.md`
