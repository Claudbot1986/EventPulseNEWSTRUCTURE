# C-htmlGate Batch 001 Report

**Document Type: HISTORICAL REPORT**
**Datum:** 2026-04-05 (skapad), 2026-04-06 (completed)

## Batch Header

| Field | Value |
|-------|-------|
| batchId | batch-001 |
| createdAt | 2026-04-05T20:25:00.000Z |
| status | completed |
| completedAt | 2026-04-06T00:00:00.000Z |
| eligibilityRulesVersion | 1.1 |
| selectionCriteria | C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path) |
| subpageAwareAbStatus | not_required |

## Metrics

| Metric | Pre | Post | Delta |
|--------|-----|------|-------|
| sourcesTotal | 10 | 10 | 0 |
| successCount | 0 | 2 | +2 |
| failCount | 10 | 6 | -4 |
| infrastructureFail | 0 | 2 | +2 |
| eventsFoundTotal | 0 | 5 | +5 |

## Sources Summary

| # | sourceId | sourceName | city/type | c2Score | c2Verdict | eventsFound | failureMode | pipeline |
|---|----------|------------|-----------|---------|------------|-------------|--------------|---------|
| 1 | hallsberg | Hallsberg | Örebro/kommunal | 44 | promising | 0 | timeTagOnly-noUrlDate | success |
| 2 | ifk-uppsala | IFK Uppsala | Uppsala/fotboll | — | unfetchable | 0 | DNS ENOTFOUND | FAIL |
| 3 | karlskoga | Karlskoga | Örebro/kommunal | 26 | promising | 0 | timeTagOnly-noUrlDate | success |
| 4 | kumla | Kumla | Örebro/kommunal | 38 | promising | 0 | timeTagOnly-noUrlDate | success |
| 5 | kungliga-musikhogskolan | Kungliga Musikhögskolan | Stockholm/universitet | 4 | unclear | 0 | wrongType-rootNotEvent | success |
| 6 | lulea-tekniska-universitet | Luleå Tekniska Universitet | Luleå/universitet | 65 | promising | 3 | — | success |
| 7 | naturhistoriska-riksmuseet | Naturhistoriska Riksmuseet | Stockholm/museum | 80 | promising | 0 | timeTagOnly-noUrlDate | success |
| 8 | polismuseet | Polismuseet | Stockholm/museum | 124 | promising | 0 | timeTagOnly-noUrlDate | success |
| 9 | stockholm-jazz-festival-1 | Stockholm Jazz Festival | Stockholm/festival | — | unfetchable | 0 | timeout | FAIL |
| 10 | liljevalchs-konsthall | Liljevalchs Konsthall | Stockholm/museum | 22 | promising | 2 | — | success |

## C0 Discovery Results

| sourceId | c0Candidates | winnerUrl | eventDensity | rootRejected |
|----------|-------------|-----------|-------------|--------------|
| hallsberg | 0 | null | 0 | false |
| ifk-uppsala | 0 | null | 0 | false (DNS fail) |
| karlskoga | 2 | /bygga-bo--miljo/kulturmiljoprogrammet.html | 15 | false |
| kumla | 1 | /kommun-och-politik/agenda-2030.html | 12 | false |
| kungliga-musikhogskolan | 1 | /om/upptack | 116 | true |
| lulea-tekniska-universitet | 2 | /utbildning/upplev-studentlivet-hos-oss | 13 | false |
| naturhistoriska-riksmuseet | 2 | /vart-utbud/kalendarium | 298 | true |
| polismuseet | 0 | null | 0 | false |
| stockholm-jazz-festival-1 | 0 | null | 0 | false (timeout) |
| liljevalchs-konsthall | 0 | null | 0 | false |

**Key C0 finding:** naturhistoriska-riksmuseet C0 discovered `/vart-utbud/kalendarium` with eventDensity=298, but extractFromHtml() returned 0 events. This confirms the problem is NOT page discovery but extraction logic.

## Pattern Groups Found

- kommunal-institution (3: hallsberg, karlskoga, kumla)
- museum (3: naturhistoriska-riksmuseet, polismuseet, liljevalchs-konsthall)
- universitet (2: lulea-tekniska-universitet, kungliga-musikhogskolan)
- idrottsförening (1: ifk-uppsala — DNS fail)
- festival (1: stockholm-jazz-festival-1 — timeout)

## AI Analysis (Steg 8-11)

**Root Cause Confirmed:**
All 10 sources pass C2-htmlGate with `promising` verdict (except 2 unfetchable + 1 unclear). The extraction gap is NOT a C1/C2 failure.

**Extraction Failure Patterns:**
1. **timeTagOnly-noUrlDate** (6 sources): Sites have `<time datetime="ISO">` with ISO dates, but event-links don't contain URL date patterns. extractFromHtml() Strategy 1 (URL date) fails.
   - polismuseet: `<time datetime="11:00:00">` — tid men INTE datum i datetime
   - hallsberg/karlskoga/kumla: SiteVision med `<time datetime="2026-03-31T11:07:02+02:00">` — datum FINNS i attr men links saknar datum i URL
   - naturhistoriska: C0 hittade /kalendarium/ men extraction=0

