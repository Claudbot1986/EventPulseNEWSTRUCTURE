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
failTypeDistribution [object] Fördelning per primär fail-typ (nivå 1), t.ex.:
                              {
                                "discovery_failure": 2,
                                "screening_failure": 1,
                                "routing_failure": 0,
                                "extraction_failure": 2,
                                "network_failure": 3,
                                "canonical_source_data_failure": 2,
                                "environment_or_tooling_failure": 0,
                                "mixed_failure": 0,
                                "unclear_failure": 0
                              }
networkErrorDistribution [object] Fördelning per nätverksfeltyp (endast om network_failure finns), t.ex.:
                              {
                                "url_problem": 0,
                                "dns_problem": 1,
                                "timeout_problem": 2,
                                "tls_certificate_problem": 0,
                                "http_404_problem": 0,
                                "http_403_problem": 0,
                                "http_5xx_problem": 0,
                                "blocked_or_fetch_environment_problem": 0,
                                "likely_requires_D": 0,
                                "likely_requires_A_or_B": 0,
                                "unclear_network_failure": 0
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
stopReason           [string]  "pool-exhausted" | "max-rounds-reached" | "no-sources-available" | "plateau"
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
- C0-discovery-fail: 5
- C2/C3-glapp-fail: 2
- C2-gränsfall: 1
- network-error-fail: 2

### networkErrorDistribution
- url_problem: 1
- dns_problem: 0
- timeout_problem: 1
- tls_certificate_problem: 0
- http_404_problem: 0
- http_403_problem: 0
- http_5xx_problem: 0
- blocked_or_fetch_environment_problem: 0
- likely_requires_D: 0
- likely_requires_A_or_B: 0
- unclear_network_failure: 0

### winningStageDistribution
- C1: 0
- C2: 0
- C3: 0

### generalChangesTested
- (ingen ändring i baseline-runda 1)

### beforeSummary
Baseline: 0/10 extract_success, 0/10 route_success, 10/10 fail, 0 events

### stopReason
pool-exhausted | max-rounds-reached | no-sources-available

### nextStep
Nästa steg baserat på poolens slutstatus
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
routeSuggestion      [string]  "UI" | "A" | "B" | "D" | "manual-review"
failType            [string]  Primär fail-klassificering (nivå 1): "discovery_failure" | "screening_failure" | "routing_failure" | "extraction_failure" | "network_failure" | "canonical_source_data_failure" | "environment_or_tooling_failure" | "mixed_failure" | "unclear_failure" | "unknown" (endast om outcomeType=fail)
networkFailureSubType [string|null]  Nätverksfel-undertyp (nivå 2) — endast om failType="network_failure". Värden:
                              "url_problem" | "dns_problem" | "timeout_problem" | "tls_certificate_problem" |
                              "http_404_problem" | "http_403_problem" | "http_5xx_problem" |
                              "blocked_or_fetch_environment_problem" | "likely_requires_D" |
                              "likely_requires_A_or_B" | "unclear_network_failure" | null
networkErrorDiagnosis [string|null]  C4-AI:s diagnos av nätverksfelet — kort och konkret, t.ex.:
                              "HTTP 404 beror sannolikt på fel canonical URL (källa pekar på /evenemang/ som inte finns)"
                              "Timeout beror på serverbelastning — möjligen tillfälligt"
                              "Certificate error är problem på sajten, inte vår fetch"
                              null om inget nätverksfel
networkErrorConfidence [string|null]  "high" | "medium" | "low" | null — hur säker är nätverksfel-klassificeringen
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
finalDecision       [string]  Slutligt beslut för sourcen i denna runda:
                              "postTestC-UI" | "postTestC-A" | "postTestC-B" | "postTestC-D" | "postTestC-manual-review"
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
| failType | discovery_failure |
| networkFailureSubType | dns_problem |
| networkErrorDiagnosis | DNS resolution failed for www.brommapojkarna.se. This could be a temporary DNS issue or a permanent problem with the domain. The source's canonical URL may be incorrect. |
| networkErrorConfidence | medium |
| evidence | 0 internal candidates found — DNS failure prevented any page fetch |
| c0Candidates | 0 |
| winnerUrl | null |
| c2Verdict | N/A |
| c2Score | N/A |
| eventsFound | 0 |
| changeApplied | null |
| improvedAfterChange | N/A |
| rootCause | discovery_failure: dns_problem — DNS resolution failed before any page could be fetched |
| finalDecision | postTestC-Fail-round1 |

## Källrapport: kth

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| sourceId | kth |
| url | https://www.kth.se |
| winningStage | C1 |
| outcomeType | fail |
| routeSuggestion | Fail |
| failType | canonical_source_data_failure |
| networkFailureSubType | http_404_problem |
| networkErrorDiagnosis | HTTP 404 on all attempted URLs. The canonical URL (www.kth.se) redirects to a different path structure. Likely the source's preferredPath needs updating to match KTH's actual events URL structure (/kalender/ or similar). |
| networkErrorConfidence | high |
| evidence | HTTP 404 on root fetch — canonical URL appears incorrect |
| c0Candidates | 0 |
| winnerUrl | null |
| c2Verdict | N/A |
| c2Score | N/A |
| eventsFound | 0 |
| changeApplied | null |
| improvedAfterChange | N/A |
| rootCause | canonical_source_data_failure: http_404_problem — HTTP 404 caused by incorrect canonical URL |
| finalDecision | postTestC-Fail-round1
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
failSetUsed          [string]  Vilka källor som ingick i rundan (kvarvarande aktiva pool), t.ex.
                              "runtime/postTestC-pool-round1.jsonl" eller liknande
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
runNextRound         [boolean]  true | false — om nästa runda ska köras (inom samma pool)
stopReason           [string]  Om runNextRound=false, varför: t.ex. "pool-exhausted", "no-sources-available"
networkErrorAnalysis [object]  Nätverksfel-analys för denna runda (endast om network-error-fail finns):
                              {
                                "totalNetworkErrors": N,
                                "byNetworkFailureSubType": {
                                  "url_problem": N,
                                  "dns_problem": N,
                                  "timeout_problem": N,
                                  "tls_certificate_problem": N,
                                  "http_404_problem": N,
                                  "http_403_problem": N,
                                  "http_5xx_problem": N,
                                  "blocked_or_fetch_environment_problem": N,
                                  "likely_requires_D": N,
                                  "likely_requires_A_or_B": N,
                                  "unclear_network_failure": N
                                },
                                "routingSignals": ["sourceId1", "sourceId2"], // vilka nätverksfel sommotiverar routing
                                "fetchEnvironmentProblems": ["sourceId3"], // timeout/cert/DNS — troligen miljö, inte routing
                                "urlProblems": ["sourceId4"], // 404 — troligen fel URL, inte routing
                                "networkErrorConclusion": "Kort sammanfattning av nätverksfelen i denna runda och vad de betyder för verktygsförbättring vs routing"
                              }
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

### networkErrorAnalysis
- totalNetworkErrors: 7
- byType:
  - url_problem: 2 (kth, g-teborgs-posten)
  - dns_problem: 1 (brommapojkarna)
  - timeout_problem: 2 (ik-sirius, helsingborg-arena)
  - tls_certificate_problem: 1 (medeltidsmuseet)
  - http_404_problem: 2 (kth, g-teborgs-posten)
  - http_403_problem: 0
  - http_5xx_problem: 0
  - blocked_or_fetch_environment_problem: 0
  - likely_requires_D: 0
  - likely_requires_A_or_B: 0
  - unclear_network_failure: 1 (brommapojkarna)
- routingSignals: []
- fetchEnvironmentProblems: ["ik-sirius", "helsingborg-arena", "medeltidsmuseet"]
- urlProblems: ["kth", "g-teborgs-posten"]
- networkErrorConclusion: "7 nätverksfel. 2 är url_problem — sourcen bör inte routeas utan fixas i source-config. 2 är timeout_problem — möjligen generellt men endast 2 sajter. 1 är tls_certificate_problem — problem på sajten. 1 är dns_problem — oklart. 0 är tydliga routing-signaler. Root URL fallback hjälpte inte."
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
networkErrorClassification [object]  Nätverksfel-klassificering (endast om network_failure eller discovery_failure med underliggande nätverksproblem finns):
                              {
                                "totalNetworkErrors": N,
                                "byNetworkFailureSubType": {
                                  "url_problem": N,
                                  "dns_problem": N,
                                  "timeout_problem": N,
                                  "tls_certificate_problem": N,
                                  "http_404_problem": N,
                                  "http_403_problem": N,
                                  "http_5xx_problem": N,
                                  "blocked_or_fetch_environment_problem": N,
                                  "likely_requires_D": N,
                                  "likely_requires_A_or_B": N,
                                  "unclear_network_failure": N
                                },
                                "confirmedRoutingSignals": [
                                  {
                                    "sourceId": "xxx",
                                    "primaryFailType": "network_failure",
                                    "networkFailureSubType": "likely_requires_D",
                                    "reason": "HTTP 200 on render-capable fetcher but 0 events on raw fetch — JS rendering required"
                                  }
                                ],
                                "confirmedFetchEnvironmentProblems": [
                                  {
                                    "sourceId": "xxx",
                                    "primaryFailType": "network_failure",
                                    "networkFailureSubType": "timeout_problem",
                                    "reason": "Timeout on multiple fetch attempts — likely server load or network issue"
                                  }
                                ],
                                "confirmedUrlProblems": [
                                  {
                                    "sourceId": "xxx",
                                    "primaryFailType": "canonical_source_data_failure",
                                    "networkFailureSubType": "http_404_problem",
                                    "reason": "HTTP 404 on all attempted URLs — canonical URL appears incorrect"
                                  }
                                ],
                                "unclearNetworkFailures": [
                                  {
                                    "sourceId": "xxx",
                                    "primaryFailType": "discovery_failure",
                                    "networkFailureSubType": "dns_problem",
                                    "reason": "DNS works but fetch fails with unclear error — more investigation needed"
                                  }
                                ],
                                "conclusion": "Sammanfattning: X nätverksrelaterade fail, Y är routing-signaler, Z är fetch-miljöproblem, W är url-problem, U är oklara. Nästa steg bör vara..."
                              }
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

### networkErrorClassification

| Fält | Värde |
|------|-------|
| totalNetworkErrors | 7 |
| byNetworkFailureSubType: | |
| url_problem | 0 |
| dns_problem | 1 |
| timeout_problem | 2 |
| tls_certificate_problem | 1 |
| http_404_problem | 2 |
| http_403_problem | 0 |
| http_5xx_problem | 0 |
| blocked_or_fetch_environment_problem | 0 |
| likely_requires_D | 0 |
| likely_requires_A_or_B | 0 |
| unclear_network_failure | 1 |

**confirmedRoutingSignals:** [] (inga nätverksfel klassades som tydliga D/A/B-signaler)

**confirmedFetchEnvironmentProblems:**
- ik-sirius: primaryFailType=network_failure, networkFailureSubType=timeout_problem — timeout på två oberoende fetch-försök
- helsingborg-arena: primaryFailType=network_failure, networkFailureSubType=timeout_problem — timeout, samma mönster som ik-sirius, möjligen generellt

**confirmedUrlProblems:**
- kth: primaryFailType=canonical_source_data_failure, networkFailureSubType=http_404_problem — HTTP 404, fel canonical URL
- g-teborgs-posten: primaryFailType=canonical_source_data_failure, networkFailureSubType=http_404_problem — HTTP 404, fel canonical URL

**unclearNetworkFailures:**
- brommapojkarna: primaryFailType=discovery_failure, networkFailureSubType=dns_problem — DNS resolution failed, oklart om det är fel URL eller tillfälligt DNS-problem
- medeltidsmuseet: primaryFailType=network_failure, networkFailureSubType=tls_certificate_problem — certifikatfel, problem på sajten

**conclusion:** 7 nätverksrelaterade fail. 2 är canonical_source_data_failure (kth, g-teborgs-posten) — fixas i source-config, inte routing. 2 är network_failure+timeout_problem (ik-sirius, helsingborg-arena) — möjligen generellt men endast 2 sajter. 1 är network_failure+tls_certificate_problem (medeltidsmuseet) — problem på sajten. 1 är discovery_failure+dns_problem (brommapojkarna) — oklart. 0 är tydliga routing-signaler. Root URL fallback hjälpte inte. Nästa runda bör fokusera på extraction_failure för varmland/liseberg.
```

---

## 7. Rapporternas relation till dynamisk pool-modell (UPPDATERAD 2026-04-11)

### Poollogik styr vilka källor som analyseras

Den dynamiska testpoolen styr vilka källor som analyseras i varje runda:

```
Runda 1: 10 sources → exitvillkor → kvarvarande pool → refill (om < 10)
  → C4-AI-analys → förbättring (eventuellt)
  → Runda 2

Runda 2: kvarvarande + nytillagda → exitvillkor → kvarvarande pool → refill
  → C4-AI-analys → förbättring (eventuellt)
  → Runda 3

Runda 3: kvarvarande + nytillagda → exitvillkor → sources → postTestC-UI/A/B/D/manual-review
```

**Regler:**
- Refill får endast ske **mellan rundor**, aldrig mitt i en runda
- Sources som lämnat poolen får inte återkomma i samma testkörning
- `postB-preC` är den enda inkommande poolen för refill
- `postTestC-manual-review` ersätter alla tidigare fail-restkö-namn

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
| **Batchrapport** | batchId, roundNumber, sourcesIn, extractSuccess, routeSuccess, fail, failTypeDistribution, networkErrorDistribution, winningStageDistribution, totalEventsExtracted, beforeSummary, afterSummary, stopReason |
| **Källrapport** | batchId, roundNumber, sourceId, url, winningStage, outcomeType, failType, networkFailureSubType, networkErrorDiagnosis, networkErrorConfidence, evidence, eventsFound, improvedAfterChange, rootCause, finalDecision |
| **Rundrapport** | batchId, roundNumber, failSetUsed, hypothesis, changeApplied, whyGeneral, beforeResults, afterResults, sourcesImproved, sourcesUnchanged, sourcesWorsened, decision, runNextRound, networkErrorAnalysis |
| **C4-AI-lärrapport** | batchId, roundNumber, observedPattern, hypothesis, proposedGeneralChange, changeApplied, whyGeneral, beforeSummary, afterSummary, sourcesImproved, sourcesUnchanged, sourcesWorsened, decision, learnedRule, confidence, shouldBeReusedLater, networkErrorClassification |

---
