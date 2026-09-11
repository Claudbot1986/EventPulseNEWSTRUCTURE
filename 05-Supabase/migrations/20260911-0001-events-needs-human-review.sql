-- Active-learning closed-loop flag (P2C).
-- Set by 08-Agent/tools/activeLearning.ts when confidence_score drops below
-- threshold. Read by 09-ScrapingSupervisor/dashboard to surface low-confidence
-- events for human review.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS needs_human_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_needs_human_review
  ON events(needs_human_review)
  WHERE needs_human_review = TRUE;