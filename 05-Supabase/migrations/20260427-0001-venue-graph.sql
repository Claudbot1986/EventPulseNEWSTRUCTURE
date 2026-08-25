-- Venue Graph schema for 07-Discovery.
-- This migration augments canonical events/venues; it does not replace or mutate them.

CREATE TABLE IF NOT EXISTS venue_graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type TEXT NOT NULL CHECK (node_type IN ('venue', 'event', 'source', 'promoter', 'attraction')),
  canonical_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  city TEXT,
  source_table TEXT,
  source_id TEXT,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('observed', 'candidate', 'verified', 'rejected', 'manual_review')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_type TEXT NOT NULL CHECK (
    edge_type IN (
      'event_hosted_at_venue',
      'event_from_source',
      'event_promoted_by',
      'event_features_attraction',
      'source_mentions_venue',
      'venue_linked_to_promoter',
      'candidate_source_for_venue'
    )
  ),
  canonical_key TEXT NOT NULL UNIQUE,
  from_node_key TEXT NOT NULL REFERENCES venue_graph_nodes(canonical_key) ON DELETE CASCADE,
  to_node_key TEXT NOT NULL REFERENCES venue_graph_nodes(canonical_key) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('event', 'raw_payload', 'graph', 'manual_review')),
  evidence_id TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_graph_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_key TEXT NOT NULL UNIQUE,
  observation_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('event', 'raw_payload', 'graph', 'manual_review')),
  evidence_id TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL CHECK (status IN ('observed', 'rejected')),
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  city TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'verified', 'rejected', 'manual_review')),
  origin_event_id TEXT NOT NULL,
  origin_path TEXT[] NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  risk_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_url TEXT NOT NULL,
  source_name TEXT,
  origin_candidate_id UUID REFERENCES venue_candidates(id) ON DELETE SET NULL,
  origin_path TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'verified', 'rejected', 'manual_review')),
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_graph_expansion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL CHECK (task_type IN ('verify_venue', 'find_source_for_venue', 'test_source_candidate', 'manual_review')),
  candidate_id UUID REFERENCES venue_candidates(id) ON DELETE CASCADE,
  candidate_canonical_key TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'expanded', 'failed', 'manual_review')) DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  expanded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_graph_expansion_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES venue_graph_expansion_queue(id) ON DELETE SET NULL,
  measured BOOLEAN NOT NULL DEFAULT true,
  result_summary TEXT NOT NULL,
  new_nodes_count INTEGER NOT NULL DEFAULT 0 CHECK (new_nodes_count >= 0),
  new_edges_count INTEGER NOT NULL DEFAULT 0 CHECK (new_edges_count >= 0),
  new_venue_candidates_count INTEGER NOT NULL DEFAULT 0 CHECK (new_venue_candidates_count >= 0),
  new_source_candidates_count INTEGER NOT NULL DEFAULT 0 CHECK (new_source_candidates_count >= 0),
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_graph_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'apply')),
  target_city TEXT NOT NULL,
  input_events INTEGER NOT NULL CHECK (input_events >= 0),
  input_venues INTEGER NOT NULL CHECK (input_venues >= 0),
  nodes INTEGER NOT NULL CHECK (nodes >= 0),
  edges INTEGER NOT NULL CHECK (edges >= 0),
  observations INTEGER NOT NULL CHECK (observations >= 0),
  venue_candidates INTEGER NOT NULL CHECK (venue_candidates >= 0),
  rejected_observations INTEGER NOT NULL CHECK (rejected_observations >= 0),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('dry_run_only', 'local_verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_graph_nodes_type_status ON venue_graph_nodes(node_type, status);
CREATE INDEX IF NOT EXISTS idx_venue_graph_edges_from ON venue_graph_edges(from_node_key);
CREATE INDEX IF NOT EXISTS idx_venue_graph_edges_to ON venue_graph_edges(to_node_key);
CREATE INDEX IF NOT EXISTS idx_venue_graph_observations_evidence ON venue_graph_observations(evidence_type, evidence_id);
CREATE INDEX IF NOT EXISTS idx_venue_candidates_status_priority ON venue_candidates(status, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_source_candidates_origin_candidate ON source_candidates(origin_candidate_id);
CREATE INDEX IF NOT EXISTS idx_source_candidates_status_priority ON source_candidates(status, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_venue_graph_expansion_queue_candidate ON venue_graph_expansion_queue(candidate_id);
CREATE INDEX IF NOT EXISTS idx_venue_graph_expansion_queue_status_priority ON venue_graph_expansion_queue(status, priority_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_graph_expansion_queue_task_candidate
  ON venue_graph_expansion_queue(task_type, candidate_canonical_key);
CREATE INDEX IF NOT EXISTS idx_venue_graph_expansion_results_task ON venue_graph_expansion_results(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_graph_expansion_results_task_unique
  ON venue_graph_expansion_results(task_id)
  WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_venue_graph_expansion_tasks(task_limit INTEGER DEFAULT 5)
RETURNS SETOF venue_graph_expansion_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT id
    FROM venue_graph_expansion_queue
    WHERE status = 'pending'
    ORDER BY priority_score DESC, created_at ASC
    LIMIT GREATEST(task_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE venue_graph_expansion_queue q
  SET
    status = 'processing',
    attempt_count = q.attempt_count + 1,
    locked_at = now(),
    updated_at = now()
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING q.*;
$$;

ALTER TABLE venue_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_graph_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_graph_expansion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_graph_expansion_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_graph_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON venue_graph_nodes FROM anon, authenticated;
REVOKE ALL ON venue_graph_edges FROM anon, authenticated;
REVOKE ALL ON venue_graph_observations FROM anon, authenticated;
REVOKE ALL ON venue_candidates FROM anon, authenticated;
REVOKE ALL ON source_candidates FROM anon, authenticated;
REVOKE ALL ON venue_graph_expansion_queue FROM anon, authenticated;
REVOKE ALL ON venue_graph_expansion_results FROM anon, authenticated;
REVOKE ALL ON venue_graph_runs FROM anon, authenticated;
REVOKE ALL ON FUNCTION claim_venue_graph_expansion_tasks(INTEGER) FROM anon, authenticated;

GRANT ALL ON venue_graph_nodes TO service_role;
GRANT ALL ON venue_graph_edges TO service_role;
GRANT ALL ON venue_graph_observations TO service_role;
GRANT ALL ON venue_candidates TO service_role;
GRANT ALL ON source_candidates TO service_role;
GRANT ALL ON venue_graph_expansion_queue TO service_role;
GRANT ALL ON venue_graph_expansion_results TO service_role;
GRANT ALL ON venue_graph_runs TO service_role;
GRANT EXECUTE ON FUNCTION claim_venue_graph_expansion_tasks(INTEGER) TO service_role;
