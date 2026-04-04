# 01-Sources/active

## Purpose

Contains information about currently active production sources. These are sources that have passed the three-phase testing approach and are running in the live ingestion pipeline.

## What belongs here

- Source configuration and adapter information
- Current source status
- Source-specific metadata

## What does NOT belong here

- Source code (lives in `services/ingestion/src/sources/`)
- Testing results (lives in `../diagnostics/`)
- Candidate evaluation (lives in `../candidate-lists/`)

## Active sources

Current active production sources:

| Source | Method | Status | Notes |
|--------|--------|--------|-------|
| kulturhuset | ElasticSearch API | Active | High confidence, 100+ events |
| ticketmaster | Official API | Active | Verified E2E, 165 events in DB |
| eventbrite | JSON-LD | Active | 46 events through pipeline |
| billetto | API | Partial | API key required |
| stockholm | Discovery seeding | Active | Sample events only |
| berwaldhallen-tixly | Tixly API | Active | Tixly integration |

## Status

**Status: Active**

This folder is a placeholder for source metadata. Actual source adapters are in `services/ingestion/src/sources/`.
