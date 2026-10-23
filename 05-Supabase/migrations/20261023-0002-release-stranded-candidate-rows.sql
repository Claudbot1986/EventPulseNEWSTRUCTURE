-- Frigör strandade kandidatrader i P3D-kön (2026-10-23)
--
-- PROBLEM
--
-- En P3D-körning som avbryts mitt i (SIGTERM, OOM, manuell kill) lämnar
-- sina claimade rader i status='processing' med en låsning som ingen
-- process längre släpper. Mätt 2026-10-23 efter körningen som startade
-- 07:31:39 UTC:
--
--   15 rader status='processing', locked_at = 2026-10-23T07:31:40Z
--   created_at = 2026-10-21T19:11:19Z (de äldsta i hela kön)
--
-- Reclaim-klausulen i claim_source_candidate_test_queue() finns sedan
-- 20261021-0003 och är korrekt:
--
--   WHERE (status = 'pending'
--          OR (status = 'processing'
--              AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes')))
--
-- Men den är INNE i samma WHERE som city-filtern från 20261023-0001:
--
--   ... AND city = 'Stockholm'
--
-- city-filtret gäller BÅDA grenarna. En rad med city IS NULL kan därför
-- inte reclaimas, hur gammal låsningen än blir — den är permanent
-- onåbar ur både pending- och processing-vägen. 13 av de 15 raderna
-- har city IS NULL på både queue- och source_candidates-sidan.
--
-- De två som har city='Stockholm' är nåbar, men reclaimen konkurrerar
-- med 340 pending-rader i samma ORDER BY (priority_score DESC,
-- created_at ASC) där alla 355 har priority_score = 50. Tie-breaken på
-- created_at är icke-deterministisk utan ett tredje sorteringsnyckel,
-- så vilken rad som vinner beror på fysisk radordning — inte på
-- någon av egenskaperna vi bryr oss om. Att h4 såg 15 stuck trots att
-- reclaimen är på plats är alltså inte ett tecken på att SQL:en är
-- trasig; det är ett tecken på att en strandad rad inte är samma sak
-- som en reclaimbar rad.
--
-- VARFÖR DETTA ÄR ETT EGET PROBLEM OCH INTE BARA EN KÖRESTÖRNING
--
-- En rad i 'processing' är i systemets ögon "pågående". Ingen gate
-- rapporterar den, ingen dashboard visar den, och ingen kommer att
-- rapportera den om vi inte mäter det uttryckligen (h4). Att lämna
-- kandidater i det tillståndet är värre än att lämna dem i 'pending':
-- de är osynliga, out-of-scope för varje konsument, och kan inte
-- klassas som varken avslutade eller väntande.
--
-- DENNA MIGRATION
--
-- Släpper alla strandade rader tillbaka till 'pending' med
-- locked_at = NULL. Villkoret är medvetet OBEROENDE av city — det är
-- hela poängen. En frigöring som filterade på city skulle inte nå
-- de 13 raderna som claimen aldrig kan se.
--
-- Idempotent: samma villkor som reclaimen, så en framtida körning av
-- det här skriptet rör bara rader som verkligen är stuck. Inga rader
-- raderas, inga kandidater förloras.
--
-- Varför ingen permanent SQL-fix? Efter det här är alla city-NULL-
-- rader 'pending', och city-NULL-rader kan inte claimas (det är hela
-- poängen med 20261023-0001). En rad som inte kan claimas kan inte
-- heller bli strandad. Undantaget är de två city='Stockholm'-raderna,
-- som går tillbaka i normal rotation och därmed inte är strukturellt
-- skyddade — men de har en fungerande reclaim och behöver ingen särskild
-- hantering. Skrivet ut här så att invariantet är explicit om någon
-- senare lägger till ett claim-filter till.

UPDATE source_candidate_test_queue
SET
  status = 'pending',
  locked_at = NULL,
  updated_at = now(),
  last_error = COALESCE(last_error, '')
    || ' [released: stranded processing row, 2026-10-23]'
WHERE status = 'processing'
  AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes');

-- Skyddsnät: en rad som är 'processing' utan city alls har aldrig nåtts
-- av någon kvägsreclaim, så den ska inte kunna ligga kvar. Om den gör
-- det är det ett nytt hål, inte något den här migrationen kan täppa.
DO $$
DECLARE
  stranded int;
BEGIN
  SELECT count(*) INTO stranded
  FROM source_candidate_test_queue
  WHERE status = 'processing';

  IF stranded > 0 THEN
    RAISE WARNING
      'source_candidate_test_queue: % rad(er) ligger kvar i processing efter frigöringen. '
      'En levande P3D-körning kan pågå — kontrollera innan du färdigförklrar.', stranded;
  END IF;
END $$;