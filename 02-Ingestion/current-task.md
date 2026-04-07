# Current Task

## Område
02-Ingestion

## Status
**AKTIV** — Tidigare markerad som "HISTORICAL ONLY", nu aktiverad efter 01-Sources fasavslut.

## Hård stop-regel (C-batch-state)

**Om `02-Ingestion/C-htmlGate/reports/batch-state.jsonl` existerar med `status ∈ {pending, testing, idle}`:**
- ALL fri root-cause-analys är BLOCKERAD
- ALL fri val av "nästa steg" från triage_required är BLOCKERAD
- Endast giltiga beteendet är C-batchflödet nedan
- current-task.md ska peka på batch-state som enda startpunkt
- Ingen annan uppgift får väljas förrän batch-state är `completed`

**Om batch-state INTE existerar eller status = completed:**
- Då är denna current-task giltig som startpunkt

## Purpose
This file defines the CURRENT task for the AI.
It is the ONLY valid task.
Nothing else may be worked on.
If unclear → STOP.

## Huvudmål (C — HTML Path — JUST NU)

**C:s huvudmål just nu är att testa om HTML-scrapingmodellen är effektiv i praktiken.**

Gör så här:
1. Testa cirka 10 olika HTML-källor via nuvarande HTML-heuristik (C0→C1→C2→extract)
2. AI analyserar varje källa och kontrollerar om HTML-modellens slutsatser är sanna, ofullständiga eller felaktiga
3. Om modellen missar events eller misstolkar strukturen → förbättra HTML-modellen så källan kan scrapas korrekt efteråt
4. Spela in återanvändbara mönster: vilka HTML-mönster, blocktyper, signaler och extraktionsmetoder som fungerar
5. Om en metod är generell nog → den ska kunna appliceras på snarlika källor utan AI-analys

**Strategisk målbild:** Utveckla generella HTML-metoder som tillsammans kan hitta och extrahera events från ~85% av scrapbara HTML-sidor.

**Viktigt:** Fokus på bred mönsterigenkänning, inte site-specifika hack.

---

## Problem (STRICT)

HTML Path fungerar för vissa sajter men den **generella modellen** är inte utvärderad BRETT.

Nuvarande beteende:
- C0/C1/C2 har implementerats men endast testats på 1-3 sajter
- Vi vet inte om signalsystemet (dateCount, timeTagCount, densityScore) fungerar **generellt**
- Vi vet inte om IGNORE_PATTERNS och concept-scoring är för restriktiv eller för bred
- Vi har ingen systematisk mätning av precision vs recall över **många domäner**

Det primära problemet är nu inte "enskild sajt fungerar inte", utan **"modellen är inte validerad brett"**.

---

## New Direction

Nästa steg är att **validiera modellen BRETT** innan vi gör fler site-specifika justeringar:

1. **Systematisk modell-utvärdering**
   - Kör sourceTriage på 10+ html_candidates
   - Mät precision vs recall för C0/C1/C2
   - Jämför genererade signalscores mot faktiska utfall
   - Identifiera var modellen Missar vs var den Träffar

2. **AI-Assisted Pattern Analysis**
   - Använd AI för att jämföra utfall över **flera sajter**
   - Hitta generella mönster i failure cases
   - Föreslå endast generella förbättringar (ej site-specifika)

3. **Regel-justering med Generalization Gate**
   - Varje föreslagen ändring måste motiveras: "hjälper detta 3+ sajter?"
   - Site-specifika fixes rapporteras men implementeras EJ i C-lager
   - Source adapters används för site-specifika edge cases

**VIKTIGT:** 
- INGEN djupsökning på enskild site om det inte är för att förstå ett generellt mönster
- INGEN site-specifik kod i C0/C1/C2
- Varje ändring måste ha bred validiering innan den accepteras

---

## Entry Point (CRITICAL)

Primärt område:
- `services/ingestion/src/tools/`

Primära verktyg:
- `C1-preHtmlGate.ts`
- `C2-htmlGate.ts`
- `extract/extractor.ts`

