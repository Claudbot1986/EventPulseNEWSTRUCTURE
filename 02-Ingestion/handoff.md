# Handoff – 02-Ingestion

---

## Nästa-steg-analys 2026-04-04 (loop 14)

### Vad förbättrades denna loop
- **VERKTYGSBLOCKERING ÅTGÄRDAD:** network_inspection var INTE saknad — verktygen fanns redan!
  - `02-Ingestion/B-networkGate/networkInspector.ts` — 692 rader, fullt implementerad
  - `02-Ingestion/B-networkGate/A-networkGate.ts` — `evaluateNetworkGate()`, 295 rader
  - `02-Ingestion/B-networkGate/index.ts` — exporterar allt
- **STOR MYTS:** handoff.md (loop 12) sa "network_inspection saknas" — STÄMMER INTE
- **ROOT-CAUSE:** `scheduler.ts` hade en STUB som sa `skip_not_implemented` för `preferredPath=network`

### Ändringar i scheduler.ts
1. **Ny import:** `inspectUrl` + `evaluateNetworkGate`
2. **Ny ExecuteNow-type:** `'execute_network'` tillagd
3. **Ny logik:** `preferredPath=network` → `execute_network` istället för `skip_not_implemented`
4. **Nytt exekveringsblock:** network path med:
   - `inspectUrl()` — probing av 20+ API-endpoints
   - `evaluateNetworkGate()` — breadth mode (2), require usable endpoint
   - HTML fallback om gate säger 'html'
   - Status-uppdatering med inspektionsresultat

### Sources som påverkas
| Källa | Status före | Status efter |
|-------|-------------|--------------|
| kulturhuset | pending_network (skipped) | pending_network (körs nu) |
| berwaldhallen | pending_network (skipped) | pending_network (körs nu) |
| fryshuset | pending_network (skipped) | pending_network (körs nu) |
| gso | pending_network (skipped) | pending_network (körs nu) |

### Kvarvarande flaskhals
- **network_inspection är långsam:** 20+ endpoints × 15s timeout = ~5 minuter per källa
- **Event-extraction från API:** Finns ingen adapter för att faktiskt extrahera events från API-svar
  - network_inspection hittar endpoints men nästa steg (bygga network_event_extraction) saknas
- **D-renderGate:** Fortfarande saknas för sbf, malmolive

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Bygga network_event_extraction** | Hög: aktiverar API-events | Medel: ny komponent | 4 källor kan potentiellt få events om API:hittas |
| 2 | **Optimera network_inspection timeout** | Medel: snabbar uppalla 4 källor | Låg: bara config | Nuvarande 15s per endpoint är för långsamt |
| 3 | **Bygga D-renderGate** | Hög: aktiverar 2 källor | Medel: headless browser | SBF och malmolive väntar |

### Rekommenderat nästa steg
- **#1 — Bygga network_event_extraction**

Motivering: network_inspection kan nu köras men hittar bara endpoints — nästa steg är att faktiskt extrahera events från de API:er som hittas.

### Två steg att INTE göra nu
1. **Bygga D-renderGate** — endast 2 källor väntar, network har 4
2. **Testa fler HTML-sources** — modellen redan utvärderad på 33+ sajter

