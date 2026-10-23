-- Claim endast in-scope-kandidater (2026-10-23)
--
-- PROBLEM
--
-- claim_source_candidate_test_queue (0001 + 0003) claimade rader på
-- status/priority/phase men inte på city. Mätt 2026-10-23 innan den här
-- migrationen:
--
--   381 rader status='pending' i source_candidate_test_queue
--     131  city = 'Stockholm'
--     202  city IS NULL
--      48  city = någon annan stad (Göteborg, Malmö, Uppsala, …)
--
-- 250 av 381 — två tredjedelar av allt P3D-testade — kunde aldrig nå
-- databasen. isInScope() i 02-Ingestion/tools/sourceRegistry.ts:150 är
-- `(source.city ?? '').trim() === 'Stockholm'`, så en promote med city NULL
-- eller city='Malmö' skriver en fil som A-gatet filtrerar bort i tysthet.
--
-- Varje sådan kandidat kostar dessutom riktig arbetstid: P3D spawnar
-- Alltools-E2E/e2e.py --from-preA --limit 1 --apply per kandidat, alltså en
-- hel A→B→C-körning mot nätet. Uppmätt kostnad i körningen 2026-10-23 var
-- 147 s för 20 kandidater, av vilka 0 var Stockholm — 0 användbara promote:ar
-- per 147 s.
--
-- DETSAMMA LÄCKT VÄXEL SOM PROMOTE-SIDAN
--
-- De två city-less filer som P3D faktiskt skrev under körningen —
-- candidate-6c03ad17-biblioteketstockholmse (biblioteket.stockholm.se) och
-- candidate-948a9541-wwwmodernamuseetse (modernamuseet.se/sv/stockholm/) —
-- var båda promote:ar som PASSADE smoke med persisterade events. De är
-- bevisat fungerande källor som ändå är osynliga för ingestion, för att
-- source_candidates.city var NULL när de skrevs. Med city-filtret kan inga
-- nya sådana promote:ar uppstå: en kandidat utan stad testar inte alls, och
-- en kandidat med stad bär med sig staden till filen (sandbox.ts:46).
--
-- VARFÖR = 'Stockholm' OCH INTE "bara icke-null"
--
-- Att släppa igenom Göteborg/Malmö vore fortfarande slösaktigt: de passerar
-- isInScope() lika lite. produkten är Stockholm (CLAUDE.md, masterplan), så
-- "kan den nå databasen" och "är den i scope" är samma fråga. Här är filtret
-- hårtkodat på samma sätt som isInScope() — de två kan inte glida isär utan
-- att det syns i diffen.
--
-- KÖN BLIR INTE TOM
--
-- Att filtrera bort city IS NULL låser inte ut framtida kandidater. P3A
-- sätter city per URL från den fråga som faktiskt hittade URL:en
-- (discoverySearch.ts:238, 323-324), och backfillen av gälla rader
-- (backfillCandidateCities.ts) kördes redan 2026-10-23. Verifierat på de
-- rader som skapades i dag:
--
--   engine              | city       | antal | skapad
--   venue_graph_geo    | Stockholm  |    30 | 09:30
--   exa_search          | Göteborg   |    10 | 08:02
--   exa_search          | Malmö      |    10 | 08:02
--   exa_search          | Uppsala    |    10 | 08:02
--   exa_search          | Stockholm  |     1 | 08:02
--   exa_search          | NULL       |     0 |
--
-- Noll NULL. De 202 legacy-raderna är gamla rader från före fixen.
--
-- VIKTIGT: inga raderas eller ändras. Rader som inte längre claimas behåller
-- sin status 'pending' och syns i dashboarden som väntande — de är inte
-- begravda, bara inte testade. Vill man testa en utsockes-kandidat i framtiden
-- krävs ett uttryckligt beslut, inte att filteret tyst försvinner.

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
      AND city = 'Stockholm'
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

REVOKE ALL ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_source_candidate_test_queue(INTEGER, TEXT) TO service_role;

-- Index som matchar filtret. Utan den går claimen igenom 381 rader för att
-- hitta 131, och den filterade kolumnen ligger sist i det befintliga indexet
-- (status, phase, priority_score DESC).
CREATE INDEX IF NOT EXISTS idx_source_candidate_queue_claimable
  ON source_candidate_test_queue(status, city, priority_score DESC, created_at ASC)
  WHERE city IS NOT NULL;