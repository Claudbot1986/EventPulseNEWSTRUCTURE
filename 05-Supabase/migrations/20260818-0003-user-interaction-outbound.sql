-- Add 'outbound' to user_interactions.interaction CHECK constraint.
--
-- Why:
--   The agent server records click → outbound → save as the funnel stages
--   for Phase 1 success. The original migration did not include 'outbound'.
--   Without it, every outbound write fails the CHECK and increments nothing.
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
    'dismiss', 'feedback_positive', 'feedback_negative'
  ));

COMMIT;
