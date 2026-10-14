-- 2026-10-12-0001-image-library-cluster-tags.sql
--
-- Lägger till cluster_tags på image_library — separata från fria `tags`.
-- Syfte: kluster-taggarna är bildens "minne" och används för matchning mot
-- nya events (lib/match.ts). Fria `tags` är curator-/metadata-taggar.
--
-- Säkerhet:
--   - DEFAULT '{}' → befintliga rader påverkas inte.
--   - Inga CHECKs (Postgres array-typ räcker).
--   - GIN-index för tags && cluster_tags-sök.
--
-- Migration är idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).

BEGIN;

ALTER TABLE image_library
  ADD COLUMN IF NOT EXISTS cluster_tags TEXT[] NOT NULL DEFAULT '{}';

-- GIN-index för array-överlapp-sökningar (t.ex. cluster_tags && ARRAY['hårdrock','gitarr'])
CREATE INDEX IF NOT EXISTS idx_image_library_cluster_tags_gin
  ON image_library USING GIN (cluster_tags)
  WHERE cardinality(cluster_tags) > 0;

-- Komposit index för kategori + cluster_tags (vanligaste sökvägen i lib/match.ts)
CREATE INDEX IF NOT EXISTS idx_image_library_category_cluster_tags
  ON image_library (category_slug, cluster_tags)
  WHERE cluster_tags IS NOT NULL AND cardinality(cluster_tags) > 0;

COMMIT;