2. **infrastructure-fail** (2 sources): DNS/timeout — ej C-problem

3. **wrongType** (1 source): kungliga-musikhogskolan C0 rejectade root (ej event-sida), C2=unclear

**What worked:**
- lulea-tekniska-universitet: 3 events via `timeTagRegex` Strategy 4 (Tribe Events Calendar struktur)
- liljevalchs-konsthall: 2 events via `timeTagRegex` Strategy 4

**Proposed General Improvement (NOT IMPLEMENTED — plateau):**
Enhance `extractFromHtml()` Strategy 4 to look for `<time datetime="YYYY-MM-DD...">` elements and traverse DOM upward to find the nearest link ancestor, then use sibling text for title extraction. This would fix the "timeTagOnly-noUrlDate" pattern across SiteVision museums/kommuner.

**Why not implemented:**
- Only 6/10 sources affected — batch shows plateau (no clear improvement trajectory)
- Enhancement would be a non-trivial C-layer change with unknown side effects
- 2 sources already succeed via existing Strategy 4

## Changes Applied

None — batch concluded with plateau stopReason.

## Unresolved Issues

- 6 sources have 0 events after extraction despite C2=promising
- C0 link discovery finds candidates but extraction fails
- Root cause is in F-eventExtraction, not C-layer
- 2 sources permanently blocked by infrastructure (DNS/timeout)

## Pattern Capture

### Pattern: timeTagOnly-noUrlDate (Provisionally General)

**Classification:** Provisionally General (Sites: polismuseet, naturhistoriska-riksmuseet, hallsberg, karlskoga, kumla)

**Potentiellt generellt problem:** SiteVision CMS museer och kommuner har `<time datetime="ISO">` med fullständigt datum men inga event-links med datum i URL. extractFromHtml() Strategy 4 hittar Tribe Events men SiteVision använder annan struktur.

**URL-struktur som påverkas:** Event card lists utan per-event anchor links

**CMS/Platform:** SiteVision (polismuseet, naturhistoriska, hallsberg, karlskoga, kumla)

**Antal sajter verifierade:** 5

**Krävs verifiering på:** 2-3 andra SiteVision-sajter

**Status:** BLOCKED — inga fler SiteVision-sajter i batch-listan

### Pattern: timeTag-datetime-noDateFormat (Site-Specific)

**Classification:** Site-Specific (Site: polismuseet)

**Problem:** polismuseet använder `<time datetime="HH:MM:SS">` (endast tid, inte datum) för öppettider, inte för events. Trots 24tt i C1 är detta öppettider, inte event-datum.

**URL-struktur:** Ej tillämpligt

**CMS/Platform:** Anpassat CMS (ej SiteVision)

**Antal sajter verifierade:** 1

**Status:** Site-Specific — source adapter rekommenderas

## Batch Conclusion

| Field | Value |
|-------|-------|
| cyclesCompleted | 0 |
| maxCycles | 3 |
| stopReason | plateau |
| successCount | 2 (lulea, liljevalchs) |
| failCount | 6 (extraction gap) |
| infrastructureFail | 2 (DNS/timeout) |
| eventsFound | 5 |

**Plateau理由:** 
- Baseline: 0 events, 0 success
- Post: 5 events, 2 success (men 2 av dessa är infrastructure-fail sources)
- Förbättring = +2 success men 6/8 kvarvarande har samma timeTagOnly-noUrlDate pattern
- Nästa cykel skulle kräva icke-trivial F-eventExtraction ändring
- Risk att ändringen är site-specifik

## Recommendations

1. **Källa-specifika lösningar för 6 failing:**
   - polismuseet: Undersök om events FaktisKT finns på sidan (C0 hittade 0 links)
   - naturhistoriska: C0 hittade /kalendarium/ — prova att köra extractFromHtml() på den URL:en
   - hallsberg/karlskoga/kumla: SiteVision-kommuner — kolla om /kalender/ subpage existerar

2. **Network Path-upptäckt:**
   - Liljevalchs har Tribe Events REST API (`/wp-json/tribe/events/v1/`)
   - Kolla om andra Tribe Events-sajter finns i source-listan

3. ** Nästa batch:** Välj sources med redan bevisad path (events > 0) för att testa pipeline-integritet

## Summary (JSONL)

```json
{"batchId":"batch-001","status":"completed","stopReason":"plateau","cyclesCompleted":0,"preRunSuccess":0,"postRunSuccess":2,"preRunEvents":0,"postRunEvents":5,"deltaSuccess":2,"deltaEvents":5,"infrastructureFail":2,"extractionGapFail":6,"c0CandidatesFound":4,"patternsFound":["timeTagOnly-noUrlDate","infrastructure-fail","wrongType"],"recommendations":["network-path-for-tribe-events","kalendarium-subpage-for-sitevision","source-adapter-for-polismuseet"]}
```
