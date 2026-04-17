# C-Lager Förbättringar — Batch 107

## Översikt

Fullständigt lyft av C-htmlGate-lagret för att göra C till en robust, transparent,
generell scraper. Målet: C ska fungera på egen hand utan C4 som krycka.

---

## FAS A: Sanningsåterställning

### Problem identifierat

`determineOutcome()` hade flera logiska fel:

1. **Fel: `result.c1.likelyJsRendered` i else-gren utan `!c0FoundWinner`** — C1 kunde aldrig trigga D-routing om Swedish patterns hittat en winner
2. **Fel: C3 AI-extraction aldrig anropades** — `evaluateAiExtract()` fanns men_CALLADES aldrig i `runSourceOnPool()`
3. **Fel: `exitReason` och `exitReasonDetail` sattes aldrig** — alla failures hade generic "C3: no events"
4. **Fel: `PerSourceTrace` byggdes aldrig** — `buildTrace()` fanns men anropades inte

### Åtgärdat

- Ny `determineOutcome()` med 12 distinkta `ExitReason`-värden
- AI-extraction wired in som fallback för C2=promising + universal=0
- `buildTrace()` anropas alltid före return
- Alla nya fält i `CResult`: `exitReason`, `exitReasonDetail`, `effectiveProcessingUrl`, `c3.aiVerdict`, `c3.aiEventsFound`

---

## FAS B: Full Per-Source Trace

### Ny struktur

`PerSourceTrace` interface innehåller alla fält för komplett spårbarhet:

- sourceId, sourceUrl, round
- C0: candidates, winnerUrl, density, ruleSource, rulePathsTested
- Effective URL + reason (C0 winner / derived-rules subpage / root)
- C1: verdict, likelyJsRendered, timeTags, dates, htmlBytes, fetchable, fetchError, subpagesTested
- C2: verdict, score, reason, htmlBytes
- C3: universalEventsFound, methodsUsed, methodBreakdown, aiVerdict, aiEventsFound, aiDuration
- exitReason, exitReasonDetail, outcomeType, routeSuggestion, winningStage, success

### writeBatchTraces()

Ny funktion som skriver `batch-traces.jsonl` efter varje batch:
- En rad per source per round
- C4-observer läser denna fil för separat analys

---

## FAS C: Skarpa Exit Reasons

### Nya ExitReason-värden

| ExitReason | Betydelse |
|------------|-----------|
| `EXTRACT_SUCCESS` | Events hittade (UI-routing) |
| `C1_STRONG_JS_RENDER_D_SIGNAL` | likelyJsRendered + ingen subpage → D |
| `C1_LIKELY_JS_RENDER_ROOT` | likelyJsRendered utan C0 winner → D |
| `C2_BLOCKED` | C2 verdict=blocked |
| `C2_UNCLEAR` | C2 verdict=unclear |
| `EXTRACTION_ZERO_PROMISING_HTML` | C2=promising men universal=0 |
| `EXTRACTION_ZERO_C3_AI_ZERO` | C2=promising, universal=0, AI=0 |
| `C1_NO_MAIN_ARTICLE` | C1 verdict=no-main |
| `NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED` | C0=0, Swedish patterns körda |
| `NO_CANDIDATES_NO_PATTERNS` | C0=0, inga patterns |
| `NETWORK_ERROR` / `FETCH_ERROR` | Fetch misslyckades |
| `ALL_ROUNDS_EXHAUSTED` | Fallback |

### Manual-review ersatt

Istället för vag `fail → manual-review`:
- Varje failure har nu en **specifik orsak**
- Varje manual-review-case har en **reason-tag**
- `routeSuggestion: 'manual-review'` används bara när ingen bättre routing finns

---

## FAS D: C0/C1/C2 Smartare

### screenUrlWithDerivedRules Wired In

**Före:** `screenUrl()` anropades alltid — derived rules från C0 ignorerades i C1
**Efter:** Om `derivedRules.has(sourceId__NEEDS_SUBPAGE_DISCOVERY)`, anropas `screenUrlWithDerivedRules()` som:
1. Testar root först
2. Om svag, testar subpage paths från regeln
3. Returnerar `bestSubpageUrl` + `testedSubpages[]`

### Effective URL Selection

```
Priority:
1. C0 winner (Swedish patterns/derived rules hittade subpage)
2. screenUrlWithDerivedRules bestSubpageUrl (derived rules subpage test)
3. Source root URL
```

### C1 Direct D-Routing

Strong JS-render signal på root + ingen subpage → direkt D utan att köra C2/C3.
Swedish pattern winners undantas (IMP-002).

---

## FAS E: C3 Riktig Extractor

### AI Fallback Wired In

