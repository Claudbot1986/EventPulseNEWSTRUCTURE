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

### Adaptiv generering med grind [P1 — 2026-10-28, byggt och verifierat]

Ny verktyg `scripts/adaptive_image_gen.ts`. Genererar i omgångar med ramp (5 → 2 → 4 → 8 → 16), **granskar varje bild med M3 vision (3 röster + majoritetsröstning)** och backar av vid fel. Mätt på community: 60 bilder, 56 godkända (93,3 %), producerad mix **100 % wide-family** mot 17 % i det gamla biblioteket.

- [ ] **Kör resten av kategorierna.** community är klar (108 behov, 60 genererade). Övriga: music 54, theatre-drama 31, exhibition 17, kids 19, film 20, (null) 20, concert 20, opera 17, dance 17, sports 18, food 18, musical-theatre 19, family 19, talks-lectures 19, circus 16, classical 14, workshop 14, nightlife 18, wine-tasting 19, electronic 19, rock 18, theatre-comedy 15. Kommando: `node --env-file=.env --import tsx scripts/adaptive_image_gen.ts --start=5 --max-rounds=8 --max-total=60` (upprepas per kategori).
- [ ] **Normalisera legacy-kategorislugs innan resten genereras.** `concert`, `Konsert`, `musical`, `cinema`, `Utställning`, `exhibitions`, `Musik på Historiska`, `Temavisning`, `hip-hop`, `sports & wellbeing` är duplicer/legacy-slugs som saknar eget cluster-underlag och skulle få 20 bilder vardera av ren slump. Bör mappas mot `music`/`exhibition`/`film` m.fl. — annars genereras ~200 bilder i fel kategorier.
- [ ] **Publicera `local_image_library_stamped_v2/`** — ännu inte uppladdad till storage och inte registrerad i `image_library`-tabellen. Kräver samma path-fix som i Storage-restore-blocket (`import-stamped/<kategori>/<fil>.webp`).
- [ ] **Kodfixar som redan gjorts i `zoom-prompter.ts` (2026-10-28)** — sammanfattning: cache-merge i stället för overwrite, `max_tokens` 1500→4000 (annars tyst mock-fallback), timeout 60 s på M3-anrop, no-text-klausul i promptmallen, EST-mallens krav på ren fasad. Verifierat: 3 av 4 tidigare text-fel rena, det fjärde (entréskylt) rensat med EST-fixen.

### Ny kompositionsmix: scen + publik, och byggnaden [P1 — 2026-10-29, användarens beslut]

Användarens granskning av de 60 bilderna: *"vi saknar motiv där vi är ännu längre bort — tittar på självaste scenen OCH publiken samt en ytterligare där man tittar på självaste koncerthuset eller teaterhuset."*

Rotorsak: **WIDE ("scen + publik") hade bara 3,6 % vikt** medan XW ("hela lokalen") tog 25 %. Ny fördelning i `ZOOM_WEIGHTS` (summa 1,0): close-familjen 12,5 % · LS 5 % · **WIDE 25 %** · XW 17,5 % · **EST 25 %** · AER 15 %. För community (target 182): scen+publik 45, byggnad 45, hela lokalen 32, overhead 27.

- [x] Vikterna ändrade i `BFL-generator/lib/zoom-prompter.ts` + egna promptsektioner för WIDE (scen + publik, "scenen utan publik är FEL"), XW (hela lokalen från balkongen) och EST ("riktigt konserthus eller teaterhus", inte betonglada).
- [x] Verifierat med nygenererade prov per nivå — de tre nivåerna är nu visuellt åtskilda (se `.scratch/imgprobe/levels/`).
- [x] `callM3` använder nu `thinking: {type:'disabled'}` — M3:s extended thinking åt hela `max_tokens`-budgeten på den längre mallen och svaret kom aldrig.
- [ ] **Regenerera de 60 redan gjorda community-bilderna med den nya mixen.** De gjordes med gamla vikter och saknar "scen + publik". Kommando: `node --env-file=.env --import tsx scripts/adaptive_image_gen.ts --categories=community --start=5 --max-rounds=8 --max-total=60 --reset` (tom `local_image_library_stamped_v2/`).

### Aspect ratio 3:2 [P0 — 2026-10-29, verifierat mot UI]

Användarens krav: *"alla bilder ska ha samma aspect ratio som förut (som i ui i appen?) — kör 3:2 om det är 3:2"*.

**UI:s container för biblioteksbilder är exakt 3:2.** `06-UI/App.js` `eventImage` = `maxWidth: 420, height: 280` → 420/280 = 1,5 = 3:2, och den renderar med `resizeMode="cover"`.

Mätt 2026-10-29 med den riktiga stämpeln (`bottom-left`, 150×36) och UI:s cover-crop:

| Källa | Efter UI:s 3:2-cover-crop | Stämpeln |
|---|---|---|
| 16:9 (1280×720) | beskär 15,6 % av bredden | ❌ avklippt till "…erad" (0 orange pixlar kvar i hörnet) |
| **3:2 (1248×832)** | ingen beskärning | ✅ "AI-genererad" helt intakt |

