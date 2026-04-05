# handoff.md — 2026-04-05 (UPPDATERAD)

## LOOP 20: Modellvalidering via sourceTriage

### Vad förbättrades denna loop
- Körde 7 aldrig-testade sources genom sourceTriage (C0→C1→C2 full pipeline)
- **Resultat: 1/7 success** (friidrott.se - 4 events via network path)
- C0 hittade candidatesidor för 4/7 sources men de flesta gav fortfarande 0 events
- Identifierade root cause: C2 vs extractFromHtml() osynkning bekräftad

### C0 Discovery-resultat
| Källa | C0 candidate | Density | Slutsats |
|-------|-------------|---------|----------|
| friidrott | root | - | network→4 events ✓ |
| folkoperan | root | - | wrong-type, 0 events |
| dunkers | /evenemang-dunkers/ | 25 | wrong-type, 0 events |
| eskilstuna | root | - | no-jsonld, 0 events |
| helsingborgskonserthus | /evenemang/ | 258 | wrong-type, 0 events |
| lindesberg | /omsorg-och-stod/... | 11 | no-jsonld, 0 events |
| lth | /kalendarium/ | 30 | no-jsonld, 0 events |

### Root-cause bekräftad
**C2→extractFromHtml() gap:** C2 ger "promising" baserat på density, MEN extractFromHtml() kräver specifika URL-datum-mönster. Exempel:
- helsingborgskonserthus: C0 hittade /evenemang/ (density=258), C2 säger promising → MEN 0 events
- lth: C0 hittade /kalendarium/ (density=30), C2 säger promising → MEN 0 events

**Slutsats:** extractFromHtml() URL-datum-krav är för restriktivt för dessa sajter.

### Sources-status (efter denna körning)
| Status | Antal | Kommentar |
|--------|-------|-----------|
| success | 12 | +1 (friidrott) |
| fail | 386 | -1 |
| triage_required | 14 | Oförändrad |

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | Utöka extractFromHtml() med fler datumstrategier (query-param, relaterade-sidor) | Fixar 4+ sajter med dates i URL params | Medium — kan öka brus | Root cause bekräftad: query-param datum |
| 2 | Analysera varför wrong-type → 0 events (JSON-LD finns men inga events) | Förstår JSON-LD extraction gap | Låg | 3/7 sources hade JSON-LD men 0 events |
| 3 | Kör C0→C2 på fler aldrig-testade sources (20+) | Bred modellvalidering | Låg | Mål: ≥10 nya testade |

### Rekommenderat nästa steg
**[1] — Analysera extractFromHtml() URL-datum gap på 3-5 sources** — Root cause bekräftad: query-param datum (arkdes, lth) och URL-datum-format. Behöver utökas.

### Två steg att INTE göra nu
1. **Ändra C2 scoring weights** — Generalization Gate stoppar. Bara 12 success sources.
2. **Bygga D-renderGate** — ej prioriterat (bara 3 sources i render-kö)

### System-effect-before-local-effect
Att förstå extractFromHtml() gapet är högre ROI än att skala en pipeline vi inte förstår.

---

## VIKTIG UPPDATERING: Sources Reality (2026-04-05)

**Antal sources i sources_status.jsonl:** 423

**Fördelning:**
| Status | Antal | Kommentar |
|--------|-------|-----------|
| fail (NO_REASON) | 387 | Bulk-importerade, aldriq testade |
| success | 11 | Verkligt testade |
| triage_required | 5 | cirkus, arkdes, bokmassan, smalandsposten, stenungsund |
| pending_render_gate | 3 | debaser, 2 andra |
| pending_api | 2 | ticketmaster, eventbrite |

**ROOT CAUSE:** 91% av sources kördes ALDRIG genom C0→C1→C2. De bulk-importerades men ingen triage kördes.

**Nästa steg:** Bygg batch-triage runner ELLER analysera triage_required sources manuellt.

---

## TRIAGE_REQUIRED ANALYS (2026-04-05)

