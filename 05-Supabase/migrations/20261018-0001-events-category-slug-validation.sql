-- 20261018-0001-events-category-slug-validation.sql
--
-- Lockdown: events.category_slug must be NULL or exist in categories.slug.
-- Prevents legacy slugs ('ovrigt', 'barn-familj', 'humor', 'dans', 'musikal',
-- 'standup', 'livepodd', 'festival', 'sport', 'theater' m.fl.) from being
-- written by any pipeline.
--
-- BAKGRUND (2026-10-18):
-- 388 events hade OGILTIGA category_slugs (ovrigt 183, barn-familj 91, humor 30,
-- dans 25, musikal 24, standup 15, festival 9, sport 7, livepodd 2, theater 2).
-- Deterministisk mappning applicerad via runtime/ovrigt-investigation/ — 0
-- events med ogiltig slug kvar. Denna constraint stänger dörren för att nya
-- legacy-slugs ska kunna skrivas in.
--
-- VARFÖR EN FUNKTION (inte CHECK med subquery):
-- Postgres CHECK-constraints kan inte innehålla subqueries direkt. Vi lindar
-- slugs-uppslaget i en STABLE helper-function. Funkionen är STABLE så Postgres
-- kan använda den i CHECK utan prestandaförlust.
--
-- LVN-NIVÅER:
--   - service_role SKYDDAS OCKSÅ (alla roller omfattas av CHECK). Om en
--     pipeline skickar legacy-slug via service_role-klient utan att gå genom
--     canonicalize-lagret → UPDATE/INSERT misslyckas med ett tydligt fel.
--   - 04-Normalizer/categoryCanonicalize.ts har utökats med Round 2-entries
--     (verifierade 2026-10-18) som mappar legacy → giltig. Pipelines som går
--     genom normalisern BÖR inte kunna skriva skräp.
--   - Om en adapter ändå emitterar legacy-slug fångas felet vid normalisern
--     (loggas som "[normalizer] canonicalized: X → Y") och hamnar på sikt
--     aldrig i DB.
--
-- SÄKERHETSASPEKTER:
--   - Constraints kan INTE inaktiveras per-row — det är binärt per tabell.
--   - Om vi någonsin behöver tillåta en tillfällig legacy-slug (t.ex. under
--     migration): ALTER TABLE events DROP CONSTRAINT events_category_slug_valid.
--   - För att köra legacy-skript för bakåtkompatibilitet: kör med
--     category_slug = NULL istället, eller använd canonicalize först.
--
-- IDEMPOTENCY:
--   - CREATE OR REPLACE FUNCTION: ersätter funktionsdefinitionen.
--   - ADD CONSTRAINT utan IF NOT EXISTS i Postgres <15. Vi använder DO-block
--     för säker multi-version-körning.
--
-- VERIFIERING (efter applicering):
--   SELECT conname, contype FROM pg_constraint
--    WHERE conrelid = 'events'::regclass AND conname = 'events_category_slug_valid';
--   -- Förväntat: 1 rad med contype='c' (check).

BEGIN;

-- ─── 1. Skapa/ersätt helper-function ─────────────────────────────────────────
-- STABLE: returnerar samma värde inom samma transaktion (categories ändras
-- inte under en transaktion, så STABLE är korrekt val — inte IMMUTABLE).

CREATE OR REPLACE FUNCTION is_valid_event_category_slug(p_slug TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_slug IS NULL OR EXISTS (SELECT 1 FROM categories WHERE slug = p_slug);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION is_valid_event_category_slug(TEXT) IS
  'Returnerar TRUE om p_slug är NULL eller finns som en giltig kategori. Används av CHECK constraint på events.category_slug.';

-- ─── 2. Lägg på CHECK-constraint (idempotent) ────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'events'::regclass
      AND conname  = 'events_category_slug_valid'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_category_slug_valid
      CHECK (is_valid_event_category_slug(category_slug));
    RAISE NOTICE '✓ events_category_slug_valid tillagt';
  ELSE
    RAISE NOTICE 'events_category_slug_valid finns redan — skippar';
  END IF;
END $$;

-- ─── 3. Verifiering (rapportera slutläge) ─────────────────────────────────────
DO $$
DECLARE
  v_total        BIGINT;
  v_null_count   BIGINT;
  v_invalid_now  BIGINT;
  v_invalid_dist TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM events;
  SELECT COUNT(*) INTO v_null_count FROM events WHERE category_slug IS NULL;

  -- Räkna events som eventuellt har legacy-slugs kvar (borde vara 0 efter städning).
  SELECT COUNT(*) INTO v_invalid_now
    FROM events e
    LEFT JOIN categories c ON c.slug = e.category_slug
   WHERE e.category_slug IS NOT NULL
     AND c.id IS NULL;

  RAISE NOTICE '=== events_category_slug_valid — slutrapport ===';
  RAISE NOTICE 'Total events:                      %', v_total;
  RAISE NOTICE 'Events med NULL category_slug:     %', v_null_count;
  RAISE NOTICE 'Events med ogiltig slug kvar:      % (borde vara 0)', v_invalid_now;
  IF v_invalid_now > 0 THEN
    RAISE WARNING 'Det finns % events med ogiltig slug — applicera först runtime/ovrigt-investigation/apply_mapping.ts', v_invalid_now;
  END IF;
END $$;

COMMIT;
