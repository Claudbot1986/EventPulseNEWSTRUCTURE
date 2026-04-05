# Source: karlskoga

**Batch:** batch-001  
**Status:** triage_required  
**LastRun:** 2026-04-05T10:02:51.579Z  
**LastEventsFound:** 0  
**Attempts:** 5  
**ConsecutiveFailures:** 4  

## Triage History
- 2026-04-05T04:02:58.667Z: html_candidate | 3tt 0d 10h 0v | events=N/A
- 2026-04-05T08:03:48.129Z: html_candidate | 3tt 0d 10h 0v | events=0
- 2026-04-05T08:42:16.629Z: html_candidate | 3tt 0d 10h 0v | events=0
- 2026-04-05T10:02:51.579Z: html_candidate | 3tt 0d 10h 0v | events=0

## Pending Next Tool
html_extraction_review

## Last Error
triage_required: C1 said html_candidate but extraction returned 0 events

## Triage Result
**Recommended Path:** html  
**Triage Result:** html_candidate  
**Confidence:** 0

## C-Batch Eligibility
- `triageResult = "html_candidate"`: YES
- `status ∈ fail/triage_required`: YES
- `pendingNextTool ≠ D-renderGate`: YES
- `preferredPath ∉ A/B-verified`: YES
- `lastEventsFound = 0`: YES

**C-Batch Eligible:** YES