Stämpeln ska vara läsbar — det är själva poängen med Art. 50-märkningen. **Korrigering 2026-10-29:** "16:9 bryter compliance-kravet i huvudvyn" var för starkt. Art. 50 kräver maskinläsbar märkning (den överlever oavsett crop) och synlig etikett bara vid deepfake/allmänintressetext — inte för generiska atmosfärsbilder. Det som faktiskt gäller är att stämpeln blir oläslig, vilket är ett användarvärde-problem, inte ett juridiskt.

Övriga containrar: 56×56 och 72×72 thumbnails (1:1, cover) — stämpeln är för liten för att betyda något där, men 3:2 beskär mindre (33 % mot 44 % av bredden). Utforska-tiles (5:2) använder statiska assets, inte biblioteket.

- [x] `scripts/adaptive_image_gen.ts` genererar nu `aspect_ratio: '3:2'`, 1248×832. Verifierat: 1 ny bild 1248×832.
- [x] `--reset`-flagg tillagd så en ny körning inte ärver förra körningens räknare ur `runtime/adaptive-image-gen/state.json`.
- [x] **Ramen är LÅST till 3:2** (användarbeslut 2026-10-29: "ramen runt bilden behöver vara samma aspect ratio"). `LOCKED_EVENT_IMAGE_ASPECT = 1.5` i `06-UI/hooks/imageAspectCore.js` används av `EventPulseCard`, `EventPulseSenasteCard`, `NewEventCard` och de två skeletten. `resizeMode` stays `"contain"` — ingen beskärning, bilden är alltid helt synlig (kravet från 2026-10-07).
  - Verifierat i riktig app (Expo-webb, Playwright): **100 karusellkort à 150×100 px och 5 "Senaste"-kort à 96×64 px — aspect exakt 1.500, höjdspridning 0,00 px.**
  - Regressionstest: `06-UI/e2e/image-frame-aspect.test.mjs` (2/2 grönt).
  - `testID="event-card-image"` / `"event-card-image-latest"` lades på bildramarna för att kunna mäta dem.
- [ ] **Hela biblioteket måste regenereras i 3:2.** 488 gamla bilder (16:9) + 61 v2-bilder (16:9) + ~510 nya. Tills dess får 16:9-bilderna brevluckor ovan/under i den låsta 3:2-ramen (contain utan beskärning).
- [x] **Konsekvensen för kortlayouten är mätt:** 3:2 ger 240 pt höjd mot 202 pt för 16:9 vid 360 pt bredd (+19 %) — och nu tillämpas detta på ALLA kort, oavsett bildformat.

### Legacy-slugs normaliserade [P0 — 2026-10-29, KLART]

Rotorsak till 43 kategorier (i stället för 27): **migrationen `20261018-0001-events-category-slug-validation.sql` hade aldrig applicerats i live-DB** — varken `is_valid_event_category_slug()` eller CHECK-constrainten fanns. Därför skrevs källornas egna kategoritaxonomier rakt in i DB: `cinema` (Zita, 72), `concert` (Nalen, 63), `Utställning` (Waldemarsudde, 17), `exhibitions` (10), `musical` (China Teatern, 10), `hip-hop` (5), `Konsert` (3), `sports & wellbeing` (3), `stage & film` (3), `guided tours & lectures` (2), `Musik på Historiska` (2), `Temavisning` (1), `Barn och familj` (1), `Föreläsning` (1), `Lov` (1), `networking & community` (1) samt **831 events med NULL** (före normalizerns fallback infördes).

- [x] `04-Normalizer/categoryCanonicalize.ts` — **Round 3**: 16 nya mappingar, varje med verifierad motivering mot riktig DB-data.
- [x] `05-Supabase/migrations/20261029-0001-normalize-legacy-category-slugs.sql` — städar 1026 events, deduplicerar `event_categories`, och LÄGGER PÅ den saknade CHECK-constrainten.
- [x] `scripts/apply_migration_20261029_slug_normalization.ts` — applicerar SQL-filen ordagrant via direkt Postgres-anslutning (`DATABASE_URL`), med `--dry-run`.
- [x] **Verifierat i live-DB:** 17149 events · 0 NULL · 0 legacy-slug · 0 slug utanför `categories` · 27 kategorier (var 44 + null) · constraint `validated=true`.
- [x] **Kvoten räknad om:** 43 kategorier → 27. **799 nya bilder → 510** (−289). Varje engångskategori (cinema, concert, Utställning, ...) krävde minst 20 egna bilder.
- [x] Tester: `04-Normalizer/categoryCanonicalize.test.ts` 81/81 grönt (16 nya Round 3-tester).
- [x] `hip-hop` LÄMNAS kvar i `categories` (legitim genre-kategori, 0 events — samma status som `comedy`/`metal`/`pop-rock`). De 5 events som bar sluggen var felmärkta och flyttades till `community`.
- [x] **Bugg hittad och fixat i applikatorn:** första `--dry-run` applicerade faktiskt migrationen — SQL-filen har sin egen `BEGIN/COMMIT` som överkörde den yttre `ROLLBACK:en`. Nu strippas `COMMIT;` i dry-run-läge. Verifierat med sentinel-test: ändring rullas tillbaka korrekt.







