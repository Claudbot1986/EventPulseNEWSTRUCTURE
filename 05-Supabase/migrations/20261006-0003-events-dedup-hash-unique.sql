-- 2026-10-06 — events.dedup_hash UNIQUE INDEX
--
-- Syfte: komplettera normalizerns dedup_hash-baserade upsert till atomic
-- Postgres-nivå. När två workers processar samma raw_event samtidigt kan
-- båda missa befintlig rad i SELECT och försöka INSERT → race condition →
-- duplicate. Med detta index stoppas den andra av en unique_violation.
--
-- Migrationen ersätter INTE den partiella unika på (source, source_id) i
-- 20261006-0002 — de två är komplementära:
--   * idx_events_source_source_id_uniq WHERE source_id IS NOT NULL
--       — skyddar adapters med stabila käll-ID (livespot, berwaldhallen, ...)
--   * idx_events_dedup_hash_uniq WHERE dedup_hash IS NOT NULL
--       — skyddar också adapters med NULL source_id där normalizerns
--         fallback dedup_hash (SHA-256 av source::title::start_time) är
--         nyckeln.
--
-- Förberedande åtgärd: 10 rader med NULL dedup_hash (legacy friendsarena/
-- artipelag-batch) backfillas med samma SHA-256-algoritm som i
-- 04-Normalizer/normalizer.ts buildDedupHash(source, ${title}::${start_time})
-- innan denna migrering kördes 2026-10-06.
--
-- Säker:
--   * Inga duplikat-rader borde finnas efter dedupe-within-source.mjs körts
--     (1337 st togs bort 2026-10-06).
--   * Om CREATE UNIQUE INDEX misslyckas, lista Postgres konfliktsupp-rader så
--     kan vi undersöka manuellt. Inga tysta dataförluster.
--
-- Rollback: DROP INDEX idx_events_dedup_hash_uniq;

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup_hash_uniq
  ON events (dedup_hash)
  WHERE dedup_hash IS NOT NULL;

COMMIT;