# H-manualReview

Manual review queue for sources that cannot be resolved automatically.

## When Events Enter Manual Review

From `source-testing.md`:
- `next_path=manual-review` set by the pipeline
- Fetch failures that cannot be retried
- Recheck requests triggered manually
- Sources with `diagnosis=manual-review`

## What Manual Review Covers

- Verifying events on sources with anti-scraping protections
- Resolving ambiguous cases where automated scoring is uncertain
- Investigating sources that fail repeatedly
- Handling newly added sources before they enter the automated pipeline

## Current Status

**Not separately implemented.** The concept is documented and the routing condition exists in `source-testing.md`, but there is no dedicated `H-manualReview.ts` or queue system. Currently events that need manual attention are flagged in logs but handled ad hoc.
