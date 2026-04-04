# 01-Sources

## Purpose

This folder is the entry point for all event sources in EventPulse. It holds information about where events come from, how they are evaluated, and their current status.

## What belongs here

- Active source definitions (source adapters, configurations)
- Candidate lists (potential sources being evaluated)
- Source matrices (evaluation criteria, comparison data)
- Diagnostics (test results, failure analysis)
- Archive (deprecated or discarded sources)

## Source lifecycle

```
[new candidate]
    ↓
[active] ← sources currently in production or testing
    ↓ or
[candidate-lists] ← sources being evaluated for adoption
    ↓
[source-matrices] ← evaluation data for decision-making
    ↓ or
[archive] ← rejected or deprecated sources
```

## Active sources (production)

Current verified production sources:
- **kulturhuset** — ElasticSearch API, high confidence
- **ticketmaster** — Official API, verified E2E (165 events in DB)
- **eventbrite** — JSON-LD fast path, verified E2E (46 events through pipeline)
- **billetto** — API key required, partial functionality
- **stockholm** — Discovery seeding source (generates sample events)
- **debaser** — robots.txt policy tested, currently blocked
- **berwaldhallen-tixly** — Tixly API integration

## Source testing phases

Every new source must pass three phases before production:

1. **Phase 1: Sanity** (`--mode=sanity`) — 1-2 events, verify source responds
2. **Phase 2: Breadth** (`--mode=breadth`) — 10-20 events, full pipeline validation
3. **Phase 3: Smoke** (`--mode=smoke`) — 3 events/venue, production-like import

Existing production adapters (kulturhuset, ticketmaster, eventbrite, billetto) skip phases 1-2.

## Path priority for source discovery

From goals.md (enforced order):

1. **JSON-LD** — schema.org/Event in `<script type="application/ld+json">` — fastest, most reliable
2. **Network Path** — internal API/XHR endpoints — only if cleaner AND more complete AND more stable than HTML
3. **HTML Path** — DOM heuristics + repetitive block detection — for sources without API
4. **Render Path** — headless/Cloudflare — last resort, high latency/cost
5. **Manual Review** — only for sources that cannot be resolved

## AI guidance

When evaluating a source:
1. Check which path it uses (JSON-LD → Network → HTML → Render)
2. Apply the correct tool for that path
3. Record diagnosis in source-matrices
4. If approved, add to candidate-lists → active
5. If rejected, move to archive with reason

## Status

**Status: Active**

This folder contains the source layer of EventPulse. The folder structure itself is a placeholder — actual source code lives in `services/ingestion/src/sources/`. This folder tracks source metadata and evaluation state.

## Relationship to other folders

- **01-Sources** feeds into **02-Ingestion** — sources provide raw data to ingestion pipeline
- **02-Ingestion/A-Direct-API** handles API-based sources (ticketmaster, eventbrite)
- **02-Ingestion/C-htmlGate** handles HTML-based sources
- **03-Queue** receives processed events from ingestion
- **06-UI** displays events from sources

## Subfolders

| Subfolder | Purpose |
|-----------|---------|
| `active/` | Currently running production sources |
| `candidate-lists/` | Sources being evaluated for adoption |
| `source-matrices/` | Evaluation criteria and comparison data |
| `diagnostics/` | Test results and failure analysis |
| `archive/` | Rejected or deprecated sources |

## AI-regler som gäller här

Domänspecifika regler för sources:
- Source-testing-regler: `AI/rules/source-testing.md`
- Scraping-policy: `AI/rules/scraping.md`
- Mål/flow: `AI/rules/goals.md`

AI-regler sammanfattade: `AI/rules-summary.md`
