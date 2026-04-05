# handoff.md — 2026-04-05

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
