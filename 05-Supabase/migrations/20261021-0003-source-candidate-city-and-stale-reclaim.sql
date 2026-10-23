-- Source candidate city + stale-claim reclaim (2026-10-21)
--
-- BAKGRUND
--
-- P3D promote:ar kandidater till sources/<slug>.jsonl, men sourceRecord()
-- (07-Discovery/src/sourceTesting/sandbox.ts:46) skriver
-- `city: candidate.city ?? undefined`. JSON.stringify droppar undefined, så
-- den promoteade filen saknar city helt. Följden:
--
--   isInScope() (02-Ingestion/tools/sourceRegistry.ts:150) returnerar false
--   → getAllSources() filtrerar bort filen
--   → getNextABatch() (02-Ingestion/A-directAPI-networkGate/runA.ts:246)
--     hittar inga ouppackade källor
--   → A-gatet loggar "Both preA-queue and sources-main are empty".
--
-- Verifierat live 2026-10-21: 8 källor promote:ade 03:23–03:26 den 22 okt,
-- 0 av dem nådde A-gatet.
--
-- Rotorsaken är att `city` aldrig fanns som kolumn. Ingen av de tre
-- producenterna (discoverySearch.ts, geoExpansion.ts, rssDiscovery.ts) hade
-- något att skriva, och kötabellen bar inte med sig fältet.
--
-- Denna migration:
--
--   1. Lägger till city på source_candidates och source_candidate_test_queue.
--   2. Låter enqueue/claim bära med sig city, så CLI:n kan sätta
--      candidate.city istället för det hårdkodade `city: null`
--      (runSourceCandidateTests.ts:31).
--   3. Lägger till stale-reclaim i claim_source_candidate_test_queue().
--
-- STALE-RECLAIM
--
-- claim_source_candidate_test_queue() filtrerade på `status = 'pending'` med
-- `FOR UPDATE SKIP LOCKED`, men inget utgångsdatum. En död P3D-körning lämnade
-- rader i 'processing' för alltid. Verifierat 2026-10-21: 23 rader fastnade,
-- äldsta locked_at 2026-10-22T01:22, medan 290 låg kvar i 'pending'.
--
-- Kedjan ska ta 258 s för 20 kandidater, så 30 minuter är ett utrymme som
-- inte nås av en levande körning.
--
-- VIKTIGT: inga befintliga rader raderas. city är nullable — en kandidat utan
-- stad promote:as till sources/ men filtreras bort av isInScope(), vilket är
-- rätt: okänd stad ska inte hamna i Stockholms pool. Data-backfillen görs av
-- 07-Discovery/src/sourceTesting/backfillCandidateCities.ts (läser de riktiga
-- sources/*.jsonl och centroid-gränserna, inte en gissad SQL-approximation).

-- ─── 1. city-kolumnerna ─────────────────────────────────────────────────────

ALTER TABLE source_candidates
  ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE source_candidate_test_queue
  ADD COLUMN IF NOT EXISTS city TEXT;

COMMENT ON COLUMN source_candidates.city IS
  'Staden kandidaten hittades i. NULL = okänd scope → filtreras bort av isInScope().';
COMMENT ON COLUMN source_candidate_test_queue.city IS
  'Kopia av source_candidates.city, fylld av enqueue_source_candidate_tests().';

-- Köordningen bryter numera på prioritet OCH stad: Göteborg/Malmö-kandidater
-- från P3A ska inte slås ut en Stockholm-kandidat med samma score.
CREATE INDEX IF NOT EXISTS idx_source_candidates_city_status_priority
  ON source_candidates(city, status, priority_score DESC);

-- ─── 2. Stale-reclaim i claim_source_candidate_test_queue ───────────────────
--
-- Endast raden som satt status='processing' utan locked_at (aldrig claimad via
-- RPC:n, t.ex. från en insert) eller med gammal låsning tas igen.

CREATE OR REPLACE FUNCTION claim_source_candidate_test_queue(task_limit INTEGER DEFAULT 1, target_phase TEXT DEFAULT NULL)
RETURNS SETOF source_candidate_test_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT id
    FROM source_candidate_test_queue
    WHERE (status = 'pending'
           OR (status = 'processing'
               AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes')))
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

-- ─── 3. enqueue bär med city ────────────────────────────────────────────────

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
    priority_score,
    city
  )
  SELECT
    sc.id,
    sc.url,
    sc.candidate_name,
    sc.origin_path,
    target_phase,
    sc.priority_score,
    sc.city
  FROM source_candidates sc
  WHERE sc.status = 'pending'
    AND sc.priority_score BETWEEN 0 AND 100
  ON CONFLICT (source_candidate_id, phase) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- Rader som redan ligger i kön behöver fylla i city och priority när
-- kandidaten ändrats sedan dess. ON CONFLICT DO NOTHING ovan rör dem inte.
-- Egen funktion så att backfillCandidateCities.ts kan köra om synken utan
-- att köra hela filen.
CREATE OR REPLACE FUNCTION sync_source_candidate_queue_city()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH synced AS (
    UPDATE source_candidate_test_queue q
    SET city = sc.city,
        priority_score = sc.priority_score,
        updated_at = now()
    FROM source_candidates sc
    WHERE sc.id = q.source_candidate_id
      AND (q.city IS DISTINCT FROM sc.city OR q.priority_score IS DISTINCT FROM sc.priority_score)
    RETURNING 1
  )
  SELECT count(*)::int FROM synced;
$$;

-- ─── 4. släpp fastnade processing-rader ────────────────────────────────────
--
-- Idempotent: samma villkor som reclaimen i claim-funktionen, så en framtida
-- körning av det här skriptet rör bara rader som verkligen är stuck.

UPDATE source_candidate_test_queue
SET status = 'pending', locked_at = NULL, updated_at = now(),
    last_error = COALESCE(last_error, '') || ' [released: stale claim, 2026-10-21]'
WHERE status = 'processing'
  AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes');

-- ─── 5. Behörigheter ────────────────────────────────────────────────────────
-- Signaturerna är oförändrade, men GRANT är idempotent och billigare att
-- köra igen än att lita på att 0001:s GRANT matchade.

REVOKE ALL ON FUNCTION enqueue_source_candidate_tests(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION sync_source_candidate_queue_city() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_source_candidate_tests(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sync_source_candidate_queue_city() TO service_role;