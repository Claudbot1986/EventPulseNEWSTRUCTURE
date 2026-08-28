-- 20260822-0003-shared-sessions.sql
--
-- T0061 / MVP-gap §78 — share plan deep-link storage.
--
-- Background:
--   A user wants to share "Konsert ikväll"-svaret till en vän. Without a
--   share mechanism the app is a single-player tool. Sharing the session
--   via deep-link converts passive viewers into agent sessions for new
--   users.
--
--   `shared_sessions` stores a minimal, non-PII snapshot of what to show
--   when the deep-link is opened:
--     - the original query text
--     - the event_ids the recommendor surfaced (eventIds[])
--     - a short alphanum hash used in the URL
--     - 30d default TTL (no zombie shares forever)
--     - view_count so the recommendor can later see "3 friends opened this"
--
-- Why short_hash instead of uuid PK in the URL:
--   The URL itself needs to look human-friendly for share-previews
--   ("/s/a4f6-91k" beats "/s/550e8400-e29b-41d4-a716-446655440000").
--   6-char base32 + FNV-1a derives a deterministic hash from
--   (session_id || nonce) → ~60M values, no timing-vulnerable RNG.
--
-- Privacy:
--   shared_sessions is service-role RLS only. GET /s/{hash} is a public
--   read endpoint (anon can fetch by hash); it returns query + event_ids
--   + created_at + view_count — NO client_user_id of the recommendor
--   leaks into the response payload.
--
-- Idempotency: cron (T0071?) cleans expired rows; until then expires_at
-- + check on read path keep stale rows from surfacing in the UI.

BEGIN;

CREATE TABLE IF NOT EXISTS shared_sessions (
  -- 6-character base32 hash used in eventpulse://s/{hash} URL.
  -- Stored as text so we can switch alphabet/seed-length without ALTER TABLE.
  id            TEXT PRIMARY KEY
                  CHECK (id ~ '^[0-9a-z]{6,12}$'),

  -- Optional link to the recommendor's anon session (for analytics).
  -- NULL when created via /agent/share without a session_id (cron, scraped).
  session_id    UUID,

  -- The natural-language query that produced these recommendations.
  query         TEXT NOT NULL CHECK (length(query) > 0 AND length(query) <= 500),

  -- The events the recommendor wanted to surface. May be empty when the
  -- query yielded no events but the recommendor wants to share the
  -- question itself ("Vad ska jag göra ikväll i Stockholm?") — the
  -- recipient's app re-runs the query on open.
  event_ids     UUID[] NOT NULL DEFAULT '{}',

  -- When this hash stops resolving. Default 30d — covers a casual share
  -- weekend but ignores links older than the next quarter.
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Denormalized count for "3 friends opened this"-style UI on the
  -- recommendor's side. Cheap to increment, doesn't need a join.
  view_count    INTEGER NOT NULL DEFAULT 0
                  CHECK (view_count >= 0)
);

-- Most reads filter on (id, expires_at) for the deep-link handler.
CREATE INDEX IF NOT EXISTS idx_shared_sessions_expires_at
  ON shared_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_shared_sessions_session_id
  ON shared_sessions (session_id)
  WHERE session_id IS NOT NULL;

-- RLS: service_role only. GET /s/{hash} is the only public read path
-- and it goes through the agent server which uses the service-role key.
ALTER TABLE shared_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_sessions_no_anon ON shared_sessions;
CREATE POLICY shared_sessions_no_anon ON shared_sessions
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS shared_sessions_no_authenticated ON shared_sessions;
CREATE POLICY shared_sessions_no_authenticated ON shared_sessions
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE shared_sessions IS
  'T0061 — share plan deep-link storage (eventpulse://s/{hash}). 30d default TTL. Public read via GET /s/{hash}; anon cannot reach table directly.';

COMMENT ON COLUMN shared_sessions.id IS
  '6-12 char base32 hash derived from FNV-1a(session_id || nonce). Case-insensitive lookup is the responsibility of /s/{hash} handler.';

COMMENT ON COLUMN shared_sessions.query IS
  'Original natural-language query. Re-played on deep-link open if event_ids is empty.';

COMMENT ON COLUMN shared_sessions.event_ids IS
  'Events the recommendor wanted to surface. Empty array is valid — recipient re-runs query on open.';

COMMIT;
