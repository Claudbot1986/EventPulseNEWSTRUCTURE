-- 20261029-0001-normalize-legacy-category-slugs.sql
--
-- Städar 1026 events med legacy-/käll-taxonomi-slugs och LÄGGER PÅ den
-- CHECK-constraint som migration 20261018-0001 aldrig applicerade.
--
-- BAKGRUND (2026-10-29):
-- 20261018-0001-events-category-slug-validation.sql definierar
-- is_valid_event_category_slug() + CHECK-constrainten events_category_slug_valid
-- på events.category_slug. Verifierat i live-DB: varken funktionen eller
-- constrainten fanns. Därför har källornas egna kategoritaxonomier skrivits
-- rakt in i DB sedan 2026-10-18:
--
--   cinema (72, Zita), concert (63, Nalen), Utställning (17, Waldemarsudde),
--   exhibitions (10), musical (10, China Teatern), hip-hop (5), Konsert (3),
--   sports & wellbeing (3), stage & film (3), guided tours & lectures (2),
--   Musik på Historiska (2), Barn och familj (1), Föreläsning (1), Lov (1),
--   networking & community (1), Temavisning (1)
--   samt 831 events med category_slug IS NULL.
--
-- Konsekvens: 43 kategorier i stället för 27. Varje enstaka legacy-slug
-- krävde sin egen uppsättning bilder (kvotformeln ger minst 20 per kategori),
-- vilket gjorde kvotskriptet räkna fram 799 nya bilder varav ~289 gick till
-- engångskategorier som bara hade några events. Efter städning: 510 bilder.
--
-- Mapping (verifierad 2026-10-29 mot riktig DB-data, 3+ samples per slug —
-- se 04-Normalizer/categoryCanonicalize.ts Round 3 för motivering per entry):
--
--   cinema                  (72) → film            — 72/72 Zita-filmvisningar
--   concert                 (63) → music           — 63/63 Nalen-konserter
--   Konsert                 (3)  → music           — språkvariant
--   Utställning             (17) → exhibition      — språkvariant (Waldemarsudde)
--   exhibitions             (10) → exhibition      — pluralform
--   Temavisning             (1)  → exhibition      — guidad visning på museum
--   musical                 (10) → musical-theatre — 10/10 China Teatern
--   sports & wellbeing      (3)  → sports          — sport/upplevelser
--   stage & film            (3)  → theatre-drama   — samma resonemang som 'theater'
--   guided tours & lectures (2)  → talks-lectures  — bokklubb/city walk
--   Föreläsning             (1)  → talks-lectures  — språkvariant
--   Musik på Historiska     (2)  → classical       — kammarmusik på Historiska
--   Barn och familj         (1)  → kids            — svensk variant av 'barn-familj'
--   Lov                     (1)  → family          — lovaktivitet för familjen
--   networking & community  (1)  → community       — community-format
--   hip-hop                 (5)  → community       — 5/5 felmärkta (se TS-filen)
--   NULL                    (831) → community      — normalizerns fallback
--
-- MÄLLSLAG: inga legacy-slugs eller NULLar ska finnas kvar, och VARJE
-- category_slug i events ska finnas i categories-tabellen.
--
-- Säkerhetsegenskaper:
--   * Idempotent (körs säkert flera gånger).
--   * Rör INTE title/description/venue/start_time eller någon annan kolumn.
--   * Rör INTE giltiga slugs (community, music, exhibition, ...).
--   * events.category_slug och event_categories uppdateras atomärt.
--   * Multi-label-skydd: dubbletter i event_categories dedupliceras.
--   * image_library.category_slug rörs inte (verifierat 2026-10-29: inga
--     legacy-slugs finns där — biblioteket är redan rent).
--   * 'hip-hop' LÄMNAS kvar i categories-tabellen (legitim framtida genre-kategori,
--     0 events efter städningen — samma status som 'comedy'/'metal'/'pop-rock').
--
-- Vad migrationen INTE gör:
--   * Rör inte image_library eller Storage (bilderna är separata blockerare).
--   * Rör inte andra migrationer (RLS-policies, indexes).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. events.category_slug — städa legacy-slugs
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE events SET category_slug = 'film'            WHERE category_slug = 'cinema';
UPDATE events SET category_slug = 'music'           WHERE category_slug = 'concert';
UPDATE events SET category_slug = 'music'           WHERE category_slug = 'Konsert';
UPDATE events SET category_slug = 'exhibition'      WHERE category_slug = 'Utställning';
UPDATE events SET category_slug = 'exhibition'      WHERE category_slug = 'exhibitions';
UPDATE events SET category_slug = 'exhibition'      WHERE category_slug = 'Temavisning';
UPDATE events SET category_slug = 'musical-theatre' WHERE category_slug = 'musical';
UPDATE events SET category_slug = 'sports'          WHERE category_slug = 'sports & wellbeing';
UPDATE events SET category_slug = 'theatre-drama'   WHERE category_slug = 'stage & film';
UPDATE events SET category_slug = 'talks-lectures'  WHERE category_slug = 'guided tours & lectures';
UPDATE events SET category_slug = 'talks-lectures'  WHERE category_slug = 'Föreläsning';
UPDATE events SET category_slug = 'classical'       WHERE category_slug = 'Musik på Historiska';
UPDATE events SET category_slug = 'kids'            WHERE category_slug = 'Barn och familj';
UPDATE events SET category_slug = 'family'          WHERE category_slug = 'Lov';
UPDATE events SET category_slug = 'community'       WHERE category_slug = 'networking & community';
UPDATE events SET category_slug = 'community'       WHERE category_slug = 'hip-hop';

