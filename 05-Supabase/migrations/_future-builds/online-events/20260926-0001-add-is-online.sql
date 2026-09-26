-- 20260926-0001-add-is-online.sql
--
-- Lägger till is_online / online_url för Home-carousel "Online events".
--
-- Bakgrund: docs/HOME-CAROUSELS-PLAN.md (2026-09-26) — 5 nya hem-karuseller.
-- Carousel D "Online" kräver en pålitlig detektor. venue_id IS NULL är otillräckligt
-- (Hardenberger-konsert har null venue men är INTE online — verifierat idag).
-- schema-migration vald av Jev (0.70 confidence) framför titel-heuristik ensam.
--
-- Designval:
--   is_online BOOLEAN DEFAULT NULL — tri-state: NULL=okänt, false=bekräftat ej online,
--   true=bekräftat online. Bakåtkompatibelt med befintliga rader.
--   online_url TEXT DEFAULT NULL — länk till deltagande (t.ex. stream-URL).
--   Separat från ticket_url eftersom online-events ofta saknar ticket-köp.
--
-- Idempotency:
--   ALTER TABLE IF NOT EXISTS — körs säkert flera gånger.
--   CREATE INDEX IF NOT EXISTS — idempotent.
--   CREATE OR REPLACE VIEW — ersätter befintlig view utan DROP.
--   INSERT ... ON CONFLICT DO NOTHING på expected-columns — idempotent.
--
-- Rollback:
--   ALTER TABLE events DROP COLUMN online_url;
--   ALTER TABLE events DROP COLUMN is_online;
--   (view-recreate måste återställas manuellt med föregående version)
--
-- GDPR-lockdown:
--   Viewn exkluderar uttryckligen source_id / dedup_hash (se 20260905-0001).
--   is_online och online_url är inte känsliga (ej scrape-targets).
--
-- Lockdown-test:
--   Uppdaterar events_public_expected_columns med de två nya kolumnerna så
--   assert_events_public_lockdown() Check E inte triggar regression.

BEGIN;

-- ─── Tabelländring ──────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS online_url TEXT DEFAULT NULL;

-- ─── Index för hem-karusellens query (online, framtida, sorterad på tid) ────
-- Partial index: bara rader som är bekräftat online och publicerade.
CREATE INDEX IF NOT EXISTS idx_events_is_online_start_time
  ON events (is_online, start_time)
  WHERE is_online = true AND status = 'published';

-- ─── Uppdatera events_public-vyn så anon-klienter ser nya kolumner ──────────
-- Bevarar existerande fältordning. Nya fält läggs till efter status_expanded.
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
  e.online_url
FROM events e
WHERE e.status = 'published';

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Uppdatera lockdown-registret ────────────────────────────────────────────
-- Nya kolumner som exponeras måste registreras i expected-listan så att
-- framtida migrationer som rör events-tabellen fångas av Check D-regressionsvakten.
INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale) VALUES
  ('is_online',  TRUE, '20260926-0001-add-is-online', 'Filter för home-karusell "Online events". NULL = okänt.'),
  ('online_url', TRUE, '20260926-0001-add-is-online', 'Deep link till online-deltagande (t.ex. stream-URL).')
ON CONFLICT (column_name) DO NOTHING;

-- ─── Verifiering direkt i migrationen ───────────────────────────────────────
-- Kör lockdown-funktionen och rapportera status. Kastar exception om FAIL.
DO $$
DECLARE
  r RECORD;
  v_failed INT := 0;
BEGIN
  RAISE NOTICE '=== events_public lockdown report (efter is_online/online_url) ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN
      v_failed := v_failed + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'events_public lockdown har % fail — migrationen är applicerad men lockdownen är bruten. Åtgärda INNAN app deploy.', v_failed;
  END IF;
  RAISE NOTICE '=== lockdown OK — is_online / online_url exponerade på ett säkert sätt ===';
END $$;

COMMIT;
