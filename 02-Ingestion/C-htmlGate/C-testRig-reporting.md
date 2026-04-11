# C-TestRig Rapporterings-Specifikation
**Document Type: OBLIGATORISK RAPPORTSPECIFIKATION**
**Status: GÄLLER FRÅN OCH MED BATCH-011**
**Primär källa för alla C-testRig-rapporter.**

---

## 1. Syfte och princip

Denna fil definierar de fyra obligatoriska rapportlagren för C-testRig och 123-loopen.

**Rapporter är inte loggar. Rapporter är byggstenar för en framtida erfarenhetsbank för generell HTML-scraping.**

Varje rapport ska:
- vara maskinläsbar och mänskligt läsbar
- kunna återanvändas i framtida AI-analys
- möjliggöra före/efter-jämförelser över rundor
- bevara lärdomar som är oberoende av enskilda batchkörningar

---

## 2. Hierarki: Fyra rapportlager

| # | Lagernamn | Vad det beskriver | Fil/Plats |
|---|-----------|-------------------|-----------|
| 1 | **Batchrapport** | Hela batchkörningen (alla rundor) | `reports/batch-{N}/batch-report.md` |
| 2 | **Källrapport** | Enskild source, enkeltrunda | `reports/batch-{N}/source-reports/{sourceId}.md` |
| 3 | **Rundrapport** | En enskild 123-runda (round1/2/3) | `reports/batch-{N}/round-{N}-report.md` |
| 4 | **C4-AI-lärrapport** | Strukturerad C4-AI-analys | `reports/batch-{N}/c4-ai-learnings.md` |

**Alla fyra lager är obligatoriska för varje batchkörning.**
Inga lager får utelämnas, hoppas över, eller ersättas med fri text.

---

## 3. Lag 1: Batchrapport

### Placering
`02-Ingestion/C-htmlGate/reports/batch-{N}/batch-report.md`

### Syfte
Ger helhetsbilden av en batchkörning inklusive alla rundor (baseline + eventuella förbättringscykler).

### Obligatoriska fält

```
batchId              [string]  T.ex. "batch-011"
roundNumber          [number]  Vilken rundnr som körts (1, 2, 3)
inputQueue           [string]  Vilken kö batchen kom ifrån (t.ex. "postB-preC")
sourcesIn            [number]  Antal källor in i batchen
extractSuccess       [number]  Antal källor med extract_success
routeSuccess        [number]  Antal källor med route_success
fail                [number]  Antal källor med fail
failTypeDistribution [object] Fördelning per fail-typ, t.ex.:
                              {
                                "C0-discovery-fail": 7,
                                "C2/C3-glapp-fail": 2,
                                "C2-gränsfall": 1
                              }
winningStageDistribution [object] Fördelning per winningStage, t.ex.:
                              {
                                "C1": 0,
                                "C2": 0,
                                "C3": 0,
                                "C4-AI": 0
                              }
totalEventsExtracted [number]  Summan av eventsFound över alla källor
generalChangesTested [array]  Lista med generella ändringar som testades i rundan
                              (en per förbättringscykel)
beforeSummary        [string]  Före-sammanfattning: antal success/fail/events per källa före ändring
afterSummary         [string]  Efter-sammanfattning: antal success/fail/events per källa efter ändring
stopReason           [string]  "plateau" | "no-general-improvement" | "d-problem" | "max-cycles"
nextStep             [string]  Kort beslut om nästa steg
```

### Format
Markdown med codeblock för strukturerad data. Fälten ska vara explicita, inte inbäddade i fritext.

### Exempel
```markdown
## Batchrapport batch-011

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| inputQueue | postB-preC |
| sourcesIn | 10 |
| extractSuccess | 0 |
| routeSuccess | 0 |
| fail | 10 |
| totalEventsExtracted | 0 |

### failTypeDistribution
- C0-discovery-fail: 7
- C2/C3-glapp-fail: 2
- C2-gränsfall: 1

### winningStageDistribution
- C1: 0
- C2: 0
- C3: 0

### generalChangesTested
- (ingen ändring i baseline-runda 1)

### beforeSummary
Baseline: 0/10 extract_success, 0/10 route_success, 10/10 fail, 0 events

### stopReason
baseline_only — round 1 klar, förbättringsloop pågår

### nextStep
Kör 123-runda-1 på postTestC-Fail-round1
```

---

## 4. Lag 2: Källrapport

### Placering
`02-Ingestion/C-htmlGate/reports/batch-{N}/source-reports/{sourceId}.md`

En fil per source. Namnsätts med sourceId.

### Syfte
Spårar exakt vad som hände med en enskild källa i en enskild runda.

### Obligatoriska fält per källa

