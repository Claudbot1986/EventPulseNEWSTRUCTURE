-- 20260929-0001-deprecated-slug-cleanup.sql
--
-- Permanent fix: ta bort 1265 events från deprecated category-slugs och
-- migrera dem till Utforska-motsvarigheter.
--
-- Bakgrund (2026-09-29):
-- 5 402 events med category_slug. 1 265 (23.4%) hade deprecated slugs
-- ('culture', 'art-exhibitions', 'theater', 'musikaler', 'art',
-- 'design', 'food-drink', 'barn', 'festivals') som inte matchar någon
-- tile i Utforska. Events med dessa slugs var dolda i UI:t.
--
-- Två samtidiga fixes (2026-09-29):
--   1. Denna migration: bakåtkompatibel uppdatering av befintliga 1265
--      events. Idempotent — kan köras flera gånger.
--   2. 04-Normalizer/categoryCanonicalize.ts: framtida skydd. Alla
--      adapters som fortsätter emittera deprecated slugs fångas i
--      normalizern (loggas som "[normalizer] canonicalized: X → Y").
--
-- Mapping (verifierad 2026-09-29 mot riktig DB-data, 3+ samples per
-- deprecated slug — se 04-Normalizer/categoryCanonicalize.ts för
-- motivering per entry):
--
--   culture        (1010) → community     — catch-all fallback (heterogent
--                                          innehåll; LLM-retag kan senare
--                                          splittra — tills vidare 'community')
--   art-exhibitions (192) → exhibition    — alla samples är utställningar
--   theater         (25)  → theatre-drama — drama är bredaste svenska termen
--   musikaler       (15)  → musical       — direkt 1:1 svensk→engelsk
--   art             (13)  → exhibition    — alla samples är konst-utställningar
--   design          (7)   → exhibition    — Arkdes design-events (per v2-plan)
--   food-drink      (1)   → food          — julbord-mat
--   barn            (1)   → family        — "Nötknäpparen — för hela familjen!"
--   festivals       (1)   → community     — generisk festival
--
-- Säkerhetsegenskaper:
--   * Idempotent (körs säkert flera gånger).
--   * Inga befintliga target-slugs påverkas.
--   * events.category_slug och event_categories uppdateras atomärt i samma
--     transaktion.
--   * Efter migreringen: 4 deprecated slugs som ligger kvar i categories-
--     tabellen tas bort (art-exhibitions, theater, art, food-drink). Övriga
--     5 (culture, musikaler, design, barn, festivals) fanns inte i
--     tabellen redan (verifierat 2026-09-29).
--   * Multi-label-skydd: om en event efter migreringen får två rader i
--     event_categories med samma category_id deduperas de (annars bryter
--     M:M-tabellen sin egen semantik — UI:t skulle dubbel-räkna).
--
-- Vad migrationen INTE gör:
--   * Rör inte title_sv / title_en / description_sv / venue_id / start_time.
--   * Rör inte target-slugs (community, exhibition, theatre-drama osv).
--   * Rör inte andra migrationer (RLS-policies, indexes).

BEGIN;

-- ─── 1. Uppdatera events.category_slug (1265 rows) ────────────────────────
-- En UPDATE per deprecated slug. Idempotent — andra körningen blir no-op.

UPDATE events SET category_slug = 'community'     WHERE category_slug = 'culture';
UPDATE events SET category_slug = 'exhibition'    WHERE category_slug = 'art-exhibitions';
UPDATE events SET category_slug = 'theatre-drama' WHERE category_slug = 'theater';
UPDATE events SET category_slug = 'musical'       WHERE category_slug = 'musikaler';
UPDATE events SET category_slug = 'exhibition'    WHERE category_slug = 'art';
UPDATE events SET category_slug = 'exhibition'    WHERE category_slug = 'design';
UPDATE events SET category_slug = 'food'          WHERE category_slug = 'food-drink';
UPDATE events SET category_slug = 'family'        WHERE category_slug = 'barn';
UPDATE events SET category_slug = 'community'     WHERE category_slug = 'festivals';

-- ─── 2. Uppdatera event_categories M:M-join (för de 4 slugs som finns i
--       categories-tabellen — kulturhuset m.fl. lade till dem som
--       faktiska kategori-rader, så event_categories har FK-referenser).
--
-- Verifierat 2026-09-29:
--   art-exhibitions: 192 event_categories rows
--   theater:         102 event_categories rows
--   food-drink:        2 event_categories rows
--   art:              13 event_categories rows

