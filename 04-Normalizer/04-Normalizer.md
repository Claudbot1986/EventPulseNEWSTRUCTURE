# 04-Normalizer

## Purpose

04-Normalizer is the data transformation layer that converts `RawEventInput` records from the queue into normalized `NormalizedEvent` records ready for Supabase storage. It resolves venues, deduplicates events, enriches category data, and writes to the events table.

## What belongs here

- Venue resolution logic (name matching, address-based matching, new venue creation)
- Category resolution (slugs → UUIDs via Supabase lookup)
- Deduplication logic (SHA-256 hash of source + source_id)
- Event insert/update logic (upsert behavior)
- Raw to normalized field mapping
- Language detection (sv/en field separation)
- Ingestion logging

## What does NOT belong here

- Queue infrastructure (belongs to `03-Queue`)
- Source adapters or extraction logic (belongs to `02-Ingestion`)
- Database schema (belongs to `05-Supabase/schema/`)
- UI rendering (belongs to `06-UI`)

## Normalization Pipeline

```
RawEventInput (from queue)
    │
    ├──► buildDedupHash(source, source_id) ──► dedup_hash
    │
    ├──► resolveVenue()
    │        │
    │        ├── Try: exact name match (case-insensitive)
    │        ├── If looksLikeAddress: try address-based matching
    │        ├── If no match: create new venue record
    │        └── Handle race condition (unique_violation → re-fetch)
    │
    ├──► resolveCategoryIds(slugs) ──► category UUIDs
    │
    ├──► buildNormalizedEvent()
    │        ├── title_en / title_sv (language split)
    │        ├── description_en / description_sv (language split)
    │        ├── start_time / end_time
    │        ├── venue_id (resolved)
    │        ├── category_slug (denormalized)
    │        └── raw_data (preserved)
    │
    └──► Upsert to events table
              │
              ├── If exists: UPDATE
              └── If new: INSERT + event_categories links
                        │
                        └── Enqueue searchSyncQueue (upsert)

    Also: log to ingestion_logs table
```

## Venue Resolution Rules

**DO store:**
- Real venue names with venue indicators (arena, theater, hall, museum, etc.)
- Addresses as fallback when venue name is "undefined"

**DO NOT store:**
- Promoter/company names (Live Nation, Ticketmaster, etc.)
- Attractions/performers as venues
- Bare generic words ("Park", "Hall") without context
- Literal "undefined" / "null" strings

Venue indicators: `arena, theater, theatre, hall, center, centre, club, bar, lounge, pub, restaurant, museum, galler, konsthall, teatern, scenen, krog, scen, hus, garden`

Promoter patterns: `inc, ab, ltd, llc, live nation, ticketmaster, axs, eventim, promoter, booking, management, agency, productions, entertainment, holdings`

## Deduplication Strategy

Primary: `dedup_hash = SHA-256(source :: source_id)`

Fallback (if no source_id): `SHA-256(source :: title :: start_time)`

This means the same event from the same source is never inserted twice.
Updates are preferred over inserts when dedup_hash matches.

## Language Split

Fields are duplicated with `-_en` / `-_sv` suffixes based on `detected_language`:
- If `detected_language === 'sv'`: title goes to `title_sv`, description to `description_sv`
- Otherwise: goes to `title_en` / `description_en`

This allows UI to serve the correct language variant.

## Relationship to Adjacent Layers

- **03-Queue** — provides `RawEventInput` jobs via `rawEventsQueue`; normalizer is the consumer
- **05-Supabase** — writes to `events`, `venues`, `event_categories`, `ingestion_logs` tables; reads from `venues`, `categories`
- **Meilisearch** — `searchSyncQueue` bridges to search index after Supabase write
- **06-UI** — reads denormalized `category_slug` directly for filtering (no join needed)

## Subfolders

| Subfolder | Purpose |
|-----------|---------|
| `category-mapping/` | Category slug → UUID resolution logic |
| `deduplication/` | Dedup hash strategy, duplicate detection |
| `field-mapping/` | RawEventInput → NormalizedEvent field mapping rules |
| `venue-matching/` | Venue resolution: name, address, creation |
| `notes/` | Operational notes, known edge cases |
| `testResults/` | Normalizer unit/integration test output |

## AI Guidance

When debugging missing events in UI:
1. Check if events reached the queue (`rawEventsQueue` depth)
2. Check if normalizer processed them (look for `✅ Inserted` / `✅ Updated` logs)
3. Check for venue resolution failures (events without `venue_id`)
4. Check Supabase `events` table directly
5. Check `ingestion_logs` for per-source insert/update counts

When modifying normalization:
- Never change dedup_hash algorithm (existing events will re-insert)
- Preserve `raw_data` field (useful for debugging)
- Always log to `ingestion_logs` (required for health monitoring)

## AI-regler som gäller här

- AI-Assisted Interpretation-regler: `AI/rules/global.md` (AI-Assisted Interpretation Rule-sektion)
- Ingestion-regler: `AI/rules/ingestion.md` (Normalization Rules-sektion)
- Workflow: `AI/workflows/ingestion-loop.md`

AI-regler sammanfattade: `AI/rules-summary.md`

## Status

**Status: Active**

`normalizer.ts` is functional and actively processing events. Venue resolution handles race conditions. Category resolution is integrated. Ingestion logging is in place.
