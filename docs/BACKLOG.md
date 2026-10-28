# EventPulse backlog (draft 2026-09-20)

**DRAFT for review.** Authoritative backlog remains `docs/BACKLOG.md` until manually adopted. Strategy lives in [`MASTERPLAN.md`](MASTERPLAN.md) (same folder).

Owner: one slice at a time. Stop if a step is not verified with real data.

User decisions baked in (2026-09-20): **guest taste-first är första fokus (100%)**; **Din helg prioriteras**; **gruppomröstning parkerad** (se DO NOT BUILD YET).

---

## NOW — Phase 1.5: pre-launch hardening

Do in this order. All items are launch blockers; nothing else enters NOW.

1. **Guest taste-first, server side** [IN PROGRESS 2026-10-09]
   - Server: `scripts/smoke-anon-signin.mjs` 6/6 PASS (2026-09-20).
   - UI: un-hide personalized home sections (Rekommenderat/Förslag/Sparade) for guests in `AppShell`/`HomeScreen`; reframe `AuthReminderModal` copy till sync-framing.

### Pre-launch (updated 2026-10-09)

- ~~Analytics decision~~ **Resolved 2026-10-09** (`81b467d2` — Fas 1.5 #4 Val A): `user_interactions` enda funnel source. `analyticsClient` markerad non-funnel.
- ~~AI image top-up~~ **Superseded 2026-10-28 — replaced by "Storage-restore" below.** BFL round 5 + backfill-verktyg var klart (`1f81a149`), men kvoten uppfylls inte: det stämpade biblioteket (`local_image_library_stamped/`, 488 webp) räcker inte till måltalet 990 (v2-formeln, användarbeslut 2026-10-18) — **kort 557 bilder**.

### Storage-restore [BLOCKER — discovered 2026-10-28, verified against live feed]

Supabase Storage-bucketen `event-posters` innehåller **0 objekt**. Varje `image_url` i databasen svarar HTTP 400 `NoSuchKey`, och det live-feedet appen läser (`eventpulse-agent.fly.dev/agent/feed`) levererar 15/15 events med trasiga bild-URL:er. UI saknar `onError` på `<Image>`, så tecknet blir en tom yta.

- [ ] Ladda upp `local_image_library_stamped/` → `import-stamped/<kategori>/<fil>.webp` (488 filer, ~25 MB). Måste matcha DB `storage_path` — `scripts/_upload_stamped_to_storage.ts` tappar idag kategori-undermappen och laddar upp fel sökväg.
- [ ] Återställ de 2 271 unika "flat" URL:erna (`import-stamped/bfl5v2_*.webp`) från `local_image_library/` (2 136 finns som `.png`) — konvertera PNG→WebP med stamp. 135 unika URL:er saknar helt lokal källa.
- [ ] Kör `08-Agent/scripts/backfill_library_to_future.ts --apply` mot de 744 framtida events med `image_url IS NULL` (`image_generation_status='pending'`) — kräver att storage är populerat först. Ingen AI-image-worker körs (ingen launchd-job).
- [ ] Lägg `onError` på `<Image>` i `06-UI/App.js` + `screens/HomeScreen.js` så en trasig URL renderar `emptyImageBoxStyle` i stället för tyst tom yta.
- [ ] Fixa `scripts/_check_image_quota_v2.ts` (saknar `import 'dotenv/config'` → rapporterar "alla kategorier uppfyller kvoten" utan att mäta) och låt båda kvotskripten läsa `events_public` i stället för legacy `events` (kategori-slugs matchar inte `image_library`).

### Ny bildgenerering med MiniMax image-01 [P1 — 2026-10-28]

Användaren raderade de gamla bilderna ("fula"). Två konkreta orsaker hittade: **kompositionsmixen är bakvänt** mot den dokumenterade foto-preferensen (2026-10-21: "mer wide/establishing/aerial, mindre close-up") — biblioteket är 68 % close-up mot ett mål på 10,7 % — och **legacy-stämpeln (240×64-pill) är bränd in i varje bild** i stället för den mindre `bottom-left`/150×36-variant som redan finns i `ai_compliance.ts`.

**Modell: `image-01` ($0.0035/bild) — inte H3.** H3 är en videomodell (t2v/i2v, 768P/2K, 4–15 s) utan stillbildsmode. BFL FLUX1.1 [pro] kostar $0.04/bild → image-01 är 11,4× billigare. Befintlig `BFL-generator/bin/bfl-zoom-batch.ts` använder **redan `image-01`** — det är bara mixen och stämpeln som är fel.

- [ ] **Regenerera biblioteket med korrekt kompositionsmix** (75 % wide/establishing/aerial, 10,7 % close-up) per `ZOOM_WEIGHTS` i `BFL-generator/lib/zoom-prompter.ts`. 488 bilder = **$1,71**. Körbart via `bfl-zoom-batch.ts` efter att `zoom-coverage-state.ts` rensats.
- [ ] **Byt stämpelvariant** i `bfl-zoom-batch.ts` från hardkodad legacy (240×64/inset 24) till `applyAiCompliance({position:'bottom-left'})` 150×36 som redan finns i `08-Agent/tools/ai_compliance.ts`.
- [ ] **Sänk concurrency 4 → 2 och använd `n=9`.** Rate limit är 10 RPM; concurrency 4 ger ~16 anrop/min (mätt latens 14,8 s) → 429. Med `n=9` (verifierat: 9 bilder på 16,7 s) räcker 2–3 anrop/min.
- [ ] **Ladda ner direkt eller använd `response_format:'base64'`** — MiniMax-URL:er expirerar efter 24 h (verifierat: `Expires` 2026-10-29T18:12:34Z på 2026-10-28).
- [ ] **Läs `metadata.success_count`/`failed_count`** — `failed_count` = "images blocked due to content safety"; ett `n:9`-anrop kan returnera 8 bilder och `failed_count:1` med `status_code:0`.
- [ ] Sätt `prompt_optimizer:true` (verifierat stöds, kostnad $0) på bildanropet — förbättrar promptkvaliteten utan extra anrop.
- [ ] Alternativ för visuell sammanhållning: `image-01-live` + `subject_reference:[{type:'character', image_file:'<url>'}]` (verifierat fungerande). Endast 1 referensbild per anrop; kontrollera pris/format innan bruk.
- [ ] Beslut som behövs: ska `aspect_ratio` vara `16:9` (1280×720) eller `3:2` (1248×832)? Kortet är idag 1024×576 via explicit `width`/`height` (bara `image-01` stöder detta).



### Phase 1.5 levererat (för historik)

- Stream A.1 — `02-Ingestion/gateEvalReport.{ts,test.ts}` (per-gate markdown-formatter, `compareGateReports(before, after)`) — `a6c45ea7`, 13/13 nya tester, 41/41 totalt.
- Stream B.1 — `06-UI/FEATURE_MAP.md` (153 rader) + feature-as-directory pilot `06-UI/features/save-favorite/` (591 rader) + visual-regression CI (`06-UI/e2e/visual-regression/`) — `b0fdff72` + `520bd6a2`.
- Agent Runtime safety-gate Tier 0 regression-fix + Tier 1 design change (Alt B) — `7207229b` + `03a2234d`.

---

## NEXT — Phase 2: retention & personalization proof

- **Din helg** (ankare)
  - Weekly personalized weekend selection on existing substrate: `rank_events` + `curated_collections` + `cached-recommendations` + pre-render cron
  - Thursday drop; push via existing notifications infra; opt-in, max 1/week (no spam v1)
  - Verify: returning guest sees a fresh weekend collection without searching

- **Personalization lift experiment**
  - Activate PERSONALIZATION_PRIORS A/B via `experiments.ts` (sticky 50/50, OEC=outbound CTR, MIN_SAMPLE 500/variant)
  - Internal users + first external cohort; write kill/continue after 4 weeks of repeat users

- **Explainability v1**
  - Surface `rank_events` `reasons[]` as "Varför detta?" chips on feed/detail cards; grounded fields only, no invented explanations

- **Conversion at value**
  - Account prompt after Nth save or first Din helg open (not at install); runs anon→auth migration from NOW#3

- **Tracking gaps**
  - Add `event_share` as first-class interaction (shares exist via `/agent/share` but aren't funnel events today)
  - Formalize `search_performed` if needed for funnel metrics

- **Growth docs**
  - Adopt/create `docs/growth/00-current-state.md` from the 2026-09-20 mapping (eventpulse-growth prompts ↔ existing modules)

---

## LATER — Phase 3+

- Transaction Level 2 (prefill) then Level 3 (partner booking API) — only after retention exists
- `source_readiness` scanner as internal quality, then human B2B outreach (Phase 4)
- Cross-source `canonical_event_id` hardening
- C3 date-in-card extraction **only if** verified on 3+ unrelated Stockholm domains (Generalization Gate)
- Stockholm Density Plan layers continue as background maintenance via nightly chain
- Second city (not Sweden-wide scrape)
- **Revisit parked group voting** only if post-launch share→open metrics (`shared_sessions.view_count`) show real sharing behavior

---

## DO NOT BUILD YET

- **Group voting / "Hjälp oss välja" / friend features — PARKED (user decision 2026-09-20).** Requires web surface (currently broken) and an active user base; plain `/s/:hash` sharing already measures funnel top.
- Public event API / bulk graph dump
- Next.js consumer app (web scope decision pending in NOW#5 — decision is not a build mandate)
- Partner portal / self-serve onboarding
- Automated outbound email / sales sequences
- Agentic purchase (Level 4)
- Sweden-wide source import or national coverage campaign
- D-render as default path
- Improvement Orchestrator as the current company task
- Social graph features
- Custom organizer websites (webbyrå)
- Meilisearch as the agent
- Draining all error queues (404 / serverdown / timeout / manual-review) as P1
- Queue `sources_status.jsonl` rewrite as a product phase
- `get_group_profile` implementation
- `create_checkout`
- `search_external_web` in the default path
- Venue-graph `--apply` as growth engine
- Source-candidate auto-promotion
- Training a custom LLM on user chats
- Account-before-value gates (reversed by decision: personalization is available to guests)