**5 triage_required sources analyserade:**

| Källa | Root Cause | Åtgärd |
|--------|------------|--------|
| **cirkus** | JS-rendered (Next.js) - events i `self.__next_f.push()` payload, ej HTML DOM | `pending_render_gate` |
| **arkdes** | Datum i query-param (`?recurring-date=2026-04-04`) - extractFromHtml() stödjer EJ query-param | `pending_render_gate` |
| **bokmassan** | Svenska datum "27 september 2026" finns men extraktion misslyckas | `manual_review` |
| **smalandsposten** | Inga event-länkar i raw HTML - möjligen aggregat eller extern domän | `manual_review` |
| **stenungsund** | Event-länkar pekar på extern domän (vastsverige.com) | `manual_review` |

**ROOT CAUSE:** extractFromHtml() design gap - kräver URL-datum ELLER svensk datum-text i anchor, men arkdes har datum i query-param och andra har external event sources.

**Sources status uppdaterad:** 5 sources omklassificerade.

---

**Föregående analys:**

---

# handoff.md — 2026-04-04

## AKTIVT SCOPE (2026-04-04) — HÄR STOPPAR ANALYSEN

**Analyserade källor (denna körning):**
- nrm.se, vasamuseet.se, scandinavium.se

**Forbjudna källor (ej sanity/breadth):**
- Debaser, Eventbrite, Billetto — pre-approved production adapters
- Konserthuset, Berwaldhallen — redan verifierade produktionskällor
- Fryshuset — render-Gate, ej HTML-analys
- GU Evenemang — finns EJ i sources/, low_value enligt C2
- GSO — oklar status, unclear enligt C2

**Mappning:** c1-c2-results.json (100+ sources, 2026-04-03)

---

## Problem (Verifierat och löst ✓)

**HTML-path: ingen event-extraktion fanns**

C2-htmlGate gav `verdict: "promising"` för Konserthuset Stockholm men:
1. sourceTriage körde INTE htmlGate C2 som extractor
2. phase1ToQueue körde endast extractFromJsonLd (0 events för no-jsonld)
3. C2-htmlGate var endast en gate, inte en extractor

## Lösning implementerad ✓

1. La till `extractFromHtml()` i `F-eventExtraction/extractor.ts`
   - URL-datum extraktion (två mönster: YYYY-MM-DD-HHMM och YYYYMMDD-HHMM)
   - Svenska datum i text
   - Kalender-länk scanning med deduplicering

2. Modifierade `phase1ToQueue.ts`:
   - JSON-LD först, HTML fallback
   - Provar kalender-subpaths (/program-och-biljetter/kalender/, etc.)

## Verifiering ✓

### phase1ToQueue (Konserthuset Stockholm)
```
[phase1→queue] JSON-LD: 0 events, HTML on main page: 8 events
Queuing 8 events from https://www.konserthuset.se/
✅ extracted=8, queued=8
```

### Worker → Database
Worker startad och konsumerar jobb. Redis visar:
- bull:raw_events:konserthuset-konserthuset-* (7 keys)
- processedOn satt på alla jobb

### Database verification (2026-04-02 04:39)
```
SELECT id,title_en,source,dedup_hash FROM events WHERE source='konserthuset';
→ "Fredag 17 april 2026 kl 19"
→ "Konserthuset 100 år – Jazzigt med Belleville Trio"
→ "Belleville Trio spelar jazz i Django Reinhardt-stil"
→ "Fredag 13 november 2026 kl 19"
→ "Konserthuset 100 år – Utställningar"
```

### Berwaldhallen (tidigare verifierat 2026-04-02 02:33)
```
"Radiokören tolkar Palestrina - i Storkyrkan"
"Bach & Brahms enligt Stutzmann"
"Emelyanychev tolkar Salonen & Schumann"
"Strauss Elektra-svit"
```

## Commit ✓

`721aa22` — feat(ingestion): add HTML extraction fallback for no-jsonld sources

## HTML extraction URL-dubblering — FIXAT ✓

