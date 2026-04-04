# 02-Ingestion

## Purpose

02-Ingestion is the data transformation layer between 01-Sources and 03-Queue. It receives raw source data and transforms it into structured event records. The pipeline is progressive: it tries the cheapest extraction methods first and escalates to more expensive ones only when necessary.

## A-H Stage Structure

The A-H stages are **progressive escalation paths**, not a linear sequence every source passes through. Most sources use only 2-3 stages. The pipeline short-circuits as soon as a stage produces high-quality output.

```
Source URL
    │
    ▼
A-Direct-API ──── (Ticketmaster, Eventbrite, Kulturhuset, Billetto)
    │              Direct API calls. No gate needed — API is the source.
    ▼
B-networkGate ──── (Used when JSON-LD fails or is absent)
    │              Inspects XHR/fetch calls in-page to find internal APIs.
    │              Falls through to C if API is blocked, key-required, or noisy.
    ▼
C-htmlGate ────── (Used when no open API found)
    │              DOM-based extraction: selectors, repetitive block detection.
    │              C1 = pre-check (rapid signals scan).
    │              C2 = full heuristics (structured extraction).
    ▼
D-renderGate ──── (Last resort — high latency/cost)
    │              Headless/Cloudflare for JS-rendered pages only.
    ▼
E-detailProbe ─── (Optional enrichment step)
    │              Follows event detail links for fuller data.
    ▼
F-eventExtraction (Always runs)
    │              Extracts: title, date, venue, URL, ticket URL, status.
    ▼
G-qualityGate ─── (Always runs)
    │              Confidence scoring per event. Events below threshold flag for review.
    ▼
H-manualReview ── (Only when G fails)
                   Human review for unresolvable events.
```

### A — Direct-API

Sources with documented, open API access. Examples: Ticketmaster, Eventbrite, Billetto, Kulturhuset.

No gate logic — the API **is** the extraction path. These sources bypass B-D entirely.

### B — networkGate

Evaluates whether in-page network requests (XHR/fetch) expose a cleaner event data endpoint than HTML. Runs `networkInspector` against the source URL.

Routing outcomes:
- `network` — internal API found and accessible without auth; route to network path
- `html` — no usable API; fall through to C-htmlGate
- `blocked-review` — API exists but requires key or returns errors; route to H

Key lesson (GotEvent): **network signals exist does not mean Network Path is usable**. An API that returns HTTP 500 or requires an API key is not a viable path.

### C — htmlGate

DOM-based extraction for sources without JSON-LD or open API.

- **C1-preHtmlGate** — fast pre-check: scans for event signals (structured markup hints, microdata, common class names). Returns verdict quickly.
- **C2-htmlGate** — full heuristics: repetitive block detection, CSS selector mapping, date parsing, venue extraction. Produces structured events from raw HTML.

Falls through to D if C produces insufficient quality signals.

### D — renderGate

Headless/Cloudflare rendering for JavaScript-heavy pages that cannot be parsed from static HTML. Last resort due to latency and cost.

Activated only when C returns low-confidence results and JS-rendering is the likely cause.

### E — detailProbe

Follows event detail page links to enrich event records with fuller information (description, ticket links, images). Optional — only used when list pages provide partial data.

### F — eventExtraction

Core field extraction. Runs for every source regardless of path:

- title
- date/time
- venue/location
- event URL
- ticket URL
- status (active, sold out, cancelled)

Output feeds into G-qualityGate.

### G — qualityGate

Confidence scoring per extracted event. Applies weighted signals:
- Completeness (all required fields present)
- Date parseability
- Venue recognizability
- Source reputation

Events below threshold route to H for manual review.

### H — manualReview

Human review queue for events that cannot be automatically resolved. Only reached when G fails. Low volume — the goal is to minimize this step.

## Path Priority (Enforced Order)

| Priority | Path | Tool | When Used |
|----------|------|------|-----------|
| 1 | JSON-LD | jsonLdDiagnostic.ts | Fastest — always test first |
| 2 | Network | A-networkGate.ts | After no-jsonld or wrong-type |
| 3 | HTML | C-htmlGate.ts | Network insufficient/blocked |
| 4 | Render | Cloudflare adapter | Last resort — high cost |
| 5 | Manual | H-manualReview | Only when all above fail |

## Relationship to Adjacent Layers

- **01-Sources** → feeds raw URLs and configurations into 02-Ingestion
- **03-Queue** → receives processed events after F-eventExtraction
- 02-Ingestion is purely transformational: it never stores source state

## Rule of Simplification

Every stage in A-H must justify its existence. If a stage can be removed without losing functionality, it should be removed. Gate stages exist to **short-circuit** expensive paths — if HTML consistently yields quality data, the network stage adds no value for that source. Simplify accordingly.

## Status

**Status: Placeholder**

The folder structure is a placeholder. Actual code lives in:

```
services/ingestion/src/
  tools/
    A-networkGate.ts        # B-stage logic
    C-htmlGate/             # C-stage logic (C1 + C2)
    jsonLdExtractor.ts      # JSON-LD fast path (pre-A)
    networkInspector.ts     # Used by B
  fetch/
    cloudflareAdapter.ts    # D-stage logic
  extract/
    extractor.ts            # F-stage logic
    schema.ts               # G-stage scoring
```

The A-H naming maps to these files. The folder structure documents the intent; the TypeScript files implement the behavior.

## Quick Reference

| Stage | Purpose | Exit Condition |
|-------|---------|----------------|
| A | Direct API call | API available |
| B | Network inspection | Open API found or fall through |
| C | HTML heuristics | Sufficient quality or fall through |
| D | Render | JS needed or fall through |
| E | Detail enrichment | Optional, always beneficial |
| F | Core extraction | Always runs |
| G | Quality scoring | Passes threshold or routes to H |
| H | Manual review | Last resort |

## AI-regler som gäller här

Domänspecifika regler för ingestion:
- Fullständiga regler: `AI/rules/ingestion.md`
- Source-testing-regler: `AI/rules/source-testing.md`
- Scraping-policy: `AI/rules/scraping.md`
- Workflow: `AI/workflows/ingestion-loop.md`
- Mål/flow: `AI/rules/goals.md`, `AI/rules/goals-detailed.md`

AI-regler sammanfattade: `AI/rules-summary.md`
