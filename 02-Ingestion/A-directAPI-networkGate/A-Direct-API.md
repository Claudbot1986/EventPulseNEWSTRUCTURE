# A-directAPI-networkGate

Sources with direct API access bypass HTML/DOM extraction entirely, providing structured JSON data directly.

## Sources

| Source | Status | Notes |
|--------|--------|-------|
| Ticketmaster | Active | Official API — verified working |
| Eventbrite | Active | JSON-LD fast path available |
| Billetto | Needs key | API key required, not yet configured |

## Tools

Source adapters live in `services/ingestion/src/sources/`. Each adapter implements a common interface for fetching and normalizing event data.

## When to Use

Use this step first — it is the fastest and most reliable path. If a source has a public or commercially available API, prefer it over any HTML-based extraction.

## Decision Logic

From `network-path-strategy.md`: API only if cleaner AND more complete AND more stable than HTML. When all three conditions hold, API is the correct path.

## Current Status

**Active.** Ticketmaster and Eventbrite adapters are functional. Billetto remains a placeholder pending API key acquisition. No separate routing logic exists yet — sources are currently hardcoded in the ingestion flow.
