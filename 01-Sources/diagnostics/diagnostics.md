# Diagnostics

## Purpose

Test results and failure analysis for sources. Contains raw output from all testing phases.

## What Belongs

- Phase 1-3 test logs
- Diagnosis results
- Failure reasons
- Error traces

## What Does Not Belong

- Candidate decisions (go to `candidate-lists/`)
- Archived records (go to `archive/`)

## Confirmed Failures

From `phase1-subpage-diagnostic.md`:

| Source | Issue |
|--------|-------|
| Konserthuset | No JSON-LD |
| Berwaldhallen | No JSON-LD |
| GSO | No JSON-LD |
| Liseberg | Cannot verify |
| Billetto | Cannot verify |

## Confirmed Success

From `phase1-verified-e2e.md`:
- **Eventbrite**: 46 events confirmed through full pipeline

## Status

**Under construction.** Actual diagnostics live in `services/ingestion/src/`.
