-- 2026-10-02 — Dedup cross-source: släpp UNIQUE INDEX på canonical_event_id
--
-- Design-bug: 20260818-0001-agent-event-graph.sql skapade ett UNIQUE INDEX
-- på canonical_event_id. Detta förhindrar att flera events pekar på samma
-- master (vilket är hela poängen med cross-source-dedup).
--
-- Vi har 387 cross-source-grupper där samma fysiska event finns i 2-5
-- olika källor med olika URL:er. UNIQUE INDEX hindrade migreringen.
--
-- Fix: släpp UNIQUE INDEX, behåll vanligt index för sökningar.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS idx_events_canonical_event_id;
DROP INDEX IF EXISTS idx_events_canonical_event_id;

-- Behåll lookup-index (icke-unique) för "hitta alla events som pekar till master X"
CREATE INDEX IF NOT EXISTS idx_events_canonical_event_id_lookup
  ON events(canonical_event_id)
  WHERE canonical_event_id IS NOT NULL;