# C-htmlGate Batch 001 Report

## Batch Header

| Field | Value |
|-------|-------|
| batchId | batch-001 |
| createdAt | 2026-04-05T20:25:00.000Z |
| status | completed |
| completedAt | 2026-04-05T21:30:00.000Z |
| eligibilityRulesVersion | 1.1 |
| selectionCriteria | C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path) |
| subpageAwareAbStatus | not_required |

## Metrics

| Metric | Pre | Post | Delta |
|--------|-----|------|-------|
| sourcesTotal | 10 | 10 | 0 |
| successCount | 0 | 1 | +1 |
| failCount | 10 | 9 | -1 |
| eventsFoundTotal | 0 | 2 | +2 |

## Sources Summary

| # | sourceId | sourceName | city/type | preEvents | postEvents | delta | preVerdict | postVerdict | c2Score | failureMode |
|---|----------|------------|-----------|-----------|------------|-------|------------|-------------|---------|--------------|
| 1 | hallsberg | Hallsberg | Örebro/kommunal | 0 | 0 | 0 | unclear | promising | 44 | no-url-date-patterns |
| 2 | ifk-uppsala | IFK Uppsala | Uppsala/fotbollsklubb | 0 | 0 | 0 | unclear | promising | 31 | no-url-date-patterns |
| 3 | karlskoga | Karlskoga | Örebro/kommunal | 0 | 0 | 0 | unclear | promising | 26 | no-url-date-patterns |
| 4 | kumla | Kumla | Örebro/kommunal | 0 | 0 | 0 | unclear | promising | 38 | no-url-date-patterns |
| 5 | kungliga-musikhogskolan | Kungliga Musikhögskolan | Stockholm/musiklärosäte | 0 | 0 | 0 | unclear | promising | 41 | no-url-date-patterns |
| 6 | lulea-tekniska-universitet | Luleå Tekniska Universitet | Luleå/universitet | 0 | 0 | 0 | unclear | promising | 65 | no-url-date-patterns |
| 7 | naturhistoriska-riksmuseet | Naturhistoriska Riksmuseet | Stockholm/museum | 0 | 0 | 0 | unclear | promising | 80 | no-url-date-patterns |
| 8 | polismuseet | Polismuseet | Stockholm/museum | 0 | 0 | 0 | unclear | promising | 124 | no-url-date-patterns |
| 9 | stockholm-jazz-festival-1 | Stockholm Jazz Festival | Stockholm/festival | 0 | 0 | 0 | unclear | promising | 134 | no-url-date-patterns |
| 10 | liljevalchs-konsthall | Liljevalchs Konsthall | Stockholm/museum | 0 | 2 | +2 | unclear | promising | 22 | swedish-date-text-no-link |

## Pattern Groups Found

- kommunal-institution (3 sources: hallsberg, karlskoga, kumla)
- museum (3 sources: naturhistoriska-riksmuseet, polismuseet, liljevalchs-konsthall)
- universitet (2 sources: lulea-tekniska-universitet, kungliga-musikhogskolan)
- idrottsförening (1 source: ifk-uppsala)
- festival (1 source: stockholm-jazz-festival-1)

## AI Analysis Summary

**Status:** Completed (post-run analysis)

**Key Finding:** All 10 sources pass C2-htmlGate as `promising` with high scores (22-134), confirming the HTML structure IS event-rich. The extraction gap is NOT a C1/C2 failure.

**Root Cause of Extraction Failure:**
`extractFromHtml()` relies on three strategies:
1. URL-embedded date patterns (YYYY-MM-DD-HHMM format)
2. `/kalender/` path with Swedish date text near links
3. Page text Swedish date scanning

These 9/10 failing sources use:
- `<time datetime="ISO">` elements with dates NOT in URLs
- Event grids/cards without per-event anchor links
- Slug-based `/kalender/` URLs (WordPress/Tribe Events style)
- Date text in cards without nearby event links

**Pattern: Swedish institutional websites (kommuner, museer, universitet) use SiteVision CMS with event grids that don't expose date patterns in individual event URLs.**

## Changes Applied to C-Model

None applied in this batch run. The identified gap (URL-date-pattern dependency) requires:
1. Subpage discovery to find event detail pages
2. OR enhanced `extractFromHtml()` to parse `<time>` sibling/parent context

## Unresolved Issues

- 9/10 sources have 0 events after extraction
- C1+C2 confirm event-rich HTML but extraction fails
- Root cause: `extractFromHtml()` URL-pattern dependency not matching these sites
- C0 frontier discovery not yet tested on these sources

## Generalizable Learnings

1. **C2 threshold is calibrated** — all 10 sources pass with promising despite 0 events. This shows C2 is correctly NOT gate-keeping based on extraction success.

2. **URL-date-pattern gap is systematic** — Swedish institutional sites (SiteVision CMS) have event grids where dates are in `<time datetime>` but not in URLs.

3. **C0 frontier discovery may help** — finding actual event detail pages (not just root) could provide URLs with date patterns.

4. **Pattern classification**: sites with high time-tag counts but no URL date patterns = `timeTagOnly` subtype that needs enhanced extraction.

## Linked Source Reports

- `sources/hallsberg.md`
- `sources/ifk-uppsala.md`
- `sources/karlskoga.md`
- `sources/kumla.md`
- `sources/kungliga-musikhogskolan.md`
- `sources/liljevalchs-konsthall.md`
- `sources/lulea-tekniska-universitet.md`
- `sources/naturhistoriska-riksmuseet.md`
- `sources/polismuseet.md`
- `sources/stockholm-jazz-festival-1.md`

## Summary (JSONL format for programmatic analysis)

```json
{"batchId":"batch-001","createdAt":"2026-04-05T20:25:00.000Z","status":"completed","completedAt":"2026-04-05T21:30:00.000Z","eligibilityRulesVersion":"1.1","selectionCriteria":"C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path)","subpageAwareAbStatus":"not_required","sourcesTotal":10,"preRunSuccessCount":0,"postRunSuccessCount":1,"deltaSuccess":1,"preRunEventsFoundTotal":0,"postRunEventsFoundTotal":2,"deltaEventsTotal":2,"majorPatternGroups":["kommunal-institution","museum","universitet","idrottsförening","festival"],"changesApplied":[],"unresolvedCount":9,"dPendingCount":0,"noImprovementCount":9,"keyFinding":"extractFromHtml() URL-date-pattern dependency gap for Swedish institutional sites"}
```