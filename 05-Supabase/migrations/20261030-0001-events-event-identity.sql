-- 20261030-0001-events-event-identity.sql
--
-- Korskälls-identitet för events + sammanslagning av dubbletter.
-- ROTSAK till de dubblettkort som syntes i appen (t.ex. "MAFFIA COMEDY
-- SUPERWEEKEND" i Utforska → Comedy: två kort, identisk titel/datum/tid,
-- från livespot + evensos).
--
-- Mätt på live-DB före migration: 16 309 events, 1 030 dubblettgrupper,
-- 2 118 extra rader.
--
-- Tre orsaker:
--   1. `dedup_hash = sha256(source::source_id)` — källan ingår i hashen,
--      så två källor som beskriver samma evenemang kan aldrig kollidera.
--      Repo-policyn säger "Do not change dedup hash algorithm", så
--      korskälls-dedup måste ligga på en ANNAN nyckel. Det gör den här.
--   2. `ticket_url` + kalenderdag är den enda befintliga korskälls-vägen
--      men kräver IDENTISK url-sträng. livespot.se/event/… vs
--      evensos.com/event/… → aldrig träff.
--   3. `canonical_event_id` fanns för just detta men var NULL på 99,5 %
--      av raderna (77 / 16 309) och exponerades inte i `events_public`.
--
-- DEN HÄR MIGRATIONEN:
--   a) lägger till `event_identity` — identitetsnyckeln som normalizern
--      och `scripts/audit-duplicates.ts` räknar på, indexerad så att
--      write-time-dedup blir en indexerad likhetsteckning.
--   b) lägger till `merged_into` — spåret "den här raden slogs ihop med
--      den där". Separat från `canonical_event_id` vars index är UNIQUE
--      och därför inte klarar "många dubbletter → en huvudrad".
--   c) filtrerar bort sammanslagna rader ur `events_public`, så att
--      ALLA läsvägar (Utforska, chatt, sök, kalender, notiscenter)
--      visar ett kort per evenemang utan att varje läsväg behöver
--      komma ihåg att filtrera.
--
--   `canonical_event_id` lämnas orörd. Den har ett eget, redan existerande
--   fält med samma (men äldre) syfte.

BEGIN;

-- ── 1. Identitetsnyckel + merge-spår ──────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_identity TEXT;

COMMENT ON COLUMN events.event_identity IS
  'Korskälls-identitetsnyckel: normaliserad titel | Europe/Stockholm-datum | lokal klockslag | platsnyckel. Satt av 04-Normalizer/normalizer.ts och scripts/audit-duplicates.ts. Se 04-Normalizer/deduplication/crossSourceIdentity.ts.';

CREATE INDEX IF NOT EXISTS idx_events_event_identity
  ON events (event_identity)
  WHERE event_identity IS NOT NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS merged_into TEXT;

COMMENT ON COLUMN events.merged_into IS
  'UUID på raden som den här raden slogs ihop med (samma evenemang, annan källa). Satt av scripts/audit-duplicates.ts --apply.';

CREATE INDEX IF NOT EXISTS idx_events_merged_into
  ON events (merged_into)
  WHERE merged_into IS NOT NULL;

