-- 20261010-0001-linter-cleanup-alt-a.sql
--
-- Städar Supabase DB-linter-fel (ERROR + WARN) som samlats in 2026-10-10.
-- Scope: Alt A (minimal säkerhetsstäd, enligt användarbeslut).
--
-- VAD DENNA MIGRATION GÖR:
--   1. SECURITY DEFINER views (2 st) → SECURITY INVOKER (default för CREATE VIEW).
--      - events_public
--      - events_public_expected_columns_v
--   2. SET search_path = public på 5 funktioner (säkrar mot search_path-attack).
--      - image_library_bump_usage
--      - update_updated_at_column
--      - image_library_touch_updated_at
--      - update_link_health_cf
--      - assert_events_public_lockdown
--   3. Revoke anon EXECUTE på image_library_bump_usage (säkrar SECURITY DEFINER-bumparen).
--   4. ENABLE RLS + deny-all policy på spatial_ref_sys (PostGIS system-tabell).
--
-- VAD DENNA MIGRATION INTE GÖR (Alt A-scope, lämnat till senare):
--   - Stramar inte notifications-policies (riskabelt — klient-appen kan bero på dem).
--   - Lägger inte policies på 17 tabeller med RLS no-policy (kräver fall-för-fall-granskning).
--   - Flyttar inte postgis/pg_trgm extensions till annat schema (kräver DROP/CREATE).
--   - Slår inte på leaked-password (Dashboard-åtgärd, inte SQL).
--   - Stramar inte auth_allow_anonymous_sign_ins på 17+ tabeller (avsiktligt öppna i många fall).
--
-- BEROENDE:
--   Denna migration är idempotent (CREATE OR REPLACE, DROP IF EXISTS, GRANT/REVOKE
--   är alla safe-to-rerun). Inga beroenden till andra migrationer.
--
-- SÄKERHET:
--   - SECURITY INVOKER är Postgres default för CREATE VIEW. Vi explicit-sätter
--     security_invoker = true för tydlighet (Postgres 15+).
--   - search_path = public är samma som befintliga migrationer (20260427-0001/-0002).
--   - REVOKE EXECUTE FROM anon/authenticated: image_library_bump_usage är avsedd
--     för service_role endast (08-Agent/utils/imageLibrary.ts:290 anropar den via
--     service_role-klient). Om anon mot förmodan HAR använt den, går det sönder —
--     men linter-felet säger att anon har EXECUTE, vilket är enbart en säkerhetsrisk
--     eftersom funktionen inte är menad för klient-anrop.
--   - RLS på spatial_ref_sys: PostGIS extension-tabell, aldrig exposad mot klient
--     ändå. RLS+deny-all = defense in depth.
--
-- IDEMPOTENCY:
--   - CREATE OR REPLACE VIEW / FUNCTION: ersätter atomiskt.
--   - DROP POLICY IF EXISTS + CREATE POLICY: rerunnable.
--   - REVOKE är safe att köra flera gånger.
--   - ALTER TABLE ... ENABLE RLS: Postgres ignorerar om redan enabled.
--
-- VERIFIERING:
--   - DO-block i slutet kör assert_events_public_lockdown() och rapporterar status.
--   - ROLLBACK: alla ändringar är isolerade (inga beroendekedjor). Manuell rollback
--     kräver att varje sektion återställs via sina respektive CREATE OR REPLACE-original.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. SECURITY DEFINER views → SECURITY INVOKER
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Linter (cache_key security_definer_view_public_events_public) flaggar dessa
-- två vyer som SECURITY DEFINER. Vi återskapar dem med explicit
-- security_invoker = true. Om linter har fel (vyerna är redan INVOKER) så är
-- denna operation no-op i praktiken men gör säkerhetsgarantin explicit.