AI-stöd får kopplas in endast som litet beslutssteg efter kandidatinsamling och före slutligt sidval.

---

## Goal (MEASURABLE)

Minst 10 verkliga testdomäner ska testas och den generella modellens prestanda ska mätas.

Mätetal:
- antal sources testade (mål: ≥10)
- precision: % av valda candidates som faktiskt ger events
- recall: % av möjliga events som hittades (om källa har känt antal)
- generella mönster identifierade i failure cases
- förbättringsförslag som gäller BRETT (3+ sajter)

Målnivå:
- Minst 10 html_candidates körda genom C0→C1→C2→extract
- Dokumenterade mönster i vad som fungerar vs vad som inte fungerar
- Minst 1 generell förbättring identifierad och testad
- Inga site-specifika hardcoding-försök

---

## Constraints

- Do not modify other domains
- Do not introduce fake data
- Do not redesign the whole system
- Make the smallest possible change
- Build discovery before extraction changes
- AI is support, not truth
- Render path remains fallback, not first solution

---

## Workflow

ingestion-loop.md

---

## Verification

verify-end-to-end.md

---

## Execution Rules (STRICT)

- ONE problem only
- DO NOT switch task
- DO NOT expand scope
- DO NOT refactor unrelated code
- DO NOT move to render unless HTML discovery clearly fails
- DO NOT use AI as a free-form crawler

---

## Status

- IN PROGRESS: move from root-fixed HTML path to candidate-page discovery
- Previous HTML path was too page-centric
- New focus: HTML Frontier Discovery + optional AI-assisted routing
- Render path is NOT the current task

---

## Progress Tracking (CRITICAL)

Track system-wide metrics, NOT per-site fixes:
- sources tested (cumulative)
- precision per source (did candidate selection match real events?)
- recall per source (did we find most/all events?)
- patterns found: what works generically, what fails generically
- AI-generated insights: cross-site patterns in failure cases
- rule changes proposed vs accepted (must have 3+ site evidence)

DO NOT track:
- "fixed X for site Y" (that's site-specific, not model improvement)
- "now finding more events on Z" (symptom, not root cause)
- individual site deep-dives unless they reveal a cross-site pattern

---

## Notes

The new truth:
- If the model doesn't work broadly, fixing individual sites is theater.
- We need cross-site validation BEFORE proposing rule changes.
- AI should find patterns across sites, not diagnose individual sites.

Therefore:
- first validate the model broadly (10+ sites)
- then find generic patterns
- then improve the model with evidence
- never hardcode for single sites

---

## NEW DISCOVERY: Network Path Works for Some Sources

### Key Findings (Loop 16)

1. **berwaldhallen has working Tixly API**
   - URL: `https://www.berwaldhallen.se/api/services/tixly/data`
   - Returns 216 events (verified via curl)
   - network_inspection correctly identifies `likely_event_api: 1`

2. **network_event_extractor works**
   - New file: `02-Ingestion/B-JSON-feedGate/networkEventExtractor.ts`
   - Successfully extracts 216 events from berwaldhallen Tixly API
   - 0 parse errors

3. **kulturhuset has NO working API**
   - All endpoints timeout or 404
   - `likely_event_api: 0, possible_api: 1` (wp-json root)
   - Should route to HTML-fallback

4. **network_inspection performance improved**
   - Batch size: 10 (was sequential, then 5)
   - Timeout: 8s per endpoint (was 15s)
   - Still slow for some sources

### Implications

- Network path is VIABLE for sources with accessible APIs (like berwaldhallen)
- HTML-fallback still needed for sources without APIs (like kulturhuset)
- Scheduler needs update to use network_event_extraction when likely_event_api > 0
- Generalization: Tixly API format may apply to other Swedish venues

### Next Steps

1. Integrate network_event_extraction into scheduler.ts
2. Test network path for other Tixly-based venues
3. Continue HTML path validation for non-API sources
4. Measure: how many sources have viable APIs vs need HTML-fallback
