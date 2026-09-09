-- 20260905-0001-events-public-lockdown-test.sql
--
-- GDPR lockdown test for events_public view.
--
-- Bakgrund: events_public är den ENDA yta som anon och authenticated får läsa
-- ifrån events-tabellen (se 20260818-0001-agent-event-graph.sql rad 297).
-- Den projicerar events och exkluderar uttryckligen raw_data, internal ids och
-- organizer_id eftersom scrape-payloaden i raw_data kan innehålla personuppgifter
-- (JSON-LD organizer.email, performer.phone, contact_person, etc) som inte ska
-- exponeras mot klientappen enligt GDPR Art. 5(1)(c) dataminimering.
--
-- Risk: en framtida migration som lägger till en kolumn i events-tabellen
-- glömmer uppdatera events_public-vyn → ny kolumn exponeras automatiskt mot
-- anon eftersom REVOKE ALL ON events FROM anon redan är på plats, men en ny
-- kolumn som JOIN:as in via någon path skulle kunna nå klienten.
--
-- Den här migrationen skapar:
--   1. events_public_expected_columns — en tabell med den auktoritativa listan
--      av kolumner som SKA finnas i events_public.
--   2. assert_events_public_lockdown() — en PL/pgSQL-funktion som jämför
--      events_public mot events och mot expected-listan. Raise:ar exception
--      om raw_data finns i vyn eller om events har nya kolumner som saknas
--      i expected-listan.
--
-- CI-hook: vitest-test (events-public-lockdown.test.ts) anropar funktionen
-- mot lokal supabase start. Migrationen körs lokalt + på prod (idempotent).
--
-- Idempotency: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- INSERT ... ON CONFLICT DO NOTHING. Kan köras flera gånger utan fel.

BEGIN;

-- ─── Expected columns registry ──────────────────────────────────────────────
-- Auktoritativ lista. När en migration lägger till en kolumn i events MÅSTE
-- den också läggas till här (om den ska exponeras) eller uttryckligen
-- exkluderas (om den är intern, som raw_data).
CREATE TABLE IF NOT EXISTS events_public_expected_columns (
  column_name TEXT PRIMARY KEY,
  must_be_present BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = uttryckligen exkluderad (t.ex. raw_data)
  added_in_migration TEXT NOT NULL,
  rationale TEXT
);

-- En gång-seeding. ON CONFLICT DO NOTHING = idempotent.
INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale) VALUES
  -- Pre-Phase-0 events columns (befintliga)
  ('id',                   TRUE, 'pre-20260818', 'Primary key, anon får se UUID för att kunna referera'),
  ('title_en',             TRUE, 'pre-20260818', 'Event-titel EN'),
  ('title_sv',             TRUE, 'pre-20260818', 'Event-titel SV (huvudsakligt språk för Stockholm)'),
  ('description_en',       TRUE, 'pre-20260818', 'Event-beskrivning EN'),
  ('description_sv',       TRUE, 'pre-20260818', 'Event-beskrivning SV'),
  ('start_time',           TRUE, 'pre-20260818', 'Krävs för tidsfiltrering i appen'),
  ('end_time',             TRUE, 'pre-20260818', 'Frivillig sluttid'),
  ('source',               TRUE, 'pre-20260818', 'Källa (ticketmaster, kulturhuset, etc)'),
  ('venue_id',             TRUE, 'pre-20260818', 'FK till venues, används av karta och filter'),
  ('lat',                  TRUE, 'pre-20260818', 'Lat för karta/distance'),
  ('lng',                  TRUE, 'pre-20260818', 'Lng för karta/distance'),
  ('location',             TRUE, 'pre-20260818', 'PostGIS POINT(lng lat) för spatial queries'),
  ('is_free',              TRUE, 'pre-20260818', 'Filter för gratis-events'),
  ('price_min_sek',        TRUE, 'pre-20260818', 'Prisfilter'),
  ('price_max_sek',        TRUE, 'pre-20260818', 'Prisfilter'),
  ('ticket_url',           TRUE, 'pre-20260818', 'Deep link till biljettköp'),
  ('image_url',            TRUE, 'pre-20260818', 'Visuell yta i UI'),
  ('category_slug',        TRUE, 'pre-20260818', 'Kategori för filter'),
  -- Phase-0/1 columns (lagts till av senare migrationer)
  ('confidence_score',     TRUE, '20260818-0001-agent-event-graph', 'Ranking-feature, klient får se för att visa confidence copy'),
  ('freshness_at',         TRUE, '20260818-0001-agent-event-graph', 'Klient får se för "uppdaterad X dagar sedan" copy'),
  ('status_expanded',      TRUE, '20260818-0001-agent-event-graph', 'Visar cancelled/sold_out/postponed i UI'),
  ('image_license',        TRUE, '20260821-0004-image-license-fields', 'Visar licensinfo i UI'),
  ('image_attribution',    TRUE, '20260821-0004-image-license-fields', 'Visar attribution i UI'),
  ('image_source_url',     TRUE, '20260821-0004-image-license-fields', 'Länk till originalbild'),
  ('image_ai_generated',   TRUE, '20260825-0001-ai-image-mandatory', 'Visar AI-stämpel i UI'),
  ('image_ai_optout',      TRUE, '20260826-0001-events-image-ai-optout', 'Styr useAiImageUrl-hook'),
  ('image_prompt',         TRUE, '20260825-0001-ai-image-mandatory', 'För "AI-transparens"-info'),
  ('image_model',          TRUE, '20260825-0001-ai-image-mandatory', 'För "AI-transparens"-info'),
  ('image_generated_at',   TRUE, '20260825-0001-ai-image-mandatory', 'För "AI-transparens"-info'),
  ('image_generation_status', TRUE, '20260825-0001-ai-image-mandatory', 'Klient behöver veta pending/failed för fallback-rendering')
