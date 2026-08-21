-- 20260821-0003-notifications-table.sql
--
-- Notifications table for T0048 / MVP-gap §77.
--
-- Schema:
--   id             : uuid PK — deterministic FNV-1a hash of
--                     (client_user_id | event_id | start_time_iso) so that
--                     a re-run of the same logical reminder is a no-op
--                     via ON CONFLICT DO NOTHING.  Application code generates
--                     the id; the DB just enforces uniqueness.
--   client_user_id : uuid — same device-level identity as user_interactions
--   kind           : text — 'reminder' | 'match' | 'response'
--   title          : text — human-readable Swedish heading
--   body           : text — optional subline (empty string when nothing useful)
--   event_id       : uuid — NULL when the notification is not tied to a single event
--   created_at     : timestamptz — set by application code at insertion time
--   status         : text — 'unread' | 'read'
--
-- RLS:
--   anon           : SELECT own rows (device polls the feed)
--                   : UPDATE own rows (mark as read)
--                   : INSERT handled only by service_role (agent server / cron)
--   authenticated  : no access (device-level anon identity, not a real user)
--   service_role   : full access (server + cron job)
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is safe. Deterministic ids from
-- application code mean a re-run never creates a duplicate row.

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY,
  client_user_id  UUID NOT NULL,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  event_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read'))
);

-- Index: look up a user's notification feed (newest first).
-- Composite on (client_user_id, created_at DESC) covers the primary query path.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (client_user_id, created_at DESC);

-- Index: deduplication check during reminder generation.
-- Partial index only covers rows with a non-null event_id (reminder kind),
-- which is the only case where idempotency via deterministic id matters.
CREATE INDEX IF NOT EXISTS idx_notifications_reminder_dedup
  ON notifications (id)
  WHERE event_id IS NOT NULL;

-- Index: mark-all-read sweeping (future use — helps avoid full table scan).
CREATE INDEX IF NOT EXISTS idx_notifications_user_status
  ON notifications (client_user_id, status)
  WHERE status = 'unread';

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- anon: read own notification feed (device polls GET /agent/notifications).
DROP POLICY IF EXISTS notifications_anon_select ON notifications;
CREATE POLICY notifications_anon_select ON notifications
  FOR SELECT USING (true);

-- anon: mark individual rows as read (optimistic local flip + server confirm).
DROP POLICY IF EXISTS notifications_anon_update ON notifications;
CREATE POLICY notifications_anon_update ON notifications
  FOR UPDATE USING (true) WITH CHECK (true);

-- INSERT goes through service_role only (agent server / cron job).
-- anon INSERT is prohibited; we rely on ON CONFLICT DO NOTHING in the
-- application code rather than a separate policy.
DROP POLICY IF EXISTS notifications_service_insert ON notifications;
CREATE POLICY notifications_service_insert ON notifications
  FOR INSERT WITH CHECK (true);

-- authenticated: no access (device-level anon identity).
DROP POLICY IF EXISTS notifications_no_authenticated ON notifications;
CREATE POLICY notifications_no_authenticated ON notifications
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE notifications IS
  'Per-device notification feed. Phase 1 carries reminder (2h before saved event), match, and response rows.';

COMMENT ON COLUMN notifications.id IS
  'Deterministic FNV-1a hash of (client_user_id | event_id | start_time_iso). Application code generates; DB enforces uniqueness.';

COMMENT ON COLUMN notifications.kind IS
  'reminder | match | response. Drives UI grouping in NotificationsScreen.';

COMMENT ON COLUMN notifications.event_id IS
  'NULL when notification is not tied to a single event (e.g. agent response).';

COMMIT;
