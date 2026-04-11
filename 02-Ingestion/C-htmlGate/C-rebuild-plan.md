# C-rebuild-plan

**Document Type: NEW REBUILD PLAN / STYRDOKUMENT**
**Status: PLANERAD — Ej implementerad**

**⚠️ NAMNRÖRA-VARNING:** Se [C-status-matrix.md](./C-status-matrix.md) för förklaring av C0/C1/C2/C3/C4-AI-namnröran innan du läser denna fil.

**Vad denna fil är:** Styrmål och steg-för-steg-plan för att bygga om C-spåret till en manuell, verifierbar testrigg. Denna plan är NY — skapad efter C-status-matrix för att dokumentera den planerade rebuilden.

**Vad denna fil INTE är:** Aktiv implementation. Verklig kod kör fortfarande legacy-flöden.

---

## 1. Syfte

Syftet med denna plan är att bygga om C-spåret till en **tydlig, manuell, verifierbar och batchdriven test-rigg** för generell HTML-bearbetning.

Planen ska lösa fyra problem samtidigt:

- skapa **en enda canonical målmodell** för C-spåret
- hålla isär **current implementation**, **legacy batchspår** och **planerad test-rigg**
- bygga en **manuell batchloop** från `postB-preC`
- förbättra HTML-verktygen genom **små generella iterationer**, inte site-specifika specialfall

Denna plan utgår från den övergripande rebuild-riktningen där köer ska vara tunna operativa lager, där routing ska vara spårbar och där endast verklig extraction får nå UI-flödet fileciteturn7file2L1-L8 fileciteturn7file4L1-L18.

---

## 2. Canonical målmodell för C-spåret

Detta är den **styrande målsemantiken framåt**.

### C1 — Discovery / Frontier

C1 ska:

- utgå från en source i `postB-preC`
- hitta relevanta huvudsidor och interna undersidor
- välja lovande kandidat-URL:er för vidare C-test
- arbeta med discovery/frontier, inte extraction

I praktiken motsvarar detta i nuvarande kod främst det som tidigare kallats `C0`.

### C2 — Grov HTML-screening och/eller routing-signal

C2 ska:

- göra en grov screening av HTML-kandidaterna
- bedöma om sidan fortfarande verkar lovande som HTML-fall
- kunna upptäcka stark signal för att sourcen egentligen bör routeas till:
  - `postTestC-A`
  - `postTestC-B`
  - `postTestC-D`
- ännu **inte** vara själva HTML-extraktionen

### C3 — HTML-extraktion

C3 ska:

- vara första steget där verklig HTML-extraktion sker
- försöka extrahera riktiga events från HTML med icke-AI-baserad logik
- endast ge `extract_success` om faktisk eventdata kan utvinnas på rimlig kvalitet

### C4-AI — Separat AI-steg efter fail

C4-AI ska:

- köras **först efter C1 → C2 → C3**
- endast användas på fail-fallen från batchen
- vara lätt att koppla bort
- användas för analys, mönsterigenkänning och förbättringsförslag
- inte vara dold huvudlogik i C-spåret

### Viktig princip

C1, C2, C3 och C4-AI får **inte** blandas ihop.

- screening = förstå vilken typ av sida detta är
- extraction = få ut riktiga events
- learning = lära av fail-fallen

---

## 3. Förhållande till nuvarande implementation

Den här planen låtsas inte att nuvarande kod redan följer målmodellen exakt.

Praktisk arbetssanning tills kodnamn eventuellt byggs om:

- nuvarande frontier/discovery-logik ≈ **Canonical C1**
- nuvarande screening/triage-logik ≈ **Canonical C2**
- `extractFromHtml()` ≈ **Canonical C3**
- AI-fallback ≈ **Canonical C4-AI**

Det betyder att rebuilden först ska låsa semantik och testrigg, och därefter — vid behov — remodulera kodnamn och filnamn.

---

## 4. Övergripande principer

### 4.1 En enda sanning

För C-spåret ska följande gälla:

- **styrande md-fil + statusmatris** = dokumentär sanning
- **verklig kod** = implementationssanning
- gamla batchartefakter får inte ligga kvar som halvaktiva parallella sanningar