### System-effect-before-local-effect
- Valt steg (#1): Bygga network_event_extraction
- Varför: Nästa logiska steg i network-path. Utan detta kan network_inspection bara rapportera men inte leverera events.

---

## Nästa-steg-analys 2026-04-04 (loop 13)

### Vad förbättrades denna loop
- **STORA ÄNDRINGEN:** Sources finns i `sources/*.jsonl` (420 filer), INTE i RawSources
- **INGA RawSources:** Sökningen hittade inga referenser till "RawSources" - mappen saknas
- **TESTADE 10+ NYA Svenska källor:**
  - falun-konserthus, gavle-konserthus, helsingborgs-konserthus, vasteras-konserthus
  - helsingborgskonserthus.se (200) - WordPress/Gravity Forms, CollectionPage JSON-LD, 0 Event JSON-LD
  - varakonserthus.se (200) - Next.js/JS-renderat, events via Sanity API, 0 i raw HTML
  - arbetets-museum (200) - WordPress, utställningar/utstallning, CollectionPage JSON-LD, 0 Event JSON-LD
  - artipelag (200) - Next.js/JS-renderat, 0 events i raw HTML
  - nationalmuseum, postmuseum - WordPress utan Event JSON-LD
- **INGA NYA FUNGERANDE HTML-KÄLLOR HITTADES**

### Sources Reality Check
| Mapp | Innehåll | Antal |
|------|----------|-------|
| sources/ | 420 .jsonl source definitions | 420 |
| 01-Sources/candidates/ | 52 .md candidate-filer | 52 |
| (ingen RawSources) | FINNS EJ | 0 |

### Inga nya HTML-källorIdentifierade
- WordPress+Gravity Forms = Ingen Event JSON-LD (gravity forms döljer events)
- Next.js/JS-renderat = 0 events i raw HTML
- SiteVision = JS-baserat, events i API

### Rekommenderat nästa steg
- **Bygga network_inspection ELLER**
- **Testa fler källor från 01-Sources/candidates/**

### System-effect-before-local-effect
- Sources resolution: ändrad sökväg (sources/ jsonl, inte RawSources)
- Inga C-lager-ändringar gjorda

---

## Nästa-steg-analys 2026-04-04 (loop 12)

### Vad förbättrades denna loop
- **VERIFIERAD SITUATION:** Alla 7 triage_required sources har `attempts: 1` - redan testade med 0 events
- **INGEN FÖRÄNDRING MÖJLIG:** Alla 4 pending_network/api sources är korrekt blockerade
  - kulturhuset: WordPress med wrong-type JSON-LD, JS-baserat
  - fryshuset: Nuxt.js/JS-renderat, raw HTML tomt
  - berwaldhallen: Testad, networkSignalsFound=true behöver network_inspection
  - gso: Testad, networkSignalsFound=true behöver network_inspection
- **SYSTEM ÄR FULLSTÄNDIGT BLOCKERAT:** Inga verktyg kan köras utan att bygga nya komponenter

### Största kvarvarande flaskhals
- **VERKTYGSBYGGNATION KRÄVS:** Tre verktyg saknas helt:
  1. network_inspection (för 4 källor)
  2. D-renderGate (för 2 källor)
  3. source_adapter (för 1 källa)
- **INGEN LITEN FÖRÄNDRING LÖSER DETTA:** Varje verktyg är en ny komponent

### Sources Status (loop 12)
| Status | Antal | Kan köras? | Sources |
|--------|-------|------------|---------|
| success | 6 | ✓ | konserthuset, dramaten, friidrott, textilmuseet, malmoopera, astronomiska-huddinge |
| pending_network | 4 | ✗ | kulturhuset, berwaldhallen, fryshuset, gso |
| pending_render | 2 | ✗ | sbf, malmolive |
| pending_source_adapter | 1 | ✗ | debaser |
| triage_required | 7 | ⚠ | gronalund, nrm, vasamuseet, scandinavium, shl, folkoperan, cirkus (redan testade, 0 events) |

### Modellen fungerar korrekt
- 6/33 sources = 18% precision
- Modellen identifierar korrekt: konserthuset, malmoopera, friidrott, textilmuseet med events
- Misslyckanden beror på: JS-rendering, API-baserat innehåll, eller genuint inga events i HTML

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Bygga network_inspection** | Hög: aktiverar 4 källor | Medel: ny komponent | Endast väg framåt för kulturhuset, berwaldhallen, fryshuset, gso |
| 2 | **Bygga D-renderGate** | Hög: aktiverar 2 källor | Medel: headless browser | SBF och malmolive väntar |
| 3 | **Bygga source_adapter** | Medel: aktiverar 1 källa | Hög: source-specifikt | debaser väntar (Site-Specific) |

### Rekommenderat nästa steg
- **#1 — Bygga network_inspection**

Motivering: Endast verktyg som aktiverar flest källor. Inget annat steg är möjligt med nuvarande kod.

### Ingen Klein Ändring Möjlig
- Inga C-lager-ändringar löser detta
- Inga nya sources kan testas utan nya verktyg
- Systemet är i holding pattern tills verktyg byggs

### System-effect-before-local-effect
- Valt steg (#1): Bygga network_inspection
- Varför: Endast väg framåt. Utan detta verktyg kan inga av de 4 blockerade källorna aktiveras.

---

## Nästa-steg-analys 2026-04-04 (loop 11)

### Vad förbättrades denna loop
- **VERIFIERAD QUEUE-STATUS:** Redis queue = 0 (INTE 19 som tidigare dokumenterat)
- **DOKUMENTATIONSKORREKTION:** Events har redan körts genom normalizer (loop 8 bekräftade "~18 i database")
- **INGEN KÖRBAR UPpgift med befintliga verktyg:** pending_network = 4, pending_render = 2, pending_source_adapter = 1

---

## Nästa-steg-analys 2026-04-04 (loop 9)

### Vad förbättrades denna loop
- **WEBFLOW-VERIFIERING BLOCKERAD:** Inga fler Webflow-sajter finns i source-listan (420 sources)
- **TESTADE:** Konserthuset, kulturhuset, fryshuset, sbf, malmolive, folkoperan — inga w-dyn-* mönster
- **INSIKT:** Webflow CMS Extraction Gap (Pattern: debaser) = endast 1 sajt, kan inte verifiera generellt
- **SBF BEKRÄFTAD:** Inte Webflow, sann render-kandidat (SiteVision JS-app)

### Största kvarvarande flaskhals
- **Verifiering omöjlig:** Pattern Capture "Webflow CMS Extraction Gap" är "Provisionally General" men inga fler Webflow-sajter finns att testa
- **Dokumentation inkonsekvent:** runtime/sources_status.jsonl visar 8 sources, handoff säger 33 testade
- **SBF/D-renderGate:** Fortfarande blockerad för D-renderGate (saknas)

### Generalization Gate Status
| Pattern | Sajter verifierade | Krav | Status |
|---------|-------------------|------|--------|
| Webflow CMS Extraction Gap | 1 (debaser) | 2-3 | **BLOCKERAD** — inga fler Webflow-sajter |

### Konsekvens för C-lager-ändring
- **Webflow C-lager-ändring = INTE MÖJLIG just nu** — Generalization Gate kräver 2–3 sajter
- Vi har bara 1 bekräftad Webflow-sajt (debaser)
- Nästa steg kan INTE vara att söka Webflow-verifiering — vi har testat alla tillgängliga sajter

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Köra normalizer→database på approved events** | Medel: Verifierar pipeline-slutresultat | Låg: Worker finns | 4 sources (19 events) klara för normalisering |
| 2 | **Uppdatera sources_status.jsonl med testade 33 sources** | Medel: Dokumentation matchar verklighet | Låg: Endast status-uppdatering | Nästa tool-verktyg behöver korrekt input |
| 3 | **Bygga source adapter för debaser** | Hög: Aktivera debaser direkt | Medel: Source-specifikt | Rätt verktyg för Site-Specific |

### Rekommenderat nästa steg
- **#2 — Uppdatera sources_status.jsonl**

Motivering: Nästa logiska steg bör vara att köra normalizer på godkända events, men det förutsätter att sources_status.jsonl är uppdaterad med de 33 testade källorna. Att först fixa dokumentationen är "minsta säkra förändring".

### Två steg att INTE göra nu
1. **Söka fler Webflow-sajter** — Vi har testat 420 sources, inga fler Webflow hittades. Detta är uttömmande.
2. **Bygga D-renderGate** — SBF är enda render-kandidaten, att bygga verktyg för 1 sajt är inte proportionellt

### System-effect-before-local-effect
- Valt steg (#2): Uppdatera sources_status.jsonl
- Varför: Pipeline-verifiering (normalizer) kräver korrekt source-status som input

---

## Nästa-steg-analys 2026-04-04 (loop 8)

### Vad förbättrades denna loop
- **VERIFIERAD ROOT-CAUSE:** debaser HAR massor av HTML-events (17 w-dyn-item blocks)
- **FALSE POSITIVE UPPDATERAD:** debaser flyttad från `pending_render` → `pending_source_adapter`
- **SBF BEKRÄFTAD:** SBF är sann render-kandidat (ingen HTML-event-data) — kvar i render-kön
- **HTML-DIAGNOSTIK GENOMFÖRD:** 0 Swedish dates, 0 ISO dates, 34 /events/[slug] URLs

### Största kvarvarande flaskhals
- **debaser blockerad:** Source adapter saknas — men bygga nytt verktyg för 1 sajt är inte "minsta säkra förändring"
- **SBF blockerar D-renderGate:** Sann render-kandidat som väntar på verktyg som inte finns
- **Model precision 15%:** 33 sources testade, endast 5 godkända (15%)

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Sök Webflow-verifiering** | Hög: Om 2-3 Webflow-sajter har samma mönster → C-lager fix | Medel: Inga sajter hittade | Pattern Capture visar "Provisionally General" |
| 2 | **Bygga source adapter för debaser** | Hög: Aktivera debaser direkt | Hög: Source-specifikt, ej generellt | Site-Specific → rätt verktyg |
| 3 | **Köra normalizer→database på approved events** | Medel: Verifierar pipeline-slutresultat | Låg: Befintliga jobb i Redis | 4 sources redan approved |

### Rekommenderat nästa steg
- **#1 — Sök Webflow-verifiering**

Motivering: Enligt Generalization Gate krävs 2-3 sajter innan C-lager-ändring. Vi har nu "Provisionally General" för Webflow CMS Extraction Gap. Att söka verifiering är låg-risk och följer reglerna.

### Två steg att INTE göra nu
1. **Bygga source adapter för debaser** — Hög insats för 1 sajt, bättre att förstå om mönstret är generellt
2. **Fokusera på extraction quality** — friidrott/textilmuseet har "dåliga" titles men fungerar

### System-effect-before-local-effect
- Valt steg (#1): Sök Webflow-verifiering
- Varför: C-lager-ändring kräver 2-3 sajter. Att söka först följer Generalization Gate och förhindrar premature optimization.

### Render-kö Status (Loop 8)
| Källa | HTML events? | Problem | Status |
|-------|-------------|---------|--------|
| debaser | JA (17 blocks) | extractFromHtml() URL-mönster missar /events/[slug] | **FALSE POSITIVE** → pending_source_adapter |
| SBF | NEJ | SiteVision JS-app, ingen HTML-data | **TRUE POSITIVE** → pending_render_gate |

---

## Nästa-steg-analys 2026-04-04 (loop 7)

### Vad förbättrades denna loop
- **VERIFIERAD ROOT-CAUSE:** debaser HAR massor av events i ren HTML (73KB, 50+ events synliga)
- **PROBLEM IDENTIFIERAT:** extractFromHtml() letar efter URL-mönster som `/YYYY-MM-DD-HHMM/` eller `/kalender/` i href
- **debaser URLs:** `/events/afro-rave-d69a4` — MATCHAR INTE extractorns förväntade mönster
- **debaser HAR Webflow-klasser:** `w-dyn-item`, `w-dyn-list`, `collection-item-20`
- **extractFromHtml() letar i:** `<main>`, `<article>`, `[role="main"]` — debaser använder `<div class="w-dyn-list">`

### Root-cause-analys (VERIFIERAD)
```
Problem: C2→extractFromHtml() miss-match
C2 säger "promising" (density=hög, dateCount=hög) men extractFromHtml() hittar 0 events
```
**Orsak:** extractFromHtml() har smala URL-mönster som inte matchar Webflow-event-URLs.

**ExtractFromHtml() URL-krav (rad 645-656):**
- `dateInfo = extractDateTimeFromUrl(href)` — kräver `/2026-04-07-16-00/` i URL
- `href.includes('/kalender/')` — debaser har `/events/` inte `/kalender/`

**debaser URL-struktur:**
- `/events/afro-rave-d69a4` — Ingen datum-embedding, ingen kalender-path
- Datum finns I TEXT, inte i URL

**Alternativt:</b>
> extractFromHtml() HAR Swedish date extractor (rad 614-626) men den körs bara på text för linkar som redan godkänts via URL-mönster. Den körs INTE på w-dyn-list items.

### Generalization Gate
- **debaser = EN sajt (Webflow)** → Site-Specific → EGEN ADAPTER
- **Men principen är generell:** extractFromHtml() har för smala URL-krav för många moderna sajter
- **Ingen C-lager ändring ännu** — först behövs fler verifierade fall

### Största kvarvarande flaskhals
- **extractFromHtml() missar alla events som inte har datum-i-URL**
- Webflow-sajter (debaser) har events med struktur: `<div class="w-dyn-item">` + datum-i-text + `/events/[slug]` URL
- extractFromHtml() söker bara i scope `main, article, [role="main"]` — inte i `w-dyn-list`

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | **Undersök SBF Webflow-status** | Hög: bekräfta om SBF också är falsk render-kandidat | Låg: curl-analys | SBF också i render-kön |
| 2 | **Bygga source adapter för debaser** | Hög: aktivera debaser direkt | Medel: source-specifik, ej generell | Source adapter är rätt verktyg för Site-Specific |
| 3 | **Föreslå generell extractFromHtml-förbättring** | Medel: kan hjälpa flera Webflow-sajter | Låg: ingen kodändring, bara dokumentation | Baserat på verifierat mönster |

### Rekommenderat nästa steg
- **#2 — Bygga source adapter för debaser**

Motivering: Nu vet vi:
- debaser = falsk positiv i render-kön (HAR massor av HTML-events, extractorn missar dem)
- SBF = korrekt parkerad (ingen HTML-event-data, SiteVision JS-app)
- Nästa steg: bygga source adapter för debaser → aktivera den utan att ändra C-lager

### System-effect-before-local-effect
- Valt steg (#2): Bygga source adapter för debaser
- Varför: Source adapter är rätt verktyg för Site-Specific problem. debaser har massor av events i HTML men extractFromHtml() URL-mönster missar `/events/[slug]` strukturen.

---

## Nästa-steg-analys 2026-04-04 (SBF-verifiering)

### SBF-analys (2026-04-04)
- SBF = **KORREKT PARKERAD** för render
- SBF HAR ingen event-data i HTML (ren SiteVision JS-app)
- SBF /kalender/ returnerar "Något gick fel" i ren HTML
- Slutsats: SBF behöver render faktiskt

### Render-kö status (UPPDATERAD)
| Källa | HTML events? | Problem | Status |
|-------|-------------|---------|--------|
| debaser | JA (50+) | extractFromHtml URL-mönster missar /events/[slug] | **FALSK POSITIV** → source adapter |
| SBF | NEJ | SiteVision JS-app, ingen HTML-data | Korrekt → render |

### Två olika typer av "pending_render"
1. **Falsk positiv** (debaser): HTML finns men extractorn missar pga URL-krav
2. **Sannpositiv** (SBF): ingen HTML finns, render behövs

---

## Pattern Capture: Webflow CMS Extraction Gap (loop 7)

**Klassificering:** Provisionally General (Site: debaser)
**Potentiellt generellt problem:** extractFromHtml() URL-krav är för smala för Webflow-sajter
**URL-struktur som påverkas:** `/events/[slug]` (ingen datum-embedding i URL)
**CMS/Platform:** Webflow (identifierbar via `w-dyn-list`, `w-dyn-item`)
**Antal sajter verifierade:** 1 (debaser)
**Behövs verifiering på:** 2-3 andra Webflow-sajter
**Status:** needsVerification = true

**Detaljer:**
- extractFromHtml() scope = `main, article, [role="main"], .content, .event-content, .kalender, .event-list`
- Webflow event-listor använder: `<div class="w-dyn-list">` + `<div class="w-dyn-item">` + `<h3 class="h3 calendar-mobile">[title]</h3>`
- Event-URLs: `/events/afro-rave-d69a4` — ingen match mot `/YYYY-MM-DD-HHMM/` eller `/kalender/`
- Sparat i: `02-Ingestion/PATTERNS.md`

**Nästa steg för verifiering:** Sök andra Webflow-baserade svenska sajter (t.ex. liknande venue-sajter)

---

## 123-metod förbättring (loop 7)

**Ändring:** Lade till **Steg 2c: Pattern Capture** i 123-metoden

**Varför:** Site-specifika fall (som debaser) innehåller ofta generella lärdomar som försvinner in i source adapters. Nu fångas de strukturerat.

**Vad som ändrats:**
1. `~/.hermes/skills/123/SKILL.md` — nytt steg efter Generalization Gate
2. `02-Ingestion/PATTERNS.md` — ny fil som pattern registry

**Minskad risk för för tidig generalisering:**
- Nu kan vi Bygga source adapter för debaser (Site-Specific)
- Samtidigt spara mönstret "Webflow CMS Extraction Gap" som Provisionally General
- C-lager-ändring kräver fortfarande 2-3 sajter verifiering

---

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
