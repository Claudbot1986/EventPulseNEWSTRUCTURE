# G-qualityGate

Confidence scoring per extracted event. Evaluates the reliability of each extracted record.

## Scoring Signals

**Positive signals** (increase confidence):
- Clear date present
- Title is specific and event-like
- Venue is identified
- Detail page is available
- Ticket URL is present

**Negative signals** (reduce confidence):
- Blog or news article pattern detected
- Missing date entirely
- Broken or malformed links
- Generic/non-event title ("Upcoming Events")
- Price-only with no event details

## Score Range

From `goals-detailed.md`: score 0.0–1.0. Events below a threshold are logged with low confidence — they are **not silently dropped**, but flagged for review.

## Current Status

**Implemented in scoring pipeline.** Confidence scoring is active. Low-confidence events are logged rather than dropped, preserving data for manual review. The exact threshold and weighting are configurable.
