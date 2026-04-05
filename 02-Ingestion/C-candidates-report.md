# C-Kandidat-Rapport

**Genererad:** 2026-04-05  
** Källa:** `runtime/sources_status.jsonl`

---

## Översikt

| Grupp | Namn | Antal | Definition |
|-------|------|-------|------------|
| A | **VERIFIED** | 21 | `status=success` + `eventsFound > 0` |
| B | **TRIAGE_REQUIRED** | 13 | C1=säger html_candidate MEN extraction=0 |
| C | **UNTESTED** | 368 | `preferredPath=MISSING`, aldrig triage-körd |
| D | **D-PENDING** | 5 | `pendingNextTool=D-renderGate` |
| E | **E-MANUAL** | 3 | `status=manual_review` |
| F | **B-PENDING** | 2 | `status=pending_api` |
| G | **ÖVRIGA** | 8 | Har preferredPath men status≠success |

**Total:** 420 rader

---

## Grupp A — VERIFIED (21 källor)

Dessa har bevisat sig ge events > 0. Ska inte testas igen.

| Källa | Events | preferredPath |
|--------|--------|--------------|
| berwaldhallen | 216 | network |
| svenska-schackf-rbundet | 50 | jsonld |
| konserthuset | 11 | html-heuristics |
| abf | 8 | html-heuristics |
| jonkoping | 7 | html-heuristics |
| studio-acusticum | 5 | html-heuristics |
| karlskrona | 4 | html-heuristics |
| ornskoldsvik | 4 | html-heuristics |
| textilmus-et | 3 | html-heuristics |
| ois | 3 | html-heuristics |
| friidrottsf-rbundet | 3 | html-heuristics |
| malmo-opera | 3 | html-heuristics |
| mjolby | 2 | html-heuristics |
| aik | 1 | html-heuristics |
| liljevalchs | 2 | html-heuristics |
| mariestad | 1 | html-heuristics |
| borlange | 1 | html-heuristics |
| molndals | 1 | html-heuristics |
| kungsbacka | 1 | html-heuristics |
| katrineholm | 1 | html-heuristics |
| malmo-stad | 1 | html-heuristics |

**Subpage-status:** Endast root testad. Ingen dokumentation om subpage-inspektion.

---

## Grupp B — TRIAGE_REQUIRED (13 källor)

**Status:** C1=säger html_candidate men extraction=0 events

**Kritisk observation:** Ingen subpage-inspektion dokumenterad för dessa.
Innan dessa klassas som C-kandidater bör A+B testas på eventuella undersidor.

| Källa | Försök | Nästa steg |
|--------|--------|------------|
| hallsberg | 3 | html_extraction_review |
| ifk-uppsala | 2 | html_extraction_review |
| karlskoga | 3 | html_extraction_review |
| kumla | 2 | html_extraction_review |
| kungliga-musikhogskolan | 1 | html_extraction_review |
| lulea-tekniska-universitet | 1 | html_extraction_review |
| naturhistoriska-riksmuseet | 1 | html_extraction_review |
| orebro-sk | 1 | html_extraction_review |
| polismuseet | 1 | html_extraction_review |
| stockholm-jazz-festival-1 | 2 | html_extraction_review |
| svenska-fotbollf-rbundet | 1 | html_extraction_review |
| uppsala-kommun | 1 | html_extraction_review |
| ystad | 1 | html_extraction_review |

**Rekommendation:**这些 ska INTE räknas som C-verifierade ännu. Subpage-inspektion (A+B på /events, /kalender etc.) krävs först.

---

## Grupp C — UNT ESTED (368 källor)

**Status:** `preferredPath=MISSING` — aldrig triage-körda

**Viktigt:** Dessa är inte C-kandidater — de är otestade. De måste först genom C0→C1 screening innan de kan kategoriseras.

**Fördelning:** Samtliga 368 har `status=fail` men `preferredPath=MISSING`, vilket betyder:
- Importerade från RawSources
- Aldrig testade genom triage

**Exempel (första 20):**
```
friidrottsf-rbundet, malmo-opera, allt-om-mat, arbetsam, artipelag,
a6, abb-arena, af, avicii-arena-sport, avicii-arena, bang, b-republic,
bang, best-of-svenska, best-western, biblioteken, biologiska,
blackstone, bok, bokhandeln, burger, byredo, b99
```

---

## Grupp D — D-PENDING (5 källor)

**Status:** `pendingNextTool=D-renderGate` — D-renderGate EJ integrerat

| Källa | Observation |
|-------|-------------|
| debaser | D-renderGate markerad, renderGate saknas |
| cirkus | D-renderGate markerad |
| arkdes | D-renderGate markerad |
| akersberga | D-renderGate markerad |
| bor-s-zoo-animagic | D-renderGate markerad |

