-- 20260820-0001-outbound-attribution.sql
--
-- Per-organizer outbound click attribution (Workstream F, masterplan §18.3).
--
-- Why this exists:
--   The agent's monetization thesis depends on being able to tell each
--   organizer "we sent you N qualified visitors this month". This table
--   is the foundation for that measurement. One row per outbound ticket
--   click from the agent UI; aggregation is done in 08-Agent/tools/attribution.ts.
--
-- Privacy decision (deliberate, do NOT change without re-reviewing §5 of
-- the masterplan):
--   The agent identifies a user by an opaque device-scoped UUID stored in
--   AsyncStorage. There is no real auth in Phase 0–1. We deliberately do
--   NOT store IP addresses, lat/lng, precise location, user_agent strings,
--   or any device fingerprint. Only:
--     - client_user_id (random UUID)
--     - session_id    (random UUID, optional)
--     - event_id      (FK to events)
--     - organizer_id  (FK to organizers, nullable — backfill is in progress)
--     - source        (denormalized from events.source so aggregation works
--                      before organizer_id is populated; current coverage
--                      ~100% vs ~0% for organizer_id)
--     - ticket_url    (the URL the user was sent to)
--     - clicked_at    (timestamptz, UTC)
--     - metadata      (small JSONB blob, ≤2KB enforced at the TS layer)
--
-- Lockdown:
--   * RLS ON, service_role only. Matches 20260818-0001-agent-event-graph.sql
--     lockdown for `organizers`, `event_offers`, `event_provenance`.
--   * anon and authenticated get NO grants — even though client_user_id is
--     the user's own UUID, exposing the raw row would leak which organizers
--     the agent has shown to which users (a competitive signal).
--   * Reads happen through the agent server (service_role).
--
-- Idempotency:
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS — same style as
--   the other migrations in this folder. Safe to re-run.
--
-- Additive only:
--   This migration does NOT alter the `events` table or `events_public`
--   view. organizer_id FK uses ON DELETE SET NULL so removing an organizer
--   (should that ever happen) preserves the click history with organizer_id
--   cleared; event_id uses ON DELETE CASCADE because the click is meaningless
--   without the event row.

BEGIN;

CREATE TABLE IF NOT EXISTS outbound_clicks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID        NOT NULL,
  session_id      UUID,
  event_id        UUID        NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
  organizer_id    UUID                 REFERENCES organizers(id) ON DELETE SET NULL,
  source          TEXT,
  ticket_url      TEXT        NOT NULL,
  clicked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Index for per-organizer totals over a date range (the primary query).
-- Composite (organizer_id, clicked_at DESC) supports the "top organizers
-- this month" aggregation without a sort step.
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_organizer_time
  ON outbound_clicks(organizer_id, clicked_at DESC NULLS LAST);

-- Index for the source-based fallback bucket (today's reality: most rows
-- have NULL organizer_id but a populated source).
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_source_time
  ON outbound_clicks(source, clicked_at DESC NULLS LAST)
  WHERE organizer_id IS NULL;

-- Index for per-event totals (debugging only — not product).
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_event_time
  ON outbound_clicks(event_id, clicked_at DESC NULLS LAST);

-- Lockdown: anon and authenticated get nothing. service_role owns the table.
ALTER TABLE outbound_clicks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON outbound_clicks FROM anon, authenticated;
GRANT ALL  ON outbound_clicks TO service_role;

COMMIT;
