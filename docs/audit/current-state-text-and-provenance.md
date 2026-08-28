# Text and Provenance — Current State

> Phase A audit deliverable T0021 (text + provenance). Pure inventory — no decisions yet.
> Last verified: 2026-08-21.

---

## Text fields

### In events_public (anon-readable view)

The `events_public` view exposes four text fields:

| Field | Type | Source in DB | Content |
|-------|------|-------------|---------|
| `title_en` | text | `events.title_en` | English event title |
| `title_sv` | text | `events.title_sv` | Swedish event title |
| `description_en` | text | `events.description_en` | English description |
| `description_sv` | text | `events.description_sv` | Swedish description |

These are exposed to anonymous users via the `events_public` view (GRANT SELECT TO anon, authenticated).

### Text provenance

Text comes exclusively from source adapters and the universal extractor:

**JSON-LD path** (`universal-extractor.ts makeEvent()`, line 249):
```typescript
let desc = norm(data.description || data.shortDescription || data.intro || data.text || data.shortDesc);
// Strip HTML tags, cap 500 chars:
desc = desc.replace(/<[^>]+>/g, '').slice(0, 500);
```

Title is assembled from (line 200–205):
- `data.translations.originalName | .name | .title`
- `data.name || data.title || data.eventTitle || data.heading || data.label`

**No field tracks which extraction method produced the text** (A1 JSON-LD vs B1–B5 JS-embedded vs C1–C3 HTML heuristics). The `confidence.signals` array records the method but not which specific field came from which method.

**No `source_url` on text fields** in `events_public`. `source` (the source slug, e.g. `ticketmaster`, `folkoperan`) is the only provenance pointer on the view.

**No character count or language-detection fields exist** on the schema.

---

## Provenance tracking

### event_provenance table

Created in `20260818-0001-agent-event-graph.sql` (lines 109–131).

```sql
CREATE TABLE event_provenance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,         -- e.g. 'ticketmaster', 'folkoperan'
  source_event_id TEXT NOT NULL,         -- original ID from that source
  source_url      TEXT,                  -- URL of the source page/event
  raw_payload_ref TEXT,                  -- optional reference to raw fetch blob
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      SMALLINT NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  UNIQUE (event_id, source, source_event_id)
);
```

**RLS:** REVOKE ALL FROM anon, authenticated; GRANT ALL TO service_role only.

**Purpose:** One row per (event_id, source) — tracks that event X was originally seen from source Y with ID Z. `raw_payload_ref` is a reference to the raw fetch result (not yet populated in the current implementation).

**Unique constraint** `(event_id, source, source_event_id)` prevents duplicate source entries per event.

### organizers table

Created in `20260818-0001-agent-event-graph.sql` (lines 39–54):

```sql
CREATE TABLE organizers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  homepage_url TEXT,
  source       TEXT,     -- source system that first created this organizer
  source_id    TEXT,     -- original ID from that source
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`organizers.source` and `organizers.source_id` track which upstream system the organizer record came from.

**RLS:** same as event_provenance — service_role only.

### events.source field

The `events.source` column (inherited from the original schema) stores the source slug. This is the only provenance field exposed on `events_public` to anonymous users.

### events.organizer_id

`events.organizer_id` (UUID, FK to organizers) links an event to its organizer. Populated during ingestion when the organizer is recognized. Coverage is ~100% for new events but still being backfilled for older rows (`20260820-0001-outbound-attribution.sql` notes this).

---

## Provenance flow summary

```
Ingestion extracts event from source
  → events.source = source slug (e.g. 'folkoperan')
  → event_provenance row inserted: (event_id, source, source_event_id, source_url, fetched_at)
  → organizers row created or matched by slug
  → events.organizer_id → organizers.id (FK)
  → event exposed in events_public with source field only
```

**What anon users see:** `source` field on each event row. No organizer_id, no event_provenance, no raw_payload_ref.

**What the agent sees (service_role):** Full event_provenance chain, organizer details, organizer_id on events.

---

## Inventory summary

| Asset | Storage | Anon visible | Rights/licensing | Editable by anon |
|-------|---------|-------------|-----------------|-----------------|
| title_en | events.title_en | Yes (via events_public) | None | No |
| title_sv | events.title_sv | Yes (via events_public) | None | No |
| description_en | events.description_en | Yes (via events_public) | None | No |
| description_sv | events.description_sv | Yes (via events_public) | None | No |
| source | events.source | Yes (via events_public) | None | No |
| image_url | events.image_url | Yes (via events_public) | None | No |
| event_provenance | event_provenance table | No (service_role only) | None | No |
| organizers | organizers table | No (service_role only) | None | No |
| organizer_id | events.organizer_id | No (excluded from events_public) | None | No |
| raw_payload_ref | event_provenance.raw_payload_ref | No (service_role only) | N/A | No |

**No rights, license, attribution, or copyright fields exist anywhere in the schema or extraction pipeline.**