-- NULL → 'community'. Detta är EXAKT normalizerns dokumenterade fallback
-- (normalizer.ts: categories[0] ?? mbResolvedCategory ?? sourceDefaultSlug
-- ?? 'community'). NULL betyder "rad från innan fallbacken fanns".
UPDATE events SET category_slug = 'community'       WHERE category_slug IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. event_categories — peka om join-rader från legacy-slugs
-- ═══════════════════════════════════════════════════════════════════════════
-- Verifierat 2026-10-29: 0 event_categories-rader pekade på någon av de
-- legacy-slugs (alla legacy-events saknade M:M-rad). nedan är därför en
-- no-op idag, men skyddar om en framtida adapter-skrivning hunnit skapa
-- sådana rader. 'hip-hop' är den enda legacy-slug som fanns i categories.

UPDATE event_categories ec
SET category_id = (SELECT id FROM categories WHERE slug = 'community' LIMIT 1)
WHERE category_id = (SELECT id FROM categories WHERE slug = 'hip-hop' LIMIT 1);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Multi-label dedup (försiktighetsåtgärd)
-- ═══════════════════════════════════════════════════════════════════════════
-- Om ett event efter migreringen har två rader med samma
-- (event_id, category_id) tas dubbletten bort — M:M-tabellen ska ha unika par.

DELETE FROM event_categories ec
USING event_categories ec2
WHERE ec.ctid > ec2.ctid
  AND ec.event_id = ec2.event_id
  AND ec.category_id = ec2.category_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Lägg på den saknade valideringen (från 20261018-0001, aldrig applicerad)
-- ═══════════════════════════════════════════════════════════════════════════
-- Härifrån kan INGEN pipeline skriva en slug som inte finns i categories.
-- Legacy-slugs fångas i normalizern (canonicalize-lagret, Round 1–3) och
-- loggas som "[normalizer] canonicalized: X → Y" innan de når DB.

CREATE OR REPLACE FUNCTION is_valid_event_category_slug(p_slug TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_slug IS NULL OR EXISTS (SELECT 1 FROM categories WHERE slug = p_slug);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION is_valid_event_category_slug(TEXT) IS
  'Returnerar TRUE om p_slug är NULL eller finns som en giltig kategori. Används av CHECK constraint på events.category_slug.';

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Verifiering
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_total        BIGINT;
  v_null_count   BIGINT;
  v_legacy_count BIGINT;
  v_invalid      BIGINT;
  v_invalid_lib  BIGINT;
  v_cats         BIGINT;
  v_constraint   TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM events;
  SELECT COUNT(*) INTO v_null_count FROM events WHERE category_slug IS NULL;

  SELECT COUNT(*) INTO v_legacy_count
  FROM events
  WHERE category_slug IN (
    'cinema', 'concert', 'Konsert', 'Utställning', 'exhibitions',
    'Temavisning', 'musical', 'sports & wellbeing', 'stage & film',
    'guided tours & lectures', 'Föreläsning', 'Musik på Historiska',
    'Barn och familj', 'Lov', 'networking & community', 'hip-hop'
  );

  SELECT COUNT(*) INTO v_invalid
  FROM events e
  LEFT JOIN categories c ON c.slug = e.category_slug
  WHERE e.category_slug IS NOT NULL AND c.id IS NULL;

  SELECT COUNT(*) INTO v_invalid_lib
  FROM image_library il
  LEFT JOIN categories c ON c.slug = il.category_slug
  WHERE il.category_slug IS NOT NULL AND c.id IS NULL;

  SELECT COUNT(DISTINCT category_slug) INTO v_cats FROM events;

  SELECT convalidated::TEXT INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'events'::regclass AND conname = 'events_category_slug_valid';

  RAISE NOTICE '=== normalize-legacy-category-slugs (2026-10-29) ===';
  RAISE NOTICE 'Events totalt:                      %', v_total;
  RAISE NOTICE 'Events med NULL category_slug:      % (ska vara 0)', v_null_count;
  RAISE NOTICE 'Events med legacy-slug kvar:        % (ska vara 0)', v_legacy_count;
  RAISE NOTICE 'Events med slug utanför categories: % (ska vara 0)', v_invalid;
  RAISE NOTICE 'image_library med ogiltig slug:     % (ska vara 0)', v_invalid_lib;
  RAISE NOTICE 'Distinkta kategorier i events:      % (var 44 + null före)', v_cats;
  RAISE NOTICE 'Constraint validated:               %', COALESCE(v_constraint, 'SAKNAS');

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % events har fortfarande NULL category_slug', v_null_count;
  END IF;
  IF v_legacy_count > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % events har fortfarande legacy-slug', v_legacy_count;
  END IF;
  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % events har slug som inte finns i categories', v_invalid;
  END IF;
  IF v_invalid_lib > 0 THEN
    RAISE EXCEPTION 'Migration misslyckades: % image_library-rader har ogiltig slug', v_invalid_lib;
  END IF;
  IF v_constraint IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Migration misslyckades: events_category_slug_valid saknas eller är ogiltifierad';
  END IF;

  RAISE NOTICE '========================================';
END $$;

COMMIT;
