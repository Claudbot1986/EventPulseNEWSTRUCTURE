# C-rebuild-plan

**⚠️ NAMNRÖRA-VARNING:** Se [C-status-matrix.md](./C-status-matrix.md) för förklaring av C0/C1/C2/C3/C4-AI-namnröran innan du läser denna fil.

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

## 6. Inkommande pool

Den enda inkommande poolen i denna fas är:

- `postB-preC`

Inkommande pool ska hållas hel. Batchmaker ska välja arbetsmängden från poolen, inte tömma eller skriva om canonical source-data.

---

## 7. Batchmaker

## Mål

Batchmaker ska skapa en **manuell testbatch om 10 källor** från `postB-preC`.

## Krav

Batchmaker får inte bara ta första 10.
Den ska försöka skapa en **avsiktligt blandad och lärandenyttig batch**.

Det betyder att Batchmaker, så långt det går med generella signaler, ska försöka få spridning i till exempel:

- olika domäntyper
- olika HTML-strukturer
- olika länkmönster
- olika datumtäthet
- olika grad av list/card-likhet
- olika sannolikhet för kalender/program/tickets/event-sidor

### Viktig nyans

Batchmaker ska inte påstå att batchen är objektivt perfekt representativ.
Den ska vara **avsiktligt blandad och rimligt varierad** för lärande.

## Batchmaker får inte

- ändra canonical source-sanning
- skriva om `sources/`
- routea direkt till produktion
- smuggla in AI-beslut som batchurvalssanning

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

## 10. Testutfallsköer

Efter C1 → C2 → C3 ska varje source hamna i **exakt en** testutfallskö.

### Testutfallsköer

- `postTestC-UI`
- `postTestC-A`
- `postTestC-B`
- `postTestC-D`
- `postTestC-Fail-round1`
- `postTestC-Fail-round2`
- `postTestC-Fail-round3`
- `postTestC-Fail`

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

#### `postTestC-Fail-round1`

Sourcen misslyckades i första batchrundan.

#### `postTestC-Fail-round2`

Sourcen misslyckades igen efter första förbättringsvarvet.

#### `postTestC-Fail-round3`

Sourcen misslyckades igen efter andra förbättringsvarvet.

#### `postTestC-Fail`

Slutligt restlager efter tre kontrollerade rundor.
Detta är fortfarande inte H.

---

## 11. Round-logik

### Round 1

- Batchmaker väljer 10 källor från `postB-preC`
- batchen körs genom `C1 → C2 → C3`
- varje source får resultatfält
- varje source hamnar i exakt en testutfallskö
- fail-fallen från just denna batch går till `postTestC-Fail-round1`

### Round 2

- endast fail-fallen från **samma batch** analyseras
- C4-AI används för analys och förbättringsförslag
- endast små generella förbättringar får göras
- samma failmängd körs igen genom C1 → C2 → C3
- kvarvarande misslyckanden går till `postTestC-Fail-round2`

### Round 3

- samma princip igen
- samma failmängd analyseras
- endast generella förbättringar
- omkörning på samma failmängd
- kvarvarande går till `postTestC-Fail-round3`

### Slutligt restlager

- källor som fortfarande misslyckas efter tre kontrollerade rundor går till `postTestC-Fail`

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

Efter varje batch måste en tydlig rapport skapas.

Rapporten ska minst innehålla:

- antal sources i batchen
- hur många som fick `extract_success`
- hur många som fick `route_success`
- hur många som failade
- hur många som vann i C1
- hur många som vann i C2
- hur många som vann i C3
- hur många som vann i C4-AI
- hur många events som extraherades i C3
- vilka sourceIds som gav events
- hur många som routeades till A
- hur många som routeades till B
- hur många som routeades till D
- vanligaste failorsakerna
- vad som ändrades inför nästa runda
- om förbättringen faktiskt hjälpte på samma failmängd

Utan denna rapportering blir 123-loopen inte verifierbar.

---

## 14. Förhållande till legacy batchspår

Gamla artefakter som exempelvis:

- äldre `run-batch-*`
- äldre `batch-state.jsonl`
- äldre batch-infrastruktur-dokumentation

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