**Viktigt:** Denna grupp är korrekt parkerad. D-renderGate finns inte i pipeline.

---

## Grupp E — E-MANUAL (3 källor)

**Status:** `status=manual_review` — alla paths testade, behöver manuell granskning

| Källa | Observation |
|-------|-------------|
| bokmassan | 0 events efter alla paths |
| smalandsposten | 0 events efter alla paths |
| stenungsund | 0 events efter alla paths |

---

## Grupp F — B-PENDING (2 källor)

**Status:** `pendingNextTool=api_adapter` — API-nyckel saknas

| Källa | Observation |
|-------|-------------|
| ticketmaster | API-nyckel saknas |
| eventbrite | API-nyckel saknas |

---

## Grupp G — ÖVRIGA (8 källor)

**Känt sedan tidigare som "path-but-fail"**

| Källa | Status | preferredPath | Events | Observation |
|-------|--------|---------------|--------|-------------|
| kulturhuset | fail | network | 0 | API endpoint timeout/404 |
| fryshuset | fail | network | 0 | Render failed: net::ERR_FAILED |
| gso | fail | network | 0 | DNS resolution unclear |
| dramaten | fail | html-heuristics | 1 | 1 event — borde vara success? |
| vasamuseet | fail | html-heuristics | 0 | C1 strong men extraction=0 |
| scandinavium | fail | html-heuristics | 0 | C1 strong men extraction=0 |
| astronomiska-huddinge | fail | html-heuristics | 0 | Ej testad ordentligt |
| folkoperan | fail | html-heuristics | 0 | C1 strong men extraction=0 |

**Observation:** `dramaten` har 1 event men status=fail. Detta tyder på att threshold för "success" är högre än 1 event.

---

## Osäkerheter och data-problem

### 1. `preferredPath=MISSING` ≠ aldrig testad
Faktum: 368 källor har `preferredPath=MISSING` OCH `status=fail`. Detta betyder att triage körts men ingen preferredPath bestämts. Vi kan inte skilja mellan "aldrig testad" och "testad men path ej fastställd" utan mer data.

### 2. `dramaten` anomali
- 1 event extraherat
- `status=fail`
- `preferredPath=html-heuristics`

Detta tyder på att success-threshold är > 1 event, eller så finns ett annat kriterium.

### 3. Subpage-inspektion dokumenteras ej
Ingen av de 420 raderna har `checkedSubpages` eller liknande fält. Vi kan inte se om /events, /kalender etc. testats.

### 4. C1 vs C2 vs extraction-resultat
triageHistory innehåller C1-resultat (html_candidate) men ingen dokumentation av:
- Vilka subpages som hittats
- Om A (JSON-LD) testats på subpages
- Om B (network) testats på subpages

### 5. eventsFound vs lastEventsFound
Båda fälten verkar finnas, men endast `lastEventsFound` är dokumenterat i framgångsrika sources.

---

## Praktisk C-kö

### Steg 1 — Verified sources (21)
Dessa är klara. Ska inte testas igen.

### Steg 2 — Triage_required + Övriga med events>0 (13 + 1?)
- 13x triage_required: Behöver subpage-inspektion
- dramaten (1 event): Threshold-problem, inte C-miss
- **Dessa bör INTE ingå i C-kö förrän subpages testats**

### Steg 3 — Övriga med pref=html (4)
- vasamuseet, scandinavium, astronomiska-huddinge, folkoperan
- Alla har `preferredPath=html` men 0 events
- Dessa är svaga C-kandidater — behöver subpage-inspektion

### Steg 4 — Untested (368)
- Måste först screenas med C0→C1
- Kan inte ingå i C-kö ännu

---

## Metadatafält som saknas (observerade)

Dessa fält behövs för att göra framtida rapporter mer exakta:

| Fält | Saknas i | Varför behövs |
|------|----------|---------------|
| `methodCandidate` | 420/420 | För att veta vilken path som förväntades |
| `verificationStatus` | 420/420 | För att skilja untested från tested_no_events |
| `checkedSubpages` | 420/420 | För att se om subpages testats |
| `checkedPaths` | 420/420 | A-root, B-root, A-sub, B-sub, etc. |

---

## Slutsats

**C-kandidatköns verkliga storlek just nu är okänd**, eftersom:

1. 13x triage_required har inte subpage-testats
2. 4x Övriga (html-men-0-events) har inte subpage-testats
3. 368x untested har aldrig triage-körts
4. 5x D-pending är korrekt parkerade
5. 21x verified är klara

**C-kandidat i strikt mening (C1=säger html_candidate, extraction=0, subpages ej testade):** 17 källor (13+4)

**C-kandidat i bred mening (alla som någonsin fått html-rekommendation):** Okänt — behöver analysera triageHistory djupare.