### 4.2 Testvägg mot produktion

C-test-riggen är ett **labb**, inte produktion.

Det betyder:

- `postTestC-UI` är staged test-output
- inget ska auto-forwardas till normalizer, BullMQ, Supabase eller UI i denna fas
- route suggestions till A/B/D är testobservationer, inte canonical sanning

### 4.3 Köer är tunna operativa lager

Testköer ska endast bära tunn operativ information, i linje med rebuild-planens grundregel om tunna kölager fileciteturn7file4L1-L11.

### 4.4 Ingen H-routing i denna fas

C rebuild ska inte skicka något till H i detta steg. Rebuild-planen är tydlig med att H inte ska användas som tidig avlastning från ett omoget C-spår fileciteturn7file4L12-L18.

### 4.5 Endast generella förbättringar

Förbättringar i C1–C4-AI får endast vara:

- små
- generella
- återanvändbara
- verifierbara på samma failmängd

Site-specifika regler är förbjudna.

---

## 5. Målbild för C-test-riggen

C-test-riggen ska vara en **manuell batchdriven testkedja**.

Grundflöde:

`postB-preC` → Batchmaker → `C1 → C2 → C3` → rätt testutfallskö → eventuell `C4-AI` på failmängden → förbättring → omkörning av samma failmängd

Det viktiga är att batchen blir den tydliga arbetsenheten.

---

## 6. Inkommande pool (UPPDATERAD 2026-04-11)

**Den enda inkommande poolen för refill av den aktiva testpoolen är `postB-preC`.**

Inkommande pool ska hållas hel. Batchmaker ska välja arbetsmängden från poolen, inte tömma eller skriva om canonical source-data.

---

## 7. Batchmaker (UPPDATERAD 2026-04-11)

## Mål

Batchmaker ska fylla den aktiva testpoolen till 10 sources från `postB-preC`:
- Vid initialt skapande: välj 10 eligible C-källor
- Vid refill (mellan rundor): fyll på med nya eligible C-källor tills poolen har 10

## Krav

Batchmaker får inte bara ta första 10.
Den ska försöka skapa en **avsiktligt blandad och lärandenyttig pool**.

Det betyder att Batchmaker, så långt det går med generella signaler, ska försöka få spridning i till exempel:

- olika domäntyper
- olika HTML-strukturer
- olika länkmönster
- olika datumtäthet
- olika grad av list/card-likhet
- olika sannolikhet för kalender/program/tickets/event-sidor

### Viktig nyans

Batchmaker ska inte påstå att poolen är objektivt perfekt representativ.
Den ska vara **avsiktligt blandad och rimligt varierad** för lärande.

## Batchmaker får inte

- ändra canonical source-sanning
- skriva om `sources/`
- routea direkt till produktion
- smuggla in AI-beslut som poolurvalssanning
- fylla på från andra källor än `postB-preC`

---

## 8. Manuell testkedja för batchen

När en batch om 10 skapats ska varje source i batchen gå genom:

1. **C1** — discovery/frontier
2. **C2** — grov HTML-screening och/eller routing-signal
3. **C3** — HTML-extraktion

Först därefter får fail-fall gå till **C4-AI**.

Det ska vara tydligt vilken stage som faktiskt gav slututfallet.

---

## 9. Resultatfält per source

Varje source som lämnar batchkörningen ska bära minst dessa fält:

- `winningStage`
- `outcomeType`
- `routeSuggestion`
- `evidence`
- `roundNumber`

### Fältens betydelse

#### `winningStage`

Vilket steg som avgjorde utfallet.

Tillåtna värden:

- `C1`
- `C2`
- `C3`
- `C4-AI`

#### `outcomeType`

Tillåtna värden:

- `extract_success`
- `route_success`
- `fail`

#### `routeSuggestion`

Tillåtna värden:

- `UI`
- `A`
- `B`
- `D`
- `Fail`

#### `evidence`

Kort, konkret och spårbar motivering till utfallet.

Exempel:

- `event-like internal pages discovered with repeated date blocks`
- `strong feed/json signal discovered during HTML screening`
- `render likely required because raw HTML lacked usable content`
- `event blocks extracted from repeated card structure`
- `no stable event-like structure found`

#### `roundNumber`

Tillåtna värden:

- `1`
- `2`
- `3`

---

## 10. Testutfallsköer (UPPDATERAD 2026-04-11)

Efter C1 → C2 → C3 ska varje source hamna i **exakt en** testutfallskö.

### Testutfallsköer

- `postTestC-UI`
- `postTestC-A`
- `postTestC-B`
- `postTestC-D`
- `postTestC-manual-review`

**`postTestC-manual-review` ersätter alla tidigare restkö-namn** (inklusive `postTestC-Fail`, `postTestC-Fail-round1/2/3` som fysiska pipeline-köer).

**Men round-1/2/3 som spårnings-, rapporterings- och erfarenhetsbanksbegrepp finns fortfarande kvar.**
Se avsnitt 11 nedan för detaljer.

### Betydelse

#### `postTestC-UI`

Sourcen gav verklig HTML-extraktion.
Detta är staged test-output, inte automatisk produktion.

#### `postTestC-A`

Sourcen verkar med stark signal vara bättre kandidat för A.
Detta är endast testobservation.

#### `postTestC-B`

Sourcen verkar med stark signal vara bättre kandidat för B.
Detta är endast testobservation.

#### `postTestC-D`

Sourcen verkar med stark signal vara bättre kandidat för D.
Detta är endast testobservation.

#### `postTestC-manual-review`

Source har deltagit i 3 rundor utan events och utan fastställd A/B/D-routing.
Kräver manuell handläggning. Ersätter alla tidigare fail-restkö-namn.

---

## 11. Round-logik (UPPDATERAD 2026-04-11)

**DENNA MODELL ERSÄTTER ALLA TIDIGARE FORMULERINGAR OM "SAMMA 10 KÄLLOR GENOM TRE RUNDOR" SOM PRIMÄR LOOPMEKANISM.**

**Men round-1/2/3 som spårnings-, rapporterings-, jämförelse- och erfarenhetsbanksbegrepp finns fortfarande kvar — de ersätts inte av den dynamiska poolmodellen.**

### Vad som ersattes vs vad som består

| Äldre modell | Ny modell | Round-begreppet |
|-------------|-----------|-----------------|
| Statisk batch: samma 10 källor走 alla 3 rundor tillsammans | Dynamisk pool: sources lämnar när exitvillkor nås | **Består** — varje source har eget `roundsParticipated` (max 3) |
| Fasta `postTestC-Fail-round1/2/3`-köer som pipeline-steg | Enskilda exit-köer (postTestC-UI/A/B/D/manual-review) | **Består** — round 1/2/3 som rapporteringslager |
| Fail-kö-modellen som primär loopmekanism | Dynamisk refill från postB-preC | **Består** — före/efter-jämförelse per runda |

### Round-resultat som obligatoriskt spårningslager

**Varje source måste kunna följas genom sina rundor.** Detta gäller även i den dynamiska poolmodellen:

- `roundNumber` är obligatoriskt fält i källrapporten (Lag 2)
- `roundNumber` är obligatoriskt fält i batchrapporten (Lag 1)
- Rundrapport (Lag 3) skapas för varje round 1, 2 och 3
- C4-AI-lärrapporten (Lag 4) innehåller round-specifik data

**Exempel: Samma source i tre rapporter:**
```
Källa "sthlm-folkhogskola" i batch-011:
  - round-1-report.md: roundNumber=1, fail (extraction_failure)
  - round-2-report.md: roundNumber=2, fail (extraction_failure)
  - round-3-report.md: roundNumber=3, finalDecision=postTestC-manual-review
```

utan denna spårning skulle erfarenhetsbanken och före/efter-jämförelserna förloras.

### Grundmodell

- Aktiv testpool: max 10 C-källor
- Refill-pool: endast `postB-preC`
- Per source: `roundsParticipated` (max 3)
- Refill: endast mellan rundor, aldrig mitt i runda

### Per-source exitvillkor