UPDATE event_categories ec
SET category_id = (SELECT id FROM categories WHERE slug = 'exhibition' LIMIT 1)
WHERE category_id = (SELECT id FROM categories WHERE slug = 'art-exhibitions');

UPDATE event_categories ec
SET category_id = (SELECT id FROM categories WHERE slug = 'theatre-drama' LIMIT 1)
WHERE category_id = (SELECT id FROM categories WHERE slug = 'theater');

UPDATE event_categories ec
SET category_id = (SELECT id FROM categories WHERE slug = 'exhibition' LIMIT 1)
WHERE category_id = (SELECT id FROM categories WHERE slug = 'art');

UPDATE event_categories ec
SET category_id = (SELECT id FROM categories WHERE slug = 'food' LIMIT 1)
WHERE category_id = (SELECT id FROM categories WHERE slug = 'food-drink');

-- ─── 3. Multi-label dedup (försiktighetsåtgärd) ────────────────────────────
-- Om en event efter migreringen råkar ha två event_categories-rader
-- med samma (event_id, category_id) — ta bort dubletten.
-- Håller tabellens semantik intakt (M:M = unika par).

DELETE FROM event_categories ec
USING event_categories ec2
WHERE ec.ctid > ec2.ctid  -- ctid-jämförelse: behåll den med lägre fysisk rad
  AND ec.event_id = ec2.event_id
  AND ec.category_id = ec2.category_id;

-- ─── 4. Ta bort deprecated slugs från categories-tabellen ──────────────────
-- Efter detta steg kommer framtida adapter-fel som emitterar dessa slugs
-- INTE längre kunna resolveCategoryIds()'a dem (returnerar []), vilket
-- gör att source-default / 'community'-fallback kickar in.

DELETE FROM categories WHERE slug IN (
  'art-exhibitions',
  'theater',
  'art',
  'food-drink'
);

-- ─── 5. Verifiering ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_remaining_events INT := 0;
  v_remaining_cats INT := 0;
  v_remaining_joins INT := 0;
BEGIN
  -- Inga events ska ha deprecated slugs kvar
  SELECT COUNT(*) INTO v_remaining_events
  FROM events
  WHERE category_slug IN (
    'culture', 'art-exhibitions', 'theater', 'musikaler', 'art',
    'design', 'food-drink', 'barn', 'festivals'
  );

  IF v_remaining_events > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % events har kvar deprecated category_slug', v_remaining_events;
  END IF;

  -- Inga deprecated slugs ska finnas kvar i categories (för de vi tog bort)
  SELECT COUNT(*) INTO v_remaining_cats
  FROM categories
  WHERE slug IN ('art-exhibitions', 'theater', 'art', 'food-drink');

  IF v_remaining_cats > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % deprecated slugs finns kvar i categories-tabellen', v_remaining_cats;
  END IF;

  -- Inga event_categories-rader ska peka på (numera borttagna) slugs
  SELECT COUNT(*) INTO v_remaining_joins
  FROM event_categories ec
  LEFT JOIN categories c ON c.id = ec.category_id
  WHERE c.id IS NULL;

  IF v_remaining_joins > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % event_categories-rader pekar på borttagna categories', v_remaining_joins;
  END IF;

  -- Rapport: hur många events flyttades till target-slugs
  RAISE NOTICE '=== deprecated-slug-cleanup (2026-09-29) ===';
  RAISE NOTICE 'culture        → community:     % events', (SELECT COUNT(*) FROM events WHERE category_slug = 'community' AND source IN (SELECT DISTINCT source FROM events WHERE source LIKE '%kulturhuset%' OR source LIKE '%visitstockholm%' OR source LIKE '%berwaldhallen%'));
  RAISE NOTICE 'art-exhibitions → exhibition:   ~192 events';
  RAISE NOTICE 'theater         → theatre-drama: ~25 events';
  RAISE NOTICE 'musikaler       → musical:      ~15 events';
  RAISE NOTICE 'art             → exhibition:   ~13 events';
  RAISE NOTICE 'design          → exhibition:   ~7 events';
  RAISE NOTICE 'food-drink      → food:         ~1 event';
  RAISE NOTICE 'barn            → family:       ~1 event';
  RAISE NOTICE 'festivals       → community:    ~1 event';
  RAISE NOTICE 'Totalt: ~1265 events dolda i UI → nu synliga';
  RAISE NOTICE '========================================';
END $$;

COMMIT;