```
batchId              [string]  T.ex. "batch-011"
roundNumber          [number]  1, 2 eller 3
sourceId             [string]  Källans ID
url                  [string]  Root-URL för sourcen
winningStage         [string]  "C1" | "C2" | "C3" | "C4-AI"
outcomeType          [string]  "extract_success" | "route_success" | "fail"
routeSuggestion      [string]  "UI" | "A" | "B" | "D" | "Fail"
failType            [string]  "C0-discovery-fail" | "C2/C3-glapp-fail" | "C2-gränsfall" | "unknown" (endast om outcomeType=fail)
evidence            [string]  Kort, konkret motivering. T.ex.
                              "0 candidates found despite root page load"
c0Candidates        [number]  Antal candidates hittade i C1 (eller "N/A" om C1 inte kördes)
c1Score             [number]  Eventuell C1-score (om tillgänglig)
winnerUrl           [string|null]  Vald kandidat-URL, eller null
c2Verdict           [string|null]  C2 verdict: "promising" | "unclear" | "low_value" | "N/A"
c2Score             [number|null]  C2 score, eller null
eventsFound         [number]  Antal events extraherade (0 om inga)
changeApplied       [string|null]  Vilken generell ändring som applicerades i denna runda, eller null
improvedAfterChange [string]  "ja" | "nej" | "oförändrat" | "N/A" (baseline-runda)
rootCause           [string]  kort root-cause-klassning: t.ex.
                              "C0-discovery-fail: no internal links found"
                              "C2/C3-glapp-fail: C2=promising but C3 extracted 0"
                              "C2-gränsfall: unclear verdict with low score"
finalDecision       [string]  Slutligt beslut för sourcen i denna runda, t.ex.:
                              "postTestC-Fail-round1" | "postTestC-UI" | "postTestC-A"
```

### Exempel
```markdown
## Källrapport: brommapojkarna

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| sourceId | brommapojkarna |
| url | https://www.brommapojkarna.se |
| winningStage | C1 |
| outcomeType | fail |
| routeSuggestion | Fail |
| failType | C0-discovery-fail |
| evidence | 0 internal candidates found, no event-like paths detected |
| c0Candidates | 0 |
| winnerUrl | null |
| c2Verdict | N/A |
| c2Score | N/A |
| eventsFound | 0 |
| changeApplied | null |
| improvedAfterChange | N/A |
| rootCause | C0-discovery-fail: no internal links found |
| finalDecision | postTestC-Fail-round1 |
```

---

## 5. Lag 3: Rundrapport (123-runda)

### Placering
`02-Ingestion/C-htmlGate/reports/batch-{N}/round-{N}-report.md`

En fil per runda (round1, round2, round3).

### Syfte
Beskriver exakt vad som hände i en enskild 123-förbättringsrunda: vilken hypotes som testades, vilken ändring som gjordes, och vad resultatet blev.

### Obligatoriska fält

```
batchId              [string]  T.ex. "batch-011"
roundNumber          [number]  1, 2 eller 3
failSetUsed          [string]  Vilken fail-kö som användes som input, t.ex.
                              "runtime/postTestC-Fail-round1.jsonl"
hypothesis           [string]  Den generella hypotes som testades, t.ex.
                              "C0 hittar för få candidates pga för smal path-inspektion"
changeApplied        [string]  Konkret ändring som gjordes, t.ex.
                              "Utökad path-inspektion i C0 för att hitta fler /kalender/-liknande paths"
whyGeneral           [string]  Varför ändringen bedömdes som generell (inte site-specifik)
beforeResults        [object]  Före-resultat:
                              {
                                "extractSuccess": N,
                                "routeSuccess": N,
                                "fail": N,
                                "totalEvents": N,
                                "failTypeDistribution": {...}
                              }
afterResults         [object]  Efter-resultat (samma struktur som beforeResults)
sourcesImproved      [array]  Lista med sourceIds som förbättrades
sourcesUnchanged     [array]  Lista med sourceIds som var oförändrade
sourcesWorsened      [array]  Lista med sourceIds som försämrades
decision             [string]  "keep" | "revert" | "unclear"
runNextRound         [boolean]  true | false — om nästa runda ska köras
stopReason           [string]  Om runNextRound=false, varför: t.ex. "plateau", "no-general-improvement"
```