### EU AI Act Art. 50 — maskinläsbar märkning [P0 — 2026-10-29]

Mätt mot lagtexten (AI Act Art. 50, Code of Practice 10 juni 2026, Guidelines C(2026) 5054) och mot faktiska bildfiler.

**Fynd 1 — leverantörens märkning föll bort.** MiniMax `image-01` returnerar en **JPEG** (inte PNG) med en digitalt signerad maskinläsbar AIGC-märkning i EXIF (Kinas TC260-standard, `SecurityData` med SM2/SM3-signaturer). Vår pipeline konverterade JPEG → stämplad PNG → WebP, och **båda** stegen tappade metadata:

| Steg | EXIF | AIGC-märkning | Vår XMP |
|---|---|---|---|
| rå MiniMax-JPEG | 1258 B | ✅ | — |
| stämplad PNG (före fix) | ❌ | ❌ | ✅ (PNG iTXt) |
| stämplad PNG (efter fix) | 1288 B | ✅ | ✅ |
| levererad WebP (före fix) | ❌ | ❌ | ❌ |
| **levererad WebP (efter fix)** | ✅ 1294 B | ✅ | ✅ 1229 B |

Utan fixen hade de bilder UI:t visar **ingen** maskinläsbar märkning alls — varken leverantörens signerade eller vår egen.

**Fynd 2 — Sharp skriver inte XMP till WebP.** Verifierat med tre ordningar (`.webp().withMetadata({xmp})`, `.withMetadata({xmp}).webp()`, `.keepMetadata().webp()`): samtliga gav `metadata.xmp === undefined` och noll "EventPulse"-byte i filen. Sharp **läser** XMP från WebP men skriver det aldrig. `parseXmp` hade dessutom ingen WebP-stöd alls.

- [x] `08-Agent/tools/ai_compliance.ts`: `injectXmpIntoWebp()` — skriver RIFF-chunk "XMP " och VP8X-chunk med XMP-flaggan 0x04 (extended file format). Layouten verifierad byte-för-byte mot `webpmux -info`. Idempotent: befintlig XMP ersätts, aldrig dupliceras.
- [x] `08-Agent/tools/ai_compliance.ts`: `applyAiComplianceToWebp()` — stämplar OCH konverterar OCH injicerar XMP i ett steg (samma XMP-paket som PNG-mastern, samma tidsstämpel).
- [x] `08-Agent/tools/ai_compliance.ts`: `readXmpPacket()` + `readWebpXmp()` — flyttar en befintlig XMP till ett nytt format.
- [x] `parseXmp()` läser nu WebP (source `webp-riff`) och fångar även `xmp:CreatorTool` i attributform (`xmp:CreatorTool="..."`), som tidigare alltid parsades som `null`.
- [x] `.withMetadata()` i hela kedjan (`applyAiCompliance`, `applyAiComplianceToWebp`, `services/imageGen.ts`) så leverantörens AIGC-märkning överlever.
- [x] Verifierat: 18/18 kontroller i `.scratch/xmptest/verify.mts` + 11/11 slutkontroller mot en rå MiniMax-JPEG. Pixeldata identisk med vanlig konvertering (diffBytes=0), `webpmux -info` hittar XMP, `parseXmp` läser tillbaka.
- [x] **Beslut: etikettens språk → "AI-genererad" på svenska** (användarbeslut 2026-10-29). Lagtexten har ingen språkregel för Art. 50. Code of Practice Measure 1.1(a) kräver "AI" (samma ord på svenska) och *uppmuntrar* ordet "GENERATED"/"MODIFIED" — fritt val. Svenska är tydligare ("plain language") i en svensk app.
- [ ] **Öppen juridisk fråga: är EventPulse "provider"?** Guidelines (11) + Art. 3(3): en app som sätter ett AI-bildgenereringssystem i tjänst under eget namn kan vara provider → då är Art. 50(2) maskinläsbar märkning **vår** bindande skyldighet (från 2 aug 2026, botter upp till 3 % av omsättning). Vår XMP är tidsstämplad men **inte digitalt signerad** (Code of Practice Measure 1.1.1 kräver signatur för signerande parter).
- [x] **Beslut: den synliga etiketten STANNAR** (användarbeslut 2026-10-29). Den är inte lagkrav för generiska atmosfärsbilder (varken deepfake eller allmänintressetext) — men Guidelines (114) säger att synlig märkning gör att kriterium 4 i deepfake-definitionen faller. Att ta bort etiketten kan alltså *öka* risken.
- [x] **Fynd 2026-10-29: MiniMax levererar maskinläsbar märkning — vi förstörde den.** `image-01` returnerar en **JPEG** med digitalt signerad AIGC-metadata i EXIF (Kinas TC260-standard, SM2/SM3-signaturer). Båda våra konverteringssteg (JPEG→PNG och PNG→WebP) tappade metadata eftersom Sharp strippar allt som standard. Fix: `.withMetadata()` i hela kedjan + `injectXmpIntoWebp()` (Sharp skriver inte XMP till WebP — verifierat med tre ordningar). Se commit `e16f9d0b`.


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
