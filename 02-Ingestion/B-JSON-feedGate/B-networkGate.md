# B-JSON-feedGate

Feed extraction layer for discovering structured event data in HTML or via simple static endpoints.

## Purpose

When a page has no JSON-LD but exposes event data via feeds (RSS, ICS, static JSON files, script tags with JSON-LD, event-calendar endpoints), this step extracts that structured data directly. Falls through to C-htmlGate when no usable feed is found.

## Scope

B-JSON-feedGate handles:
- JSON-LD embedded in `<script type="application/ld+json">`
- RSS/Atom feeds
- ICS (iCalendar) feeds
- Static JSON files with event data
- Feed links discovered in HTML (`<link rel="alternate" type="application/rss+xml">`)
- Event-calendar API responses (simple JSON endpoints, not requiring browser/XHR)

B-JSON-feedGate does NOT handle:
- XHR/fetch network inspection (that is A-directAPI-networkGate)
- JS-rendered content (that is D-renderGate)
- Live API endpoints requiring API keys (those belong in A)

## Tools

- `A-networkGate.ts` — main gate logic (feed evaluation)
- `networkInspector.ts` — optional: used to discover XHR-based feeds if applicable

## Decision Rule

> Use feed data if it is directly readable and contains usable event data.

Feed must be:
1. Accessible without authentication or API key
2. Return structured event data (JSON, XML/RSS, ICS)
3. Not require JavaScript execution to load

If the feed requires browser rendering or returns opaque/binary formats, fall through to C-htmlGate.

### B-inspektion MÅSTE inkludera subpages
B-JSON-feedGate får inte bara testa root-URL.
Många källor har ingen feed på root men väl på:
- /events
- /kalender
- /program
- /whatson
- /feed
- /events/rss

**Korrekt B-flöde:**
1. Check root for feed links and JSON-LD
2. Check discovered event-candidate subpages for feeds
3. Only conclude "no viable feed" after subpage inspection

## Current Status

**Partially implemented.** Feed extraction logic exists. Integration into scheduler is ongoing.
