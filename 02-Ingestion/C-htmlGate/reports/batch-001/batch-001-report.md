# C-htmlGate Batch 001 Report

## Batch Header

| Field | Value |
|-------|-------|
| batchId | batch-001 |
| createdAt | 2026-04-05T20:25:00.000Z |
| status | pending (not yet run) |
| eligibilityRulesVersion | 1.0 |
| selectionCriteria | C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path) |
| subpageAwareAbStatus | missing |

**Note:** subpage-aware A/B assessment is **NOT done** for these sources. They were selected based on status filters in sources_status.jsonl, not after subpage pre-verification.

## Metrics

| Metric | Pre | Post | Delta |
|--------|-----|------|-------|
| sourcesTotal | 10 | 10 | 0 |
| successCount | 0 | - | - |
| failCount | 10 | - | - |
| eventsFoundTotal | 0 | - | - |

## Sources Summary

| # | sourceId | sourceName | city/type | preEvents | postEvents | delta | preVerdict | postVerdict | methodCandidate | needsD |
|---|----------|------------|-----------|-----------|-------------|-------|------------|-------------|-----------------|--------|
| 1 | hallsberg | Hallsberg | Örebro/kommunal | 0 | - | - | unclear | - | html_candidate | unclear |
| 2 | ifk-uppsala | IFK Uppsala | Uppsala/fotbollsklubb | 0 | - | - | unclear | - | html_candidate | unclear |
| 3 | karlskoga | Karlskoga | Örebro/kommunal | 0 | - | - | unclear | - | html_candidate | unclear |
| 4 | kumla | Kumla | Örebro/kommunal | 0 | - | - | unclear | - | html_candidate | unclear |
| 5 | kungliga-musikhogskolan | Kungliga Musikhögskolan | Stockholm/musiklärosäte | 0 | - | - | unclear | - | html_candidate | unclear |
| 6 | liljevalchs-konsthall | Liljevalchs Konsthall | Göteborg/museum | 0 | - | - | unclear | - | html_candidate | unclear |
| 7 | lulea-tekniska-universitet | Luleå Tekniska Universitet | Luleå/universitet | 0 | - | - | unclear | - | html_candidate | unclear |
| 8 | moderna-museet | Moderna Museet | Stockholm/museum | 0 | - | - | unclear | - | html_candidate | unclear |
| 9 | naturhistoriska-riksmuseet | Naturhistoriska Riksmuseet | Stockholm/museum | 0 | - | - | unclear | - | html_candidate | unclear |
| 10 | orebro-sk | Örebro SK | Örebro/fotbollsklubb | 0 | - | - | unclear | - | html_candidate | unclear |

## Pattern Groups Found

- kommunal-institution (4 sources: hallsberg, karlskoga, kumla, uppsala-kommun-related)
- idrottsförening (2 sources: ifk-uppsala, orebro-sk)
- museum (3 sources: liljevalchs-konsthall, moderna-museet, naturhistoriska-riksmuseet)
- utbildning (1 source: kungliga-musikhogskolan)
- universitet (1 source: lulea-tekniska-universitet)

## AI Analysis Summary

**Status:** Not yet run (batch is in pending state)

## Changes Applied to C-Model

None yet - batch not executed.

## Unresolved Issues

- 10 sources have 0 events found
- All sources have status fail/triage_required with html_candidate result
- subpageAwareAbStatus = missing
- Unknown whether root-only analysis is sufficient or subpage discovery is needed

## Generalizable Learnings

None yet - batch not executed.

## Linked Source Reports

- `sources/hallsberg.md`
- `sources/ifk-uppsala.md`
- `sources/karlskoga.md`
- `sources/kumla.md`
- `sources/kungliga-musikhogskolan.md`
- `sources/liljevalchs-konsthall.md`
- `sources/lulea-tekniska-universitet.md`
- `sources/moderna-museet.md`
- `sources/naturhistoriska-riksmuseet.md`
- `sources/orebro-sk.md`

## Summary (JSONL format for programmatic analysis)

```
{"batchId":"batch-001","createdAt":"2026-04-05T20:25:00.000Z","status":"pending","eligibilityRulesVersion":"1.0","selectionCriteria":"C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path)","subpageAwareAbStatus":"missing","sourcesTotal":10,"preRunSuccessCount":0,"postRunSuccessCount":0,"deltaSuccess":0,"preRunEventsFoundTotal":0,"postRunEventsFoundTotal":0,"deltaEventsTotal":0,"majorPatternGroups":["kommunal-institution","idrottsförening","museum","utbildning","universitet"],"changesApplied":[],"unresolvedCount":10,"dPendingCount":0,"noImprovementCount":10}
```