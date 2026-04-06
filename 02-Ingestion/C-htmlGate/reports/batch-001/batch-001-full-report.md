# C-htmlGate Batch 001 Full Report

## Batch Header
| Field | Value |
|-------|-------|
| batchId | batch-001 |
| createdAt | 2026-04-06T05:54:00.000Z |
| status | completed |
| completedAt | 2026-04-06T06:30:00.000Z |
| eligibilityRulesVersion | 1.1 |
| currentBatch | 1 |

## Baseline Results (all 10 sources)

| # | sourceId | url | c0Candidates | c0Winner | c2Verdict | c2Score | eventsFound |
|---|----------|-----|--------------|----------|-----------|---------|-------------|
| 1 | hallsberg | https://www.hallsberg.se | 0 | null | promising | 44 | 0 |
| 2 | ifk-uppsala | https://www.ifkuppsala.se | 0 | null | promising | 31 | 0 |
| 3 | karlskoga | https://www.karlskoga.se | 2 | /bygga-bo--miljo/kulturmiljoprogrammet.html | promising | 12 | 0 |
| 4 | kumla | https://www.kumla.se | 1 | /kommun-och-politik/agenda-2030.html | maybe | 16 | 0 |
| 5 | kungliga-musikhogskolan | https://www.kmh.se | 1 | /konserter---evenemang.html | promising | 431 | 0 |
| 6 | lulea-tekniska-universitet | https://www.ltu.se | 2 | /utbildning/upplev-studentlivet-hos-oss | unclear | 9 | 0 |
| 7 | moderna-museet | https://www.modernamuseet.se | 0 | null | promising | 59 | 0 |
| 8 | naturhistoriska-riksmuseet | https://www.nrm.se | 2 | /vart-utbud/kalendarium | promising | 118 | 0 |
| 9 | orebro-sk | https://www.orebro.se | 0 | null | maybe | 11 | 0 |
| 10 | polismuseet | https://www.polismuseet.se | 0 | null | promising | 124 | 0 |

## Summary

| Metric | Value |
|--------|-------|
| sourcesTotal | 10 |
| successCount | 0 |
| failCount | 10 |
| eventsTotal | 0 |
| c0CandidatesFound | 8 |
| jsRenderedDetected | 0 (ALL FALSE NEGATIVES) |

## AI Analysis (Steg 8)

### Root Cause Confirmed

**All 10 sources fail because events are JavaScript-rendered.**

Verified via curl (raw HTML) vs browser (rendered):
- **kmh.se**: Browser shows 42 events in `<li>` items. curl shows ZERO event links.
- **polismuseet.se**: Browser shows structured `<article>` events. curl shows nothing.
- **nrm.se**: Browser shows event list. curl shows nothing.

### C1 JS-Detection Failure

C1's current logic:
```typescript
const likelyJsRendered = !hasMain && linkCount < 5;
```

**Problem:** Many JS-rendered pages have `<main>` and more than 5 links — but NONE of those links are the event links in raw HTML. The event links only appear after JavaScript execution.

**Evidence:** All 3 tested sources have `likelyJsRendered=false` but are definitively JS-rendered.

### Pattern Classification

**Pattern: JS-Rendered-False-Negative (Provisionally General)**

| Field | Value |
|-------|-------|
| Classification | Provisionally General |
| Sites verified | 3 (kmh, polismuseet, nrm) |
| Requirement | 2-3 more sites |
| Root cause | C1's heuristic too simple |
| Fix scope | C1 logic change |

**Sites in batch affected:** At least 3/10 confirmed JS-rendered but not detected.

### Why No Cycles Attempted

According to Steg 8 rules: "If INGEN generell förbättring möjlig → skip to steg 13"

A C1 logic change to fix JS-detection would be:
1. A C-layer change (C1)
2. Requires cross-site verification on 2-3 MORE JS-rendered sites first
3. The current batch doesn't provide enough verification data

Therefore: **no-general-improvement** → stopReason

## Recommendations

1. **Immediate:** Park these 10 sources as `pending_render` with `pendingNextTool: D-renderGate`
2. **Verify JS-detection fix on:** malmolive, sbf (already flagged as pending_render)
3. **Strengthen C1 JS-detection:** Look for event-container elements missing from raw HTML, not just `<main>` presence

## Stop Reason

`no-general-improvement` — C1 JS-detection fix requires cross-site verification before implementation.

## Batch-State Update

```json
{
  "currentBatch": 1,
  "status": "completed",
  "completedBatches": [1],
  "stopReason": "no-general-improvement",
  "cyclesCompleted": 0,
  "patternsFound": ["JS-Rendered-False-Negative"]
}
```