**Problem:** URL-dubblering: `/program-och-biljetter/kalender/konsert/...` blev dubbel sökväg.

**Orsak:** `resolveUrl()` i `extractFromHtml()` konkatenerade `base + href` för absoluta hrefs.

**Fix:** Använd `URL.origin + href` istället för `base + href` för absoluta hrefs.

**Verifiering:**
```
npx tsx -e "extractFromHtml(html, 'konserthuset', 'https://www.konserthuset.se/program-och-biljetter/kalender/')"
→ URL: https://www.konserthuset.se/program-och-biljetter/kalender/konsert/2026-04-17-19-00/ ✓
```

**Commit:** `a3b4f0e`

## Fryshuset JS-rendered upptäckt (2026-04-03)

**Problem:** Fryshuset har JS-rendered content. HTML innehåller bara 90 tecken i `<main>` - allt event-innehåll laddas via JavaScript.

**Förbättring:** Lagt till JS-render-detektion i C1-preHtmlGate och C3-aiExtractGate:

1. C1.screenUrl() returnerar `likelyJsRendered` (heuristik: tom main + låg text-densitet)
2. C3.returnerar `fallbackToRender` när sidan behöver rendering

**Ny fil:** `02-Ingestion/tools/pendingRenderQueue.ts`
- Mottager kandidater som behöver D-renderGate
- Status: `pending_render_gate`
- Signal: `js_rendered_c1` eller `js_rendered_c3`

## Source Management System (2026-04-03)

**Systematisk kaosriar och import av alla källspår.**

### Scan results

| Fil | Typ | Antal | Klassificering |
|-----|-----|-------|----------------|
| `01-Sources/100testcandidates.md` | Testrapport | 100 | Sources-dictionary |
| `01-Sources/candidate-lists/` | Scouting | ~100 | Sources-dictionary |
| `01-Sources/active/active.md` | Aktiva | 6 | Sources-dictionary |
| `02-Ingestion/sourceRunner.ts` | Hardkodade | 8 | Sources-dictionary |
| `sources/` | Source truth | 8 | ✓ Används |
| `runtime/sources_status.jsonl` | Runtime | — | ✓ Rättat |

### Rättningar

