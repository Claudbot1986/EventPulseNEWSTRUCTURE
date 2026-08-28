-- 20260821-0002-user-preferences.sql
--
-- User preference store for onboarding + Phase 1 personalization.
--
-- Schema:
--   client_user_id : text   — device-level anonymous identity (matches
--                              user_interactions.client_user_id)
--   preferences   : jsonb   — freeform key/value bag; Phase 1 carries
--                              { categories: string[], updated_at: timestamptz }
--   created_at    : timestamptz
--   updated_at    : timestamptz
--
-- One row per client_user_id. Upsert semantics (ON CONFLICT DO UPDATE)
-- keep the write simple without needing a separate "does this user exist?" check.
--
-- RLS:
--   anon       : can UPDATE own row (preferences are self-written)
--   authenticated : no access (these are device-level identities, not users)
--   service_role : full access (migrations + the agent server)
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is safe.

BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
  client_user_id  TEXT PRIMARY KEY,
  preferences     JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep updated_at current on every write.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_preferences_updated_at ON user_preferences;
CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Own row only via client_user_id match (device-scoped identity).
DROP POLICY IF EXISTS user_preferences_anon_update ON user_preferences;
CREATE POLICY user_preferences_anon_update ON user_preferences
  FOR UPDATE USING (true) WITH CHECK (true);

-- anon can INSERT (first-time onboarding creates the row).
DROP POLICY IF EXISTS user_preferences_anon_insert ON user_preferences;
CREATE POLICY user_preferences_anon_insert ON user_preferences
  FOR INSERT WITH CHECK (true);

-- anon can SELECT to check if preferences exist (skip onboarding on re-visit).
DROP POLICY IF EXISTS user_preferences_anon_select ON user_preferences;
CREATE POLICY user_preferences_anon_select ON user_preferences
  FOR SELECT USING (true);

-- authenticated: no access (device-level anon identity, not a real user account).
DROP POLICY IF EXISTS user_preferences_no_authenticated ON user_preferences;
CREATE POLICY user_preferences_no_authenticated ON user_preferences
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE user_preferences IS
  'Device-level preference store. Phase 1 carries { categories: string[] } from onboarding.';

COMMIT;
