# Source: kungliga-musikhogskolan

## Identity

| Field | Value |
|-------|-------|
| sourceId | kungliga-musikhogskolan |
| sourceName | Kungliga Musikhögskolan |
| url | https://www.kmh.se |
| city | Stockholm |
| type | universitet |
| batchId | batch-001 |
| createdAt | 2026-04-05T20:25:00.000Z |

## Batch Context

| Field | Value |
|-------|-------|
| methodCandidate | html_candidate |
| verificationStatus | batch-eligible |
| eligibilityRulesVersion | 1.0 |
| selectionCriteria | C-htmlGate batch-eligible filter (html_candidate + fail/triage_required + no D-renderGate + no A/B-verified path) |
| subpageAwareAbStatus | missing |

## Pre-Run State

| Field | Value |
|-------|-------|
| rootChecked | yes |
| subpagesCheckedCount | unknown |
| likelyEventSubpages | unknown |
| preRunEventsFound | 0 |
| preRunVerdict | unclear |
| preRunFailureMode | extraction-failed |

## Post-Run State

| Field | Value |
|-------|-------|
| postRunEventsFound | - |
| postRunVerdict | - |
| postRunFailureMode | - |
| deltaEvents | - |

## HTML Pattern Analysis

| Field | Value |
|-------|-------|
| htmlPatternType | unknown |
| patternSignals | 5tt=+ 5d= |

## AI Finding Summary

**What C found:** C1 identified html_candidate. Extraction returned 0 events. Triage reason: 5 time-tags + 5 dates
**What AI analyzed:** Not yet run
**What was difficult:** Unknown - batch not executed
**What was changed:** No change
**What happened after:** No change applied

## Learning

| Field | Value |
|-------|-------|
| generalizableLearning | unknown |
| learningDescription | - |
| remainingIssue | batch not executed |
| needsD | unclear |
| notes | subpage-aware A/B assessment missing |

## Verification

| Check | Result |
|-------|--------|
| root HTML fetched | 2026-04-05 |
| subpages found | unknown |
| C0 density adequate | unclear |
| C1 signals present | yes |
| extraction worked | no |

## Compact Data (for JSON extraction)

```
SOURCE_START
{"sourceId":"kungliga-musikhogskolan","sourceName":"Kungliga Musikhögskolan","url":"https://www.kmh.se","city":"Stockholm","type":"universitet","batchId":"batch-001","methodCandidate":"html_candidate","verificationStatus":"batch-eligible","eligibilityRulesVersion":"1.0","selectionCriteria":"C-htmlGate batch-eligible filter","subpageAwareAbStatus":"missing","rootChecked":true,"subpagesCheckedCount":null,"likelyEventSubpages":null,"preRunEventsFound":0,"postRunEventsFound":null,"deltaEvents":null,"preRunVerdict":"unclear","postRunVerdict":null,"preRunFailureMode":"extraction-failed","postRunFailureMode":null,"htmlPatternType":null,"patternSignals":"5tt=+ 5d=","aiFindingSummary":"C1: 5 time-tags + 5 dates, 0 events","generalizableLearning":null,"remainingIssue":"batch not executed","needsD":"unclear","notes":"subpageAwareAbStatus missing"}
SOURCE_END
```