1. **runtime/sources_status.jsonl** — innehöll source truth istället för status. Rättat.
2. **sources/** — rensat och återuppbyggt med verifierade källor.
3. Lagt till `sources/fryshuset.jsonl`, `sources/debaser.jsonl`, `sources/gso.jsonl`

### sources/ nu

| ID | URL | Typ | Preferred Path |
|----|-----|-----|----------------|
| konserthuset | www.konserthuset.se/... | konserthus | html |
| berwaldhallen | www.berwaldhallen.se | konserthus | jsonld (tixly) |
| kulturhuset | www.kulturhuset.se | kulturhus | network |
| ticketmaster | www.ticketmaster.se | aggregator | api |
| eventbrite | www.eventbrite.se | aggregator | jsonld |
| fryshuset | fryshuset.se/kalendarium | arena | render |
| debaser | debaser.se | musik | unknown |
| gso | www.gso.se | konserthus | unknown |

### Schema separation (bekräftad)

- `sources/` = SourceTruth (discoveredAt, preferredPath, discoveredBy)
- `runtime/sources_status.jsonl` = SourceStatus (lastRun, status, consecutiveFailures)
- `runtime/pending_render_queue.jsonl` = D-renderGate kandidater
- `runtime/sources_priority_queue.jsonl` = Scheduler prioritet

## Nästa steg

1. ~~Bygga source management system~~ ✓ KLART
2. ~~Rensa sources/~~ ✓ KLART
3. ~~Rätta runtime/sources_status.jsonl~~ ✓ KLART
4. Analysera "promising→0 events" failure pattern [PÅGÅENDE]

---

## Nästa-steg-analys [2026-04-04 — Loop 17]

### Vad förbättrades denna loop
- **berwaldhallen** via scheduler: 216 events via network path (Tixly API)
- **konserthuset** via scheduler: 11 events via HTML path
- **gso**: C1=manual_review (DNS resolution failed) — fel source, behöver ej köras
- Network path integration fungerar i scheduler (execute_network)

### Största kvarvarande flaskhals
**Modellvalidering ej bred.** Bara 8/420 sources testade (1.9%). Ingen systematisk mätning av C0/C1/C2 prestanda.

### Sources-status (efter denna körning)
| Status | Antal |
|--------|-------|
| success | 8 |
| fail | 9 |
| pending_render | 2 |
| pending_network | 3 |
| pending_api | 2 |
| triage_required | 8 |
| never_run | ~380 |

### Nästa-steg-analys [2026-04-04]

### Vad förbättrades denna loop
- Identifierade root cause: C2 "promising" ≠ extractFromHtml() URL-datum krav
- NRM har events men URL-pattern `/evenemangsfakta/[slug]` utan datum
- scandinavium.se redirectar till gotevent.se — source-status felaktig
- SiteVision CMS-pattern misstänkt (CSS-class cards, ej URL-datum)

### Största kvarvarande flaskhals
**C2 vs extractFromHtml() osynkning.** C2 mäter page density men extractFromHtml() kräver URL-datum eller specifikt datum-format.

### Tre möjliga nästa steg
|| # | Steg | Systemnytta | Risk | Varför nu |
||---|------|-------------|------|-----------|
|| 1 | Batch-testa 10+ aldrig-körda sources via scheduler --triage-batch | Bred modellvalidering | Låg — readonly diagnostik | Mål: ≥10 sajter testade |
|| 2 | Analysera siteviz/URL-mönster på 3+ fungerande sajter | Förstå extractFromHtml() krav | Låg | Förbättrar C2→extract synk |
|| 3 | Sök nya Tixly-baserade venues (network path) | Utökar working sources | Medium — API kan saknas | bekräftad path för 1 venue |

### Rekommenderat nästa steg
**[1] — Kör scheduler --triage-batch på triage_required + never_run sources** — bredast modellvalidering för minst arbete

### Två steg att INTE göra nu
1. **Fördjupa nrm/vasamuseet/scandinavium** — Site-Specific pattern (C2 vs extract gap), Generalization Gate stoppar
2. **Bygga D-renderGate** — ej prioriterat (bara 2 sources i render-kö)

### System-effect-before-local-effect
10+ sources testade → mätbar modellprestanda → data-driven förbättring. Utan bred validering: enskilda fixes teater.

### Största kvarvarande flaskhals
**C2 och extractFromHtml() är inte synkade.** C2 använder breadth_wrongtype-logik (dateCount, densityScore) för att avgöra "lovande", men extractFromHtml() kräver specifika URL-mönster (YYYY-MM-DD-HHMM eller /kalender/) för att extrahera events.

Exempel:
- nrm.se: C2 säger promising (dateCount=0 men density hög) → extractFromHtml() hittar 0 events
- vasamuseet.se: C2 säger promising → 0 events
- scandinavium.se: C2 säger promising → 0 events

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | Analysera 3-5 "promising→0 events" failures i detalj (nrm, vasamuseet, scandinavium) | Hitta exakt var extraktionen brister | Låg — diagnostik | Rätt timing för att förstå presisionsproblem |
| 2 | Utöka extractFromHtml() med fler datumstrategier | Förbättrar extraktion brett | Medium — kan öka brus | Om mönstret är generellt |
| 3 | Justera C2 threshold för att kräva faktiska URL-datum i candidates | Bättre precision, färre falska positiver | Medium — kan blockera giltiga källor | Om problemet är att C2 är för liberal |

### Analysresultat: "promising→0 events" failure pattern (2026-04-04)

**Tre failures analyserade:**
1. **nrm.se** — C1=strong(11tt+4d), C2=promising(score=60) → extractFromHtml()=0 events
2. **vasamuseet.se** — C1=weak(tt=0,d=0,h=3,li=0), C2=promising(score=13) → extractFromHtml()=0 events
3. **scandinavium.se** — C1=weak(tt=0,d=0,h=7,li=8), C2=promising(score=38) → extractFromHtml()=0 events

**ROOT CAUSE identifierad:**
C2 och extractFromHtml() är osynkade. C2 ger "promising" baserat på viktade signals (venueMarker×1, priceMarker×1, datePatterns×1, eventTitles×1), men extractFromHtml() kräver specifika mönster:

- **URL-datum** i href: `/2026-04-17-19-00/` eller `/kalender/20260417-1600/`
- **Svenska datum-text**: `\d{1,2} månad \d{4}` — t.ex. "7 april 2026"
- **ISO-datum i path**: `/2026/04/17/`

Utan dessa mönster ger extractFromHtml() 0 events, oavsett C2:s score.

**C2 vs extractFromHtml() gap:**
| Källa | C2 score | Dominant signal | extractFromHtml() krav | Matchar? |
|-------|----------|-----------------|------------------------|----------|
| nrm.se | 60 | venueMarker | kräver URL-datum ELLER svensk text | ❌ |
| vasamuseet | 13 | priceMarker | kräver URL-datum ELLER svensk text | ❌ |
| scandinavium | 38 | venueMarker | kräver URL-datum ELLER svensk text | ❌ |

**Rekommenderat nästa steg:**
- **[1] — Analysera 3-5 "promising→0 events" failures i detalj** ← KLART (ovan)
- **[2] — Förstå exakt vilka URL/date-mönster som behövs för att extrahera events på dessa sajter**
- **[3] — Jämföra med Konserthuset (som FUNGERAR: 8 events via extractFromHtml())** — konserthuset har `/program-och-biljetter/kalender/` i URL + Swedish date-text

**Konserthuset som referens (fungerar ✓):**
- C1: weak(tt=0,d=11,h=11,li=38)
- C2: promising(score=15, pg=date-pattern)
- extractFromHtml(): 8 events — fungerar tack vare `/kalender/` i href + svensk datumtext

### System-effect-before-local-effect
Val av rätt candidate page → extraktion → events i databas. Fel i tidigare steg förstör allt nedströms. Att förstå varför "lovande" inte ger events är högre ROI än att skala en pipeline vi inte förstår.

---

### Förklaring av pipeline-resultat

Pipeline: diagnoseUrl → networkGate → runHtmlDiscovery(C0→C1→C2) → extractFromHtml()

Batch 1 (23 sources):
- gate=unclear: 8 (C2 kan inte avgöra)
- gate=promising: 6 (C2 säger lovande men 0 events) ← PROBLEMET
- extracted: 5 (faktiskt extrigerade events ✓)
- gate=low_value: 3 (C2 säger lågt värde)
- gate=maybe: 1

**Kärnproblem:** C2:s "promising" baseras på sidstruktur (dateCount, densityScore), inte på om URL-patterns i extractFromHtml() matchar.

### Nästa konkreta undersökning
Köra sourceTriage direkt på nrm.se och vasamuseet.se för att se exakt:
1. Vilka candidates C0 hittar
2. Vilka signals C1 mäter
3. Vad C2 scorer
4. Vad extractFromHtml() faktiskt hittar

---

## Nästa-steg-analys [2026-04-05 — Loop 19]

### Vad förbättrades denna loop
- **Verifierade root cause för triage_required → 0 events**: Scheduler:s triage-mode kör endast C1 på root-sida, INTE C0 som upptäcker interna candidatesidor
- **Verifierade att kommunal-sajter har两层 navigation**: Root-sida har "uppleva och göra" meny → event-sida under → eventsida med kalender i tredej
- **Verifierade att polismuseet.se har /kalendarium/ page**: Root-URL redirectar, /kalendarium/ finns men extractFromHtml() kan inte extrahera events pga fel format
- **Identificerade SiteVision CMS-mönster**: Kumla, Hallsberg, Karlskoga använder SiteVision med navigationsstruktur som inte matchar extractFromHtml() scope

### Största kvarvarande flaskhals
**Scheduler:s triage-mode bypassar C0 (htmlFrontierDiscovery)**. Kod i `scheduler.ts` rad 561-628:
1. Kör `screenUrl()` (C1) på root URL
2. Om C1 = html_candidate → direkt `extractFromHtml()` på root-sida
3. **Aldrig**: kör C0 för att upptäcka interna candidate pages
4. **Aldrig**: kör C2 för att utvärdera candidates

### Sources-status (efter denna körning)
| Status | Antal | Kommentar |
|--------|-------|-----------|
| success | 20 | +1 (katrineholm med 2 events) |
| fail | 376 | |
| triage_required | 14 | Stabil, samma sources failar repeterat |
| pending_render_gate | 5 | |
| manual_review | 3 | |

### Root-cause bevis

**hallsberg, karlskoga, kumla (alla SiteVision):**
- C1 säger: `html_candidate (strong/medium) - 6-4 time-tags + 6-4 dates`
- extractFromHtml() på root: `0 events`
- curl visar: Endast navigationsmenyer och nyhetssidor på root
- Event-calendar under: `/uppleva-och-gora/kalender-och-evenemang/` eller liknande

**polismuseet:**
- C1 säger: `html_candidate (strong) - 24tt + 10 dates`
- extractFromHtml() på root: `0 events`
- curl visar: `/besok-polismuseet/kalendarium/` har eventsida med `/kalendarium/pratapolis/`, `/kalendarium/pa-patrull/`, `/kalendarium/guidad-visning-polisliv/`
- Men `/kalendarium/` har INTE URL-datum-mönster och extractFromHtml() ignorerar det

**katrineholm (fungerar):**
- C1 säger: `html_candidate (strong) - 23 time-tags + 20 dates`
- extractFromHtml() på root: `2 events`
- Root har redan events i rätt format

### Tre möjliga nästa steg

| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | Aktivera C0 discovery i scheduler triage-mode | Fixar 14+ triage_required sources som har events men på intern page | Medium — C0 kan hitta fel pages | 14 sources har strong C1 men 0 events - chansen är hög |
| 2 | Analysera sitevision-sajter som grupp (kumla, hallsberg, karlskoga, etc.) | Förstå SiteVision navigation patterns generellt | Låg - diagnostik | SiteVision är vanligt i Sverige (kommuner, myndigheter) |
| 3 | Uppdatera sources_status.jsonl för korrekta event page URLs | Gör att scheduler kan köras direkt på rätt page | Medium - manuell insats | Finns redan internal candidates för vissa sources |

### Rekommenderat nästa steg
**[1] — Aktivera C0 discovery i scheduler.ts triage-mode** — Endast ändring behövs: i `runSource()` när `triageOutcome === 'html_candidate'`, kör `discoverEventCandidates()` före `extractFromHtml()`. Detta fixar 14+ triage_required sources som har stark C1 men 0 events på root.

### Två steg att INTE göra nu
1. **Ändra extractFromHtml() för att han fler URL-format** — Generalization Gate stoppar. SiteVision-sajter har olika URL-strukturer. Bättre att hitta rätt page via C0.
2. **Justera C1 thresholds för att minska html_candidate** — Detta skulle minska recall. Strong signals är korrekta, problemet är att vi testar root istället för candidates.

### System-effect-before-local-effect
Aktivera C0 i triage-mode ger bred effekt: varje triage_required source som har strong/medium C1 men 0 events är en kandidat. C0 upptäcker interna pages som gör att extractFromHtml() hittar events. Detta är högre ROI än site-specifika fixes.

### Evidence från denna körning
```
hallsberg: C1=strong (6tt+6d) → extractFromHtml(root)=0 → SiteVision, ingen kalender-sida i root
kumla: C1=strong (4tt+4d) → extractFromHtml(root)=0 → SiteVision, "uppleva och göra" meny inte events
karlskoga: C1=medium (3tt+10h) → extractFromHtml(root)=0 → SiteVision, ingen event-page på root
polismuseet: C1=strong (24tt+10d) → extractFromHtml(root)=0 → /kalendarium/ existerar men url-format fel
katrineholm: C1=strong (23tt+20d) → extractFromHtml(root)=2 → fungerar pga events redan på root
```

---

## NÄSTA-STEG-ANALYS [2026-04-05 — Loop 18]

### Vad förbättrades denna loop
- **12 nya sources blev success** från html_candidate status (screened men aldrig extraherade)
- **Total events ökade från ~250 till 278** (+28 events)
- **success rate förbättrad: 9→20 sources** (+122% ökning)
- **fail reducerat: 402→376** (-26 sources omplacerade till success)
- Identifierade root cause: **triage-batch körde ENBART C1, inte extractFromHtml()**

### Största kvarvarande flaskhals
**Modellvalidering fortfarande begränsad.** Även med 20 success sources:
- Många har lågt eventantal (1-4 events)
- Vissa (13 stycken) har strong C1 signals men ändå 0 events efter full pipeline
- render_candidate (40) och still_unknown (197) blockerar fortfarande

### Sources-status (efter denna körning)
| Status | Antal | Kommentar |
|--------|-------|-----------|
| success | 20 | +11 från denna session |
| fail | 376 | -26 från denna session |
| pending_render_gate | 5 | |
| render_candidate | 40 | C1 sa JS-rendered |
| manual_review | 138 | C1 kunde inte avgöra |
| still_unknown | 197 | Fetch-fel (404, timeout, DNS) |

### Tre möjliga nästa steg
| # | Steg | Systemnytta | Risk | Varför nu |
|---|------|-------------|------|-----------|
| 1 | Kör scheduler på render_candidate (40 sources) | Utökar working sources med ~20-30% | Medium — D-renderGate behövs | Alla har starka signals men HTML behöver rendering |
| 2 | Fördjupa 13 "strong signal → 0 events" sources | Förstå C1→C2→extract gap | Låg — diagnostik | dessa har tt≥6 eller d≥10 men ändå 0 events |
| 3 | Analysera still_unknown (197) — varför fetch failar | Förstå blockeringsorsak | Låg — kan vara DNS/robots/blocking | Största enskilda grupp efter success |

### Rekommenderat nästa steg
**[2] — Analysera 13 "strong signal → 0 events" sources** — dessa har C1 med tt≥6 ELLER d≥10 men ändå 0 events efter full pipeline (scheduler med C0→C1→C2→extractFromHtml). Exempel: polismuseet (24tt), hallsberg (6tt+6d), karlskoga (10tt). Root cause kan vara:
- extractFromHtml() URL-date kravet är för restriktivt
- C2 density scoring mismatchar med extract logik
- Dessa sources har datum i text men inte i URL

### Två steg att INTE göra nu
1. **Köra triage-batch igen** — det löste problemet denna gång MEN det var en engångsfix pga att triage-batch bara körde C1. Om nya sources läggs till behöver de full pipeline, inte bara C1.
2. **Justera IGNORE_PATTERNS eller scoring weights** — Generalization Gate regler gäller. Vi har bara 20 success sources, inte tillräckligt för att dra generella slutsatser.

### System-effect-before-local-effect
13 "strong signal → 0 events" sources representar en specifik subgrupp där C1 säger strong/medium men extractFromHtml() returnerar 0. Att förstå detta gap hjälper C2→extract synkningen generellt, inte bara dessa specifika sources.

### Root-cause upptäckt denna session
**triage-batch kommandot i scheduler.ts körde endast C1 (screenUrl), INTE hela pipelinen (C0→C1→C2→extractFromHtml).**
- Konsekvens: 27 sources fick triageResult=html_candidate men extraktion kördes aldrig
- Lösning: Kör scheduler --source <id> istället för --triage-batch för full pipeline
- Dokumenterad i systemet: html_extraction_review som pendingNextTool betyder "vänta på full pipeline"
