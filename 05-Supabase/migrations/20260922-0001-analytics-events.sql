-- 20260922-0001-analytics-events.sql
-- analytics_events — EN databas for user activity (Fas B, user decision 2026-09-21).
--
-- The 10-Analytics service (port 7778) writes its anonymous activity stream
-- here as the PRIMARY store; its JSONL file stays only as a fallback when
-- Supabase is unreachable. user_interactions remains the home for event-linked
-- interactions (save/reject/dwell/...) which carry an auth uid —
-- analytics_events is for the pseudonymous stream (session_start,
-- search_query, tile_tap, ...) where a device hash is the only identifier.
--
-- Columns mirror 10-Analytics/analytics.ts StoredEvent 1:1:
--   event_type     — EVENT_TYPES member (analytics.ts)
--   page           — free label, ≤64 chars
--   payload        — per-type JSON blob, no PII
--   device_id_hash — 64-hex pseudonymous device hash (rotated salt)
--   session_id     — per-launch id
--   ts / received_at — event time and server receive time (ISO-8601 UTC)
--
-- RLS: service_role only — both the writer (10-Analytics) and the reader
-- (09-ScrapingSupervisor dashboard) use the service-role key. anon and
-- authenticated get explicit deny-all policies (cached_recommendations
-- pattern).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + DROP POLICY IF EXISTS.
-- Run manually via psql (repo convention — no migration runner):
--   psql "$SUPABASE_DB_URL" -f 20260922-0001-analytics-events.sql

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type     TEXT        NOT NULL,
  page           TEXT        NOT NULL DEFAULT 'unknown',
  payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  device_id_hash TEXT        NOT NULL,
  session_id     TEXT        NOT NULL,
  ts             TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL
);

-- GDPR export/erase per device + the panel's per-profile windows.
CREATE INDEX IF NOT EXISTS idx_analytics_events_device_ts
  ON analytics_events (device_id_hash, ts);

-- Retention purges (purgeOlderThan deletes ts < cutoff).
CREATE INDEX IF NOT EXISTS idx_analytics_events_ts
  ON analytics_events (ts);

-- RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated access; only service_role reads/writes via
-- 10-Analytics + the supervisor dashboard. Explicit no-access policies
-- keep the audit clean and match the other pseudonymous-data tables.
DROP POLICY IF EXISTS analytics_events_no_anon ON analytics_events;
CREATE POLICY analytics_events_no_anon ON analytics_events
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS analytics_events_no_authenticated ON analytics_events;
CREATE POLICY analytics_events_no_authenticated ON analytics_events
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE analytics_events IS
  'Anonymous user-activity stream from 10-Analytics (Fas B primary store; JSONL is the fallback). Written by 10-Analytics via service_role, read by the 09-ScrapingSupervisor dashboard. Pseudonymous — device_id_hash only, no PII.';

COMMIT;