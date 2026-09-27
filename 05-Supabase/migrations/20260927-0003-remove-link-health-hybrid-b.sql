-- 20260927-0003-remove-link-health-hybrid-b.sql
--
-- Smartare link-health: tar bort Hybrid B, byter till tre stater (live/dead/unknown).
--
-- Bakgrund (2026-09-27): användaren körde HEAD-check på 1 676 events som var
-- individuellt markerade broken OCH på 2 090 events som gömdes av Hybrid B
-- ("någon annan event i samma källa cf≥2"). Resultat:
--   - Individuellt broken: 212 (12.6%) hade faktiskt fungerande URL:er
--     (alla passerade start_time, så ingen effekt på appen ändå).
--   - Hybrid B-dolda: 1 194 (57.1%) hade fungerande URL:er — 1 088 av dem
--     var framtida events som borde visas i UI. Största källor: sthlmlist
--     (945), spelning-se (158), debaser (54).
--
-- Hybrid B-regeln var tänkt som "transparens" — visa aldrig en källa som
-- inte är helt frisk. Verkligheten blev att den gömde tusentals fungerande
-- events från de fyra dominerande källorna bara för att en enda event
-- bland hundratals cf-failades 2+ dagar i rad.
--
-- Användarens direktiv: tre terminala stater istället för Hybrid B.
--   live    = URL svarade 2xx/3xx (HEAD/GET/SB) och body innehåller inte
--             REMOVED_PATTERN.
--   dead    = 404/410, ELLER 2xx + REMOVED_PATTERN (soft 404), ELLER
--             upprepade 5xx server-fel.
--   unknown = HEAD + GET-Range + ScrapingBee kunde inte avgöra (blockerad,
--             timeout, anti-bot som inte ens SB tar sig förbi).
--   NULL    = aldrig kontrollerad (synlig i UI som default).
--
-- Designval:
--   - Vyn återgår till 0003-logiken: enbart enskilda dead events döljs
--     (link_status IS DISTINCT FROM 'dead'). Käll-taint-regeln borta.
--   - CHECK-constraint utökas till 'live' | 'dead' | 'unknown' (NULL kvar).
--   - RPC update_link_health_cf utökas: 'unknown' lämnar cf oförändrat
--     och rensar first_broken_at (streaken är irrelevant om vi inte vet).
--   - Befintliga rader konverteras: 'ok' → 'live', 'broken' → 'dead'.
--
-- Konsekvens för 1 088 framtida events:
--   - Direkt synliga i events_public så fort migrationen körts.
--   - Inga andra kodändringar behövs — UI/app läser vyn, som nu visar dem.
--
-- GDPR/lockdown:
--   Inga kolumner ändras (cf/first_broken_at kvar). Inga GRANT ändras.
--   events_public_expected_columns förblir validerad.
--
-- Idempotency:
--   UPDATE WHERE link_status='ok'/'broken' är naturally idempotent (matchar
--   inte längre efter första körningen).
--   DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT — körs säkert.
--   CREATE OR REPLACE FUNCTION/VIEW — ersätter atomiskt.
--
-- Rollback:
--   Återkör 20260926-0004-link-health-hybrid.sql (återställer Hybrid B-klausulen).
--   Konvertera 'live'/'dead' tillbaka till 'ok'/'broken' om detta körs i prod.

-- ─── CHECK-constraint uppdateras FÖRST — NOT VALID för att inte validera
-- befintliga 'ok'/'broken'-rader (de konverteras i nästa steg).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_link_status_check;
ALTER TABLE events ADD CONSTRAINT events_link_status_check
  CHECK (link_status IS NULL OR link_status IN ('live', 'dead', 'unknown'))
  NOT VALID;

-- ─── Datakonvertering: 'ok' → 'live', 'broken' → 'dead' ─────────────────────
UPDATE events SET link_status = 'live' WHERE link_status = 'ok';
UPDATE events SET link_status = 'dead' WHERE link_status = 'broken';

-- ─── Validera constraint mot de nu-konverterade raderna (snabb FT-scan) ────
ALTER TABLE events VALIDATE CONSTRAINT events_link_status_check;

-- ─── RPC uppdateras: 'live' | 'dead' | 'unknown', 'unknown' nollställer streaken ─
-- 'unknown' betyder "vi vet inte" — varken cf++ eller cf=0. Men streaken
-- (first_broken_at) ska rensas så att quarantine_trigger inte fastnar på
-- gamla streaker. cf-räknaren lämnas oförändrad så nästa HEAD-check kan
-- fortsätta räkna om status visar sig vara 'dead'.
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
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION update_link_health_cf(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;

-- ─── Uppdatera events_public-vyn — Hybrid B borttagen ─────────────────────
-- Behåller per-event filter: bara dead events döljs.
-- NULL (okontrollerade) och 'live'/'unknown' synliga.
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
  -- 20260927-0003: bara enskilda dead events döljs (IS DISTINCT FROM håller
  -- NULL och 'unknown' synliga). Hybrid B (cf≥2 → dölj källa) BORTTAGEN.
  AND (e.link_status IS DISTINCT FROM 'dead');

GRANT SELECT ON events_public TO anon, authenticated;

-- ─── Verifiering ──────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  v_failed INT := 0;
BEGIN
  RAISE NOTICE '=== events_public lockdown report (efter smartare link-health, 3 stater) ===';
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '[%] % — %', r.status, r.check_name, r.detail;
    IF r.status = 'FAIL' THEN
      v_failed := v_failed + 1;
    END IF;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'events_public lockdown har % fail — migrationen applicerad men lockdownen bruten. Åtgärda INNAN deploy.', v_failed;
  END IF;
  RAISE NOTICE '=== lockdown OK — tre stater live/dead/unknown aktiva, Hybrid B borta ===';
END $$;

COMMIT;
