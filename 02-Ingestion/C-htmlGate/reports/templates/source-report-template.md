# Source: {sourceId}

## Identity

| Field | Value |
|-------|-------|
| sourceId | {sourceId} |
| sourceName | {sourceName} |
| url | {url} |
| city | {city} |
| type | {type} |
| batchId | {batchId} |
| createdAt | {ISO timestamp} |

## Batch Context

| Field | Value |
|-------|-------|
| methodCandidate | {html_candidate/render_candidate/network_candidate} |
| verificationStatus | {batch-eligible/subpage-verified/manual-review-needed} |
| eligibilityRulesVersion | {version} |
| selectionCriteria | {text} |
| subpageAwareAbStatus | {done/partial/missing} |

## Pre-Run State

| Field | Value |
|-------|-------|
| rootChecked | {yes/no} |
| subpagesCheckedCount | {N} |
| likelyEventSubpages | [{paths}] |
| preRunEventsFound | {N} |
| preRunVerdict | {promising/maybe/unclear/low_value} |
| preRunFailureMode | {none/extraction-failed/no-events/no-subpages} |

## Post-Run State (after AI-assisted change)

| Field | Value |
|-------|-------|
| postRunEventsFound | {N} |
| postRunVerdict | {promising/maybe/unclear/low_value} |
| postRunFailureMode | {none/extraction-failed/no-events/no-subpages} |
| deltaEvents | {+/-N} |

## HTML Pattern Analysis

| Field | Value |
|-------|-------|
| htmlPatternType | {event-list/event-grid/news-based/mixed/unknown} |
| patternSignals | {timeTagCount, dateCount, listMarker, etc.} |

## AI Finding Summary

**What C found:** {description}
**What AI analyzed:** {description}
**What was difficult:** {description}
**What was changed:** {description or "no change"}
**What happened after:** {description or "no change applied"}

## Learning

| Field | Value |
|-------|-------|
| generalizableLearning | {yes/no/partially} |
| learningDescription | {text} |
| remainingIssue | {text or "none"} |
| needsD | {yes/no/unclear} |
| notes | {text} |

## Verification

| Check | Result |
|-------|--------|
| root HTML fetched | {yes/no} |
| subpages found | {yes/no} |
| C0 density adequate | {yes/no} |
| C1 signals present | {yes/no} |
| extraction worked | {yes/no} |

## Compact Data (for JSON extraction)

```
SOURCE_START
{"sourceId":"{id}","sourceName":"{name}","url":"{url}","city":"{city}","type":"{type}","batchId":"{batchId}","methodCandidate":"{method}","verificationStatus":"{status}","eligibilityRulesVersion":"{ver}","selectionCriteria":"{criteria}","subpageAwareAbStatus":"{ab}","rootChecked":{root},"subpagesCheckedCount":{n},"likelyEventSubpages":{paths},"preRunEventsFound":{pre},"postRunEventsFound":{post},"deltaEvents":{delta},"preRunVerdict":"{pver}","postRunVerdict":"{pvr}","preRunFailureMode":"{pfm}","postRunFailureMode":"{pofm}","htmlPatternType":"{type}","patternSignals":"{signals}","aiFindingSummary":"{summary}","generalizableLearning":"{gen}","remainingIssue":"{issue}","needsD":"{needsd}","notes":"{notes}"}
SOURCE_END
```