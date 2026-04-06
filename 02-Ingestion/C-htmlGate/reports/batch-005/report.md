# C-htmlGate Batch 005 Report
**Date:** 2026-04-06  
**Pipeline:** C0 (discoverEventCandidates) → C1 (screenUrl) → C2 (evaluateHtmlGate) → extract (extractFromHtml)

## Summary

| Metric | Value |
|--------|-------|
| Total Sources | 10 |
| Extraction Success | 0/10 |
| Total Events Found | 0 |
| C0 Candidates Found | 0/10 |
| C2 Verdict: promising | 9/10 |
| C2 Verdict: maybe | 1/10 |

## Tabular Results

```
sourceId | eventsFound | c0Candidates | c2Verdict | c2Score | failureMode
hallsberg | 0 | 0 | promising | 44 | no-events-despite-promising-c2
ifk-uppsala | 0 | 0 | promising | 31 | no-events-despite-promising-c2
karlskoga | 0 | 0 | promising | 12 | wrong-candidate-page-selected
kumla | 0 | 0 | maybe | 16 | no-events-c2-maybe
moderna-museet | 0 | 0 | promising | 49 | no-events-despite-promising-c2
naturhistoriska-riksmuseet | 0 | 0 | promising | 131 | high-density-but-sitevision-js
polismuseet | 0 | 0 | promising | 124 | time-tags-without-structured-events
stockholm-jazz-festival-1 | 0 | 0 | promising | 134 | time-tags-without-structured-events
orebro-sk | 0 | 0 | promising | 51 | no-events-despite-promising-c2
svenska-fotbollf-rbundet | 0 | 0 | promising | 12 | wrong-candidate-page-selected
```

## Key Findings

1. **C0 Discovery fails for all 10 sources** - Same as batch 004, no internal candidate pages discovered
2. **C2 says "promising" but extraction returns 0 events** - 9/10 sources show this pattern
3. **Time-tags without date patterns** - polismuseet (24tt/0d), stockholm-jazz (26tt/0d) have high time-tag counts but no date-context
4. **High C2 scores but no extraction** - nrm (131), stockholm-jazz (134), polismuseet (124) all score well but return 0
5. **Wrong page selected by C0 winner** - karlskoga got /bygga-bo--miljo/kulturmiljoprogrammet.html (not events), svenska-fotbollf-rbundet got /biljett/ (not events)

## Pattern: C2 promising + 0 events (Confirmed Plateau)

Batch 005 confirms the plateau pattern from batch 004:
- C0 finds 0 candidates for all 10 sources (100% failure)
- C2 gate approves pages based on time-tag/date density
- But time-tags don't mean structured event data exists
- Extraction fails despite high C2 scores

## Stop Reason: no-general-improvement

Batch 005 targets the same "C0=0 candidates" problem as batch 004. The failure is:
1. NOT fixable by adjusting C2 thresholds (9/10 already "promising")
2. NOT fixable by adjusting extraction (signals suggest events but none found)
3. SiteVision/JS-hydrated content suspected for nrm, polismuseet, moderna-museet
4. Wrong page selected when C0 does find candidates (karlskoga, svenska-fotbollf-rbundet)

**Conclusion:** C0 candidate discovery failure is systemic, not fixable by C-layer changes alone.

## Classification of Failures

| Failure Type | Sources | Likely Cause |
|--------------|---------|--------------|
| C0=0 candidates, C2 promising | 6 | SiteVision/CMS, no discoverable event pages |
| C0 finds wrong page | 2 | karlskoga, svenska-fotbollf-rbundet - URL selection too broad |
| Time-tags only, no dates | 2 | polismuseet, stockholm-jazz - not event calendar pages |
| SiteVision/JS-hydrated | 1 | nrm - /kalendarium exists but content loaded via JS |

## Batch 005 vs Batch 004 Comparison

| Metric | Batch 004 | Batch 005 |
|--------|-----------|-----------|
| Success | 2/10 | 0/10 |
| Events | 8 | 0 |
| C0 candidates=0 | 10/10 | 10/10 |
| C2 promising | 7/10 | 9/10 |
| Plateau | Yes | Yes |

## Next Steps (per handoff.md)

Batch 005 = plateau, stopReason=no-general-improvement. Recommended: phase1ToQueue on 26 success sources (verified end-to-end pipeline), not more C-batch iteration.

## Files Generated

- `batch-005-baseline-results.jsonl` - Raw pipeline results per source
- `sources/` - Per-source reports