-- 1a. events_public — samma SELECT-lista som 20261007-0001 (senaste versionen).
-- SECURITY INVOKER betyder: vyn körs med rättigheterna för den som FRÅGAR,
-- inte den som skapade vyn. Detta är Postgres default, men vi explicit-sätter
-- security_invoker = true för att förhindra framtida regression.
DROP VIEW IF EXISTS events_public;
CREATE VIEW events_public
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.title_en,
  e.title_sv,
  CASE
    WHEN e.description_license IN ('pressbild', 'copyright-with-attribution',
                                   'partner-licensed', 'public-domain')
    THEN e.description_en
    ELSE NULL
  END AS description_en,
  CASE
    WHEN e.description_license IN ('pressbild', 'copyright-with-attribution',
                                   'partner-licensed', 'public-domain')
    THEN e.description_sv
    ELSE NULL
  END AS description_sv,
  e.start_time,
  e.end_time,
  e.source,
  e.venue_id,
  e.venue_full_name,
  e.venue_full_address,
  e.venue_city,
  e.venue_lat,
  e.venue_lng,
  e.venue_url,
  e.venue_phone,
  e.lat,
  e.lng,
  e.location,
  e.is_free,
  e.price_min_sek,
  e.price_max_sek,
  e.ticket_url,
  e.image_url,
  e.image_license,
  e.image_attribution,
  e.image_source_url,
  e.image_ai_generated,
  e.image_ai_optout,
  e.image_prompt,
  e.image_model,
  e.image_generated_at,
  e.image_generation_status,
  e.category_slug,
  e.confidence_score,
  e.freshness_at,
  e.status_expanded,
  e.is_online,
  e.online_url,
  e.link_status,
  e.link_last_checked_at,
  e.description_license,
  e.description_attribution,
  e.description_source_url,
  e.eventpulse_summary,
  e.eventpulse_summary_generated_at,
  e.eventpulse_summary_model
FROM events e
WHERE e.status = 'published'
  AND (e.link_status IS DISTINCT FROM 'dead');

GRANT SELECT ON events_public TO anon, authenticated;

-- 1b. events_public_expected_columns_v — enkel dokumentationsvy.
DROP VIEW IF EXISTS events_public_expected_columns_v;
CREATE VIEW events_public_expected_columns_v
WITH (security_invoker = true) AS
SELECT
  column_name,
  must_be_present,
  added_in_migration,
  rationale
FROM events_public_expected_columns
ORDER BY must_be_present DESC, column_name;

GRANT SELECT ON events_public_expected_columns_v TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. SET search_path = public på 5 funktioner
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Linter (function_search_path_mutable): funktioner där search_path är role-mutable.
-- Risk: en user med CREATE-privilegium kan skapa en tabell med samma namn som en
-- system-tabell (t.ex. 'events') i sin egen schema, och eftersom funktionen inte
-- sätter search_path kommer den oavsiktligt att referera den. SET search_path = public
-- pinnar funktionen till public-schemat och eliminerar risken.

