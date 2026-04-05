# C-htmlGate Batch 004 Report
**Date:** 2026-04-06  
**Pipeline:** C0 (discoverEventCandidates) → C1 (screenUrl) → C2 (evaluateHtmlGate) → extract (extractFromHtml)

## Summary

| Metric | Value |
|--------|-------|
| Total Sources | 10 |
| Extraction Success | 2/10 |
| Total Events Found | 8 |
| C0 Candidates Found | 0/10 |
| C2 Verdict: promising | 7/10 |
| C2 Verdict: unclear | 3/10 |

## Tabular Results

```
sourceId | eventsFound | triageResult | c0Candidates | c2Verdict | c2Score | extractionSuccess
stockholm-jazz-festival-1 | 0 | medium | 0 | promising | 134 | false
svenska-fotbollf-rbundet | 0 | medium | 0 | promising | 193 | false
uppsala-kommun | 0 | strong | 0 | promising | 43 | false
ystad | 0 | strong | 0 | promising | 46 | false
kulturhuset-stadsteatern | 0 | weak | 0 | unclear | 4 | false
falkenberg | 0 | weak | 0 | promising | 48 | false
gp | 0 | weak | 0 | unclear | 4 | false
helagotland | 0 | medium | 0 | promising | 204 | false
sundsvall | 2 | weak | 0 | promising | 54 | true
vasteras | 6 | weak | 0 | promising | 38 | true
```

## Key Findings

1. **C0 Discovery fails for all 10 sources** - No internal candidate pages discovered
2. **C2 says "promising" but extraction returns 0 events** - 8/10 sources show this pattern
3. **Only 2 sources produced events** - sundsvall (2 events), vasteras (6 events)
4. **High C2 scores but no extraction** - helagotland (204), svenska-fotbollf-rbundet (193), stockholm-jazz-festival-1 (134) all score well but return 0

## Pattern: C2 promising + 0 events

The batch confirms the plateau pattern from batch-state.jsonl:
- C2 gate approves pages based on time-tag density
- But time-tags don't mean structured event data exists
- Extraction fails despite high C2 scores

## Files Generated

- `detailed-results.jsonl` - Raw pipeline results per source
- `summary.json` - Machine-readable summary
- `report.md` - This report