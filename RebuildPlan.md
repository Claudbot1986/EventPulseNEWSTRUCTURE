# SOURCE REBUILD PLAN

## 1. Syfte

Syftet med denna ombyggnad är att skapa en tydlig, robust och verifierbar source-arkitektur för EventPulse där:

- råa källor kan importeras upprepade gånger utan dubletter
- `00-Sources/sources/` är den enda canonical sanningen för source-identitet
- operativa köer hålls separata från masterdata
- befintliga verktyg A, B, C och D används systematiskt på källor som ännu inte passerat rätt verktyg
- varje köhopp blir spårbart
- C-spåret utvecklas vidare innan svåra C-fall börjar skickas till H
- H hålls litet och värdefullt, helst högst cirka 5% av källorna
- UI endast får källor där verktyg faktiskt lyckats utvinna events

Denna plan ersätter grov mass-routing som slutlig sanning. Routing ska i stället bli ett kontrollerat verktygsflöde med spårbarhet.

---

## 2. Canonical Principles

### 2.1 En source har en canonical identitet

Varje källa ska ha ett stabilt `sourceId` som används konsekvent i hela systemet.

### 2.2 `sources/` är master-sanning

`00-Sources/sources/` är den enda canonical källan för:

- source-identitet
- grundmetadata
- relevanta flags
- nuvarande operativt steg i kedjan
- queue-history / route-history
- tool-history
- statusfält som hör till source-livscykeln

### 2.3 Köer är tunna operativa lager

Pre-, post- och UI-köer får inte bli parallella source-register. De ska endast innehålla:

- referens till canonical source
- queue-specifik metadata
- prioritet
- timestamps
- attempts / worker-noteringar

De får inte bära full source-sanning.

### 2.4 Historik får aldrig förstöras

Varje hopp mellan steg ska vara spårbart. Historik ska appendas, aldrig skrivas över.

### 2.5 Verktyg före slutlig klassning

En källa ska i normalfallet inte placeras i slutlig A/B/C/D/H enbart på grov metadata. Befintliga verktyg ska användas på källor som ännu inte passerat relevant steg.

### 2.6 C ska utvecklas innan H används från C

Svåra C-fall ska först samlas i `postC`, inte direkt i `preH`. H finns som målstruktur men ska inte bli avlastning för ett omoget C-spår.

### 2.7 H är dyrt och ska hållas litet

H är ett medvetet lager för verkligt svåra, värdefulla fall. Målet är att högst cirka 5% av källorna ska hamna där när verktygen fungerar rimligt bra.

---

## 3. Fas 1 — Reset

### Mål

Nollställa tidigare operativ sortering utan att radera historik.

### Ska göras

1. Alla sources återställs till ett operativt läge som motsvarar obehandlad eller osorterad.
2. Tidigare queue-markeringar, batchmarkeringar och route-status neutraliseras som styrande sanning.
3. Gammal operativ state markeras som `legacy` eller `pre-reset`.
4. Historik bevaras men styr inte vidare rebuild.

---

## 4. Fas 2 — Raw Import Tool (00A)

### Mål

Fastställa och standardisera verktyget som importerar råa källor till deduplicerade canonical sources.

### Krav på 00A

Verktyget i `00-Sources/00A-ImportRawSources-Tool/` ska kunna:

- läsa en eller flera råa source-listor från RawSources
- normalisera namn och URL:er
- identifiera sannolika dubletter
- skapa nya canonical sources
- uppdatera befintliga canonical sources utan att skapa dubletter
- köras flera gånger utan att source-biblioteket blir smutsigt
- föra manifest över importerade filer
- ge spårbarhet på fil- och radnivå

### Viktiga säkerhetsregler

- import är append-only
- backup av `sources/` ska tas före import
- importpreview får aldrig tolkas som replacement set
- inga sources får tas bort av 00A

---

## 5. Fas 3 — Canonical Sources Architecture

### Mål

Skapa en ren source-arkitektur där `sources/` är master utan att i onödan bryta befintlig runtime.

### Viktig säkerhetsregel

Nuvarande `00-Sources/sources/` ska inte döpas om direkt innan kompatibilitet är verifierad.

### Varje source i master ska kunna bära

