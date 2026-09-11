-- Source Candidates — discovery output for 07-Discovery.
--
-- Schema mismatch fix (2026-09-11): the existing
-- 20260427-0001-venue-graph.sql defined source_candidates with columns
-- (candidate_url, source_name, ...) but the actual discovery code
-- (discoverySearch.ts, rssDiscovery.ts, googleCustomSearch.ts, geoExpansion.ts)
-- writes rows with columns (url, source_query, discovered_at, engine, status).
-- The table never existed on the live DB — both the original migration's
-- CREATE IF NOT EXISTS and the discovery code's upsert() have been failing
-- silently for weeks.
--
-- This migration creates the table with the schema the discovery code expects,
-- so all discovery modules (P3A, P3B, P3C) can write successfully.
--
-- Source of truth for columns: discoverySearch.ts writeCandidates() and
-- geoExpansion.ts toWrite map. Keep these in sync if you change either.

CREATE TABLE IF NOT EXISTS source_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  source_query TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  engine TEXT NOT NULL CHECK (engine IN (
    'exa_search',
    'google_cse',
    'venue_graph_geo',
    'rss_discovery',
    'manual'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'tested',
    'promoted',
    'rejected'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_candidates_url ON source_candidates(url);
CREATE INDEX IF NOT EXISTS idx_source_candidates_engine_status ON source_candidates(engine, status);
CREATE INDEX IF NOT EXISTS idx_source_candidates_discovered_at ON source_candidates(discovered_at DESC);

ALTER TABLE source_candidates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON source_candidates FROM anon, authenticated;
GRANT ALL ON source_candidates TO service_role;