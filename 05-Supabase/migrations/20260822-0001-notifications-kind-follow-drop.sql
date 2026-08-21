-- 20260822-0001-notifications-kind-follow-drop.sql
--
-- Notifications table: extend kind enum with 'follow_drop' for T0059.
--
-- Background: T0048 (Phase 1 retention, MVP-gap §77) shipped the
-- notifications table with kind ∈ {'reminder', 'match', 'response'}.
-- T0059 (Follow → push when venue/artist drops new event) introduces
-- a new notification kind — fired by the cron job in 08-Agent/cron/follow_drops.ts
-- whenever a venue the user follows has published a new event in the
-- last N hours.
--
-- Schema:
--   Drops the existing CHECK constraint and replaces it with one that
--   also accepts 'follow_drop'. Idempotent — DROP IF EXISTS the old
--   constraint, ADD with the new list.
--
-- Forward compat: 'artist_drop' is reserved for Phase 2 (artist-follow
-- push) — adding it to the enum now means we don't need a second
-- migration when the event_artists join table is wired up.
--
-- Backward compat: existing 'reminder' / 'match' / 'response' rows are
-- unaffected. The widened enum is purely additive.

BEGIN;

-- Drop the old constraint (created in 20260821-0003).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

-- Add the widened constraint. Postgres doesn't support inline IF NOT EXISTS
-- for CHECK constraints, so we drop-then-add.
ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'match', 'response', 'follow_drop', 'artist_drop'));

-- Update the table comment to reflect the new kinds.
COMMENT ON COLUMN notifications.kind IS
  'reminder | match | response | follow_drop | artist_drop. Drives UI grouping in NotificationsScreen. follow_drop fires when a venue the user follows publishes a new event; artist_drop is reserved for Phase 2.';

COMMIT;