- `sourceId`
- canonical URL
- normaliserat namn
- discovery metadata
- relevanta flags
- `requiresManualReview` / `reviewTags` där relevant
- nuvarande operativt steg
- queue-history / route-history / tool-history
- länkar till rapporter eller tidigare analyser

---

## 6. Fas 4 — Queue Architecture

### Mål

Skapa separata operativa köer utan att skapa separata masterregister.

### Grundprincip

Köerna ska spegla **var i verktygskedjan** en source befinner sig, inte utgöra nya källregister.

### Operativa steg i kedjan

Följande steg ska finnas i master och motsvarande tunna kölager ska kunna finnas operativt:

- `sources-main`
- `preA`
- `postA`
- `postA-preB`
- `preB`
- `postB`
- `postB-preC`
- `preC`
- `postC`
- `preD`
- `postD`
- `preH`
- `preUI`
- `UI`

### Tunn queue-post ska kunna innehålla

- `sourceId`
- `queueName`
- `queuedAt`
- `priority`
- `attempt`
- `queueReason`
- `workerNotes`
- eventuellt liten snapshot för debug om absolut nödvändigt

### Får inte ligga i köerna

- full source metadata
- full title/name/url-payload om den redan finns i source-filen
- full route-history
- full tool-history
- raw text eller extracted content som långlivad sanning

---

## 7. Fas 5 — Verktygsdriven Routingkedja

### Mål

Låta sources passera genom befintliga verktyg i rätt ordning, med tydlig spårbarhet efter varje steg.

### Viktig ändring jämfört med grov mass-routing

Detta steg ska **inte** betyda att alla källor mass-routas direkt till slutliga A/B/C/D/H på grov metadata. I stället ska systemet använda befintliga verktyg stegvis.

### Kedjan i människospråk

`råa källor → 00A → sources-main → A-verktyg → B-verktyg → C-verktyg/123 → D-verktyg → UI`

H finns, men ska ännu inte få inflöde direkt från C.

---

## 8. Fas 5A — A-spåret

### Mål

Köra verktyg A på källor som ännu inte passerat A.

### Flöde

`preA`
→ kör A-verktyg

Utfall:

1. **events utvinns**
   - till `preUI`
2. **stark A-kandidat men ej full extraction ännu**
   - till `postA`
3. **ej A**
   - till `postA-preB`

### A betyder här

Riktiga API/XHR/network-källor där eventdata kan hämtas reproducerbart utan HTML-scraping.

---

## 9. Fas 5B — B-spåret

### Mål

Köra verktyg B på källor som passerat A men inte lösts där.

### Flöde

`postA-preB`
→ `preB`
→ kör B-verktyg

Utfall:

1. **events utvinns**
   - till `preUI`
2. **stark B-kandidat men ej full extraction ännu**
   - till `postB`
3. **ej B**
   - till `postB-preC`

### B betyder här

JSON-LD, RSS, ICS, statiska JSON-filer, feed-länkar och andra icke-renderade strukturerade datakällor.

---

## 10. Fas 5C — C-spåret

### Mål

Köra C0/C1/C2 och 123-loopen på källor som inte lösts via A eller B, och samtidigt utveckla generell HTML-scraping.

### Flöde

`postB-preC`
→ `preC`
→ kör `C0/C1/C2 + 123`

Utfall:

1. **events utvinns**
   - till `preUI`
2. **verifierad A-kandidat hittas**
   - tillbaka till `preA`
3. **verifierad B-kandidat hittas**
   - tillbaka till `preB`
4. **verifierad D-kandidat hittas**
   - till `preD`
5. **ej generellt lösbar ännu**
   - till `postC`

### Viktig regel

C ska **inte** ännu skicka till `preH`. `postC` är det avsiktliga lagret för olösta C-fall medan C-verktyget fortfarande utvecklas.

### Syftet med `postC`

`postC` är inte en papperskorg. Det är ett lärande lager för:

- svåra HTML-fall
- cases som kräver mer generell C-utveckling
- cases där A/B/D-signal måste upptäckas bättre

---

## 11. Fas 5D — D-spåret

### Mål

Köra D/render-verktyget på källor där render-behov faktiskt upptäckts.

### Flöde

`preD`
→ kör D-verktyg

Utfall:

1. **events utvinns**
   - till `preUI`
2. **stark D-kandidat men ej full extraction ännu**
   - till `postD`
