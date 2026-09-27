-- 20260927-0001-categories-v2.sql
--
-- Stratifierade kategorier för EventPulse — Steg 3.1 av planen
-- "Stratifierade kategorier + Utforska-kort" (2026-09-27).
--
-- Bakgrund: idag har vi 5686 events i 19 kategorier. Tre jättar (music 43 %,
-- community 25 %, culture 19 %) gömer 87 % av allt — för grovt. Denna
-- migration sår de 24 finmaskiga slugs som planen listar (platt lista).
--
-- categories-tabellen har dessa kolumner (befintlig, ej ändrad här):
--   id          UUID PK
--   slug        TEXT NOT NULL UNIQUE
--   name_sv     TEXT NOT NULL          ← svenskt visningsnamn
--   name_en     TEXT NOT NULL          ← engelskt visningsnamn
--   icon        TEXT                   ← emoji/bild-nyckel (nullable)
--   sort_order  INT NOT NULL DEFAULT 0 ← sortering i Utforska (Steg 4)
--   created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Säkerhetsegenskaper:
--   * Idempotent (ON CONFLICT DO NOTHING) — kan köras flera gånger.
--   * Inga befintliga slugs eller events påverkas.
--   * Inga DROP — migrationen är additiv. Borttagning av utgångna slugs
--     (art, art-exhibitions, design, barn, food-drink, festivals,
--     nightlife, unknown, musikaler, theater) sker i senare migration
--     efter att re-tagging (Steg 3.4) verifierats.
--   * Multi-label använder befintliga event_categories M:M-join.
--
-- Vad som INTE görs här (kommer i 3.2–3.4):
--   * Normalizer multi-label-persistens (ändras i 04-Normalizer/normalizer.ts).
--   * Re-tagging av befintliga 5686 events.
--   * UI-mappning av multi-label → filter-knappar (delvis klart i 06-UI/utils).
--   * Backfill av event_categories-join-rader.

BEGIN;

-- ─── Säkerställ UNIQUE-constraint på categories.slug (defensivt) ──────────
-- categories-tabellen finns redan (skapad 2026-03-23) men vi kan inte lita
-- på att slug har en UNIQUE-begränsning. DO-blocket kontrollerar och
-- lägger till om den saknas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'categories_slug_unique'
      AND conrelid = 'categories'::regclass
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- ─── Sådd av 24 finmaskiga slugs (platt lista) ────────────────────────────
-- 8 musik-genrer (via artist-tillägg i Steg 3.5)
-- 5 scenkonst-slugs
-- 1 konst/utställning (konsoliderar art + art-exhibitions + design)
-- 3 livsstils-slugs (flea-market, food, wine-tasting)
-- 2 barn/familj
-- 1 film
-- 2 lärande (talks-lectures, workshop)
-- 1 sport
-- 1 restpost (community, töms efter re-tagging)
--
-- icon-kolumnen lämnas NULL — Steg 4 (UI-kort) väljer emoji/bild då vi vet
-- exakt vilka 24 kort som ska visas. sort_order sätts preliminärt så att
-- musik kommer först, scenkonst därefter, osv.
INSERT INTO categories (slug, name_sv, name_en, sort_order) VALUES
  -- 🎵 Musik-genrer (Steg 3.5)
  ('pop-rock',      'Pop/Rock',         'Pop/Rock',         100),
  ('jazz',          'Jazz',             'Jazz',             101),
  ('classical',     'Klassiskt',        'Classical',        102),
  ('electronic',    'Elektroniskt',     'Electronic',       103),
  ('hip-hop',       'Hip-hop',          'Hip-hop',          104),
  ('metal',         'Metal',            'Metal',            105),
  ('world-folk',    'Världsmusik/folk', 'World/Folk',       106),
  ('musical',       'Musikal',          'Musical',          107),
  -- 🎭 Scenkonst
  ('opera',         'Opera',            'Opera',            200),
  ('theatre-comedy','Teater-komedi',    'Theatre-comedy',   201),
  ('theatre-drama', 'Teater-drama',     'Theatre-drama',    202),
  ('dance',         'Dans',             'Dance',            203),
  ('circus',        'Cirkus',           'Circus',           204),
  -- 🖼️ Konst & utställning
  ('exhibition',    'Utställning',      'Exhibition',       300),
  -- 🛍️ Livsstil
  ('flea-market',   'Loppis/marknad',   'Flea market',      400),
  ('food',          'Mat',              'Food',             401),
  ('wine-tasting',  'Vintasting',       'Wine tasting',     402),
  -- 👨‍👩‍👧 Barn & familj
  ('kids',          'Barn',             'Kids',             500),
  ('family',        'Familj',           'Family',           501),
  -- 🎬 Film
  ('film',          'Film',             'Film',             600),
  -- 📚 Lärande
  ('talks-lectures','Föreläsningar',    'Talks/Lectures',   700),
  ('workshop',      'Workshop',         'Workshop',         701),
  -- 🏃 Sport
  ('sports',        'Sport',            'Sports',           800),
  -- 🗂️ Restpost (töms efter re-tagging)
  ('community',     'Community',        'Community',        900)
ON CONFLICT (slug) DO NOTHING;

-- ─── Index för filter-queries (06-UI Utforska) ────────────────────────────
-- Befintligt index på categories.slug (via UNIQUE) räcker för
-- event_categories-joins. Inget nytt index behövs.

-- ─── RLS-påminnelse ────────────────────────────────────────────────────────
-- RLS för categories är redan konfigurerad i 20260818-0001-agent-event-graph.sql:
--   REVOKE ALL ON categories FROM anon, authenticated;
--   GRANT ALL ON categories TO service_role;
-- Inga ändringar behövs.

COMMIT;
