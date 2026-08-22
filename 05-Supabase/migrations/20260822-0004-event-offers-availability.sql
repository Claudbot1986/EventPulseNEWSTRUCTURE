-- 20260822-0004-event-offers-availability.sql
-- T0080 — Functional event chips/badges on cards.
--
-- Adds `availability` enum column to `event_offers` so the agent API can
-- surface ticket-availability badges on event cards (Sold Out / Few tickets left /
-- Available / Unknown). The column is derived from offer metadata at ingest time;
-- this migration adds the schema only — the value is back-filled from `valid_until`
-- in a subsequent data fix, and new rows get the value on write.
--
-- Availability derivation rule (used by search_events.ts to derive badge):
--   - 'limited'  : valid_until is set AND valid_until < NOW() + INTERVAL '7 days'
--                 (scarce inventory — fewer than 7 days before expiry)
--   - 'sold_out' : valid_until is set AND valid_until < NOW()
--   - 'available': valid_until is NULL OR valid_until >= NOW() + INTERVAL '7 days'
--   - 'unknown'  : no primary offer row found (default)

BEGIN;

ALTER TABLE event_offers
  ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'unknown'
  CHECK (availability IN ('sold_out', 'limited', 'available', 'unknown'));

-- Backfill: NULL valid_until → 'available'; past valid_until → 'sold_out';
-- future valid_until < 7d → 'limited'; future valid_until >= 7d → 'available'.
UPDATE event_offers
SET availability = CASE
  WHEN valid_until IS NULL                                      THEN 'available'
  WHEN valid_until < NOW()                                     THEN 'sold_out'
  WHEN valid_until < NOW() + INTERVAL '7 days'                 THEN 'limited'
  ELSE                                                             'available'
END
WHERE availability = 'unknown';

-- Index for fast badge lookup at event level (most common query = "has any
-- primary offer with availability != 'available'").
CREATE INDEX IF NOT EXISTS idx_event_offers_availability
  ON event_offers(event_id, availability)
  WHERE availability != 'available';

ALTER TABLE event_offers
  ALTER COLUMN availability DROP DEFAULT;

COMMIT;

-- Verify
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_offers' AND column_name = 'availability'
  );
END $$;