3. **ej lösbar med D**
   - senare kandidat för `preH`, men detta ska styras först när H aktiveras skarpt

### Viktig regel

D ska användas restriktivt. Render ska inte sättas på misstanke utan på tydlig signal eller verifiering.

---

## 12. Fas 5E — H-spåret

### Mål

Ha en färdig målstruktur för manuell hantering, men inte använda den som utväg för C ännu.

### Viktig regel

`preH` ska finnas som operativt steg, men ska **inte** i detta skede få inflöde direkt från C.

### H blir aktivt först när

- C har utvecklats tillräckligt
- A/B/D-reglerna är rimligt stabila
- ni vill börja samla verkligt svåra restfall

### När H senare används

H ska endast ta emot:

- källor som inte kunnat lösas i A/B/C/D
- fall med hög lärdomspotential
- fall där manuell hantering är motiverad

Målet är att hålla H litet, helst högst cirka 5%.

---

## 13. Fas 5F — UI-flödet

### Mål

Bara källor där verktyg faktiskt lyckats utvinna events ska nå UI-flödet.

### Flöde

`preUI`
→ verifiering av att events faktiskt utvunnits
→ `UI`

### Viktig regel

UI ska inte få källor bara för att de är lovande kandidater. UI ska få källor där extraction faktiskt fungerat.

---

## 14. Spårbarhet mellan köhopp

### Mål

Det ska gå att se exakt hur en source rört sig genom kedjan.

### Varje source ska kunna bära

- `currentOperationalQueue`
- `queueEnteredAt`
- `queueHistory[]`
- `lastToolRun`
- `lastToolResult`
- `toolHistory[]`
- `attemptCountsByTool`
- `routingReason`
- `routingConfidence`

### Exempel

En source ska kunna visa något i stil med:

- `sources-main`
- `preA`
- `postA-preB`
- `preB`
- `postB-preC`
- `preC`
- `postC`

Det ska också gå att se hur många gånger den eventuellt hoppat mellan A, B, C och D.

---

## 15. Fas 6 — Verifieringsregler för A/B/D

### Mål

Definiera exakt vad som menas med att en source verkligen är A-, B- eller D-kandidat.

### Grundregel

Flytt mellan spår får inte ske på AI-känsla eller grov metadata. Verktyg eller verifieringsfunktion måste ge konkret grund.

### Detta måste definieras och implementeras

- `verifyAClassification(source)`
- `verifyBClassification(source)`
- `verifyDClassification(source)`

### Exempel

**A**
- relevant API/XHR hittat
- eventdata kan hämtas reproducerbart
- HTML behövs inte som huvudväg

**B**
- JSON/feed/structured payload innehåller användbar eventdata
- resultatet är reproducerbart

**D**
- rå HTML saknar nödvändigt innehåll
- relevant innehåll uppstår först efter render
- render-behov är konkret bekräftat

---

## 16. Fas 7 — C-Batchmaker

### Mål

Skapa batchar om 10 från `preC` / C-lagret utan att förstöra historik eller masterdata.

### Plats

Verktyget ska ligga i:

`C-htmlGate/C-Batchmaker-Tool/`

### Viktig regel

Batchmaker ska bygga separat batchlager och får inte skriva om `sources/` godtyckligt.

---

## 17. Fas 8 — 123-Loop

### Mål

123-loopen ska förbättra generell HTML-scraping på batchar från C-lagret.

### 123 ska göra

1. läsa batchar från C-lagret
2. göra grov HTML-analys på huvudsidor och relevanta undersidor
3. köra förfinad scraping
4. jämföra scrapingresultat mot AI-baserad analys
5. dra generella slutsatser
6. skriva rapport per källa och batch

### 123 får inte göra

- bygga site-specifika regler
- använda H som tidig avlastning
- göra arkitekturomläggningar under loopens gång

---

## 18. Fas 9 — Aktivering av H som verkligt restlager

### Mål

Först när C är mer moget börja skicka verkliga restfall till H.

### Detta får ske först när

- C utvecklats ett antal kontrollerade varv
- A/B/D-signaler upptäcks rimligt väl
- `postC` visar verkliga kvarvarande svårfall
- H kan hållas litet och meningsfullt

---

## 19. Rekommenderad arbetsordning

Arbetet ska ske i denna ordning:

