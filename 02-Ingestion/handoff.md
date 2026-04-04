# Handoff – 02-Ingestion

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

## Nästa-steg-analys 2026-04-04 (STRATEGISK ÖVERSYN)

### Vad förbättrades denna loop
- Strategisk omorientering: Från site-specifik felsökning → bred modell-validering
- current-task.md uppdaterad med nya mål (10+ sources, precision/recall, generella mönster)
- handoff.md uppdaterad med ny inriktning

### Största kvarvarande flaskhals
**Modell-validering saknas:**
- C0/C1/C2 har endast testats på 1-3 sajter
- Vi vet INTE om signalsystemet fungerar BRETT
- Vi har ingen systematisk mätning av precision vs recall

### Tre möjliga nästa steg (GENERELLA)

|| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Kör sourceTriage på 10+ html_candidates** | Hög: Bred validering av modellen | Låg: Befintlig kod | Vi måste veta om modellen fungerar BRETT |
| 2 | **AI-analys av failure patterns** | Medel: Hitta generella mönster | Låg: Endast analys | Mönster över 3+ sajter → regeländring |
| 3 | **Utvärdera IGNORE_PATTERNS effekt** | Medel: Vet vi om mönstren är för breda/restriktiva? | Låg: Analysera befintliga resultat | Generell förbättring kräver förståelse |

### Rekommenderat nästa steg
**#1 — Systematisk modell-validering på 10+ html_candidates**

Motivering: Vi kan inte förbättra en modell vi inte har mätt brett. Nästa steg är att köra sourceTriage på 10+ html_candidates och samla systematiska data om:
- C0 candidate discovery: hur många links hittas per sajt?
- C1/C2 signals: korrelerar scores med faktiska events?
- Extraction: hur ofta vald candidate faktiskt ger events?

### Två steg att INTE göra nu
1. **Djupsökning på enskild sajt** — Lockande men genererar inte lära om modellen
2. **Site-specifik kodändring** — Får ENDAST göras efter bred validering som visar 3+ sajter samma problem

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
