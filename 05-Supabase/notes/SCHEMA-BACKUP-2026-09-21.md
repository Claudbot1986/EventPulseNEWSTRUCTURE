# SCHEMA-BACKUP — 2026-09-21

Backup-referens av Supabase/Postgres-struktur. **Läs-red-only** — denna fil ändras INTE i vanlig drift; den är ett screenshot-att-gå-tillbaka-till innan man vidrör databasen.

Genererad via read-only-analys av `/05-Supabase/migrations/` den 2026-09-21. **Inga DDL-ändringar utfördes vid skapande.**

---

## ⚠️ VARNING — läs först

- **Fem grundtabeller skapades INTE via migrations i denna mapp:** `events`, `venues`, `categories`, `event_categories`, `ingestion_logs`, m.fl. Källa för dessa är `05-Supabase/schema/schema.md`. Saknas den → struktur är ofullständig. Schema.md ÄR canonical reality.
- **Schema-mismatch på `source_candidates`:** migration `#1 venue-graph` (20260427-0001) skapade tabellen med gammalt schema. Migration `#26 source-candidates` (20260911-0002) försöker skapa med NYTT schema. Eftersom båda använder `CREATE TABLE IF NOT EXISTS` blir #26 NO-OP på DB där #1 redan körts. Känd bugg — vidrör EJ i translations-projektet.
- **Lockdown-testet (migration #23):** `events_public_expected_columns` + assert-funktion. Aktiveras vid varje migration. Skyddar ENDAST events/events_public — påverkas INTE av nya tabeller.
- **Pre-launch-state:** databasen har idag ~6 755 future events enligt migration #21 image-library (räknat per 2026-08-27). Siffran kan ha vuxit; verifiera separat vid eventuell tömning.

---

## Rollback-ordning (de 5 senaste, senaste först vid bakåtrullning)

1. `20260920-0002-widen-interaction-attendance-rating-dwell.sql` — utökar CHECK-värden på `user_interactions.interaction`
2. `20260920-0001-user-preferences-auth-uid.sql` — TEXT→UUID-konvertering + RLS-byte på `user_preferences`
3. `20260911-0002-source-candidates.sql` — schema-mismatch (se varning)
4. `20260911-0001-events-needs-human-review.sql` — ny kolumn på events (`needs_human_review`)
5. `20260906-0001-account-deletion-cascade.sql` — FK CASCADE på 5 user/agent-tabeller

För att backa ur: kör DROP för varje schemaförändring i omvänd ordning. **`events_public`-vyn får ALDRIG droppas utan att först återskapas från migration #18's innehåll.**

---

## Kronologisk migration-förteckning (alla 28)

Risk: 🟢 additiv (säker att applicera) · 🟡 strukturell ALTER (kräver plan) · 🔴 destruktiv / känd risk (rör EJ utan godkännande)

| # | Migration | Risk | Vad den gör | Berör |
|---|-----------|------|-------------|-------|
| 1 | 20260427-0001-venue-graph.sql | 🟢 | Venue Graph: 8 nya tabeller (nodes/edges/observations/candidates/expansion/results/runs) + index + claim-RPC-funktion + REVOKE/GRANT-mönster. **Saknar BEGIN/COMMIT.** | venue_graph*, source_candidates (gammal schema) |
| 2 | 20260427-0002-source-candidate-testing.sql | 🟢 | Source Candidate Testing: 3 nya tabeller (test_queue/test_runs/test_decisions) + 2 RPC-funktioner + RLS. **Saknar BEGIN/COMMIT.** | source_test_queue/_runs/_decisions |
| 3 | 20260818-0001-agent-event-graph.sql | 🟡 | Agent Event Graph: 6 ALTER events ADD COLUMN + 10 nya tabeller (organizers, artists, event_artists, event_offers, event_provenance, user_profiles, user_interactions, agent_sessions, agent_messages, source_readiness) + events_public RECREATE + REVOKE/GRANT-flush (anon lockdown). Grundläggande lockdown. | events (alter), events_public (recreate), agents*, user_* |
| 4 | 20260818-0002-confidence-v1.sql | 🟢 | Backfill: 2 UPDATE på events (freshness seed + confidence_score). WHERE-guards → idempotent. | events |
| 5 | 20260818-0003-user-interaction-outbound.sql | 🟢 | DROP/ADD CHECK widening på `user_interactions.interaction` med 'outbound'. | user_interactions |
| 6 | 20260819-0001-last-seen-default.sql | 🟢 | ALTER COLUMN SET DEFAULT now() på `events.freshness_at` + `events.last_seen_at` + UPDATE-backfill. WHERE-guards → idempotent. | events |
| 7 | 20260820-0001-outbound-attribution.sql | 🟢 | Ny tabell outbound_clicks + 3 index + RLS + service_role-only. | outbound_clicks |
| 8 | 20260821-0001-user-interaction-reject.sql | 🟢 | DROP/ADD CHECK widening på `user_interactions.interaction` med 'reject'. | user_interactions |
| 9 | 20260821-0002-user-preferences.sql | 🟡 | Ny tabell user_preferences (TEXT client_user_id PK) + global `update_updated_at_column`-funktion (namnkollisionsrisk!) + 4 RLS-policies + COMMENT. | user_preferences, update_updated_at_column() |
| 10 | 20260821-0003-notifications-table.sql | 🟢 | Ny tabell notifications + 3 index + 4 policies + service_role-only. | notifications |
| 11 | 20260821-0004-image-license-fields.sql | 🟡 | 3 ADD COLUMN på events (image_attribution, image_source_url, image_license) + DO-block CHECK + 1 index + CREATE OR REPLACE VIEW events_public. | events, events_public (replace) |
| 12 | 20260822-0001-notifications-kind-follow-drop.sql | 🟡 | DROP/ADD CHECK widening på `notifications.kind` med 'follow_drop'. | notifications |
| 13 | 20260822-0002-cached-recommendations.sql | 🟢 | Ny tabell cached_recommendations + 1 index + 2 deny-policies + service_role-only. | cached_recommendations |
| 14 | 20260822-0003-shared-sessions.sql | 🟢 | Ny tabell shared_sessions + 2 index + 2 deny-policies + service_role-only. **← MÖNSTER ATT KOPIERA för translations-tabell.** | shared_sessions |
| 15 | 20260822-0004-event-offers-availability.sql | 🟡 | ADD COLUMN availability + UPDATE-backfill + ALTER COLUMN DROP DEFAULT + 1 partial index + DO-ASSERT. Bra mönster. | event_offers |
| 16 | 20260822-0005-attendance-rating.sql | 🟡 | DROP/ADD CHECK widening på `user_interactions.interaction` (attendance+rating) + DROP/ADD CHECK widening på `notifications.kind` + 1 index. | user_interactions, notifications |
| 17 | 20260825-0001-event-image-tracking.sql | 🟡 | 5 ADD COLUMN på events (image_prompt, image_model, image_generated_at, image_generation_status, image_ai_generated) + 2 index. Markerad "NOT APPLIED" i header men uppenbarligen körts. | events |
| 18 | 20260825-0001-ai-image-mandatory.sql | 🟡 | 7 ADD COLUMN på events + DO CHECK + DROP/ADD license CHECK + UPDATE-backfill + DROP/CREATE VIEW events_public (full recreate). | events, events_public (full recreate) |
| 19 | 20260826-0001-events-image-ai-optout.sql | 🟡 | ADD COLUMN image_ai_optout + 1 index + DROP/CREATE VIEW events_public (recreate). | events, events_public (recreate) |
| 20 | 20260826-0002-events-cleanup-non-ai-images.sql | 🔴 | **MASS-UPDATE** på events — nollställer image_url för icke-AI-rader. **Tier 0-policy = kräver explicit human approval + dry-run först.** RÖR EJ. | events |
| 21 | 20260827-0001-image-library.sql | 🟢 | Ny tabell image_library + 4 index + namespaced trigger-funktion + RPC-funktion + 2 policies + service_role-only. | image_library |
| 22 | 20260827-0002-image-library-status.sql | 🟡 | DROP/ADD CHECK widening på `events.image_generation_status` + DROP/ADD CHECK widening på `events.image_license`. Lägger till 'library_fallback'. | events |
| 23 | 20260905-0001-events-public-lockdown-test.sql | 🟡 | Skapar events_public_expected_columns + PL/pgSQL assert-funktion + dokumentationsvy + GRANT. **DO-blocket RAISE EXCEPTION om lockdown bruten vid migrate. Regression-guard för framtida events-kolumner.** | events_public (test) |
| 24 | 20260906-0001-account-deletion-cascade.sql | 🟡 | 5 ALTER TABLE ... ADD CONSTRAINT FK till auth.users(id) ON DELETE CASCADE på user_interactions, user_profiles, agent_sessions, notifications, cached_recommendations. **OBS:** user_preferences är TEXT, inte UUID — exkluderad medvetet. | user_interactions, user_profiles, agent_sessions, notifications, cached_recommendations |
| 25 | 20260911-0001-events-needs-human-review.sql | 🟢 | 1 ADD COLUMN (needs_human_review) + 1 partial index. **Saknar BEGIN/COMMIT.** | events |
| 26 | 20260911-0002-source-candidates.sql | 🔴 | CREATE TABLE IF NOT EXISTS source_candidates med NY schema (url, source_query, ...) som skiljer sig från #1-versionen (candidate_url, source_name, ...). **Schema-mismatch → tyst drift-risk på prod.** RÖR EJ enligt användarens beslut 2026-09-21. | source_candidates |
| 27 | 20260920-0001-user-preferences-auth-uid.sql | 🟡 | DELETE legacy rows + ALTER COLUMN TYPE TEXT→UUID + ADD FK NOT VALID till auth.users + DROP 4 policies + skapa 3 owner-only-policies + REVOKE/GRANT + COMMENT. Känslig datatransform. | user_preferences |
| 28 | 20260920-0002-widen-interaction-attendance-rating-dwell.sql | 🟢 | DROP/ADD CHECK widening på `user_interactions.interaction` (totalt 11 värden). Repar tyst prod-drift där attendance/rating tyst förlorats. | user_interactions |

---

## Tabell- och vy-översikt efter migration #28

### Schema `public` (förväntat nuläge)

**events** — källa för översättningar (primary key: `id UUID`)
- title_en/title_sv, description_en/description_sv (language-split)
- ~50+ kolumner inkl. image_*, status, dedup_hash, location, freshness_at, last_seen_at, confidence_score, needs_human_review
- Källa: schema.md

**venue_graph-*** (8 tabeller) — från #1, används av discovery

**source_candidates** — från #1 (gamla schemat) ⚠️ schema-konflikt med #26

**user_preferences** — TEXT-konverterad till UUID + RLS ägd-bara (#27)
**user_profiles / user_interactions / agent_sessions / agent_messages / notifications / cached_recommendations / shared_sessions** — FK CASCADE till auth.users (#24)

**events_public** — vy, recreate flera gånger (#3, #11, #18, #19). Skyddas av lockdown-test (#23).

**image_library / outbound_clicks / event_artists / event_offers / event_provenance / organizers / artists / source_readiness** — service_role-only

### Funktioner / stored procedures

- `claim_venue_graph_runs()` — från #1
- `enqueue_source_candidate_test()` + hjälpare — från #2
- `update_updated_at_column()` — från #9 (⚠️ globalt namn, kan kollidera med framtida migrationer)
- `image_library_touch_updated_at()` — från #21 (namespaced)
- `image_library_bump_usage()` RPC — från #21
- `assert_events_public_lockdown()` — från #23 (regression-guard)
- `user_preferences_touch_updated_at` (implicerad, ev. namngiven)

### Realtime-publikationer

- `supabase_realtime` — publicerar events/insert/update. Verifiering krävs separat.

### Storage-buckets

- `event-posters` (nämnd i `docs/AI-IMAGE-PIPELINE-PLAN.md`, **inte** skapad via SQL-migration)
- Filer lagras i Cloudflare R2 enligt `packages/shared/src/types/ingestion.ts` — separat från Supabase Storage.

---

## För en translations-migration

**Säkraste prefix:** `20260921-0001-event-translations.sql`
**Föreslaget mönster** (kopia av #14 shared-sessions, men utan FK till auth.users):
- BEGIN/COMMIT
- CREATE TABLE IF NOT EXISTS event_translations (event_id UUID FK→events(id) ON DELETE CASCADE, language TEXT, title, description, model, translated_at TIMESTAMPTZ, PRIMARY KEY (event_id, language))
- CREATE INDEX IF NOT EXISTS (event_id), (language)
- ALTER TABLE ... ENABLE ROW LEVEL SECURITY
- REVOKE ALL FROM anon, authenticated
- GRANT ALL TO service_role

**Undvik:**
- `update_updated_at_column`-namnet (använd eget namespaced funktionsnamn om updated_at-trigger behövs)
- Nya kolumner på `events`-tabellen (skulle kräva uppdatering av lockdown-test #23)
- DROP/CREATE VIEW events_public (skulle kräva assertion)
- Alla migrations märkta 🟡 eller 🔴 ovan

**Återställning vid fel:**
```sql
DROP TABLE IF EXISTS event_translations CASCADE;
-- Allt annat orört. Inga främmande effekter.
```

---

## Metadata om detta dokument

- Skapat: 2026-09-21
- Källa: read-only-analys av `05-Supabase/migrations/` (28 SQL-filer)
- Genereringsmetod: agent-utredning, verifierad mot filsystem
- Uppdateringspolicy: uppdatera INTE utan att först köra en ny read-only-analys (så att diffen mot verkligheten syns)
- Status: ✅ Verifierad konsistent med migrations-mappen vid skapande
