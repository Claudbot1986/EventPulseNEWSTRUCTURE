-- Source Candidate Test Queue — gör 07-Discovery/src/sourceTesting/ körbar på live-DB.
--
-- BAKGRUND (2026-10-21)
--
-- Migration 20260427-0002 skapade source_candidate_test_queue/runs/decisions plus
-- RPC:erna enqueue_source_candidate_tests() och claim_source_candidate_test_queue().
-- Ingen av dem existerar på den live-databasen — verifierat via PostgREST:
--
--   GET  /rest/v1/source_candidate_test_queue  → HTTP 404 (relation does not exist)
--   POST /rest/v1/rpc/enqueue_source_candidate_tests
--        → HTTP 404 PGRST202 "Searched for the function ... but no matches were found"
--   POST /rest/v1/rpc/claim_source_candidate_test_queue → HTTP 404, samma fel
--
-- Dvs. hela 07-Discovery/src/sourceTesting/ (runner.ts, sandbox.ts,
-- supabaseRepository.ts, runSourceCandidateTests.ts) är död kod i produktion:
-- runnern har aldrig kunnat claim:a en enda kandidat.
--
-- Det finns dessutom en kolumnkonflikt. 20260427-0001 skapade source_candidates med
-- (candidate_url, source_name, origin_path, priority_score, status CHECK IN
-- ('candidate','verified','rejected','manual_review')), men 20260911-0002 skapade
-- den på nytt med discovery-kodens faktiska schema (url, source_query, engine,
-- status CHECK IN ('pending','tested','promoted','rejected')). Den senare är den
-- som lever:
--
--   335 rader, samtliga status='pending'
--     exa_search       228
--     venue_graph_geo   68
--     rss_discovery     39
--
-- 0002 definierar därför en kö vars FK pekar på kolumner som inte finns, och
-- vars status-filter ('candidate','manual_review') utesluter varje rad som
-- faktiskt existerar. Även om tabellen vore skapad skulle RPC:n returnera noll rader.
--
-- DENNA MIGRATION
--
-- 1. Lägger till de tre saknade kolumnerna på den levande source_candidates:
--    priority_score (nullable — discovery-koden sätter den inte), origin_path,
--    och CHECK-villkoret 'tested'/'manual_review' på status.
-- 2. Skapar de tre kötabellerna om 0002 inte lyckats.
-- 3. Skapar RPC:erna med korrekt status-filter: 'pending' — den status alla tre
--    producenterna (discoverySearch.ts, geoExpansion.ts, rssDiscovery.ts) lämnar
--    sina rader i.
-- 4. Backfyllar priority_score så köordningen är meningsfull.
--
-- VIKTIGT: inga befintliga rader raderas eller ändras. alla kolumner är additive
-- med DEFAULT, och status-villkoret är en superset av det gamla.

-- ─── 1. Additiva kolumner på den levande source_candidates ───────────────────

-- 0002-kön sorterar på priority_score. Discovery-koden (upsert i
-- discoverySearch.ts:197, geoExpansion.ts:277, rssDiscovery.ts:471) sätter inte
-- något score, så utan default skulle varje rad få NULL och sorteringen blir
-- godtycklig. 50 är mitten av 0001-skalan (0–100).
ALTER TABLE source_candidates
  ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 50;

ALTER TABLE source_candidates
  ADD COLUMN IF NOT EXISTS origin_path TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE source_candidates
  ADD COLUMN IF NOT EXISTS candidate_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_candidates_status_check'
  ) THEN
    ALTER TABLE source_candidates
      ADD CONSTRAINT source_candidates_status_check
      CHECK (status IN ('pending', 'tested', 'verified', 'promoted', 'rejected', 'manual_review'));
  END IF;
END $$;

UPDATE source_candidates SET priority_score = 50 WHERE priority_score IS NULL;

-- 0002-kön kräver NOT NULL — backfill först, sätt sedan villkoret.
ALTER TABLE source_candidates
  ALTER COLUMN priority_score SET DEFAULT 50,
  ALTER COLUMN priority_score SET NOT NULL;

-- 0002's ON CONFLICT (source_candidate_id, phase) behöver inget index på
-- source_candidates utöver PK, men ett på status+prioritet gör en framtida
-- backfill av en befintlig status rimlig.
CREATE INDEX IF NOT EXISTS idx_source_candidates_status_priority
  ON source_candidates(status, priority_score DESC);

-- ─── 2. Kötabellerna (idempotent — 0002 kanske redan kört) ───────────────────

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

ALTER TABLE source_candidate_test_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_candidate_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_candidate_test_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON source_candidate_test_queue FROM anon, authenticated;
REVOKE ALL ON source_candidate_test_runs FROM anon, authenticated;
REVOKE ALL ON source_candidate_test_decisions FROM anon, authenticated;
GRANT ALL ON source_candidate_test_queue TO service_role;
GRANT ALL ON source_candidate_test_runs TO service_role;
GRANT ALL ON source_candidate_test_decisions TO service_role;

-- ─── 3. RPC:erna, med filter på den status som faktiskt förekommer ───────────
--
-- 0002:s WHERE sc.status IN ('candidate', 'manual_review') kan aldrig matcha en
-- rad: båda värdena ligger utanför den levande CHECK-villkoret. Alla 335
-- discovery-rader har status='pending'. Här filtreras på 'pending' i stället.

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
    sc.url,
    sc.candidate_name,
    sc.origin_path,
    target_phase,
    sc.priority_score
  FROM source_candidates sc
  WHERE sc.status = 'pending'
    AND sc.priority_score BETWEEN 0 AND 100
  ON CONFLICT (source_candidate_id, phase) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_source_candidate_tests(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_source_candidate_tests(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) TO service_role;