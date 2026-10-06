-- 2026-10-06 — events (source, source_id) partial UNIQUE index.
--
-- Syfte: Hindra framtida inom-source-duppleringar på DB-nivå. När en
-- adapter anger ett stabilt source_id (livespot, berwaldhallen, spelning-se,
-- ticketmaster m.fl.) ska (source, source_id) vara globalt unikt inom events-
-- tabellen. För adapters utan source_id (NULL) skyddar vi inte — där förlitar
-- vi oss på normalizer-nivåns dedup_hash.
--
-- Backup-bild (innan migreringen kördes 2026-10-06):
--   * 1337 within-source duplicates togs bort via scripts/dedupe-within-source.mjs
--     innan denna constraint lades till:
--       - livespot-stockholm: 1217 (legacy 2026-10-04 direct-insert batch)
--       - berwaldhallen: 115
--       - eventbrite-stockholm: 3
--       - nalen: 2
--   * Om denna migrering kör utan föregående dedup, kommer CREATE UNIQUE INDEX
--     misslyckas (Postgres returnerar "could not create unique index" med
--     list på konflikterande rader) — det är avsiktligt.
--
-- Påverkan på write-path:
--   * Normalizerns processRawEvent i 04-Normalizer/normalizer.ts gör en SELECT
--     före INSERT/INSERT och uppdaterar om raden finns. SELECT-then-INSERT är
--     inte atomärt — två parallella workers kan båda missa en befintlig rad
--     och båda försöka INSERT, vilket skapar duplicates. Med detta index
--     stoppas den andra av en unique_violation (23505), så worst case blir
--     ett failed job (BullMQ retry) istället för korrupt data.
--   * För en idealisk fix: byt normalizer till supabase.upsert(...) med
--     onConflict: 'source,source_id' när source_id är satt. Fångas av framtida
--     PR — utanför denna migrerings räckvidd.
--
-- Påverkan på cross-source-dedup:
--   * Inga. canonical_event_id är oförändrat (delas av flera events på
--     tvärs av källor). Denna constraint är source-scoped.
--
-- Säker:
--   * WHERE source_id IS NOT NULL utesluter rader där källan aldrig emitterat
--     ett source_id (t.ex. legacy direct-insert från 2026-10-04). De har
--     redan dedupats via dedupe-within-source.mjs men vi skyddar inte
--     framtida legacy-paths heller.
--   * IF NOT EXISTS gör migreringen idempotent.
--
-- Rollback: DROP INDEX idx_events_source_source_id_uniq;

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source_source_id_uniq
  ON events (source, source_id)
  WHERE source_id IS NOT NULL;

COMMIT;