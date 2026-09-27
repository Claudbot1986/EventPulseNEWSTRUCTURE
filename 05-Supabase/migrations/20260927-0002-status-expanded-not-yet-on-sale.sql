-- Migration: extend status_expanded enum with 'not_yet_on_sale'.
--
-- Why: 2026-09-27 — user wants sold-out and not-yet-on-sale events visibly
-- marked in the UI. status_expanded already supports 'sold_out', 'cancelled',
-- 'postponed', 'rescheduled', 'scheduled'. We add 'not_yet_on_sale' for the
-- case when a source publishes an event whose tickets aren't on sale yet
-- (e.g. Folkoperan abonnemangspaket-sidor that aren't yet bookable).
--
-- The existing CHECK constraint must be dropped and re-added with the new
-- value, because PostgreSQL does not allow adding values to a CHECK
-- constraint in place.
--
-- Safe: idempotent (drops + re-adds). No data migration needed — existing
-- NULL values remain valid. Run against dev first, then prod.
BEGIN;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_status_expanded_check;

ALTER TABLE events
  ADD CONSTRAINT events_status_expanded_check
    CHECK (status_expanded IS NULL OR status_expanded IN (
      'scheduled', 'cancelled', 'postponed', 'rescheduled', 'sold_out',
      'not_yet_on_sale'
    ));

COMMIT;