-- 20260930-0001-music-taxonomy-v3.sql
--
-- Stratifierade musikkategorier — Steg 2.5+ av MusicBrainz + Last.fm-planen
-- (se /Users/claudgashi/.claude/plans/soft-sprouting-taco.md).
--
-- Bakgrund (2026-09-30):
-- TagToCategory v2 utökar från 3 till 8 musik-buckets för att matcha
-- Last.fm:s crowdsourcade tag-kluster (Rodrigo y Gabriela → rock,
-- Anna Netrebko → opera, Berliner Philharmoniker → classical).
-- Slug `musical` döptes om till `musical-theatre` för att ta bort
-- semantik-kollisionen med musik som generell kategori.
--
-- Vad migrationen gör:
--   1. Lägger till 3 nya musik-slugs i categories-tabellen:
--        rock, pop, musical-theatre
--      (jazz, electronic, hip-hop, classical, opera fanns redan.)
--   2. Flyttar events från `musical` → `musical-theatre`
--      (~136 events, alla är Oscarsteatern-scrape eller liknande
--      genuina musikal-föreställningar).
--   3. Döper om categories-raden `musical` → `musical-theatre`.
--   4. Inga FK-uppdateringar behövs i event_categories eftersom
--      categories.id är oförändrad.
--
-- Vad migrationen INTE gör:
--   * Rör inte `pop-rock` (sammanslagen legacy-slug, lämnas kvar).
--   * Rör inte `metal`, `world-folk` (legacy-subgenres, lämnas kvar).
--   * Rör inte deprecated `music`-slug (2368 events) — retag-pipelinen
--     (_retag-batch-v3.ts) får ny chans att klassificera dem när den
--     uppdaterade tagToCategory.ts plockar dem upp.
--   * Rör inte title_sv / title_en / description_sv / venue_id / start_time.

BEGIN;

-- ─── 1. Lägg till 3 nya musik-slugs (idempotent) ───────────────────────────
-- sort_order efter befintliga musik-slugs (107 = musical).
-- Vi lägger de nya i 108–110 så de sorteras rätt i Utforska.

INSERT INTO categories (slug, name_sv, name_en, sort_order) VALUES
  ('rock',             'Rock',             'Rock',             108),
  ('pop',              'Pop',              'Pop',              109),
  ('musical-theatre',  'Musikal',          'Musical-theatre',  110)
ON CONFLICT (slug) DO NOTHING;

-- ─── 2. Migrera events: musical → musical-theatre ──────────────────────────
-- Idempotent: om inga events har 'musical' är detta no-op.

UPDATE events
SET category_slug = 'musical-theatre'
WHERE category_slug = 'musical';

-- ─── 3. Migrera event_categories M:M-join ───────────────────────────────────
-- Samma categories.id-flytt behövs om det finns event_categories-rader
-- som pekar på den categories-rad som heter 'musical'.
-- Vi byter FK-pekare från 'musical'-row till 'musical-theatre'-row.

UPDATE event_categories ec
SET category_id = (SELECT id FROM categories WHERE slug = 'musical-theatre' LIMIT 1)
WHERE category_id = (SELECT id FROM categories WHERE slug = 'musical' LIMIT 1)
  AND EXISTS (SELECT 1 FROM categories WHERE slug = 'musical-theatre');

-- ─── 4. Döp om categories-raden 'musical' → 'musical-theatre' ───────────────
-- Detta gör att categories-tabellen inte har två rader (gammal 'musical'
-- + ny 'musical-theatre') efter migreringen. Behåller samma id → alla
-- befintliga FK-referenser (utöver de vi redan uppdaterade i steg 3)
-- pekar fortsatt rätt.

UPDATE categories
SET slug = 'musical-theatre',
    name_en = 'Musical-theatre'
WHERE slug = 'musical';

-- ─── 5. Verifiering ────────────────────────────────────────────────────────

DO $$
DECLARE
  v_musical_events INT := 0;
  v_theatre_events INT := 0;
  v_old_cat INT := 0;
  v_new_cat INT := 0;
  v_dup INT := 0;
BEGIN
  -- Inga events ska ha 'musical' kvar
  SELECT COUNT(*) INTO v_musical_events
  FROM events WHERE category_slug = 'musical';

  IF v_musical_events > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % events har kvar category_slug=musical', v_musical_events;
  END IF;

  -- musical-theatre ska ha events (gamla 'musical'-events flyttade hit)
  SELECT COUNT(*) INTO v_theatre_events
  FROM events WHERE category_slug = 'musical-theatre';

  IF v_theatre_events = 0 THEN
    RAISE WARNING 'Inga events med category_slug=musical-theatre efter migrering (kan vara OK om inga musicals fanns).';
  END IF;

  -- categories-tabellen ska inte ha 'musical' kvar
  SELECT COUNT(*) INTO v_old_cat
  FROM categories WHERE slug = 'musical';

  IF v_old_cat > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: categories-tabellen har kvar slug=musical';
  END IF;

  -- musical-theatre ska finnas i categories
  SELECT COUNT(*) INTO v_new_cat
  FROM categories WHERE slug = 'musical-theatre';

  IF v_new_cat = 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: musical-theatre saknas i categories-tabellen';
  END IF;

  -- Inga duplicates i event_categories efter flytten
  SELECT COUNT(*) INTO v_dup
  FROM (
    SELECT event_id, category_id, COUNT(*) c
    FROM event_categories
    GROUP BY event_id, category_id
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % duplicerade event_categories-rader', v_dup;
  END IF;

  RAISE NOTICE '=== music-taxonomy-v3 (2026-09-30) ===';
  RAISE NOTICE 'events musical → musical-theatre: %', v_theatre_events;
  RAISE NOTICE 'categories slug musical borttagen, musical-theatre aktiv';
  RAISE NOTICE '3 nya slugs tillagda: rock, pop, musical-theatre';
  RAISE NOTICE '========================================';
END $$;

COMMIT;