ON CONFLICT (column_name) DO NOTHING;

-- Exkluderade kolumner — den här listan är dokumentationen "vad får INTE exponeras".
-- Här ligger GDPR-känsliga fält och interna fält.
INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale) VALUES
  ('raw_data',     FALSE, 'pre-20260818', 'JSONB med hela scrape-payloaden. Kan innehålla personuppgifter (organizer.email, performer.phone). GDPR Art. 5(1)(c) dataminimering.'),
  ('organizer_id', FALSE, '20260818-0001-agent-event-graph', 'Intern FK, kan möjliggöra profilering av enskilda organisatörer. Exponeras inte förrän B2B-readiness kräver det (Phase 4).'),
  ('source_id',    FALSE, 'pre-20260818', 'Käll-specifikt event-id. Kan kombineras med source för att härleda scrape-target. Liten risk men onödig exponering.'),
  ('dedup_hash',   FALSE, 'pre-20260818', 'SHA-256 av (source, source_id). Läckage avslöjar interna normaliseringsdetaljer.')
ON CONFLICT (column_name) DO NOTHING;

-- ─── Assertion-funktion ─────────────────────────────────────────────────────
-- Anropas av vitest. Raise:ar exception om:
--   A. raw_data finns i events_public (GDPR-läcka)
--   B. organizer_id finns i events_public (internt fält exponerat)
--   C. source_id eller dedup_hash finns i events_public (små men onödiga läckor)
--   D. events har kolumner som varken finns i events_public eller i
--      expected-listan (regression: ny kolumn glömd)
--   E. expected-listan har must_be_present=TRUE men kolumnen saknas i vyn
CREATE OR REPLACE FUNCTION assert_events_public_lockdown()
RETURNS TABLE(check_name TEXT, status TEXT, detail TEXT) AS $$
DECLARE
  v_view_cols TEXT[];
  v_table_cols TEXT[];
  v_missing_in_view TEXT;
  v_unexpected_in_view TEXT;
  v_drift_col TEXT;
