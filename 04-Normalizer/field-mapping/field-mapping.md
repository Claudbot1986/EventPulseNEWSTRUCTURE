# 04-Normalizer/field-mapping

## Purpose

Documents how fields are mapped from `RawEventInput` to the Supabase `events` table schema (`NormalizedEvent`).

## RawEventInput → events Table

| RawEventInput field | events column | Notes |
|---------------------|---------------|-------|
| `title` | `title_en` | If `detected_language === 'sv'` → `title_sv` instead |
| `description` | `description_en` | If `detected_language === 'sv'` → `description_sv` instead |
| `start_time` | `start_time` | ISO timestamp |
| `end_time` | `end_time` | Only stored if valid ISO timestamp (contains `T`), not just `HH:MM` |
| `source` | `source` | e.g. `'eventbrite'`, `'ticketmaster'` |
| `source_id` | `source_id` | Source-specific event ID |
| `venue_id` | `venue_id` | Resolved UUID from `resolveVenue()` |
| `lat` | `lat` | Falls back to Stockholm center (59.3293) if null |
| `lng` | `lng` | Falls back to Stockholm center (18.0686) if null |
| `location` | `location` | `POINT(lng lat)` PostGIS format |
| `is_free` | `is_free` | Boolean |
| `price_min_sek` | `price_min_sek` | |
| `price_max_sek` | `price_max_sek` | |
| `url` or `ticket_url` | `ticket_url` | Prefer `url`, fallback to `ticket_url` |
| `image_url` | `image_url` | |
| `dedup_hash` | `dedup_hash` | SHA-256 of source::source_id |
| `category_slug` | `category_slug` | Denormalized for fast UI filtering |
| `status` | `status` | Always `'published'` for normalized events |
| `raw_payload` | `raw_data` | Preserved for debugging |

## Venue_id Resolution

See `../venue-matching/venue-matching.md` for full venue resolution logic.

## Language Split

The normalizer creates parallel `*_en` / `*_sv` fields based on detected language:

```
if detected_language === 'sv':
    title_sv = title
    title_en = null
    description_sv = description
    description_en = null
else:
    title_en = title
    title_sv = null
    description_en = description
    description_sv = null
```

This allows the API to serve language-appropriate content without runtime detection.

## What belongs here

- Field mapping table
- Language split logic
- Default value handling

## What does NOT belong here

- Venue resolution (belongs to `../venue-matching/`)
- Category resolution (belongs to `../category-mapping/`)

## Status

**Status: Active**

Field mapping is implemented in `normalizer.ts` `processRawEvent()`. Language split is in place. `raw_data` is preserved for debugging.
