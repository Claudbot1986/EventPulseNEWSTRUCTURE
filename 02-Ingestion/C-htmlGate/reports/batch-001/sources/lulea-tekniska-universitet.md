# Source: lulea-tekniska-universitet

## Identity

| Field | Value |
|-------|-------|
| sourceId | lulea-tekniska-universitet |
| sourceName | Luleå Tekniska Universitet |
| url | https://www.ltu.se |
| city | Luleå |
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
| patternSignals | 11tt=+ 6d= |

## AI Finding Summary

**What C found:** C1 identified html_candidate. Extraction returned 0 events. Triage reason: 11 time-tags + 6 dates
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

## Learning Grouping

| Field | Value |
|-------|-------|
| siteFamily | universitet |
| likelyCms | unknown |
| contentPatternGuess | subpage-event-calendar |
| likelyEventPresentation | time-tag-list |
| likelyJsShell | possible |
| candidateDifficulty | medium |
| needsSubpageDiscovery | True |

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
{"sourceId":"lulea-tekniska-universitet","sourceName":"Luleå Tekniska Universitet","url":"https://www.ltu.se","city":"Luleå","type":"universitet","batchId":"batch-001","methodCandidate":"html_candidate","verificationStatus":"batch-eligible","eligibilityRulesVersion":"1.0","selectionCriteria":"C-htmlGate batch-eligible filter","subpageAwareAbStatus":"missing","rootChecked":true,"subpagesCheckedCount":null,"likelyEventSubpages":null,"preRunEventsFound":0,"postRunEventsFound":null,"deltaEvents":null,"preRunVerdict":"unclear","postRunVerdict":null,"preRunFailureMode":"extraction-failed","postRunFailureMode":null,"htmlPatternType":null,"patternSignals":"11tt=+ 6d=","aiFindingSummary":"C1: 11 time-tags + 6 dates, 0 events","generalizableLearning":null,"remainingIssue":"batch not executed","needsD":"unclear","notes":"subpageAwareAbStatus missing"}
SOURCE_END
```
