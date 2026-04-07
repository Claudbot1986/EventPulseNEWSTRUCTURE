# B-JSON-feedGate

Network inspection layer for discovering hidden API endpoints that power a page dynamically, and JSON/feed structured data sources (JSON-LD, RSS, ICS, static JSON files).

## Purpose

When a page has no JSON-LD but loads events via XHR/fetch (e.g., a JavaScript-driven event calendar), this step intercepts those network requests to find a cleaner data source than rendered HTML. Also handles direct JSON/feed sources like RSS, ICS, and static JSON files.

## Tools

- `A-networkGate.ts` — main gate logic
- `networkInspector.ts` — request interception and analysis

## Decision Rule
From `network-path-strategy.md`:

> Use API only if it is cleaner AND more complete AND more stable than HTML.

All three conditions must be satisfied. If the XHR/fetch endpoint returns incomplete or unstable data, fall through to C-htmlGate.

### B-inspektion MÅSTE inkludera subpages
B-JSON-feedGate får inte bara testa root-URL.
Många källor har ingen API på root men väl på:
- /events
- /kalender
- /program
- /whatson
- /api/events

**Korrekt B-flöde:**
1. Inspect root for network requests
2. Inspect discovered event-candidate subpages for network requests
3. Only conclude "no viable API" after subpage inspection

## Current Status

**Partially implemented.** `A-networkGate.ts` exists. `networkInspector.ts` exists for request interception. The routing logic between this step and C-htmlGate is not yet fully wired in the ingestion pipeline.
