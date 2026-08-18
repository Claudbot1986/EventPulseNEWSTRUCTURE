-- Agent Event Graph migration for 08-Agent Phase 0.
-- This migration adds the interaction + organizer + provenance layer
-- needed by the private agent API. It does not mutate canonical
-- events/venues/categories created earlier.
--
-- Lockdown principles:
--   * anon: only the public-safe view (events_public) — no direct table access.
--   * authenticated: only user-owned rows (user_profiles, user_interactions, agent_*).
--   * service_role: full access (used by 08-Agent server).
--
-- All counts/fields here MUST come from real ingestion output — no synthetic
-- evidence rows in event_provenance.

BEGIN;

-- ─── events: agent-facing columns ────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS canonical_event_id TEXT,
  ADD COLUMN IF NOT EXISTS organizer_id      UUID,
  ADD COLUMN IF NOT EXISTS confidence_score  SMALLINT
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS freshness_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_expanded   TEXT
    CHECK (status_expanded IS NULL OR status_expanded IN (
      'scheduled', 'cancelled', 'postponed', 'rescheduled', 'sold_out'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_canonical_event_id
  ON events(canonical_event_id)
  WHERE canonical_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_organizer
  ON events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_status_start_time
  ON events(status, status_expanded, start_time);
CREATE INDEX IF NOT EXISTS idx_events_freshness
  ON events(freshness_at DESC NULLS LAST);

-- ─── organizers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  homepage_url TEXT,
  source       TEXT,
  source_id    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organizers FROM anon, authenticated;
GRANT ALL ON organizers TO service_role;

-- ─── artists ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_artists (
  event_id  UUID NOT NULL REFERENCES events(id)  ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('headliner', 'support', 'opener', 'performer')),
  position  SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY (event_id, artist_id, role)
);

CREATE INDEX IF NOT EXISTS idx_event_artists_artist
  ON event_artists(artist_id);

ALTER TABLE artists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_artists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artists      FROM anon, authenticated;
REVOKE ALL ON event_artists FROM anon, authenticated;
GRANT ALL ON artists       TO service_role;
GRANT ALL ON event_artists TO service_role;

-- ─── event_offers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offer_url   TEXT NOT NULL,
  price_min   NUMERIC(10,2) CHECK (price_min IS NULL OR price_min >= 0),
  price_max   NUMERIC(10,2) CHECK (price_max IS NULL OR price_max >= 0),
  currency    TEXT NOT NULL DEFAULT 'SEK',
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  vendor      TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (event_id, offer_url)
);

CREATE INDEX IF NOT EXISTS idx_event_offers_event
  ON event_offers(event_id);
CREATE INDEX IF NOT EXISTS idx_event_offers_primary
  ON event_offers(event_id) WHERE is_primary;

ALTER TABLE event_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_offers FROM anon, authenticated;
GRANT ALL ON event_offers TO service_role;

-- ─── event_provenance ────────────────────────────────────────────────────────
-- One row per (event_id, source). Real only — never synthetic.
CREATE TABLE IF NOT EXISTS event_provenance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_url      TEXT,
  raw_payload_ref TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      SMALLINT NOT NULL DEFAULT 100
    CHECK (confidence BETWEEN 0 AND 100),
  UNIQUE (event_id, source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_provenance_event
  ON event_provenance(event_id);
CREATE INDEX IF NOT EXISTS idx_event_provenance_source
  ON event_provenance(source, source_event_id);

ALTER TABLE event_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_provenance FROM anon, authenticated;
GRANT ALL ON event_provenance TO service_role;

-- ─── user_profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  client_user_id   UUID PRIMARY KEY,
  anon_token_hash  TEXT NOT NULL,
  city_default     TEXT NOT NULL DEFAULT 'Stockholm',
  language         TEXT NOT NULL DEFAULT 'sv'
    CHECK (language IN ('sv', 'en')),
  budget_sek_max   INTEGER CHECK (budget_sek_max IS NULL OR budget_sek_max >= 0),
  party_size       SMALLINT NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 20),
  categories_pref  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_anon_token_hash
  ON user_profiles(anon_token_hash);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users may read/write only their own row (matched by client_user_id claim).
