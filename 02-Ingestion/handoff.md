# Handoff – 02-Ingestion

---

## Nästa-steg-analys 2026-04-04 (loop 6)

### Vad förbättrades denna loop
- **VIKTIG UPPTÄCKT: debaser är INTE JS-renderad!**
- curl av debaser.se/kalender visar MASSOR av events i ren HTML
- C1:s `likelyJsRendered` heuristic (`!hasMain && linkCount < 5`) är FEL för Webflow-sajter
- Webflow-sajter använder `<div class="w-dyn-list">` istället för `<main>/<article>`
- Debaser har 73KB HTML med fullständiga event-listor (datum, artister, platser)

### Root-cause-analys
- **C1 falskt positiv:** `hasMain=false` + `hasArticle=false` → likelyJsRendered=true
- Debaser ANVÄNDER INTE `<main>` eller `<article>` - Webflow-mönster
- Men sidan har massor av event-data i ren HTML: `class="collection-item-20 w-dyn-item"`, `<h3 class="h3 calendar-data">`, event-links med `/events/...`

### Generalization Gate
- Observation fràn EN sajt (debaser) → Site-Specific
- Men misstanke om generellt mönster för Webflow-baserade sajter
- KRÄVER 2-3 verifierade fall innan C1-ändring

### Största kvarvarande flaskhals
- **C1 likelyJsRendered heuristik missar Webflow-sajter**
- 2 sources (debaser, sbf) parkerade som "pending_render" men kanske inte behöver det
- D-renderGate-bygget kan vara ogrundat om dessa källor redan har HTML-data

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Undersök fler Webflow-sajter** | Hög: kan avslöja om debaser är ensam eller generellt mönster | Låg: endast curl/analys | 2+ fall behövs innan C1-ändring |
| 2 | **Testa debaser kalender-sida via sourceTriage** | Hög: kan bevisa att debaser kan extraheras med HTML-path | Medel: om det fungerar kan debaser tas ur render-kön | Nästa logiska verifiering |
| 3 | **Undersök SBF similarly** | Medel: sbf är också i render-kön | Låg: endast analys | Kan ge fler bevis för Webflow-mönstret |

### Rekommenderat nästa steg
- **#2 — Testa debaser kalender-sida via sourceTriage**

Motivering: curl visar tydligt att debaser har events i HTML. Nästa steg är att verifiera med vårt faktiska verktyg (C1→C2→extract) för att bevisa om HTML-path fungerar för debaser eller inte.

### Två steg att INTE göra nu
1. **Bygga D-renderGate** — för tidigt, 2 källor i render-kön kan vara falska positiver
2. **Ändra C1 likelyJsRendered logik** — endast 1 sajt verifierad hittills