BEGIN
  -- Hämta aktuella kolumner från events_public-vyn.
  SELECT array_agg(column_name::TEXT ORDER BY column_name)
    INTO v_view_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'events_public';

  -- Hämta aktuella kolumner från events-tabellen.
  SELECT array_agg(column_name::TEXT ORDER BY column_name)
    INTO v_table_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'events';

  -- Check A: raw_data får ALDRIG finnas i vyn.
  IF 'raw_data' = ANY(v_view_cols) THEN
    RETURN QUERY SELECT 'A.raw_data_in_view'::TEXT, 'FAIL'::TEXT,
      'GDPR-läcka: events_public innehåller raw_data (JSONB med scrape-payload som kan innehålla personuppgifter). Ta bort kolumnen ur vyn.'::TEXT;
  ELSE
    RETURN QUERY SELECT 'A.raw_data_in_view'::TEXT, 'OK'::TEXT, 'raw_data är inte exponerad i events_public.'::TEXT;
  END IF;

  -- Check B: organizer_id är internt och får inte exponeras.
  IF 'organizer_id' = ANY(v_view_cols) THEN
    RETURN QUERY SELECT 'B.organizer_id_in_view'::TEXT, 'FAIL'::TEXT,
      'Internt fält exponerat: organizer_id finns i events_public. B2B-readiness (Phase 4) krävs först.'::TEXT;
  ELSE
    RETURN QUERY SELECT 'B.organizer_id_in_view'::TEXT, 'OK'::TEXT, 'organizer_id är inte exponerad.'::TEXT;
  END IF;

  -- Check C: source_id och dedup_hash är små onödiga läckor.
  IF 'source_id' = ANY(v_view_cols) THEN
    RETURN QUERY SELECT 'C.source_id_in_view'::TEXT, 'WARN'::TEXT,
      'source_id exponerat — liten risk för härledning av scrape-target. Överväg att ta bort ur vyn.'::TEXT;
  END IF;
  IF 'dedup_hash' = ANY(v_view_cols) THEN
    RETURN QUERY SELECT 'C.dedup_hash_in_view'::TEXT, 'WARN'::TEXT,
      'dedup_hash exponerat — avslöjar normaliseringsdetaljer. Ta bort ur vyn.'::TEXT;
  END IF;
  IF NOT ('source_id' = ANY(v_view_cols)) AND NOT ('dedup_hash' = ANY(v_view_cols)) THEN
    RETURN QUERY SELECT 'C.internal_ids_in_view'::TEXT, 'OK'::TEXT, 'source_id och dedup_hash är inte exponerade.'::TEXT;
  END IF;

  -- Check D: events har nya kolumner som varken finns i vyn eller i expected-listan.
  -- Detta är regression-guarden.
  SELECT t.column_name
    INTO v_drift_col
    FROM unnest(v_table_cols) AS t(column_name)
    LEFT JOIN events_public_expected_columns e USING (column_name)
   WHERE e.column_name IS NULL
     AND t.column_name NOT IN ('id', 'updated_at')  -- updated_at är internt, inte events-data
     AND t.column_name NOT LIKE '\_\_%'              -- ignorera system-kolumner
   LIMIT 1;

  IF v_drift_col IS NOT NULL THEN
    RETURN QUERY SELECT 'D.new_column_drift'::TEXT, 'FAIL'::TEXT,
      format('Regression: events har ny kolumn "%s" som saknas i events_public OCH i events_public_expected_columns. Lägg till i vyn om den ska exponeras, eller i expected_columns med must_be_present=FALSE om den är intern.', v_drift_col)::TEXT;
  ELSE
    RETURN QUERY SELECT 'D.new_column_drift'::TEXT, 'OK'::TEXT, 'Inga odokumenterade kolumner i events-tabellen.'::TEXT;
  END IF;

  -- Check E: alla must_be_present=TRUE kolumner måste finnas i vyn.
  SELECT e.column_name
    INTO v_drift_col
    FROM events_public_expected_columns e
   WHERE e.must_be_present = TRUE
     AND NOT (e.column_name = ANY(v_view_cols))
   LIMIT 1;

  IF v_drift_col IS NOT NULL THEN
    RETURN QUERY SELECT 'E.expected_missing'::TEXT, 'FAIL'::TEXT,
      format('Expected column "%s" saknas i events_public. Migrationen som lade till kolumnen glömde uppdatera vyn.', v_drift_col)::TEXT;
  ELSE
    RETURN QUERY SELECT 'E.expected_missing'::TEXT, 'OK'::TEXT, 'Alla förväntade kolumner finns i events_public.'::TEXT;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── Dokumentationsvy för människor ──────────────────────────────────────────
-- Gör det enkelt att se "vad är publikt, vad är internt" vid inspektion.
CREATE OR REPLACE VIEW events_public_expected_columns_v AS
SELECT
  column_name,
  must_be_present,
  added_in_migration,
  rationale
FROM events_public_expected_columns
ORDER BY must_be_present DESC, column_name;

GRANT SELECT ON events_public_expected_columns_v TO service_role;
GRANT SELECT ON events_public_expected_columns TO service_role;

-- ─── Initial körning: rapportera nuvarande tillstånd ─────────────────────────
-- Skriver till RAISE NOTICE så migration-loggen visar lockdown-status.
DO $$
DECLARE
  r RECORD;
  v_failed INT := 0;
BEGIN
  RAISE NOTICE '=== events_public lockdown report ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN
      v_failed := v_failed + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'events_public lockdown har % fail — se rapport ovan. Migrationen är applicerad men lockdownen är bruten. Åtgärda INNAN app deploy.', v_failed;
  END IF;
  RAISE NOTICE '=== lockdown OK — events_public är säker för anon ===';
END $$;

COMMIT;
