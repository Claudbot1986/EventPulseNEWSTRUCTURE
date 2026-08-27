-- 20260827-0001-image-library.sql
--
-- Image library för återanvändning av AI-genererade bilder.
--
-- Bakgrund: AI-bild-pipelinen genererade 1 466 bilder för past events som nu
-- är "bortkastade" eftersom events är avslutade. Samtidigt har vi 6 755 future
-- events som behöver bilder och BFL-priser gör per-event-generering dyrt.
--
-- Strategisk förändring (2026-08-27): bygga ett återanvändbart bildbibliotek.
-- Varje BFL-genererad bild registreras i image_library med metadata om kategori,
-- venue-pattern och användningshistorik. När worker misslyckas (no_credits / fel)
-- eller normalizer ser ett nytt event → hämta bästa match från image_library.
--
-- Schema-organisation:
--   - storage_path = R2-nyckel (t.ex. 'event-posters/ai-generated/abc.jpg')
--   - category_slug = 'music' | 'community' | 'culture' | ... (kopplad till events)
--   - venue_pattern = regex (NULL = alla venues) — frivilligt curator-tag
--   - times_used = räknare, ökas vid varje reuse
--   - rating = 1-5 (curator), NULL = orörd
--
-- Idempotency: CREATE TABLE IF NOT EXISTS, indexes idempotenta.

BEGIN;

-- ─── Tabell ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS image_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path TEXT NOT NULL UNIQUE,
  -- Publik URL (cachelagd vid insert; vi slipper beräkna om varje lookup)
  public_url TEXT NOT NULL,
  -- Kategori enligt events.category_slug (NULL = wildcard/default)
  category_slug TEXT,
  -- Venue-pattern (regex på venue_name), NULL = alla venues passar
  venue_pattern TEXT,
  -- Fritexts-taggar för framtida curator-sök
  tags TEXT[] NOT NULL DEFAULT '{}',
  -- Vilket event som genererade bilden (för audit + referens)
  source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  -- Användningsräknare (uppdateras via pickLibraryFallback)
  times_used INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  -- Curator-bedömning (NULL = orörd, 1-5)
  rating SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  approved_by TEXT NOT NULL DEFAULT 'auto',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Index för snabb lookup vid fallback ────────────────────────────────────

-- Primär lookup: kategori (vanligaste frågan i pickLibraryFallback)
CREATE INDEX IF NOT EXISTS idx_image_library_category
  ON image_library (category_slug, rating DESC NULLS LAST, times_used DESC)
  WHERE category_slug IS NOT NULL;

-- Sekundär: hämta alla biblioteks-bilder (för "default"-fallback)
CREATE INDEX IF NOT EXISTS idx_image_library_rating
  ON image_library (rating DESC NULLS LAST, times_used DESC)
  WHERE rating IS NOT NULL;

-- För "minst använda"-rotation (curator-verktyg senare)
CREATE INDEX IF NOT EXISTS idx_image_library_times_used
  ON image_library (times_used ASC);

-- För source_event_id-lookup (audit)
CREATE INDEX IF NOT EXISTS idx_image_library_source_event
  ON image_library (source_event_id)
  WHERE source_event_id IS NOT NULL;

-- ─── updated_at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION image_library_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_image_library_updated_at ON image_library;
CREATE TRIGGER trg_image_library_updated_at
  BEFORE UPDATE ON image_library
  FOR EACH ROW EXECUTE FUNCTION image_library_touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE image_library ENABLE ROW LEVEL SECURITY;

-- Service role har full access (befintligt mönster från events-tabellen)
DROP POLICY IF EXISTS image_library_service_all ON image_library;
CREATE POLICY image_library_service_all ON image_library
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- anon + authenticated kan läsa (för att kunna visa library-bild i klient om behov)
DROP POLICY IF EXISTS image_library_read_anon ON image_library;
CREATE POLICY image_library_read_anon ON image_library
  FOR SELECT TO anon, authenticated USING (TRUE);

GRANT SELECT ON image_library TO anon, authenticated;
GRANT ALL ON image_library TO service_role;

-- ─── RPC: bump_usage ────────────────────────────────────────────────────────
-- Atomic increment av times_used + last_used_at vid varje fallback-match.
-- Anropas av 08-Agent/utils/imageLibrary.ts → pickLibraryFallback().
-- SECURITY DEFINER eftersom anon/authenticated INTE ska kunna bumpa räknaren.

CREATE OR REPLACE FUNCTION image_library_bump_usage(p_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE image_library
  SET times_used = times_used + 1, last_used_at = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION image_library_bump_usage(UUID) TO service_role;

COMMIT;