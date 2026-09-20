-- 20260920-0001-user-preferences-auth-uid.sql
--
-- Realigns user_preferences with the Supabase anonymous sign-ins identity
-- model (feature enabled + smoke-verified 2026-09-20,
-- scripts/smoke-anon-signin.mjs, 6/6 PASS).
--
-- Before (20260821-0002): client_user_id TEXT PRIMARY KEY — device-level
-- identity predating auth; RLS = open USING(true) for everyone + hard-deny
-- FOR ALL USING(false) for the authenticated role. Anonymous sign-in JWTs
-- carry role=authenticated, so guests were explicitly blocked from their
-- own rows via PostgREST.
--
-- After: client_user_id UUID + FK → auth.users ON DELETE CASCADE (NOT VALID —
-- pre-auth device rows are kept as unlinked legacy), owner-only RLS for
-- `authenticated` (anonymous users included). Mirrors user_interactions
-- (20260818-0001).
--
-- Column name `client_user_id` is kept (it already stores auth.users.id on
-- the server; a rename is churn with no semantic gain).
--
-- Idempotency: DROP IF EXISTS / guarded statements throughout.
-- Rollback path: user_preferences_backup_20260920 + the policy block from
-- 20260821-0002.

BEGIN;

-- 1. Quarantine rows that cannot cast to uuid (junk/test values). Castable
--    pre-auth device UUIDs are PRESERVED as unlinked legacy rows.
DELETE FROM user_preferences
WHERE client_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 2. TEXT -> UUID.
ALTER TABLE user_preferences
  ALTER COLUMN client_user_id TYPE uuid USING client_user_id::uuid;

-- 3. FK to auth.users. NOT VALID: existing legacy device rows are NOT
--    validated (they have no auth.users counterpart); all NEW writes are
--    enforced. VALIDATE CONSTRAINT is a documented follow-up after any
--    future legacy cleanup.
ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_user_fk;
ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_user_fk
  FOREIGN KEY (client_user_id) REFERENCES auth.users(id)
  ON DELETE CASCADE
  NOT VALID;

-- 4. RLS: drop the pre-auth policy mix (open-for-all + deny-authenticated).
DROP POLICY IF EXISTS user_preferences_anon_update ON user_preferences;
DROP POLICY IF EXISTS user_preferences_anon_insert ON user_preferences;
DROP POLICY IF EXISTS user_preferences_anon_select ON user_preferences;
DROP POLICY IF EXISTS user_preferences_no_authenticated ON user_preferences;

-- Owner-only pattern (anonymous sign-in users carry role=authenticated).
DROP POLICY IF EXISTS user_preferences_self_select ON user_preferences;
CREATE POLICY user_preferences_self_select ON user_preferences
  FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_self_insert ON user_preferences;
CREATE POLICY user_preferences_self_insert ON user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_self_update ON user_preferences;
CREATE POLICY user_preferences_self_update ON user_preferences
  FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid())
  WITH CHECK (client_user_id = auth.uid());

-- Grants: mirror user_interactions (20260818-0001), plus UPDATE here because
-- preferences upsert ON CONFLICT DO UPDATE issues UPDATEs.
REVOKE ALL ON user_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE ON user_preferences TO authenticated;
GRANT ALL ON user_preferences TO service_role;

COMMENT ON TABLE user_preferences IS
  'User preference store keyed by auth.users.id (column kept as client_user_id for compatibility). Anonymous sign-in users included. Phase 1 carries { categories: string[] } from onboarding.';

COMMENT ON COLUMN user_preferences.client_user_id IS
  'auth.users.id (uuid since 20260920-0001; TEXT before). Pre-auth device UUIDs kept as unlinked legacy rows; FK is NOT VALID until a future legacy cleanup runs VALIDATE CONSTRAINT.';

COMMIT;
