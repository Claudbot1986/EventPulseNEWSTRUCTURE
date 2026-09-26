-- 20260926-0004-link-health-hybrid.sql
--
-- Hybrid B (per-källa-filter med 2-dagars grace) — utökar 0003.
--
-- Bakgrund (2026-09-26): v2 (0003) doljer enskilda broken events. Användaren
-- vill ha STRICTARE: om en källa har en bruten länk ska HELA källan försvinna
-- från UI och alla events från källan in i reparationsprogrammet. Ren per-
-- källa-direkt (v3) ratades av både riskanalys (10 risker) och Jev
-- (score 1.13/10; choice = hybrid med 0.92 confidence). Hybrid B = per-källa
-- filter men först efter 2 dagars consecutive broken.
--
-- Designval:
--   consecutive_broken_count INT NOT NULL DEFAULT 0
--     Räknare som inkrementeras per dag huvudkvarteren HEAD:ar som 'broken'.
--     Nollställs vid 'ok'. Om cf>=2 → källan anses strukturellt trasig.
--   first_broken_at TIMESTAMPTZ
--     När den nuvarande broken-streaken startade. NULL = eventet är ok/nytt.
--     Sätts vid första transitionen ok→broken; rensas vid broken→ok.
--
-- View-filter (utökar 0003):
--   0003 doljer broken events (per-event).
--   0004 lägger till: om någon event cf>=2 → dölj ALLA events från samma källa.
--   Resultat:
--     cf<2:  bara 0003-filtret (enskilda broken events dolda, source synlig).
--     cf>=2: 0004-filtret tar över (hela källan dold).
--
-- Reparationsprogram (cross-domain):
--   När cf just korsat 2 → quarantine_trigger.ts skickar källan till
--   02-Ingestion/C-htmlGate/manual-review/pending.jsonl. Operatör/granskning
--   löser via befintligt flöde. När cf återgår till 0 (HEAD:ar som 'ok')
--   öppnas källan automatiskt av view-filtret — inget manuellt steg krävs.
--
-- GDPR/lockdown:
--   cf-kolumner är server-interna. events_public lägger dem INTE till i
--   SELECT-listan; kolumnerna exponeras aldrig för anon-klienter.
--   Ingen uppdatering behövs av events_public_expected_columns.
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS DEFAULT 0 → bakåtkompatibelt.
--   CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE VIEW / OR REPLACE FUNCTION.
--   GRANT EXECUTE ON FUNCTION (idempotent).
--
-- Rollback:
--   DROP FUNCTION update_link_health_cf(UUID, TEXT, TIMESTAMPTZ);
--   DROP INDEX IF EXISTS idx_events_cf_threshold;
--   ALTER TABLE events DROP COLUMN first_broken_at;
--   ALTER TABLE events DROP COLUMN consecutive_broken_count;
--   (view-recreate måste återställas manuellt med 0003-versionen)

BEGIN;

-- ─── Tabelländring ──────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS consecutive_broken_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_broken_at TIMESTAMPTZ;

-- ─── Index för quarantine_trigger-frågan ────────────────────────────────────
-- Partial: bara published+broken (det enda tillstånd där cf>=2 är möjligt).
-- Composite (source, cf, first_broken_at) så "korsade tröskeln idag" är O(1).
CREATE INDEX IF NOT EXISTS idx_events_cf_threshold
  ON events (source, consecutive_broken_count, first_broken_at)
  WHERE status = 'published' AND link_status = 'broken';

-- ─── RPC: atomär cf-uppdatering vid daglig HEAD-check ─────────────────────
-- check_link_health.ts anropar denna istället för direkt UPDATE för att
-- kringgå Supabase-klientens CASE-begränsningar. Atomisk single-statement —
-- concurrent HEAD:s mot samma event-id ger deterministiskt resultat.
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
      WHEN p_new_status = 'broken' THEN consecutive_broken_count + 1
      ELSE 0
    END,
    first_broken_at = CASE
      WHEN p_new_status = 'broken' AND first_broken_at IS NULL THEN p_checked_at
      WHEN p_new_status = 'ok' THEN NULL
      ELSE first_broken_at
    END
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION update_link_health_cf(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;

-- ─── Uppdatera events_public-vyn — Hybrid B-filter ─────────────────────────
-- Samma kolumner som 0003. WHERE utökas med ett NOT EXISTS: om någon event
-- i samma källa har cf>=2 → dölj ALLA events från källan.
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
  -- 20260926-0003: bekräftat trasiga events syns inte ensamma.
  AND (e.link_status IS DISTINCT FROM 'broken')
  -- 20260926-0004 (Hybrid B): om NÅGON event i källan cf>=2 → hela källan
  -- döljs. Exkluderar source från UI tills cf återgår till 0 (HEAD:ar som
  -- 'ok') eller operatören löser via reparationsprogrammet. NULL-kolumner
  -- (ännu ej HEAD-checkade) räknas inte som broken — källan förblir synlig.
  AND NOT EXISTS (
    SELECT 1 FROM events e2
    WHERE e2.source = e.source
      AND e2.status = 'published'
      AND e2.link_status = 'broken'
      AND e2.consecutive_broken_count >= 2
  );

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Verifiering (samma mönster som 0003) ─────────────────────────────────
DO $$
DECLARE
  r RECORD;
  v_failed INT := 0;
BEGIN
  RAISE NOTICE '=== events_public lockdown report (efter cf-filter, 0004) ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN
      v_failed := v_failed + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'events_public lockdown har % fail — migrationen applicerad men lockdownen bruten. Åtgärda INNAN deploy.', v_failed;
  END IF;
  RAISE NOTICE '=== lockdown OK — Hybrid-B cf-filter aktivt ===';
END $$;

COMMIT;