### Exempel
```markdown
## Rundrapport round-1 (batch-011)

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| failSetUsed | runtime/postTestC-Fail-round1.jsonl |

### hypothesis
C0 hittar för få candidates pga för smal path-inspektion.
Flera sajter i batch-011 har /kalender/-liknande paths som inte upptäcks.

### changeApplied
Utökad path-inspektion i C0 med bredare keyword-mängd för event-like paths.

### whyGeneral
Samma mönster (smala path-inspektionsregler) påverkar 7+ sajter oberoende av domän.

### beforeResults
- extractSuccess: 0
- routeSuccess: 0
- fail: 10
- totalEvents: 0

### afterResults
- extractSuccess: 1
- routeSuccess: 1
- fail: 8
- totalEvents: 5

### sourcesImproved
["kth", "helsingborg-arena"]

### sourcesUnchanged
["brommapojkarna", "nykoping", "medeltidsmuseet", "ik-sirius", "g-teborgs-posten", "varmland", "liseberg", "svenska-hockeyligan-shl"]

### sourcesWorsened
[]

### decision
keep

### runNextRound
true

### stopReason
(null)
```

---

## 6. Lag 4: C4-AI-lärrapport

### Placering
`02-Ingestion/C-htmlGate/reports/batch-{N}/c4-ai-learnings.md`

En fil per batch. Kan ha underavsnitt per runda.

### Syfte
Strukturerad, maskinläsbar dokumentation av vad C4-AI lärt sig. Detta är **obligatoriskt och separat** från fri AI-analys som en agent kan skriva. Utan strukturerad C4-AI-lärrapport saknas spårbarhet för framtida generell förbättring.

### OBS: C4-AI ≠ dold fallback

C4-AI får ALDRIG användas för att "rädda" enskilda fail-fall genom att extrahera events med AI.
C4-AI får ALDRIG ge AI-genererade events direkt till produktion.
C4-AI-resultat utan förbättring av verktygen räknas INTE som verklig generell framgång.

C4-AI är endast för: analys, hypoteser, mönsteridentifiering och förbättringsförslag för C0/C1/C2/C3.

### Obligatoriska fält

```
batchId              [string]  T.ex. "batch-011"
roundNumber          [number]  1, 2 eller 3
observedPattern      [string]  Vad C4-AI observerade i fail-mängden, t.ex.
                              "7/10 sources har C0-discovery-fail med 0 candidates —
                               dessa sajter har /kalender/ men C0 hittar det inte"
hypothesis           [string]  Hypotes baserad på mönstret, t.ex.
                              "C0 path-inspektion är för smal för svenska event-URL-mönster"
proposedGeneralChange [string] Föreslagen generell ändring (innan agenten beslutar om implementering)
changeApplied        [string|null]  Vilken ändring som faktiskt applicerades (kan skilja sig från proposed)
whyGeneral           [string]  Motivering till varför ändringen bedömdes som generell, t.ex.
                              "Påverkar 7+ sajter oberoende av domän, ingen site-specifik regel"
beforeSummary        [string]  Före-sammanfattning på batchnivå
afterSummary         [string]  Efter-sammanfattning på batchnivå
sourcesImproved      [array]  sourceIds som fick bättre resultat efter ändringen
sourcesUnchanged     [array]  sourceIds som var oförändrade
sourcesWorsened      [array]  sourceIds som fick sämre resultat
decision             [string]  "keep" | "revert" | "unclear" — gäller ändringen
learnedRule          [string]  Den lärda regeln, strukturerat: t.ex.
                              "C0 path-inspektion måste täcka /kalender/, /event/, /program/ som breda keyword-familjer"
confidence           [string]  "high" | "medium" | "low"
shouldBeReusedLater  [string]  "ja" | "nej" | "prövas-igen"
```

### Exempel
```markdown
## C4-AI-lärrapport batch-011

### Runda 1

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| observedPattern | 7/10 sources uppvisar C0-discovery-fail med 0 candidates.
                   Dessa sajter har tydliga /kalender/, /program/, /events/-paths
                   men C0 hittar dem inte. |
| hypothesis | C0 path-inspektion är för smal. Svenska event-sajter använder
              varierade URL-mönster som inte täcks av nuvarande keyword-lista. |
| proposedGeneralChange | Bredda C0 keyword-inspektion till att täcka
                         /kalender/, /program/, /event/, /evenemang/ |
| changeApplied | Utökad path-inspektion med /kalender/, /program/, /event/ som alias |
| whyGeneral | 7 sajter påverkas oberoende av domän och CMS. Samma mönster
              observerat på svenska och internationella event-sajter. |
| beforeSummary | 0 extract_success, 0 route_success, 10 fail, 0 events |
| afterSummary | 1 extract_success, 1 route_success, 8 fail, 5 events |
| sourcesImproved | ["kth", "helsingborg-arena"] |
| sourcesUnchanged | ["brommapojkarna", "nykoping", "medeltidsmuseet", "ik-sirius",
                    "g-teborgs-posten", "varmland", "liseberg", "svenska-hockeyligan-shl"] |
| sourcesWorsened | [] |
| decision | keep |
| learnedRule | C0 path-inspektion måste täcka /kalender/ som alias för /events/ —
              svenska event-sajter använder detta mönster brett. |
| confidence | medium |
| shouldBeReusedLater | prövas-igen |
```

