-- 20260822-0002-cached-recommendations.sql
--
-- Cached recommendations table for T0060 / MVP-gap §77 (Phase 1 retention).
--
-- Background:
--   Active users (3+ distinct sessions in 30d) tend to forget to open the
--   app between sessions. The fix is to pre-render the 3 most likely
--   intents ("Vad ska jag göra ikväll?", "Något i helgen?", "Upprepa senast")
--   and surface them in HomeScreen so the user has zero-friction entry points.
--
--   This table stores the pre-rendered output for each eligible user. The
--   cron at 08-Agent/cron/pre_render_recommendations.ts runs twice a day
--   (06:00 and 17:00 Stockholm time) and refreshes the row.
--
-- Schema:
--   client_user_id  : uuid PK — same anon UUID the agent server already uses
--   slot_1_title    : text     — slot 1 prompt text ("Vad ska jag göra ikväll?")
--   slot_1_card_1   : jsonb    — top event card OR null (shape below)
--   slot_1_card_2   : jsonb    — second event card OR null
--   slot_2_* / slot_3_* : same shape for slots 2 and 3
--   generated_at    : timestamptz — when the cron last refreshed this row
--
-- Card payload (jsonb) shape:
--   {
--     event_id:    string,
--     title:       string,
--     start_time:  string,
--     venue_name:  string,
--     image_url:   string | null,
--     rank_reason: string  -- primary RankReason, e.g. 'time_fit'
--   }
-- All values come from real events_public rows; the JSON is opaque to SQL
-- and is interpreted by the read-side endpoint at request time.
--
-- RLS:
--   service_role only — the agent server reads these via service_role
--   client. anon cannot read the table directly; the read goes through
--   GET /agent/cached-recommendations which gates on client_user_id.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT (client_user_id)
-- DO UPDATE. The cron re-runs are safe.

BEGIN;

CREATE TABLE IF NOT EXISTS cached_recommendations (
  client_user_id UUID PRIMARY KEY,
  slot_1_title   TEXT NOT NULL DEFAULT '',
  slot_1_card_1  JSONB,
  slot_1_card_2  JSONB,
  slot_2_title   TEXT NOT NULL DEFAULT '',
  slot_2_card_1  JSONB,
  slot_2_card_2  JSONB,
  slot_3_title   TEXT NOT NULL DEFAULT '',
  slot_3_card_1  JSONB,
  slot_3_card_2  JSONB,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Look up by recency (admin / metrics dashboards in Phase 2).
CREATE INDEX IF NOT EXISTS idx_cached_recommendations_generated_at
  ON cached_recommendations (generated_at DESC);

-- RLS
ALTER TABLE cached_recommendations ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated access; only service_role reads/writes via
-- the agent server + cron. Explicit no-access policies keep audit
-- clean and match the rest of the personal-data tables.
DROP POLICY IF EXISTS cached_recommendations_no_anon ON cached_recommendations;
CREATE POLICY cached_recommendations_no_anon ON cached_recommendations
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS cached_recommendations_no_authenticated ON cached_recommendations;
CREATE POLICY cached_recommendations_no_authenticated ON cached_recommendations
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE cached_recommendations IS
  'Pre-rendered HomeScreen recommendations per active user (T0060). Refreshed by 08-Agent/cron/pre_render_recommendations.ts twice a day; read by GET /agent/cached-recommendations.';

COMMENT ON COLUMN cached_recommendations.client_user_id IS
  'PK — same anon UUID used in user_interactions / user_preferences / notifications.';

COMMENT ON COLUMN cached_recommendations.slot_1_title IS
  'Slot 1 prompt (Swedish). Default slot text — ikväll.';

COMMENT ON COLUMN cached_recommendations.slot_1_card_1 IS
  'Top card for slot 1, jsonb payload {event_id, title, start_time, venue_name, image_url, rank_reason}. NULL when no eligible event exists.';

COMMIT;
