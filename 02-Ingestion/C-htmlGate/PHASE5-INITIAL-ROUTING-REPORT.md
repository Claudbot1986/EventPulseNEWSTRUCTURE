# Phase 5 — Initial Routing Report

**Document Type: HISTORICAL REPORT**
**Status: COMPLETE — 2026-04-07**

> **⚠️ DETTA ÄR EN HISTORISK RAPPORT FRÅN 2026-04-07.**
> Bilder och slutsatser i denna fil speglar förhållandena VID DEN TIDPUNKTEN och ska inte tolkas som aktuell status.
>
> **⚠️ NAMNRÖRA-VARNING:** C0/C1/C2-terminologi i denna fil refererar till nuvarande implementation. Se [C-status-matrix.md](./C-status-matrix.md) för förklaring av hur dessa mappas till canonical C1/C2/C3/C4-AI.
>
> **Författare:** Hermes Agent
> **Genomförandedatum:** 2026-04-07
> **Phase:** 5 of RebuildPlan.md

---

## Summary

Initial routing of all 425 canonical sources to the five operational queues has been completed.

---

## Queue Distribution

| Queue | Count | Description |
|-------|-------|-------------|
| A | 3 | Direct API/Network sources |
| B | 2 | JSON/Feed/Structured data sources |
| C | 414 | HTML-based sources (unknown path) |
| D | 1 | JS-Render required sources |
| H | 5 | Manual review / test sources |
| **Total** | **425** | |

---

## Confidence Distribution

| Confidence | Count | Notes |
|------------|-------|-------|
| high | 5 | Verified paths (A/B preferredPath) |
| medium | 2 | Fryshuset (D-render), preferredPath=html |
| low | 418 | Unknown preferredPath → C-queue |
| verified | 0 | Not set in initial routing (per spec) |

---

## Queue A — Direct API/Network (3 sources)

| Source ID | Reason |
|-----------|--------|
| berwaldhallen | preferredPath=network, Tixly API verified |
| kulturhuset | preferredPath=network, ElasticSearch API |
| ticketmaster | preferredPath=api, Official API |

---

## Queue B — JSON/Feed/Structured Data (2 sources)

| Source ID | Reason |
|-----------|--------|
| eventbrite | preferredPath=jsonld, JSON-LD extraction |
| svenska-schackf-rbundet | preferredPath=jsonld, JSON-LD confirmed |

---

## Queue C — HTML-Based (414 sources)

All sources with `preferredPath=unknown` or no explicit path.

**Note:** 418 sources have low confidence because they have not yet been analyzed. The C-batchmaker (Phase 6) will process these in batches of 10 to discover the actual HTML structure.

---

## Queue D — JS-Render Required (1 source)

| Source ID | Reason |
|-----------|--------|
| fryshuset | preferredPath=render, JS-rendered (Nuxt) |

---

## Queue H — Manual Review (5 sources)

| Source ID | Reason |
|-----------|--------|
| abf-conflict-1 | test/conflict source, requires manual review |
| dubblett-v2-test | test source, not real |
| flaggad-v2-test | test source, not real |
| ren-ny-kalla-v2-test | test source, not real |
| test-write-verify | test source, not real |

---

## Changes Made

### Source Files (sources/*.jsonl)

Each of the 425 source files has been updated with:
- `currentQueue`: A/B/C/D/H
- `routingConfidence`: low/medium/high
- `routingReason`: text explanation
- `routedAt`: ISO timestamp
- `route-history`: appended with Phase 5 entry

### Queue Files

New queue entries created in:
- `02-Ingestion/A-directAPI-networkGate/A-queue/`: 3 files
- `02-Ingestion/B-JSON-feedGate/B-queue/`: 2 files
- `02-Ingestion/C-htmlGate/C-queue/`: 415 files (414 + example)
- `02-Ingestion/D-renderGate/D-queue/`: 2 files (1 + example)
- `02-Ingestion/H-manualReview/H-queue/`: 5 files

---

## Notable Observations

1. **Most sources (414) defaulted to C-queue** because `preferredPath=unknown` in the raw import data
2. **Only 7 sources have verified preferredPath** from previous testing
3. **5 test sources** were routed to H as they are not real production sources
4. **No source has routingConfidence=verified** — this is correct per spec, as verified status requires the actual verification functions from Phase 8

---

## Next Steps

1. **Phase 6:** Build C-Batchmaker to process C-queue in batches of 10
2. **Phase 7:** Run 123-loop on batches to discover actual HTML structure
3. **Phase 8:** Implement verifyA/verifyB/verifyD functions for verified routing
4. **Phase 9:** Deep analysis of H-queue sources

---

## Routing Rules Applied

```python
preferredPath=network → A (high)
preferredPath=api → A (high)
preferredPath=jsonld → B (high)
preferredPath=render → D (medium)
preferredPath=html → C (medium)
preferredPath=unknown → C (low)
test/conflict source → H (low)
requiresManualReview=true → H (medium)
```

---

**Status:** COMPLETE
