-- 20260822-0005-attendance-rating.sql
--
-- Add 'attendance' + 'rating' to user_interactions.interaction and
-- 'attendance_prompt' to notifications.kind.
--
-- Background: T0082 wires the post-event feedback loop. After a user
-- attends a saved event we want two distinct signals in user_interactions:
--
--   attendance  — the user marked the saved event as attended (binary).
--                 Driven by the attendance_prompt cron + the rating UI.
--   rating      — the user assigned a 1–5 star score + an optional short
--                 note (capped at 140 chars; no PII).
--
-- Both share the existing column set (event_id, metadata JSONB, etc.);
-- `rating` stores `rating` (1..5) and `note` (string, <=140 chars) inside
-- metadata. `attendance` stores nothing extra — its presence is the signal.
--
-- A new notifications.kind = 'attendance_prompt' carries the prompt that
-- asks the user to rate the show they attended. The cron fires 2 hours
-- after each saved event's start_time.
--
-- Idempotency:
--   DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT with the same name is safe
--   in a single transaction. CHECK constraints are not versioned in pg,
--   so widening the enum is always additive.

BEGIN;

-- ─── user_interactions.interaction ──────────────────────────────────────────
ALTER TABLE user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_interaction_check;

ALTER TABLE user_interactions
  ADD CONSTRAINT user_interactions_interaction_check
  CHECK (interaction IN (
    'impression', 'click', 'outbound', 'save',
    'dismiss', 'feedback_positive', 'feedback_negative',
    'attendance', 'rating'
  ));

COMMENT ON COLUMN user_interactions.interaction IS
  'impression | click | outbound | save | dismiss | feedback_positive | feedback_negative | attendance | rating. attendance+rating are the T0082 post-event feedback signals.';

-- ─── notifications.kind ─────────────────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'reminder', 'match', 'response', 'follow_drop', 'artist_drop',
    'attendance_prompt'
  ));

COMMENT ON COLUMN notifications.kind IS
  'reminder | match | response | follow_drop | artist_drop | attendance_prompt. attendance_prompt is fired 2h after a saved event starts (T0082).';

-- ─── Index for cron scan ────────────────────────────────────────────────────
-- The cron needs to find saved events whose start_time has been crossed
-- by ~2h. Composite on (interaction, event_id) keeps the scan small.
CREATE INDEX IF NOT EXISTS idx_user_interactions_attendance
  ON user_interactions (interaction, event_id)
  WHERE interaction = 'save';

COMMIT;
