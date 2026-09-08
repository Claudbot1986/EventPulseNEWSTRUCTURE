-- 20260906-0001-account-deletion-cascade.sql
--
-- Fas 2.5 / Apple App Store §5.1.1(v) compliance — GDPR account-deletion.
--
-- Background:
--   Apple requires that every app offering login provide a working in-app
--   account-deletion flow. The agent's DELETE /agent/account route calls
--   `auth.admin.deleteUser(userId)`, which removes the auth.users row but
--   does NOT cascade into user-scoped data tables. Without ON DELETE
--   CASCADE foreign keys, those rows would orphan — violating GDPR
--   (right-to-erasure) and leaving PII behind after the user deletes their
--   account.
--
-- This migration adds FOREIGN KEY ... REFERENCES auth.users(id) ON DELETE
-- CASCADE on every user-scoped table whose client_user_id column is UUID.
-- `user_preferences.client_user_id` is TEXT (device-scoped, not auth-scoped)
-- and is therefore explicitly excluded — that column is purged by an
-- explicit DELETE in the route handler before the auth.users row goes away.
--
-- Idempotency: each ALTER TABLE ... ADD CONSTRAINT is guarded by
-- IF NOT EXISTS (Postgres 9.6+). Safe to re-run.
--
-- Tables touched:
--   - user_interactions      (UUID)
--   - user_profiles          (UUID)
--   - agent_sessions         (UUID)
--   - notifications          (UUID)
--   - cached_recommendations (UUID)
--   - shared_sessions        — has no created_by_user_id column today;
--                              skipped. A future migration will add the
--                              column + FK when share-ownership lands.
--   - attendance / rating rows live inside user_interactions
--                              (interaction in ('attendance', 'rating')),
--                              already covered by user_interactions_user_fk.
--                              No separate attendance_rating table.
--   - agent_messages         — references agent_sessions (already CASCADE
--                              via existing FK in 20260818-0001), no change.

BEGIN;

-- user_interactions
ALTER TABLE user_interactions
  DROP CONSTRAINT IF EXISTS user_interactions_user_fk;
ALTER TABLE user_interactions
  ADD CONSTRAINT user_interactions_user_fk
  FOREIGN KEY (client_user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- user_profiles
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_user_fk;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_user_fk
  FOREIGN KEY (client_user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- agent_sessions
ALTER TABLE agent_sessions
  DROP CONSTRAINT IF EXISTS agent_sessions_user_fk;
ALTER TABLE agent_sessions
  ADD CONSTRAINT agent_sessions_user_fk
  FOREIGN KEY (client_user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- notifications
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_user_fk;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_fk
  FOREIGN KEY (client_user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- cached_recommendations
ALTER TABLE cached_recommendations
  DROP CONSTRAINT IF EXISTS cached_recommendations_user_fk;
ALTER TABLE cached_recommendations
  ADD CONSTRAINT cached_recommendations_user_fk
  FOREIGN KEY (client_user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT user_interactions_user_fk ON user_interactions IS
  'Fas 2.5 — GDPR cascade. Deleting the auth.users row removes all user_interactions.';
COMMENT ON CONSTRAINT user_profiles_user_fk ON user_profiles IS
  'Fas 2.5 — GDPR cascade. Deleting the auth.users row removes the user_profiles row.';
COMMENT ON CONSTRAINT agent_sessions_user_fk ON agent_sessions IS
  'Fas 2.5 — GDPR cascade. agent_messages already cascades via session_id FK.';
COMMENT ON CONSTRAINT notifications_user_fk ON notifications IS
  'Fas 2.5 — GDPR cascade. Deleting the auth.users row removes notifications.';
COMMENT ON CONSTRAINT cached_recommendations_user_fk ON cached_recommendations IS
  'Fas 2.5 — GDPR cascade. Deleting the auth.users row removes cached recommendations.';

COMMIT;