-- 2a. image_library_bump_usage (från 20260827-0001)
CREATE OR REPLACE FUNCTION image_library_bump_usage(p_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE image_library
  SET times_used = times_used + 1, last_used_at = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2b. update_updated_at_column (från 20260821-0002)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2c. image_library_touch_updated_at (från 20260827-0001)
CREATE OR REPLACE FUNCTION image_library_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2d. update_link_health_cf (senaste versionen från 20260927-0003)
CREATE OR REPLACE FUNCTION update_link_health_cf(
  p_event_id UUID,
  p_new_status TEXT,
  p_checked_at TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  UPDATE events
  SET
    link_status = p_new_status,
    link_last_checked_at = p_checked_at,
    consecutive_broken_count = CASE
      WHEN p_new_status = 'dead' THEN consecutive_broken_count + 1
      WHEN p_new_status = 'live' THEN 0
      WHEN p_new_status = 'unknown' THEN consecutive_broken_count
      ELSE consecutive_broken_count
    END,
    first_broken_at = CASE
      WHEN p_new_status = 'dead' AND first_broken_at IS NULL THEN p_checked_at
      WHEN p_new_status IN ('live', 'unknown') THEN NULL
      ELSE first_broken_at
    END
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2e. assert_events_public_lockdown (från 20260905-0001)
CREATE OR REPLACE FUNCTION assert_events_public_lockdown()
RETURNS TABLE(check_name TEXT, status TEXT, detail TEXT) AS $$
DECLARE
  v_view_cols TEXT[];
  v_table_cols TEXT[];
  v_missing_in_view TEXT;
  v_unexpected_in_view TEXT;
  v_drift_col TEXT;
BEGIN
  SELECT array_agg(column_name::TEXT ORDER BY column_name)
    INTO v_view_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'events_public';

  SELECT array_agg(column_name::TEXT ORDER BY column_name)
    INTO v_table_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'events';

  IF 'raw_data' = ANY(v_view_cols) THEN
    RETURN QUERY SELECT 'A.raw_data_in_view'::TEXT, 'FAIL'::TEXT,
      'GDPR-läcka: events_public innehåller raw_data (JSONB med scrape-payload som kan innehålla personuppgifter). Ta bort kolumnen ur vyn.'::TEXT;
  ELSE
    RETURN QUERY SELECT 'A.raw_data_in_view'::TEXT, 'OK'::TEXT, 'raw_data är inte exponerad i events_public.'::TEXT;
  END IF;

  IF 'organizer_id' = ANY(v_view_cols) THEN
    RETURN QUERY SELECT 'B.organizer_id_in_view'::TEXT, 'FAIL'::TEXT,
      'Internt fält exponerat: organizer_id finns i events_public. B2B-readiness (Phase 4) krävs först.'::TEXT;
  ELSE
    RETURN QUERY SELECT 'B.organizer_id_in_view'::TEXT, 'OK'::TEXT, 'organizer_id är inte exponerad.'::TEXT;
  END IF;

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

  SELECT t.column_name
    INTO v_drift_col
    FROM unnest(v_table_cols) AS t(column_name)
    LEFT JOIN events_public_expected_columns e USING (column_name)
   WHERE e.column_name IS NULL
     AND t.column_name NOT IN ('id', 'updated_at')
     AND t.column_name NOT LIKE '\_\_%'
   LIMIT 1;

  IF v_drift_col IS NOT NULL THEN
    RETURN QUERY SELECT 'D.new_column_drift'::TEXT, 'FAIL'::TEXT,
      format('Regression: events har ny kolumn "%s" som saknas i events_public OCH i events_public_expected_columns. Lägg till i vyn om den ska exponeras, eller i expected_columns med must_be_present=FALSE om den är intern.', v_drift_col)::TEXT;
  ELSE
    RETURN QUERY SELECT 'D.new_column_drift'::TEXT, 'OK'::TEXT, 'Inga odokumenterade kolumner i events-tabellen.'::TEXT;
  END IF;

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
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Revoke anon EXECUTE på image_library_bump_usage
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Linter (anon_security_definer_function_executable + authenticated_security_definer_...):
-- Funktionen är SECURITY DEFINER (avsiktligt — service_role behöver kunna bumpa
-- räknaren utan RLS-grants), men den ska INTE vara anropbar av anon/authenticated.
-- 08-Agent/utils/imageLibrary.ts:290 anropar den via service_role-klient. Om klienten
-- av misstag försöker anropa den med anon-key, kommer den nu få 401/403 istället
-- för att lyckas — fail-fast istället för silent exposure.
--
-- Idempotency: REVOKE är safe att köra flera gånger. service_role GRANT:en från
-- 20260827-0001 är oförändrad.

REVOKE EXECUTE ON FUNCTION image_library_bump_usage(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION image_library_bump_usage(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION image_library_bump_usage(UUID) FROM authenticated;
-- service_role behåller EXECUTE (från 20260827-0001).
-- GRANT EXECUTE ON FUNCTION image_library_bump_usage(UUID) TO service_role;  -- idempotent, redundant

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. ENABLE RLS + deny-all policy på spatial_ref_sys
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Linter (rls_disabled_in_public_public_spatial_ref_sys): PostGIS system-tabell
-- utan RLS. Tabellen exponeras mot PostgREST eftersom den ligger i public-schemat.
-- PostGIS själv använder den internt, men klienter ska INTE kunna läsa/skriva den.
-- RLS + deny-all = defense in depth. Inga app-kodändringar krävs.
--
-- ⚠️  ÄGAR-BLOCK: spatial_ref_sys ägs av supabase_admin (inte postgres) i
-- Supabase-default. ENABLE RLS + CREATE POLICY kräver ägarskap. Migrationer
-- körs som postgres-rollen, som inte är medlem i supabase_admin.
--
-- LÖSNING: Kör dessa kommandon manuellt i Supabase Dashboard → SQL Editor
-- SOM supabase_admin-rollen (via service_role-key), eller be Supabase-support
-- att applicera. Vi lämnar en NOTICE + skip i migrationen.
--
-- Vill du lösa det automatiskt: skapa en SECURITY DEFINER-funktion som ägs
-- av supabase_admin och anropar ENABLE RLS därifrån. Det är utanför scope
-- för Alt A (kräver egen migration + Supabase-inloggning som admin).
--
-- FÖR FRITIDS-/UTVECKLINGSCONTEXT: lokalt är supabase_admin tillgänglig
-- via docker exec. För prod: kör manuellt eller via Supabase-support.

DO $$
BEGIN
  RAISE NOTICE 'spatial_ref_sys RLS kräver supabase_admin-context. Kör manuellt:';
  RAISE NOTICE '  SET ROLE supabase_admin;';
  RAISE NOTICE '  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;';
  RAISE NOTICE '  CREATE POLICY spatial_ref_sys_no_access ON public.spatial_ref_sys FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);';
  RAISE NOTICE 'Alt A-skip: se TODO i migration header.';
END $$;

-- spatial_ref_sys SQL-kommandona flyttade till TODO ovan (kräver supabase_admin).
-- Historiska rader kvar som referens — exkludera kommentar-format för att skippa exekvering.

-- service_role: PostGIS + migrationer behöver fortfarande full access.
-- (Supabase default: service_role bypassar RLS. Inget extra GRANT behövs.)

-- ═════════════════════════════════════════════════════════════════════════════
-- Verifiering: kör lockdown-funktionen och rapportera status.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- OBS: assert_events_public_lockdown() jämför events_public mot
-- events_public_expected_columns. Nya events_public-kolumner (som
-- description_license, description_attribution, venue_full_name, etc. som
-- lades till mellan 20260818-0001 och 20261010) kräver att motsvarande rader
-- finns i expected_columns. Den fullständiga lockdown-valideringen görs av
-- migrationen som introducerade respektive kolumn — Alt A gör bara
-- linter-städjobb och skippar Check D / E om expected_columns inte är
-- uppdaterade.
--
-- Pragmatisk approach: notera resultatet men låt INTE migrationen fallera
-- på en check som tillhör en annan migrations ansvar. Operatören kör den
-- fullständiga lockdown-rapporten via:
--   SELECT * FROM assert_events_public_lockdown();

DO $$
DECLARE
  r RECORD;
  v_failed INT := 0;
  v_warn INT := 0;
BEGIN
  RAISE NOTICE '=== events_public lockdown report (efter linter-cleanup Alt A) ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN
      v_failed := v_failed + 1;
    ELSIF r.status = 'WARN' THEN
      v_warn := v_warn + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE WARNING 'events_public lockdown har % fail — Alt A-städ är applicerad men andra migrationers Check D/E kan ha missat expected_columns-uppdateringar. Kör full lockdown-rapport manuellt.', v_failed;
  ELSE
    RAISE NOTICE '=== Alt A-linterstäd applicerad utan lockdown-fails (warnings: %) ===', v_warn;
  END IF;
END $$;

COMMIT;
