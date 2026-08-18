-- Source Candidate Testing schema for 07-Discovery.
-- Tracks sandboxed A/B/C/D tests before any source is promoted to canonical sources/.

CREATE TABLE IF NOT EXISTS source_candidate_test_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_candidate_id UUID NOT NULL REFERENCES source_candidates(id) ON DELETE CASCADE,
  candidate_url TEXT NOT NULL,
  candidate_name TEXT,
  origin_path TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  phase TEXT NOT NULL CHECK (phase IN ('sanity', 'breadth', 'smoke')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'passed', 'failed', 'manual_review')),
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_candidate_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_candidate_id UUID NOT NULL REFERENCES source_candidates(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('sanity', 'breadth', 'smoke')),
  sandbox_source_id TEXT NOT NULL,
  commands_run JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_a JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_b JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_c JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_d JSONB NOT NULL DEFAULT '{}'::jsonb,
  events_found_total INTEGER NOT NULL DEFAULT 0 CHECK (events_found_total >= 0),
  events_after_normalization INTEGER NOT NULL DEFAULT 0 CHECK (events_after_normalization >= 0),
  events_persisted INTEGER NOT NULL DEFAULT 0 CHECK (events_persisted >= 0),
  winning_path TEXT NOT NULL CHECK (winning_path IN ('jsonld', 'network', 'html', 'render', 'manual_review', 'none')),
  report_path TEXT,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  report_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_candidate_test_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_candidate_id UUID NOT NULL REFERENCES source_candidates(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('promote', 'reject', 'manual_review')),
  reason TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  evidence_run_id UUID REFERENCES source_candidate_test_runs(id) ON DELETE SET NULL,
  promoted_source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_candidate_test_queue_candidate_phase
  ON source_candidate_test_queue(source_candidate_id, phase);
CREATE INDEX IF NOT EXISTS idx_source_candidate_test_queue_status_priority
  ON source_candidate_test_queue(status, phase, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_source_candidate_test_runs_candidate
  ON source_candidate_test_runs(source_candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_candidate_test_decisions_candidate
  ON source_candidate_test_decisions(source_candidate_id, created_at DESC);

CREATE OR REPLACE FUNCTION claim_source_candidate_test_queue(task_limit INTEGER DEFAULT 1, target_phase TEXT DEFAULT NULL)
RETURNS SETOF source_candidate_test_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT id
    FROM source_candidate_test_queue
    WHERE status = 'pending'
      AND (target_phase IS NULL OR phase = target_phase)
    ORDER BY priority_score DESC, created_at ASC
    LIMIT GREATEST(task_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE source_candidate_test_queue q
  SET
    status = 'processing',
    attempt_count = q.attempt_count + 1,
    locked_at = now(),
    updated_at = now()
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING q.*;
$$;

CREATE OR REPLACE FUNCTION enqueue_source_candidate_tests(target_phase TEXT DEFAULT 'sanity')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  INSERT INTO source_candidate_test_queue (
    source_candidate_id,
    candidate_url,
    candidate_name,
    origin_path,
    phase,
    priority_score
  )
  SELECT
    sc.id,
    sc.candidate_url,
    sc.source_name,
    sc.origin_path,
    target_phase,
    sc.priority_score
  FROM source_candidates sc
  WHERE sc.status IN ('candidate', 'manual_review')
  ON CONFLICT (source_candidate_id, phase) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

ALTER TABLE source_candidate_test_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_candidate_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_candidate_test_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON source_candidate_test_queue FROM anon, authenticated;
REVOKE ALL ON source_candidate_test_runs FROM anon, authenticated;
REVOKE ALL ON source_candidate_test_decisions FROM anon, authenticated;
REVOKE ALL ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION enqueue_source_candidate_tests(TEXT) FROM anon, authenticated;

GRANT ALL ON source_candidate_test_queue TO service_role;
GRANT ALL ON source_candidate_test_runs TO service_role;
GRANT ALL ON source_candidate_test_decisions TO service_role;
GRANT EXECUTE ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_source_candidate_tests(TEXT) TO service_role;
