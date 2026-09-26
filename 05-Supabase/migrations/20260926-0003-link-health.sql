-- 20260926-0003-link-health.sql
--
-- Lägger till link-hälso-fält för daily HEAD-check per aktiv källa.
--
-- Bakgrund: användaren hittade en trasig KTH-länk som "fastnade" när hen
-- klickade "läs mer". Förslag: daglig HEAD-check per aktiv källa + UI-warning
-- i appen när en specifik event-länk senast markerats som trasig + watchlist
-- för källor med ihållande trasiga länkar.
--
-- Designval (2026-09-26):
--   link_status          TEXT NULL — tri-state plus null:
--                           NULL    = aldrig kontrollerad
--                           'ok'    = senaste HEAD returnerade 2xx/3xx
--                           'broken'= senaste HEAD returnerade 4xx/5xx,
--                                     network error, timeout, eller DNS-fel.
--                                     "Consecutive failure" hanteras via
--                                     link_last_checked_at + cron-logik.
--   link_last_checked_at TIMESTAMPTZ NULL — när senaste HEAD kördes.
--
-- Per-event, inte per-source:
--   Skälet: KTH-hemsidan kan vara uppe medan en specifik event-sida är 404
--   (precis detta hände med KTH-eventet användaren rapporterade). Att bara
--   kolla source-URL:en missar det mesta av problemet. Cron väljer en
--   representativ event per källa och dag och HEAD:ar dess ticket_url.
--
-- GDPR-lockdown:
--   Vyn events_public exponeras sedan 20260905-0001. De två nya kolumnerna
--   är inte känsliga — de beskriver länkhälsa, inte scrape-targets.
--   Registreras i events_public_expected_columns så lockdown Check D/E
--   inte triggar regression.
--
-- Idempotency:
--   ALTER TABLE ADD COLUMN IF NOT EXISTS — körs säkert flera gånger.
--   CREATE INDEX IF NOT EXISTS — idempotent.
--   CREATE OR REPLACE VIEW — ersätter utan DROP.
--   DO-block för CHECK-constraint (PG < 16 saknar IF NOT EXISTS på constraints).
--   INSERT ... ON CONFLICT DO NOTHING — idempotent på expected-columns.
--
-- Rollback:
--   ALTER TABLE events DROP COLUMN link_last_checked_at;
--   ALTER TABLE events DROP COLUMN link_status;
--   (view-recreate måste återställas manuellt med föregående version)

BEGIN;

-- ─── Tabelländring ──────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS link_status TEXT,
  ADD COLUMN IF NOT EXISTS link_last_checked_at TIMESTAMPTZ;

-- ─── CHECK constraint för link_status ────────────────────────────────────────
-- 'ok' | 'broken' | NULL (okänd). Undviker enum-typ för att hålla det simpelt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_link_status_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_link_status_check
      CHECK (link_status IS NULL OR link_status IN ('ok', 'broken'));
  END IF;
END $$;

-- ─── Index för watchlist-frågan ──────────────────────────────────────────────
-- "Hitta källor med minst en trasig event-länk som kollats senaste 7 dagarna".
-- Partial index: bara de rader vi faktiskt frågar mot.
CREATE INDEX IF NOT EXISTS idx_events_link_status_broken_recent
  ON events (source, link_last_checked_at)
  WHERE link_status = 'broken' AND status = 'published';

-- Sekundärt index för cron: "hitta äldsta okontrollerade event per källa".
-- Används av check_link_health.ts för att plocka nästa event att HEAD-testa.
CREATE INDEX IF NOT EXISTS idx_events_source_status_checked
  ON events (source, link_last_checked_at NULLS FIRST, start_time)
  WHERE status = 'published' AND ticket_url IS NOT NULL;

-- ─── Uppdatera events_public-vyn så anon-klienter ser nya kolumner ──────────
-- Bevarar existerande fältordning. Nya fält läggs till efter online_url.
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
  e.online_url,
  e.link_status,
  e.link_last_checked_at
FROM events e
WHERE e.status = 'published'
  -- 2026-09-26 (link-health v2): trasiga events försvinner helt från UI.
  -- IS DISTINCT FROM håller NULL-events (ännu ej HEAD-checkade) synliga —
  -- bara bekräftat trasiga filtreras. Source-regeln "källa synlig om minst
  -- ett event är ok" uppstår naturligt: filtrerar vi alla events försvinner
  -- källan från UI.
  AND (e.link_status IS DISTINCT FROM 'broken');

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Uppdatera lockdown-registret ────────────────────────────────────────────
-- Nya kolumner som exponeras måste registreras i expected-listan så att
-- framtida migrationer som rör events-tabellen fångas av Check D-regressionsvakten.
INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale) VALUES
  ('link_status',          TRUE, '20260926-0003-link-health', 'Server-side filter: view:n exkluderar rader med link_status=''broken'' från anon-klienter. NULL = okänd (visas).'),
  ('link_last_checked_at', TRUE, '20260926-0003-link-health', 'Operator: watchlist + supervisor-rapport visar när senaste HEAD-check kördes.')
ON CONFLICT (column_name) DO NOTHING;

-- ─── Verifiering direkt i migrationen ───────────────────────────────────────
-- Kör lockdown-funktionen och rapportera status. Kastar exception om FAIL.
DO $$
DECLARE
  r RECORD;
  v_failed INT := 0;
BEGIN
  RAISE NOTICE '=== events_public lockdown report (efter link_status) ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN
      v_failed := v_failed + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'events_public lockdown har % fail — migrationen är applicerad men lockdownen är bruten. Åtgärda INNAN app deploy.', v_failed;
  END IF;
  RAISE NOTICE '=== lockdown OK — link_status / link_last_checked_at exponerade på ett säkert sätt ===';
END $$;

COMMIT;