| Villkor | Åtgärd |
|---------|--------|
| events hittades | → `postTestC-UI` |
| A-signal (hög konfidens) | → `postTestC-A` |
| B-signal (hög konfidens) | → `postTestC-B` |
| D-signal (hög konfidens) | → `postTestC-D` |
| 3 rundor utan events | → `postTestC-manual-review` |

### Rundflöde

**Runda N:**
- Kör C1 → C2 → C3 på alla kvarvarande aktiva sources
- Varje source hamnar i exakt en utfallskö
- Sources som lämnar poolen ersätts inte förrän mellan rundor

**Mellan rundor:**
- Beräkna nya aktiva poolstorlek
- Om pool < 10: Batchmaker fyller på med eligible sources från `postB-preC`
- Sources som redan lämnat poolen får inte återkomma
- poolRoundNumber += 1

**Upprepning:**
- Steg 1–2 upprepas tills alla aktiva sources lämnat poolen eller nått 3 rundor

---

## 12. C4-AI / lärloopen

C4-AI ska inte vara en konkurrerande pipeline.

C4-AI ska:

- analysera fail-fallen efter C1 → C2 → C3
- hitta återkommande generella mönster
- föreslå förbättringar till C1, C2 eller C3
- hjälpa till att avgöra om ett återkommande failmönster egentligen borde ge starkare routing till A/B/D

C4-AI får inte:

- ersätta C1–C3 som dold huvudlogik
- skapa site-specifika regler
- fabricera events
- flytta saker direkt till produktion
- skapa ny parallell sanning om pipeline-stegen

---

## 13. Rapportering per batch

**AUKTORITATIV RAPPORTSPECIFIKATION:** [C-testRig-reporting.md](./C-testRig-reporting.md) — där definieras de fyra obligatoriska rapportlagren med fullständiga fältlistor.

Efter varje batch måste fyra rapportlager skapas, inget får utelämnas:

**Lag 1 — Batchrapport** (`reports/batch-{N}/batch-report.md`):
Obligatoriskt innehåll:
- batchId, roundNumber, inputQueue, sourcesIn
- extractSuccess, routeSuccess, fail
- failTypeDistribution (C0-discovery-fail / C2/C3-glapp-fail / C2-gränsfall)
- winningStageDistribution (C1 / C2 / C3 / C4-AI)
- totalEventsExtracted
- generalChangesTested (en post per cykel)
- beforeSummary, afterSummary
- stopReason, nextStep

**Lag 2 — Källrapporter** (`reports/batch-{N}/source-reports/{sourceId}.md`):
En fil per source. Obligatoriskt innehåll per källa:
- batchId, roundNumber, sourceId, url
- winningStage, outcomeType, routeSuggestion
- failType, evidence
- c0Candidates, winnerUrl, c2Verdict, c2Score
- eventsFound, changeApplied, improvedAfterChange
- rootCause, finalDecision

**Lag 3 — Rundrapporter** (`reports/batch-{N}/round-{N}-report.md`):
En fil per 123-runda. Obligatoriskt innehåll:
- batchId, roundNumber, failSetUsed
- hypothesis, changeApplied, whyGeneral
- beforeResults, afterResults
- sourcesImproved, sourcesUnchanged, sourcesWorsened
- decision, runNextRound, stopReason

**Lag 4 — C4-AI-lärrapport** (`reports/batch-{N}/c4-ai-learnings.md`):
En fil per batch. Obligatoriskt innehåll:
- batchId, roundNumber
- observedPattern, hypothesis, proposedGeneralChange
- changeApplied, whyGeneral
- beforeSummary, afterSummary
- sourcesImproved, sourcesUnchanged, sourcesWorsened
- decision, learnedRule, confidence, shouldBeReusedLater

**Regler:**
- Rapporter är byggstenar för en framtida erfarenhetsbank — inte loggfiler
- C4-AI-lärrapporten är obligatorisk, inte frivillig fri text
- Före/efter-jämförelse krävs för varje 123-runda
- Varje källa i varje runda måste kunna spåras via källrapport
- Utan denna rapportering blir 123-loopen inte verifierbar

---

## 14. Förhållande till legacy batchspår

