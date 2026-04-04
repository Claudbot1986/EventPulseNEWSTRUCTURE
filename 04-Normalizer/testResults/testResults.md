# 04-Normalizer/testResults

## Purpose

Contains test results and validation reports for the normalization layer: unit tests, integration tests, venue resolution tests, deduplication tests, and field mapping validation.

## What belongs here

- Unit test output for `normalizer.ts`
- Integration test results (end-to-end from queue to Supabase)
- Dedup test reports
- Venue resolution edge case tests

## Current Test Files

Tests live in `services/ingestion/src/extract/__tests__/`:
- `dedup.test.ts` — deduplication logic
- `extractor.test.ts` — field extraction
- `integration.test.ts` — full pipeline integration

## What does NOT belong here

- Source adapter tests (belongs to `02-Ingestion/testResults/`)
- Queue-level smoke tests (belongs to `03-Queue/testResults/`)

## Status

**Status: Placeholder**

Add test output logs and validation reports here. Keep raw test output for debugging.