-- ── 2. events_public: dölj sammanslagna rader ─────────────────────────────
--
-- Vyn är skyddad av assert_events_public_lockdown() (migration #23).
--
-- CREATE OR REPLACE VIEW används (inte DROP + CREATE) eftersom
-- kolumnlista, ordning och typer är IDENTISKA med den nuvarande vyn —
-- bara WHERE-villkoret ändras. Det gör migrationen atomär: finns det
-- något fel i den nya definitionen faller vyn tillbaka, aldrig bort.
-- (DROP + CREATE vore inte atomär här — apply-migration.ts kör
-- statement för statement.)

CREATE OR REPLACE VIEW events_public AS
SELECT
  e.id,
  e.title_en,
  e.title_sv,
  CASE
    WHEN e.description_license = ANY (ARRAY['pressbild'::text, 'copyright-with-attribution'::text, 'partner-licensed'::text, 'public-domain'::text]) THEN e.description_en
    ELSE NULL::text
  END AS description_en,
  CASE
    WHEN e.description_license = ANY (ARRAY['pressbild'::text, 'copyright-with-attribution'::text, 'partner-licensed'::text, 'public-domain'::text]) THEN e.description_sv
    ELSE NULL::text
  END AS description_sv,
  e.start_time,
  e.end_time,
  e.source,
  e.venue_id,
  e.venue_full_name,
  e.venue_full_address,
  e.venue_city,
  e.venue_lat,
  e.venue_lng,
  e.venue_url,
  e.venue_phone,
  e.lat,
  e.lng,
  e.location,
  e.is_free,
  e.price_min_sek,
  e.price_max_sek,
  e.ticket_url,
  e.image_url,
  e.image_license,
  e.image_attribution,
  e.image_source_url,
  e.image_ai_generated,
  e.image_ai_optout,
  e.image_prompt,
  e.image_model,
  e.image_generated_at,
  e.image_generation_status,
  e.category_slug,
  e.confidence_score,
  e.freshness_at,
  e.status_expanded,
  e.is_online,
  e.online_url,
  e.link_status,
  e.link_last_checked_at,
  e.description_license,
  e.description_attribution,
  e.description_source_url,
  e.eventpulse_summary,
  e.eventpulse_summary_generated_at,
  e.eventpulse_summary_model,
  e.editorial_description,
  e.editorial_description_generated_at,
  e.event_profile
FROM events e
WHERE e.status::text = 'published'::text
  AND e.link_status IS DISTINCT FROM 'dead'::text
  -- 2026-10-30 — sammanslagna dubbletter visas inte. Raden finns kvar i
  -- events (spårbarhet, reversibelhet) men inte i den publika yn.
  AND e.merged_into IS NULL;

GRANT SELECT ON events_public TO anon, authenticated;
GRANT ALL ON events_public TO service_role;

-- ── 3. expected_columns: de två nya kolumnerna är interna ────────────────
--
-- Lockdown check D kräver att varje ny kolumn i events antingen finns i
-- vyn eller registreras här. Båda är interna (nyckel + merge-spår) och
-- ska INTE exponeras publikt.
--
-- check E verifierar sedan att alla must_be_present = TRUE-kolumner
-- FAKTISKT finns i vyn. Kolumnerna nedan är redan exponerade i vyn, så
-- de registreras med must_be_present = TRUE — check E bekräftar då att
-- vyn verkligen exponerar dem.

INSERT INTO events_public_expected_columns (column_name, must_be_present, added_in_migration, rationale)
VALUES
  ('event_identity', false, '20261030-0001',
   'Korskälls-identitetsnyckel. Intern dedup-nyckel — exponeras inte publikt (samma skäl som dedup_hash).'),
  ('merged_into', false, '20261030-0001',
   'UUID på huvudraden som en sammanslagen dubblett pekar på. Internt merge-spår — exponeras inte publikt.'),
  -- ── Föregående drift (registrerad här för att låsa upp gaten) ───────────
  -- Mätt 2026-10-30: 20 kolumner i events fanns varken i vyn eller i
  -- expected_columns, vilket gjorde att check D i assert_events_public_lockdown()
  -- redan var FAIL FÖRE den här migrationen — gaten var alltså red från början.
  -- Kolumnerna nedan exponeras i vyn (must_be_present = TRUE → check E
  -- verifierar det) eller är interna (must_be_present = FALSE).
  ('description_license', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20260926.'),
  ('description_attribution', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20260926.'),
  ('description_source_url', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20260926.'),
  ('eventpulse_summary', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20260926.'),
  ('eventpulse_summary_generated_at', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20260926.'),
  ('eventpulse_summary_model', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20260926.'),
  ('venue_full_name', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('venue_full_address', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('venue_city', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('venue_lat', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('venue_lng', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('venue_url', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('venue_phone', true, '20261030-0001', 'Drift-sync: exponerad i events_public sedan 20261005-0001.'),
  ('raw_description', false, '20261030-0001', 'Drift-sync: intern källtext med 30-dagars retention — exponeras inte publikt.'),
  ('raw_description_captured_at', false, '20261030-0001', 'Drift-sync: intern tidsstämpel för råtext-retention — exponeras inte publikt.'),
  ('eventpulse_summary_facts', false, '20261030-0001', 'Drift-sync: interna faktaserien — exponeras inte publikt.'),
  ('eventpulse_summary_provenance', false, '20261030-0001', 'Drift-sync: intern provenance — exponeras inte publikt.'),
  ('editorial_info_level', false, '20261030-0001', 'Drift-sync: intern redigeringsmetadata — exponeras inte publikt.'),
  ('editorial_model', false, '20261030-0001', 'Drift-sync: intern redigeringsmetadata — exponeras inte publikt.'),
  ('editorial_prompt_version', false, '20261030-0001', 'Drift-sync: intern redigeringsmetadata — exponeras inte publikt.')
ON CONFLICT (column_name) DO UPDATE
  SET must_be_present = EXCLUDED.must_be_present,
      added_in_migration = EXCLUDED.added_in_migration,
      rationale = EXCLUDED.rationale;

-- ── 4. Återställ grants + verifiera lockdown ──────────────────────────────

GRANT SELECT ON events_public TO anon, authenticated;
GRANT ALL ON events_public TO service_role;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM assert_events_public_lockdown() LOOP
    RAISE NOTICE '%: % — %', r.check_name, r.status, r.detail;
    IF r.status = 'FAIL' THEN
      RAISE EXCEPTION 'events_public lockdown FAIL: % (%s)', r.check_name, r.detail;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