### Ny aktiv runner (2026-04-11): `run-dynamic-pool.ts`

Den nya canonical runnern för C-testRiggen är `run-dynamic-pool.ts`. Den implementerar:

- Dynamisk testpool på max 10 aktiva C-källor
- Per-source `roundsParticipated` (max 3)
- Exitvillkor: events → UI, A/B/D-signal → A/B/D, 3 rundor utan lösning → manual-review
- Refill endast mellan rundor, endast från `postB-preC`
- Sources som lämnat poolen får inte återkomma
- Rapportering på fyra nivåer: pool/batch, source, round, C4-AI

### Legacy-artefakter

Gamla artefakter som exempelvis:

- äldre `run-batch-*` (run-batch-001 – run-batch-012)
- äldre `batch-state.jsonl` (pre-2026-04-11)
- äldre `run-round-1.ts` (statisk fail-round-modell)

ska i denna rebuild betraktas som:

- **legacy baseline batch mode**
- historisk referens
- inte aktiv pipeline

De får användas som lärdom eller jämförelse, men ska inte vara styrande sanning.

---

## 15. Promotion till riktig pipeline

Inget i C-test-riggen ska automatiskt gå till riktig pipeline i denna fas.

### Senare möjlig manuell promotion

#### Från `postTestC-UI`

Kan senare manuellt promote:as till riktig `preUI` / normalizer-väg om extraction har verifierats.

#### Från `postTestC-A`

Kan senare manuellt testas i riktig A-väg.

#### Från `postTestC-B`

Kan senare manuellt testas i riktig B-väg.

#### Från `postTestC-D`

Kan senare manuellt testas i riktig D-väg.

---

## 16. Stora steg i rebuilden

### Steg 1 — Lås semantiken

Lås den canonical målmodellen:

- C1 = discovery/frontier
- C2 = grov HTML-screening och/eller routing-signal
- C3 = HTML-extraktion
- C4-AI = separat AI-steg efter fail

### Steg 2 — Lås mappningen mot nuvarande kod

Dokumentera tydligt vad i nuvarande implementation som motsvarar C1, C2, C3 och C4-AI.

### Steg 3 — Bygg Batchmaker

Bygg första riktiga batchkomponenten som väljer 10 blandade källor från `postB-preC`.

### Steg 4 — Bygg manuell C-testkedja

Bygg batchkörning genom C1 → C2 → C3 med tydliga resultatfält och exakt en utfallskö per source.

### Steg 5 — Bygg batchrapportering

Bygg standardrapport efter varje batch så att utfallet blir verifierbart.

### Steg 6 — Bygg fail-round1 → 2 → 3

Bygg den riktiga förbättringsloopen så att samma failmängd körs igen efter generella förbättringar.

### Steg 7 — Lägg AI utanför kärnflödet

Koppla in C4-AI efter fail, inte mitt inne i kärnflödet.

### Steg 8 — Frys eller ersätt legacy batchspår

Gör klart vad som är legacy och vad som är ny aktiv C-test-rigg.

### Steg 9 — Först därefter: manuell promotion

När testriggen fungerar sanningsenligt kan staged testresultat börja promote:as manuellt till riktig pipeline.

---

## 17. Vad som inte ska göras nu

- inte börja med full automation
- inte auto-forwarda `postTestC-UI` till riktig pipeline
- inte låta AI maskera svagheter i C1–C3
- inte bygga site-specifika regler
- inte skicka fall till H
- inte fortsätta med gamla batchartefakter som om de vore aktiv pipeline
- inte låta dokumentation säga mer än vad rebuilden faktiskt gör

---

## 18. Slutprincip

C-rebuilden ska inte bygga “allt på en gång”.

Den ska bygga en **liten men sann test-rigg** där:

- 10 blandade källor väljs från `postB-preC`
- källorna går genom C1 → C2 → C3
- varje source får tydliga resultatfält
- varje source hamnar i rätt testutfallskö
- samma failmängd förbättras och körs igen
- AI är separat, tydlig och avstängningsbar
- endast verklig extraction får senare nå riktig pipeline

Det är så C-spåret blir spårbart, förbättringsbart och verkligt användbart.