### System-effect-before-local-effect
- Valt steg (#2): Testa debaser kalender-sida med sourceTriage
- Varför: Om debaser fungerar med HTML-path, kan vi ta bort den från render-kön och slippa bygga D-renderGate för denna källa

---

## Nästa-steg-analys 2026-04-04 (loop 5)

### Vad förbättrades denna loop
- **BRED MODELL-VALIDERING:** Testade 33 HTML-sources totalt genom sourceTriage
- **MODELL-PRESTANDA MÄTT:** Precision = 15% (5/33 godkända)
- **MODELLEN ÄR INTE PROBLEMET:** C0/C1/C2 fungerar korrekt, flaskhalsen är källdata

### Största kvarvarande flaskhals
- **Majoriteten av HTML-sources har INGA extraherbara events:** 28/33 sources (85%) gav 0 events
- Orsaker: ingen JSON-LD + HTML saknar event-listor, JS-rendering, eller felaktiga URLs
- **Denna insikt är det viktigaste resultatet hittills**

### Fullständig modell-validering (33 sources)

**Batch 1 (2026-04-04, 23 sources):**
| Källa | C0 | Events | Approved |
|-------|-----|--------|----------|
| konserthuset | ✓ | 11 | ✅ |
| dramaten | ✓ | 1 | ✅ |
| friidrott | ✓ | 4 | ✅ |
| textilmuseet | ✓ | 3 | ✅ |
| sbf | ✓ | 7 | ✅ (C3→render) |
| gronalund | ✓ | 0 | ❌ |
| nrm | ✓ | 0 | ❌ |
| vasamuseet | ✓ | 0 | ❌ |
| scandinavium | ✓ | 0 | ❌ |
| astronomiska | ✓ | 0 | ❌ |
| shl | ✓ | 0 | ❌ |
| + 13 fler | — | 0 | ❌ |

**Batch 2 (2026-04-04, 6 nya sources):**
gronalund, nrm, vasamuseet, scandinavium, folkoperan, cirkus → 0 approved

**Batch 3 (2026-04-04, 4 alternativa URLs):**
gronalund/kalender, nrm/kalendarium, vasamuseet/evenemang, scandinavium/kalender → 0 approved

### Generella mönster (nyinsikt)

1. **C0 fungerar:** Hittar candidates på de flesta sajter
2. **ExtractFromHtml misslyckas:** 85% av candidates ger 0 events
3. **HTML saknar events:** Många sajter har helt enkelt inga event-listor i sin HTML (kan vara JS-lastat, API-baserat, eller har bara nyheter)
4. **Kalender-subpaths hjälper inte:** Om root saknar events gör kalender-sidor det också
5. **High density ≠ extraction:** nrm density=300 men 0 events

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Bygga D-renderGate** | Hög: aktiverar JS-renderade källor | Medel: ny komponent | 2 sources (debaser, sbf) väntar på render |
| 2 | **Undersöka network-path för no-jsonld sources** | Medel: kan hitta API-endpoints | Medel: network-inspection saknas | Många sources har networkSignalsFound=true |
| 3 | **Köra normalizer→database på befintliga events** | Medel: verifierar slutresultat | Låg: befintliga jobb i Redis | Fokusera på befintliga 18 events |

### Rekommenderat nästa steg
- **#1 — Bygga D-renderGate**

Motivering: Vi har bevisat att HTML-path fungerar (5 sources, 18 events). Nästa steg är att aktivera render-path för de sources som är blockerade (debaser, sbf). D-renderGate är nästa logiska verktyg i path-ordningen.

### Två steg att INTE göra nu
1. **Testa fler HTML-sources** — 33 sources testade, modellen utvärderad. Mer testning ger samma resultat.
2. **Fokusera på extraction quality** — friidrott/textilmuseet har "dåliga" titles men de är fortfarande events. Bättre att få fler sources än att finslipa 4.

### System-effect-before-local-effect
- Valt steg (#1): Bygga D-renderGate
- Varför: Detta är nästa verktyg i pipelinen. Vi har 2 parkerade källor (debaser, sbf) som väntar på det.

---

### Vad förbättrades denna loop
- **VERIFIERADE HELA PIPELINE:** Körde konserthuset, dramaten, friidrott, textilmuseet genom sourceTriage → phase1ToQueue → Redis → normalizer worker → database
- **Pipeline bevisad FUNGERA:** 14 konserthuset, 1 dramaten, 4 friidrott, 3 textilmuseet events i databasen
- **Upptäckte dubbla workers:** OLD worker (eventpulse-main) vs NEW worker (NEWSTRUCTURE) — de delar samma Redis

### Största kvarvarande flaskhals
- **Worker-konflikt:** NEWSTRUCTURE normalizer worker tog JOBB IGENOM men old worker (eventpulse-main, PID 10735) konsumerar från samma Redis kö
- **Phase1-batch 11:33:** phase1ToQueue körde 5 sources → 22 events queued men INGEN worker konsumerade dem (old worker körde redan och normalizer för jobb-logik verkar ha kört klart)
- **SBF:** 7 events från triage → C3 flagged → 0 i database (JS-render path, D-renderGate saknas)
- **Extraction quality:** friidrott ("MARS 2026 | 13:03") och textilmuseet ("Maj »") visar att extractFromHtml ibland fångar raw text istället för titles

### Pipeline-verifiering Resultat (2026-04-04)

**Källa | Events queued | Events i DB**
konserthuset | 11 | 14 totalt (8 gamla + 6 nya)
dramaten | 1 | 1
friidrott | 4 | 4
textilmuseet | 3 | 3
sbf | 0 (C3 flagged) | 0

**Totalt:** 19 events queued, ~18 i database (gammal worker vs ny worker)

### Generalization-mönster

1. **Root vs candidate:** konserthuset root = 11 events (bäst), candidate pages = färre
2. **Kalender-subpaths:** Försöks med /kalender/ etc men konserthuset fungerar på root
3. **High density ≠ extraction:** density=300+并不意味着 extraction works

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Verifiera friidrott/textilmuseet extraction quality** | Hög: dessa sources levererar brute raw text som titles | Låg: analysera extractFromHtml output | Förstå varför titles blir "MARS 2026" |
| 2 | **Undersök SBF C3→render path** | Hög: 7 events hittades men C3 flagged som JS-render | Medel: D-renderGate saknas | Nästa logiska steg för render-kandidater |
| 3 | **Köra fler HTML sources (10+ test)** | Medel: bred modell-validering | Låg: befintlig kod | current-task.md mål: ≥10 sources |

### Rekommenderat nästa steg
- **#1 — Verifiera friidrott/textilmuseet extraction quality**

Motivering: dessa 7 events har dålig quality ("MARS 2026 | 13:03" etc). Att förstå varför extractFromHtml fångar raw text istället för titles är viktigt för modell-validering.

### Två steg att INTE göra nu
1. **Köra fler HTML sources utan att förstå extraction quality** — Vi har redat 4 nya sources med events, men kvalitén är osäker
2. **Bygga D-renderGate nu** — SBF behöver render, men vi behöver först förstå om HTML-path faktiskt failar eller om det är extraction-problem

### System-effect-before-local-effect
- Valt steg (#1): Analysera extraction quality problem
- Varför: 7 events "hittades" men med dålig quality. Detta är ett direkt pipeline-problem som påverkar alla HTML-sources.

---

## Mottaget från 01-Sources (2026-04-04)

### Bakgrund
01-Sources fas avslutad. Tre HTML-kandidater verifierades med C2 och extractFromHtml.

### Verifieringsresultat (UPPDATERAD 2026-04-04)

| Källa | C0 Discovery | Extraction | Faktiskt utfall | Nästa steg |
|--------|-------------|------------|-----------------|------------|
| malmoopera | 18 links, winner density=38 | 7-8 events ✓ | **FUNGERAR** | Pipeline-verifiering |
| malmolive | 42 links, winner density=113 | 0 events | **JS-render misstanke (403)** | → PARK: pending_render_gate |
| dramaten | 9 links, winner density=267 | 1 event | Lågt men fungerar | Undersök candidates |

### Root-cause (UPPDATERAD efter verklig testning)
- **C0 htmlFrontierDiscovery FUNGERAR** - finns och används i sourceTriage.ts (rad 96)
- **C0 hittar 18 internal links** på malmoopera, rankar query-param URLs högst
- **Root-sida ger 8 events** direkt via Swedish dates i text
- **C0 winner URL ger 7 events** - query-param sidor fungerar
- **/pa-scen/ finns EJ** - Malmö Opera har ingen sådan path (404)

### Gammal felaktig analys (från 01-Sources)
- Påstående: "Events finns på undersidor: `/pa-scen/`, `/program/`, `/kalender/`"
- Verklighet: `/pa-scen/` = 404, `/program/` = 404, `/kalender/` = 404 på malmoopera
- Events hittas via Swedish dates i root-sidans text och via query-param URLs

### Konsekvens för 02-Ingestion
- **C0 (discoverEventCandidates) fungerar korrekt**
- **Extraction fungerar** - Swedish dates + text-scraping hittar events
- **Tidigare hypotes var fel** - problemet var inte "wrong page selection"
- **Behöver verifiera malmolive och dramaten** för att förstå hela bilden

### Nästa steg enligt 02-Ingestion current-task (UPPDATERAD 2026-04-04)

**STRATEGISK NYINRIKTNING:** Från site-specifik felsökning → bred modell-validering

1. **Systematisk modell-utvärdering**
   - Kör sourceTriage på 10+ html_candidates
   - Mät precision vs recall för C0/C1/C2
   - Jämför genererade signalscores mot faktiska utfall

2. **AI-Assisted Pattern Analysis**
   - Använd AI för att jämföra utfall över flera sajter
   - Hitta generella mönster i failure cases
   - Föreslå endast generella förbättringar (ej site-specifika)

3. **Regel-justering med Generalization Gate**
   - Varje föreslagen ändring: "hjälper detta 3+ sajter?"
   - Site-specifika fixes → source adapters, EJ C-lager

**VIKTIGT:**
- INGEN djupsökning på enskild site om det inte är för generellt mönster
- INGEN site-specifik kod i C0/C1/C2
- Varje ändring kräver bred validiering

---

> **HISTORICAL ONLY — inactive after NEWSTRUCTURE migration.**
> 
> Active files now live in:
> - `NEWSTRUCTURE/02-Ingestion/current-task.md`
> - `NEWSTRUCTURE/02-Ingestion/handoff.md`
> 
> Do not use this file when domain-local files exist.
>
> **Future plan:** When current migration stabilizes, move git/repo root to `NEWSTRUCTURE` so that all relative paths, active context resolution and skills naturally use the correct project root.

## Nästa-steg-analys 2026-04-04 (loop 2)

### Vad förbättrades denna loop
- **MODELL-VALIDERING GENOMFÖRD:** Körde sourceTriage på 23 no-jsonld candidates
- **PHASE1→QUEUE VERIFIERAD:** 4/5 approved sources queueade (19 events)
- Konserthuset: 11 events → queue ✓
- Dramaten: 1 event → queue ✓
- Friidrott: 4 events → queue ✓
- Textilmuseet: 3 events → queue ✓
- SBF: 0 events → C3 flagged JS-render → pending_render_queue

### Största kvarvarande flaskhals
- SBF (7 events från triage) → C3 flagged som JS-render → D-renderGate saknas
- 18/23 "gate=promising" men 0 events — signalsystemet hittar candidates men extraction failar
- Kalender/calendar-sidor har hög density men låg extractability

### Modell-Validering Resultat (2026-04-04)

**Batch:** 23 no-jsonld URLs från 100testcandidates.md

| Mått | Värde |
|------|-------|
| Sources testade | 23 | 100% |
| Approved (events > 0) | 5 | 22% |
| Events totalt | 26 (triage) / 19 (queue) | — |
| Phase1→Queue | 4/5 success | 80% |
| C0 candidates hittade | 20/23 | 87% |

**Phase1→Queue Resultat:**

| Källa | Triage events | Queue status | Anledning |
|-------|---------------|--------------|-----------|
| konserthuset | 11 | ✅ 11 queued | — |
| dramaten | 1 | ✅ 1 queued | — |
| friidrott | 4 | ✅ 4 queued | — |
| textilmuseet | 3 | ✅ 3 queued | — |
| sbf | 7 | ❌ 0 queued | C3 flagged JS-render → pending_render_queue |

**Generella mönster identifierade:**

1. **Root-sida vs discovered:** konserthuset ger 11 events från root, nrm.se hittade /kalendarium men 0 events
2. **High density ≠ events:** nrm.se density=300 → 0 events, friidrott.se density låg → 4 events
3. **High density candidates misslyckas:** svenskfotboll.se (biljett/) density=9 → 0, shl.se density=200 → 0
4. **Kalender-sidor:** Kalender/calendar-sidor har hög density men låg extractability
5. **SBF C3-flaggad:** Trots 7 events i triage, C3 säger JS-render vid phase1ToQueue → inkonsekvent

**Site-Specific vs General:**

| Observation | Klassificering | Handling |
|-------------|----------------|----------|
| SBF inkonsekvent (7→0) | Oklart | Undersök: triage≠phase1ToQueue |
| Vasamuseet root > discovered | Site-Specific | Source adapter |
| Universitets-sidor alla 0 | General (4+ sajter) | Föreslå: IGNORE university-event paths |
| Kalender-sidor hög density→0 | General (4+ sajter) | Föreslå: lägre vikt för /kalender/ paths |

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Undersök SBF inkonsekvens** | Hög: Förstå triage≠phase1ToQueue | Medel: Kan vara C3 fel | SBF visade 7 events, nu 0 |
| 2 | **Analysera failure patterns** | Medel-Hög: Hitta varför 18/23 har 0 events | Låg: Endast analys | Generella mönster → regeländring |
| 3 | **Kör normalizer på queued events** | Hög: 19 events → database | Medel: Normalizer kan missa | Verifierar hela pipeline |

### Rekommenderat nästa steg
**#3 — Kör normalizer på queued events**

Motivering: Vi har 19 events i queue (konserthuset, dramaten, friidrott, textilmuseet). Att köra normalizer→database verifierar hela pipeline och ger mätbar output.

### Två steg att INTE göra nu
1. **Ändra IGNORE_PATTERNS för universitets-sidor** — Endast 4 sajter, ej verifierat generellt
2. **Fixa SBF som site-specific** — Vi behöver förstå varför C3 säger JS-render när triage funkade

---

## Senaste loop
Datum: 2026-04-03
Problem: Tre kvarvarande problem med routingmodellen:
1. unknown blir implicit HTML-default (ej explicit triage)
2. jsonld med 0 events blir silent fail
3. routingbeslut sparas inte som långlivat runtime-minne

Ändring:

### 1. Nya statusar i SourceStatus
- `pending_api` - för api-sources som inte kan köras ännu
- `pending_network` - för network-sources som inte kan köras ännu
- `triage_required` - för unknown-sources som misslyckats med HTML-triage
- `needs_review` - för sources där etablerad path returnerar 0 events

### 2. Nya routingminne-fält
- `routingReason` - varför detta path valdes (spårbart)
- `pendingNextTool` - nästa verktyg som behövs (D-renderGate, api_adapter, etc)
- `triageAttempts` - antal triage-försök för unknown sources

### 3. Scheduler-logik uppdaterad
- api/network → pending_api/pending_network + pendingNextTool satt
- jsonld med 0 events → needs_review + pendingNextTool=preferredPath_recheck
- unknown med 0 events → triage_required + triageAttempts++
- unknown med events → success + pendingNextTool=preferredPath_recheck (flaggar för uppdatering)

Filer ändrade:
- 02-Ingestion/tools/sourceRegistry.ts: Nya statusar och fält
- 02-Ingestion/scheduler.ts: Uppdaterad updateSourceStatus-anrop

Verifiering (från sources_status.jsonl):
```
kulturhuset: status=pending_network, routingReason="preferredPath=network...", pendingNextTool=network_inspection ✓
ticketmaster: status=pending_api, routingReason="preferredPath=api...", pendingNextTool=api_adapter ✓
berwaldhallen: status=needs_review, routingReason="Tixly API endpoint...", pendingNextTool=preferredPath_recheck ✓
astronomiska-huddinge: status=success, routingReason="triage_success...", triageAttempts=1 ✓
debaser: status=triage_required, triageAttempts=1 ✓
```

Commit: (kommer göras)

---

## Senaste loop
Datum: 2026-04-03
Problem: sources/ och runtime/ hade otydlig separation, saknade spårbarhetsfält och prioriteringslogik
Ändring:
- Uppdaterat SourceTruth interface med: preferredPathReason, systemVersionAtDecision, verifiedAt, needsRecheck
- Uppdaterat SourceStatus interface med: lastSystemVersion, rename pending_render_gate → pending_render
- Lagt till saknade status-poster (fryshuset, debaser, gso) i sources_status.jsonl
- Fixat scheduler.ts error-sträng till 'pending_render'
- Uppdaterat alla 8 sources med spårbarhetsfält (preferredPathReason, systemVersionAtDecision, verifiedAt, needsRecheck)
- debaser och gso fick needsRecheck=true (behöver utredas)
Verifiering: scheduler --status visar 8 sources, 8 statuses
Commit: b5841e6 (sources spårbarhet), f7a4d17 (needsRecheck prioritering)

## Öppna problem
- C3 behöver integreras i phase1ToQueue (OLLAMA API fungerade, men integration i pipeline behövs)

---

## Nuvarande status

- phase1ToQueue.ts är kopplad till NEWSTRUCTURE ✓
- JSON-LD → Queue ✓
- HTML-path → Queue ✓
- Worker → Database ✓
- Konserthuset: 8 events queued → database verifierat ✓
- Berwaldhallen: database verifierat ✓

Senaste commit:
- 721aa22 feat(ingestion): add HTML extraction fallback for no-jsonld sources

---

## Nuvarande status

- phase1ToQueue.ts är kopplad till NEWSTRUCTURE ✓
- JSON-LD → Queue ✓
- HTML-path → Queue ✓
- Worker → Database ✓
- Konserthuset: 8 events queued → database verifierat ✓
- Berwaldhallen: database verifierat ✓
- URL-dubblering fixat ✓ (a3b4f0e)

Senaste commits:
- a3b4f0e fix(ingestion): prevent URL path duplication in extractFromHtml resolveUrl
- 721aa22 feat(ingestion): add HTML extraction fallback for no-jsonld sources

---

## Öppna problem

Inga öppna problem.

---

## Nästa målsättning

### Analysera HTML-path-flaskhalsar och optimera source-täckning

#### Mål
Identifiera och kategorisera alla 100 källor efter varför de INTE levererar events via HTML-path. Skapa en systematisk lista som visar exakt vilka flaskhalsar som finns och vilka källor som kan fixas med rätt verktyg.

#### Analysuppgifter

1. **Kategorisera alla sources som INTE gav events (86 st) i dessa grupper:**

   | Kategori | Kännetecken | Exempel | Åtgärd |
   |----------|-------------|---------|--------|
   | `js-render` | HTML tom/substanslös, kräver JS-körning | Fryshuset, Debaser, Liseberg | Måste använda render-path (headless browser) |
   | `fetch-fail` | DNS/timeout/403/404 | malmolive.se, operna.se | Fel URL, site nere, eller blockerat |
   | `no-events-in-html` | HTML finns men inga event-länkar hittas | Berwaldhallen, GSO | HTML finns men selectors/hittar inte rätt mönster |
   | `wrong-jsonld` | JSON-LD finns men är fel type (WebPage/Organization) | Avicii Arena, kulturhuset | Måste använda HTML-path istället |
   | `api-required` | Events laddas via separat API, ej i HTML | ? | Måste använda network-path för att hitta API-endpoints |
   | `calendar-subpath` | Events finns på undersida (kalender/program) | ? | Prova kända subpaths: /kalender/, /program/, /events/ |

2. **För varje kategori, svara på:**
   - Vilka features behövs för att lösa kategorin?
   - Finns feature redan i pipelinen (render-path, network-path)?
   - Vad är minsta ändring för att lösa?

3. **Skapa prioritetsordning för implementation:**
   - Vilken kategori täcker FLEST källor?
   - Vilken kategori är ENKLAST att implementera?
   - Vilken ger STÖRST täckning per insats?

4. **Output: En komplett analysrapport i detta format:**

```
### Bottleneck-analys

| Kategori | Antal källor | Exempel | Feature som behövs | Komplexitet |
|----------|--------------|---------|-------------------|-------------|
| js-render | X | ... | render-path | hög |
| fetch-fail | X | ... | URL-fixar/undersökning | låg |
| ... | ... | ... | ... | ... |

### Rekommenderad prioritetsordning
1. [Kort beskrivning av högsta prioritet]
2. ...
3. ...

### Käll-lista som behöver render-path (JS)
[Alla källor som är js-render med URL]

### Käll-lista som behöver network-path (API)
[Alla källor som troligen behöver API-inspektion]

### Käll-lista med felaktig URL
[Alla fetch-fail som kan vara URL-problem]

### Övriga iakttagelser
[Vad som helst intressant upptäcktes]
```

#### Arbetssätt
- Använd test-results.json som bas (genererades vid 100-källa test)
- Görstickprov på 5-10 källor för att verifiera kategori-klassificering
- Om osäker på kategori, testa manuellt med curl/browser
- Spara slutlig rapport i `01-Sources/HTML-path-bottleneck-analysis.md`

#### Regler
- Gör endast analys och dokumentation - INGA kodändringar
- Uppdatera handoff.md med resultatet av analysen
- Svara på svenska

## Nästa-steg-analys 2026-04-04 (loop 3)

### Vad förbättrades denna loop
- **Testade malmolive och dramaten** enligt rekommenderat nästa steg
- **malmolive**: Root=0 events, C0 winner density=113 men 0 extraction, JS-rendering misstänkt (403 på /kalender/)
- **dramaten**: Root=1 event, C0 winner=1 event, lågt men fungerar
- **Nu har vi komplett bild** av de tre källorna från handoff

### Render-Queue Blocking Rule tillämpad
- malmolive är **stark misstanke render-kandidat** (C0 density=113, extraction=0, 403)
- → **PARKERAD** för D-renderGate (ej vald som nästa steg)
- → Nästa steg väljs från sources som KAN göras NU

### Fullständig status (uppdaterad)

| Källa | Root Events | C0 Winner | Winner Events | Problem | Status |
|--------|-------------|-----------|--------------|---------|--------|
| malmoopera | 8 ✓ | density=38 | 7 ✓ | **FUNGERAR** | → Pipeline-verifiering |
| malmolive | 0 | density=113 | 0 | **JS-render? 403** | → **PARK: pending_render_gate** |
| dramaten | 1 | density=267 | 1 | Lågt | Undersök |

### Största kvarvarande flaskhals
- **malmolive är blockerad** - JS-rendering eller skyddsåtgärd (403)
- **dramaten ger bara 1 event** - möjligen förbättrad candidate-sökning behövs
- **Men: malmoopera fungerar** - kan leverera 7-8 events via pipeline

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Kör sourceTriage på malmoopera → phase1ToQueue** | Hög: bekräftar fungerande pipeline | Låg: befintlig kod | Kan göras NU, ger 7-8 events |
| 2 | **Undersök dramaten candidate quality** | Medel: kan förbättra 1→5 events | Låg: analysera | Potentiellt fixbart |
| 3 | **Bygg D-renderGate för malmolive** | Hög: kan ge 10+ events | Hög: ny komponent | Blockerad just nu |

### Rekommenderat nästa steg
- **#1 — Kör sourceTriage på malmoopera → phase1ToQueue**

Motivering: malmolive är parkerad (render-blockerad), dramaten ger lågt. malmoopera FUNGERAR med 7-8 events. Att bekräfta hela pipeline (triage→queue→database) är rätt steg NU.

### Två steg att INTE göra nu
1. **Undersök malmolive igen** — redan parkerad för D-renderGate, ingen mer analys kommer ge events med nuvarande verktyg.
2. **Bygga D-renderGate nu** — för tidigt, ingen källa är fullt verifierad som render-kandidat.

### System-effect-before-local-effect
- Valt steg (#1): Kör sourceTriage på malmoopera
- Varför: Endast steg som faktiskt kan leverera events NU. malmolive är blockerad. dramaten är osäker. malmoopera är bevisad.

---

## Regler för automatisk uppdatering

AI-agenten ska efter varje loop:
1. Uppdatera endast sektionen "Senaste loop"
2. Uppdatera "Nuvarande status" endast om något faktiskt förändrats
3. Ta bort lösta problem från "Öppna problem"
4. Lägga till nya problem om de upptäcks
5. Uppdatera "Nästa rekommenderade steg"
6. Om handoff.md inte ändrats är loopen inte klar