CREATE POLICY user_profiles_self_select ON user_profiles
  FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());
CREATE POLICY user_profiles_self_upsert ON user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());
CREATE POLICY user_profiles_self_update ON user_profiles
  FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid())
  WITH CHECK (client_user_id = auth.uid());

REVOKE ALL ON user_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON user_profiles TO authenticated;
GRANT ALL ON user_profiles TO service_role;

-- ─── user_interactions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID NOT NULL,
  session_id      UUID,
  event_id        UUID REFERENCES events(id) ON DELETE SET NULL,
  interaction     TEXT NOT NULL CHECK (interaction IN (
    'impression', 'click', 'save', 'dismiss', 'feedback_positive', 'feedback_negative'
  )),
  query_text      TEXT,
  rank_position   SMALLINT CHECK (rank_position IS NULL OR rank_position BETWEEN 0 AND 50),
  reasons         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_interactions_user_time
  ON user_interactions(client_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interactions_event
  ON user_interactions(event_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_session
  ON user_interactions(session_id);

ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_interactions_self_select ON user_interactions
  FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());
CREATE POLICY user_interactions_self_insert ON user_interactions
  FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

REVOKE ALL ON user_interactions FROM anon;
GRANT SELECT, INSERT ON user_interactions TO authenticated;
GRANT ALL ON user_interactions TO service_role;

-- ─── agent_sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin          TEXT,
  user_agent      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_time
  ON agent_sessions(client_user_id, last_active_at DESC);

ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_sessions_self_select ON agent_sessions
  FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

REVOKE ALL ON agent_sessions FROM anon;
GRANT SELECT ON agent_sessions TO authenticated;
GRANT ALL ON agent_sessions TO service_role;

-- ─── agent_messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content      TEXT NOT NULL,
  tool_calls   JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_time
  ON agent_messages(session_id, created_at);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

-- Note: agents write via service_role; users can read their own session messages.
-- We rely on service_role bypass + join through agent_sessions ownership in app
-- layer; no direct anon/authenticated policy here.

REVOKE ALL ON agent_messages FROM anon, authenticated;
GRANT ALL ON agent_messages TO service_role;

-- ─── source_readiness ────────────────────────────────────────────────────────
-- Per-source readiness score used by agent ranking; consumed by 08-Agent.
CREATE TABLE IF NOT EXISTS source_readiness (
  source          TEXT PRIMARY KEY,
  confidence      SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  event_count     INTEGER NOT NULL CHECK (event_count >= 0),
  freshest_at     TIMESTAMPTZ,
  stale_ratio     NUMERIC(4,3) NOT NULL DEFAULT 0
    CHECK (stale_ratio BETWEEN 0 AND 1),
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT
);

ALTER TABLE source_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON source_readiness FROM anon, authenticated;
GRANT ALL ON source_readiness TO service_role;

-- ─── events_public view ──────────────────────────────────────────────────────
-- The ONLY object anon may read. Excludes raw_data, internal ids, organizer_id.
CREATE OR REPLACE VIEW events_public AS
SELECT
  e.id,
  e.title_en,
  e.title_sv,
  e.description_en,
  e.description_sv,
  e.start_time,
  e.end_time,
  e.source,
  e.venue_id,
  e.lat,
  e.lng,
  e.location,
  e.is_free,
  e.price_min_sek,
  e.price_max_sek,
  e.ticket_url,
  e.image_url,
  e.category_slug,
  e.confidence_score,
  e.freshness_at,
  e.status_expanded
FROM events e
WHERE e.status = 'published';

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Lockdown: anon never touches base tables ────────────────────────────────
REVOKE ALL ON events       FROM anon;
REVOKE ALL ON venues       FROM anon;
REVOKE ALL ON categories   FROM anon;
REVOKE ALL ON event_categories FROM anon;
REVOKE ALL ON ingestion_logs FROM anon;

-- service_role retains full control.
GRANT ALL ON events            TO service_role;
GRANT ALL ON venues            TO service_role;
GRANT ALL ON categories        TO service_role;
GRANT ALL ON event_categories  TO service_role;
GRANT ALL ON ingestion_logs    TO service_role;

COMMIT;
