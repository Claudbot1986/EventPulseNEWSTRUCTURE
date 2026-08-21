-- 20260821-0001-user-interaction-reject.sql
--
-- Add 'reject' to user_interactions.interaction CHECK constraint (Phase 1).
--
-- Why:
--   Phase 1 success tracking needs a first-class `reject` interaction
--   (vs. legacy `dismiss`) so the personalization layer can bucket
--   "user dismissed this event" with an explicit reason (reject_reason).
--   The 20260818-0003 migration added 'outbound' but did not include
--   'reject'. Without this migration, every `reject` write fails the
--   CHECK and the funnel count stays at zero.
--
-- Scope:
--   - This is additive on the interaction enum. The legacy values
--     ('dismiss', 'feedback_positive', 'feedback_negative') remain
--     accepted so historical rows and the personalize.ts query (which
--     still reads 'dismiss' + 'feedback_negative') keep working.
--   - `dwell` was added to the live DB outside of a committed migration and
--     is preserved here so the constraint matches reality. Re-running the
--     migration is idempotent.
--   - `reject_reason` itself is a JSONB key inside `metadata`. No new
--     column is added — the application layer (record_feedback.ts)
--     writes it under `metadata->>reject_reason`. This avoids a schema
--     change for a nullable string field and keeps the door open for
--     future reject reasons without further migrations.
--
-- Idempotency:
--   DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT with same name is safe —
--   Postgres treats them as separate statements within a transaction.

BEGIN;

ALTER TABLE user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_interaction_check;

ALTER TABLE user_interactions
  ADD CONSTRAINT user_interactions_interaction_check
  CHECK (interaction IN (
    'impression', 'click', 'outbound', 'save',
    'reject', 'dismiss',
    'feedback_positive', 'feedback_negative',
    'dwell'
  ));

COMMIT;
