# F-eventExtraction

Core field extraction — the step that actually transforms raw page data into structured event records.

## Core Fields (Required)

Always extract these six fields:
1. **title** — event name
2. **date / start_time** — event date and/or time
3. **venue** — location name
4. **url** — link to the event page
5. **ticket_url** — direct link to tickets (if available)
6. **status** — event status (scheduled, cancelled, sold_out, etc.)

## Optional Fields

- end_time, description, organizer, price, image, category, tags

## Source

From `ingestion.md`: "6 core fields plus optional fields."

## Current Status

**Part of extraction pipeline.** Field extraction is woven throughout the ingestion flow — it is not a single isolated step. Different extraction paths (API, HTML, detail probe) each produce event records with the same target schema.