---

## 7. Rapporternas relation till fail-round-logiken

### Fail-round styr vilka källor som analyseras

123-loopen arbetar på en fast failmängd:

```
batch körs → postTestC-Fail-round1 → 123-runda-1 → förbättring
  → re-run på samma failmängd → postTestC-Fail-round2 → 123-runda-2
    → re-run → postTestC-Fail-round3 → 123-runda-3 → postTestC-Fail
```

**Regler:**
- Ny batch får INTE blandas in mitt i förbättringsloopen
- `postTestC-Fail-round1` är startpunkten för 123-loopen efter batch-011
- `batch-state.jsonl` och `postTestC-Fail-round*.jsonl` är olika saker:
  - `batch-state.jsonl` styr vilket batch-nummer som körs
  - `postTestC-Fail-round*.jsonl` är källan för förbättringsarbete

---

## 8. Rapporternas relation till AI-regler

### C4-AI = analys och förbättring, inte räddning

| AI-användning | Tillåten? | Varför |
|---------------|-----------|--------|
| Analysera fail-mönster över batch | Ja | Genererar hypoteser |
| Jämföra före/efter | Ja | Mäter verklig förbättring |
| Föreslå generell ändring | Ja | Verktygsförbättring |
| Extrahera events med AI för att "rädda" enskilda fail | **NEJ** | Dold fallback, maskerar svaga verktyg |
| Ge AI-events direkt till produktion | **NEJ** | AI-genererade events utan verktygsförbättring = ingen lärdom |
| Skapa site-specifika regler | **NEJ** | Förbjudet enligt Generalization Protection Rule |

### Regel: C4-AI-lärnivå är obligatorisk

C4-AI-lärrapporten ska alltid genereras. Om C4-AI inte hittar något mönster ska det dokumenteras:

```
observedPattern: "Inga generella mönster identifierade i denna fail-mängd"
hypothesis: "Ingen tydlig hypotes — mönstret är heterogent"
decision: "unclear"
```

---

## 9. Plats för rapporter

Alla C-testRig-rapporter sparas i:

```
02-Ingestion/C-htmlGate/reports/
  batch-{N}/
    batch-report.md              ← Lag 1
    c4-ai-learnings.md          ← Lag 4
    round-1-report.md            ← Lag 3 (rundrapport)
    round-2-report.md            ← Lag 3 (om round 2 kördes)
    round-3-report.md            ← Lag 3 (om round 3 kördes)
    source-reports/
      {sourceId1}.md             ← Lag 2
      {sourceId2}.md             ← Lag 2
      ...
```

Katalog skapas av agenten vid rapporteringstillfället.
Filnamn är obligatoriska enligt ovan.

---

## 10. Ingen feltolkning: Rapporternas syfte

Dessa rapporter är **inte** loggfiler.

Loggfiler är: timestampade stdout/stderr, nix i bakgrunden, operativa händelser.
Rapporter är: strukturerad data för framtida erfarenhetsbank, mänsklig läsning och AI-analys.

**En erfarenhetsbank** betyder:
- Nästa agent som arbetar med C-spåret ska kunna läsa tidigare rapporter och förstå:
  - Vilka generella ändringar som testats
  - Vilka som fungerade och vilka som inte
  - Vilka mönster som är verifierade över flera batchar
- C4-AI-lärnivån ska kunna användas för att trigga framtida hypoteser
- Källrapporter ska möjliggöra spårbarhet: källa X → förbättrades av ändring Y

Utan denna struktur: ingen återanvändbar erfarenhetsbank, bara lös text.

---

## 11. Sammanfattning: Obligatoriska fält per rapportlag

| Lager | Minst obligatoriskt |
|-------|---------------------|
| **Batchrapport** | batchId, roundNumber, sourcesIn, extractSuccess, routeSuccess, fail, failTypeDistribution, winningStageDistribution, totalEventsExtracted, beforeSummary, afterSummary, stopReason |
| **Källrapport** | batchId, roundNumber, sourceId, url, winningStage, outcomeType, failType, evidence, eventsFound, improvedAfterChange, rootCause, finalDecision |
| **Rundrapport** | batchId, roundNumber, failSetUsed, hypothesis, changeApplied, whyGeneral, beforeResults, afterResults, sourcesImproved, sourcesUnchanged, sourcesWorsened, decision, runNextRound |
| **C4-AI-lärrapport** | batchId, roundNumber, observedPattern, hypothesis, proposedGeneralChange, changeApplied, whyGeneral, beforeSummary, afterSummary, sourcesImproved, sourcesUnchanged, sourcesWorsened, decision, learnedRule, confidence, shouldBeReusedLater |

---