**Tidigare:** `evaluateAiExtract()` fanns men kördes aldrig
**Nu:** Körs när:
- `C2 verdict = promising`
- `universal eventsFound = 0`

### AI-resultat sparas i trace

- `c3.aiVerdict`
- `c3.aiEventsFound`
- `c3.aiDuration`

### Universal Extractor Scope Fix (IMP-003)

**Före:** `scope = $('main, article...')` — ignorerade sidor utan semantic containers
**Efter:** Om scope har < 5 element, fallback till `$('body')`

---

## FAS F: Separat C4-Observer

### Arkitektur

```
C-runtime:  run-dynamic-pool.ts
            ↓ (batch-traces.jsonl)
C4-observer: reports/c4-observer/c4-observer-analyze.ts
            ↓ (reports/batch-N/c4-observer-*.{json,md,jsonl})
```

### C4-observer-analys

Körs SEPARAT från C-runtime:
```bash
npx tsx reports/c4-observer/c4-observer-analyze.ts --batch 107
```

Producerar:
- `c4-observer-summary.json` — statistik
- `c4-observer-findings.jsonl` — en rad per promising-zero source
- `c4-observer-report.md` — mänsklig läsbar rapport

### Vad C4-observer GÖR

- Identifierar vanliga failure patterns
- Hittar `promising → zero` sources (högsta prioritet)
- Genererar rekommendationer för C0/C1/C2/C3
- analyserar failure families per exit reason

### Vad C4-observer INTE GÖR

- Påverkar INTE runtime routing
- Ändrar INTE C-resultat
- Körs INTE som en del av C-pipelinen
- Stoppar INTE C från att köra om C4-mappen saknas

---

## FAS G: Förbättrade Batch-Rapporter

### Nya rapporter per batch

- `batch-traces.jsonl` — PerSourceTrace för varje source/round
- `c4-observer-*.{json,md,jsonl}` — C4-analys (om körts)

### Exit Reason i batch-report

Varje batchrapport ska nu visa:
- Antal per exitReason
- Promising→zero ratio
- Median HTML bytes per verdict
- C0 rule application rate

---

## FAS H: Tester och Verifiering

### Kör en mindre batch för verifiering

```bash
# Sätt i batch-state.jsonl för en mindre batch:
echo '{"currentBatch": 107, "status": "pending", "batchSources": ["korta listan av 5-10 kända källor"]}' > reports/batch-state.jsonl

# Kör
npx tsx run-dynamic-pool.ts
```

### Verifiera med C4-observer

```bash
# Efter batch:
npx tsx reports/c4-observer/c4-observer-analyze.ts --batch 107

# Läs rapporten:
cat reports/batch-107/c4-observer-report.md
```

### Tecken på framgång

- Färre `ALL_ROUNDS_EXHAUSTED` (fler specifika reasons)
- `EXTRACTION_ZERO_PROMISING_HTML` eller `EXTRACTION_ZERO_C3_AI_ZERO` syns istället för generisk fail
- C3 AI hittar events på sources där universal=0
- `effectiveUrl` visar att Swedish pattern winners faktiskt används

---

## Kodändringar Sammanfattning

### run-dynamic-pool.ts

1. `buildTrace()` — ny funktion för PerSourceTrace
2. `runSourceOnPool()` — omskriven med:
   - `effectiveUrl` selection
   - `screenUrlWithDerivedRules()` anrop
   - `evaluateAiExtract()` fallback
   - Full `PerSourceTrace` byggd
3. `determineOutcome()` — omskriven med 12 specifika exit reasons
4. `writeBatchTraces()` — ny funktion
5. `CResult` interface utökat med: `exitReason`, `exitReasonDetail`, `effectiveProcessingUrl`, `effectiveProcessingUrlReason`, `c3.aiVerdict`, `c3.aiEventsFound`, `c3.aiDuration`

### extractor.ts

1. Scope fallback till `$('body')` om < 5 main-scope elements (IMP-003)

### c4-observer-analyze.ts

Ny fil:
- `analyzeBatch()` — core analysis
- `identifyFailurePatterns()` — gruppering per exitReason
- `generateRecommendations()` — C4-insikter
- `writeReports()` — JSON + JSONL + Markdown

---

## Känt återstående svagt

- `extractFromHtml()` har fortfarande begränsad extraction (endast URL-dates, Swedish text-dates, time-tags, Tribe Events Calendar)
- AI-extraction prompt kan behöva justering
- Inga tester i formellt test-suite — endast manuell körning

---

## Nästa steg

1. Kör batch 107 med 10-20 sources
2. Kör `c4-observer-analyze.ts --batch 107`
3. Granska `c4-observer-report.md` för patterns
4. Identifiera högvärdiga `promising→zero` cases
5. Förbättra extraction baserat på C4-insikter