1. skriv in denna plan som styrande fil
2. genomför Fas 1: reset
3. fastställ eller bygg 00A-verktyget
4. verifiera att raw-import fungerar deduplicerat och idempotent
5. bygg eller justera canonical source-arkitekturen utan att direkt bryta nuvarande `sources/`
6. skapa queue-arkitekturen som tunna operativa lager
7. koppla varje verktyg till sin inkommande kö och verifiera att verktygen nekar körning från fel kö
8. kör verktygsdriven kedja A → B → C → D, inte grov slutrouting som ensam sanning
9. definiera verifieringsregler för A/B/D
10. bygg C-Batchmaker
11. bygg och strama upp 123-loopen
12. använd `postC` som lärande lager innan H aktiveras från C
13. aktivera H som verkligt restlager först när C mognat
14. låt endast källor med verklig event-extraction nå `preUI → UI`

---

## 20. Appendix — två jämförda modeller

### Modell A — rekommenderad

Verktygsdriven kedja med spårbara steg:

`00A → sources-main → preA → A → preB → B → preC → C → preD → D → preUI → UI`

med möjlighet för C att skicka uppåt till `preA`, `preB` eller `preD`, och olösta fall till `postC`.

### Modell B — alternativ men inte huvudval

Ett grovverktyg som först gör skarp första screening från `sources-main` till A/B/C/D/H.

Detta kan senare användas som lätt försortering, men ska inte ensam ersätta den verktygsdrivna kedjan om precisionen är otillräcklig.

---

## 21. Fas 10 — Manuell verktygskörning före helintegrering

### Mål

Innan systemet helintegreras ska varje verktyg kunna köras manuellt, med tydliga inkommande och utgående köer, så att hela kedjan kan testas och verifieras steg för steg.

### Viktig princip

Detta steg kommer före full automation. Pre- och post-köer ska först fungera operativt vid manuell körning enligt denna plan.

### Detta ska uppnås

- A kan köras manuellt endast på källor i rätt inkommande kö
- B kan köras manuellt endast på källor i rätt inkommande kö
- C kan köras manuellt endast på källor i rätt inkommande kö
- D kan köras manuellt endast på källor i rätt inkommande kö
- varje verktyg ska kunna testas och verifieras isolerat
- varje köhopp ska kunna observeras i master och i tunna köposter
- felaktig körning från fel kö ska nekas tydligt

### Resultat

När denna fas är klar ska hela kedjan kunna köras kontrollerat av människa, verktyg för verktyg, från `sources-main` till `preUI` eller senare `preH`.

---

## 22. Fas 11 — Slutintegration: `importALL`

### Mål

Slutmålet är att ett enda kommando, exempelvis `importALL`, ska kunna köra flödet från råa källor i `RawSources/` hela vägen till `preUI` eller senare `preH`, via den verktygsdrivna kedjan.

### Viktig regel

Denna helintegrering får ske först när manuell verktygskörning och kögating fungerar stabilt.

### Slutflöde i människospråk

`RawSources → 00A-import → sources-main → A/B/C/D-kedjan → preUI eller senare preH`

### Detta ska betyda i praktiken

- råa filer i `RawSources/` läses in automatiskt
- 00A uppdaterar canonical `sources/` append-only
- nya eller relevanta sources går vidare in i rätt verktygskedja
- endast sources där events faktiskt utvinns når `preUI`
- verkliga restfall kan senare nå `preH` när H aktiverats skarpt
- spårbarheten ska finnas hela vägen från råfil till operativt slutläge

### Viktig avgränsning

`importALL` är ett slutmål för integrering, inte startpunkten för rebuilden. Först ska kedjan fungera manuellt och verifierat.

---

## 23. Vad som INTE ska göras nu

- inte direkt döpa om nuvarande `sources/` innan kompatibilitet är verifierad
- inte låta köerna bli egna masterregister
- inte behandla grov mass-routing som slutlig verktygsklassning
- inte skicka C-fall till H för tidigt
- inte bygga site-specifika HTML-regler i 123
- inte låta UI få källor utan verklig extraction
- inte acceptera stor H-kö som normalbild; hög H-andel betyder att verktygen behöver förbättras
- inte aktivera `importALL` innan manuell verktygskörning och kögating fungerar stabilt
