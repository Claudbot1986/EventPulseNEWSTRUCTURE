-- T0201 — Description rights + EventPulse fact-based summary
-- Datum: 2026-10-05
-- Klass: additiv schema-ändring (NULL defaults, ingen DROP/ALTER på befintliga
--        kolumner; säker att applicera på live DB utan onödig risk).
--
-- BAKGRUND (vault 02-Operations/19-Decision-Log.md, 2026-10-05):
--   Användaren beslutade att separera "källans text vi förstår" från "text vi får
--   visa publikt". Tidigare exponerades `events_public.description_en/sv` rakt av
--   till anon REST och UI utan rättighetskontroll. Det innebar att scraped källa-
--   text (marknadsföring, slogans) potentiellt återpublicerades automatiskt.
--
--   Mål:
--     1. Lagra källbeskrivningen separat (raw_description) med 30-dagars retention.
--     2. Klassificera rättighetsstatus per event (description_license enum).
--     3. Generera en faktabaserad, deterministisk `eventpulse_summary` från
--        normaliserade fält (Faktaextraktion + template).
--     4. Exponera ENDAST `eventpulse_summary` (eller license-tillåten
--        description_en/sv) via `events_public` view — aldrig scraped text
--        automatiskt.
--
-- SÄKERHETSREGLER:
--   - Allt är NULL-default; befintliga rader orörda.
--   - description_license CHECK constraint lik image_license-mönstret (T0052).
--   - raw_description sätts endast av `04-Normalizer` vid insert/update; UI
--     och agenter läser aldrig den.
--   - events_public view uppdateras i separat migration EFTER att denna
--     applicerats och `04-Normalizer`-skrivningen verifierats — det ger en
--     rollback-vänlig två-stegs-rullning.

BEGIN;

-- ─── 1. description_license ─────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description_license TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_description_license_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_description_license_check
      CHECK (description_license IS NULL OR description_license IN (
        'pressbild',                  -- svensk upphovsrätt räcker för redaktionellt bruk
        'copyright-with-attribution', -- API ToS kräver attribution
        'partner-licensed',           -- framtida partners uttryckligen ger rätt
        'public-domain',              -- Wikimedia, CC0, etc.
        'unknown'                     -- default; aldrig publikt utan vidare
      ));
  END IF;
END $$;

-- ─── 2. description_attribution ─────────────────────────────────────────────
-- Fri formattering ("Photo: Billetto"-stil, fast för text). NULL om ej behövs.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description_attribution TEXT;

-- ─── 3. description_source_url ──────────────────────────────────────────────
-- URL till källans description-sida (eller original description-location).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description_source_url TEXT;

-- ─── 4. raw_description ──────────────────────────────────────────────────────
-- Källans original-text. ENDAST för internt bruk (reprocessing, debugging,
-- faktakonfirmering). Aldrig i UI. Nattlig retention-worker rensar efter 30 dagar.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS raw_description TEXT;

-- ─── 5. raw_description_captured_at ─────────────────────────────────────────
-- Tidsstämpel för när raw_description skrevs. Används av retention-worker
-- (`now() - raw_description_captured_at > interval '30 days'` → rensa).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS raw_description_captured_at TIMESTAMPTZ;

-- ─── 6. eventpulse_summary ─────────────────────────────────────────────────
-- Faktabaserad, deterministisk sammanfattning. Byggs av
-- `04-Normalizer/eventpulseSummary.ts` via template per event-typ.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eventpulse_summary TEXT;

-- ─── 7. eventpulse_summary_facts ────────────────────────────────────────────
-- JSONB med extraherade fakta. Exempel:
--   {
--     "event_type": "concert",
--     "artist": "Artist X",
--     "support_act": null,
--     "venue": "Avicii Arena",
--     "city": "Stockholm",
--     "date": "2026-11-14",
--     "doors_time": "18:30",
--     "start_time": "19:30",
--     "age_limit": "18",
--     "language": "sv",
--     "price_min_sek": 450,
--     "is_free": false,
--     "accessibility": null,
--     "organizer": null
--   }
-- Fält som inte kunde extraheras → null. Hitta på.ingen är en hård regel
-- (CLAUDE.md "No fake data").
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eventpulse_summary_facts JSONB;

-- ─── 8. eventpulse_summary_provenance ───────────────────────────────────────
-- JSONB som mappar faktumnyckel → käll-URL eller source-namn.
-- Exempel: { "doors_time": "venue_page", "age_limit": "ticket_page" }
-- Används för att kunna svara på "varför tror vi det här?" i framtiden.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eventpulse_summary_provenance JSONB;

-- ─── 9. eventpulse_summary_generated_at ─────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eventpulse_summary_generated_at TIMESTAMPTZ;

-- ─── 10. eventpulse_summary_model ───────────────────────────────────────────
-- Vilken template-generator som körts (deterministisk: 'deterministic-v1').
-- Mönster från image_license-fältet (T0052) + event_translations.model.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS eventpulse_summary_model TEXT;

-- ─── Index för retention-worker (30-dagars scan) ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_raw_description_retention
  ON events (raw_description_captured_at)
  WHERE raw_description IS NOT NULL;

-- ─── Index för "events med summary" (UI/feed-filter) ────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_eventpulse_summary_present
  ON events (eventpulse_summary_generated_at DESC)
  WHERE eventpulse_summary IS NOT NULL;

-- ─── Audit-rad ──────────────────────────────────────────────────────────────
COMMENT ON COLUMN events.description_license IS
  'Rättighetsstatus för description_en/sv (T0201, 2026-10-05). Default unknown; UI visar description_en/sv ENDAST om license är pressbild|copyright-with-attribution|partner-licensed|public-domain. Mönster från image_license (T0052).';

COMMENT ON COLUMN events.description_attribution IS
  'Attribution-sträng för description. Visas i UI endast när description_license IN {copyright-with-attribution, partner-licensed, cc-by}.';

COMMENT ON COLUMN events.description_source_url IS
  'URL till källans description-sida. Används av re-extraktion och provenance.';

COMMENT ON COLUMN events.raw_description IS
  'Källans original-text för description. ENDAST för internt bruk; rensas efter 30 dagar av nattlig retention-worker. Aldrig i events_public view. (T0201)';

COMMENT ON COLUMN events.raw_description_captured_at IS
  'Tidsstämpel för raw_description-skrivning. Retention-worker använder (now() - captured_at > 30d) som rens-villkor.';

COMMENT ON COLUMN events.eventpulse_summary IS
  'Faktabaserad, deterministisk EventPulse-sammanfattning. Byggs av eventpulseSummary.ts från extraherade fakta. Synlig i UI primärt; UI visar ALDRIG scraped description utan description_license-tillstånd. (T0201)';

COMMENT ON COLUMN events.eventpulse_summary_facts IS
  'Extraherade fakta som byggde eventpulse_summary. Fält som ej kunde verifieras → null. Hittar-på-ingen är hård regel.';

COMMENT ON COLUMN events.eventpulse_summary_provenance IS
  'Provenance per faktumnyckel: {fact_key: source_url|source_name}. För framtida "varför tror vi det här?"-förklaringar.';

COMMENT ON COLUMN events.eventpulse_summary_model IS
  'Template-generator version (t.ex. deterministic-v1).';

COMMIT;