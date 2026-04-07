SOURCE REBUILD PLAN

1. Syfte

Syftet med denna ombyggnad är att skapa en tydlig, robust och verifierbar source-arkitektur för EventPulse där:
	•	råa källor kan importeras upprepade gånger utan dubletter
	•	sources/ är den enda canonical sanningen för source-identitet
	•	operativa köer hålls separata från masterdata
	•	alla sources kan routas till rätt arbetskö: A, B, C, D eller H
	•	123-loopen endast arbetar på batchar från C
	•	förbättring av HTML-scraping sker generellt, inte site-specifikt
	•	flytt från C till A, B eller D endast får ske efter verifierad klassning
	•	svåra, verkliga HTML-fall samlas i H för senare djupanalys

Denna plan ska ersätta lös ryckig styrning och minska risken för flera parallella sanningar.

⸻

2. Canonical Principles

2.1 En source har en canonical identitet

Varje källa ska ha ett stabilt sourceId som används konsekvent i hela systemet.

2.2 sources/ är master-sanning

00-Sources/sources/ är den enda canonical källan för:
	•	source-identitet
	•	grundmetadata
	•	nuvarande queue-placement
	•	route-history
	•	statusfält som hör till source-livscykeln

2.3 Köer är operativa urval, inte alternativa sanningar

A-, B-, C-, D- och H-köerna får inte bli parallella source-register. De ska endast innehålla lätta queue-poster eller referenser till canonical source.

2.4 Historik får aldrig förstöras

Flytt mellan köer får aldrig innebära att tidigare routinghistorik tappas bort. Historik ska bevaras som spårbar route-history.

2.5 HTML-förbättringar måste vara generella

All utveckling i C-spåret ska förbättra generell HTML-scraping. Inga site-specifika scrapingmetoder ska byggas in i 123-loopen.

2.6 Verifiering före flytt

Ingen source får flyttas från C till A, B eller D enbart för att AI eller heuristik “tror” det. Flytt kräver uttrycklig verifiering.

⸻

3. Fas 1 — Reset

Mål

Nollställa nuvarande operativa source-sortering så att systemet kan byggas upp från ett rent läge.

Ska göras
	1.	Alla sources återställs till ett operativt läge som motsvarar obehandlad eller osorterad.
	2.	Befintliga queue-markeringar, batchmarkeringar och route-status som hör till tidigare körningar neutraliseras.
	3.	Gamla batchfiler, gamla C-köer och gammal route-state får inte längre användas som styrande sanning.
	4.	Tidigare data får behållas, men ska markeras tydligt som legacy eller pre-reset.

Viktig regel

Reset betyder inte att historik ska raderas. Reset betyder att gammal operativ sortering inte längre styr systemet.

⸻

4. Fas 2 — Raw Import Tool (00A)

Mål

Fastställa och standardisera verktyget som importerar råa källor till deduplicerade canonical sources.

Krav på 00A

Verktyget i 00-Sources/00A-ImportRawSources-Tool/ ska kunna:
	•	läsa råa source-listor
	•	normalisera namn och URL:er
	•	identifiera sannolika dubletter
	•	skapa nya canonical sources
	•	uppdatera befintliga canonical sources utan att skapa dubletter
	•	köras flera gånger utan att source-biblioteket blir smutsigt

Idempotenskrav

00A måste vara idempotent:
	•	samma råkälla importerad flera gånger får inte skapa flera source-poster
	•	stökiga input-listor måste kunna dedupliceras stabilt

Om verktyget redan finns

Om liknande funktionalitet redan finns i projektet ska den återanvändas, flyttas eller kapslas in under 00A-ImportRawSources-Tool/, och dokumenteras tydligt.

Om verktyget inte finns

Om sådan funktionalitet saknas ska ett nytt, avgränsat verktyg byggas med just detta ansvar.

⸻

5. Fas 3 — Canonical Sources Architecture

Mål

Skapa en ren source-arkitektur där sources/ är master utan att i onödan bryta befintlig runtime.

Viktig säkerhetsregel

Nuvarande 00-Sources/sources/ ska inte döpas om direkt innan kompatibilitet är verifierad.

Därför gäller följande
	1.	Nuvarande sources/ lämnas orörd tills det är bevisat att beroenden inte bryts.
	2.	Om en ny generation av sources behöver byggas parallellt ska detta först ske i en separat struktur, exempelvis sources_v2/.
	3.	Först när kompatibilitet, läsande kod och beroenden är verifierade får ny canonical struktur ta över.
	4.	När övergång sker ska det vara tydligt vilken mapp som är aktiv canonical source truth.

Varje source i master ska kunna bära
	•	sourceId
	•	canonical URL
	•	normaliserat namn
	•	discovery metadata
	•	current status
	•	current queue placement
	•	route-history
	•	relevanta flags
	•	eventuellt länkar till rapporter eller tidigare analyser

⸻

6. Fas 4 — Queue Architecture (A/B/C/D/H)

Mål

Skapa separata operativa köer utan att skapa separata masterregister.

Köstruktur

Följande köer ska finnas:
	•	A-directAPI-networkGate/A-queue/
	•	B-JSON-feedGate/B-queue/
	•	C-htmlGate/C-queue/
	•	D-renderGate/D-queue/
	•	H-manualReview/H-queue/

Köernas roll

Varje kö ska endast beskriva:
	•	vilka sources som väntar på behandling i det spåret
	•	eventuell prioritet
	•	eventuell queue-specifik metadata
	•	referens till canonical source

Viktig regel

Köfiler får inte innehålla egna fulla, långlivade versioner av source-sanningen. Master ligger i sources/.

⸻

7. Fas 5 — Initial Routing

Mål

Låta systemet routa alla canonical sources till rätt första kö från ett rent läge.

Routing ska bedöma

För varje source får systemet analysera:
	•	huvudsidan
	•	relevanta undersidor
	•	och särskilt den eller de sidor där eventen faktiskt verkar ligga

Det räcker alltså inte att bara titta på startsidan.

Routingutfall

En source ska routas till:
	•	A om det finns tydlig network/API-baserad väg
	•	B om det finns tydlig JSON/feed/strukturerad data-väg
	•	C om källan framstår som HTML-baserad och inte redan verifierats som A, B eller D
	•	D endast om render-behov är operativt verifierat
	•	H om källan är osäker, svårtolkad eller kräver manuell kontroll

Uppdateringar som ska ske samtidigt

När routingen körs ska source-filen uppdateras med:
	•	currentQueue
	•	routingConfidence
	•	routingReason
	•	routedAt
	•	route-history

Samtidigt ska rätt köpost skapas i motsvarande queue.

⸻

8. Fas 6 — C-Batchmaker

Mål

Skapa smarta batchar om 10 från C-kön utan att förstöra huvudordning eller historik.

Plats

Verktyget ska ligga i:
C-htmlGate/C-Batchmaker-Tool/

Input
	•	C-kön

Output
	•	batchfiler i C-batches/

Batchmaker ska
	•	skapa batchar om 10
	•	välja variation som maximerar lärande
	•	undvika att en enda typ av källa dominerar batchen
	•	kunna köras flera gånger utan att tidigare batchordning förstörs
	•	hålla batchlagret separat från både master sources och C-kön

Viktig regel

Batchmaker får inte godtyckligt skriva om sources/ eller förstöra C-kön. Den ska bygga ett separat batchlager.

⸻

9. Fas 7 — 123-Loop

Mål

123-loopen ska endast göra ett jobb: förbättra generell HTML-scraping på batchar från C.

123 ska göra
	1.	Läsa en batch om 10 från C-batches/
	2.	Göra grov HTML-analys på huvudsidor och relevanta undersidor
	3.	Köra förfinad scraping
	4.	Jämföra scrapingresultat mot AI-baserad analys
	5.	Dra generella slutsatser om hur HTML-scrapingverktyget kan förbättras
	6.	Köra totalt 3 kontrollerade körningar per källa eller batch
	7.	Skriva:
	•	1 rapport per källa
	•	1 rapport per batch

123 får inte göra
	•	bygga site-specifika regler
	•	flytta källor från C till A/B/D enbart på AI-bedömning
	•	hoppa mellan flera mål samtidigt
	•	ändra hela systemarkitekturen under loopens gång

Utfall efter 3 körningar

Efter tre körningar ska varje source i batchen antingen:
	•	vara kvar i C
	•	flyttas till A efter verifiering
	•	flyttas till B efter verifiering
	•	flyttas till D efter verifiering
	•	flyttas till H om den verkar vara en riktig eventkälla men inte går att lösa generellt med HTML

⸻

10. Fas 8 — “100% säker flytt” verifieringsregler

Mål

Definiera exakt vad “100% säker flytt” betyder operativt.

Grundregel

Flytt från C till A, B eller D får aldrig ske direkt från:
	•	AI-bedömning
	•	magkänsla
	•	hög sannolikhet
	•	allmän misstanke

Flytt får endast ske när en explicit verifieringsfunktion har bekräftat klassningen.

Detta måste finnas

Följande verifieringslogik ska definieras och implementeras:
	•	verifyAClassification(source)
	•	verifyBClassification(source)
	•	verifyDClassification(source)

Krav för faktisk flytt

En source får flyttas från C till A, B eller D endast om:
	1.	rätt verifieringsfunktion körts
	2.	verifieringen returnerat godkänt resultat
	3.	routingConfidence = verified
	4.	routingReason anger den konkreta verifierade orsaken

Exempel: vad som måste verifieras

A — verifierad network/API-källa
Minst något i stil med:
	•	relevant API/XHR eller nätverkskälla har hittats
	•	eventdata eller tydligt eventnära data kommer därifrån
	•	datan går att hämta reproducerbart utan HTML-scraping

B — verifierad strukturerad data-källa
Minst något i stil med:
	•	JSON, feed eller strukturerad payload innehåller användbar eventdata
	•	datan är direkt extraherbar
	•	HTML-heurstik behövs inte som huvudväg
	•	resultatet är reproducerbart

D — verifierat render-behov
Minst något i stil med:
	•	rå HTML eller vanlig fetch saknar nödvändigt eventinnehåll
	•	relevant innehåll uppstår först efter render eller JS-exekvering
	•	behovet av render är bekräftat med definierad kontroll
	•	D sätts inte på misstanke utan på verifierad grund

Manuell kontroll i början

De första 10–20 flyttarna från C till A/B/D ska granskas manuellt för att säkerställa att verifieringsreglerna fungerar korrekt.

⸻

11. Fas 9 — H Manual Review

Mål

Samla de svåraste men mest lärorika fallen för senare djupanalys.

En source ska till H när
	•	den inte verifierats som A, B eller D
	•	den inte kunnat lösas generellt i C efter 3 körningar
	•	den fortfarande verkar vara en verklig eventkälla

H ska användas till
	•	systematisk efteranalys
	•	lärande om svåra HTML-fall
	•	framtida förbättringar av generell scrapinglogik
	•	manuell kontroll av cases som inte passar nuvarande klassificering

Viktig regel

H är inte en papperskorg. H är ett medvetet lager för svåra, värdefulla fall.

⸻

12. Fas 10 — Rekommenderad arbetsordning

Arbetet ska ske i denna ordning:
	1.	Skriv in denna plan som en ny styrande .md-fil
	2.	Genomför Fas 1: reset
	3.	Fastställ eller bygg 00A-verktyget
	4.	Verifiera att raw-import fungerar deduplicerat och idempotent
	5.	Bygg eller justera canonical source-arkitekturen utan att direkt bryta nuvarande sources/
	6.	Skapa queue-arkitekturen A/B/C/D/H
	7.	Kör initial routing från ren source-bas
	8.	Definiera verifieringsreglerna för A/B/D
	9.	Bygg C-Batchmaker
	10.	Bygg och strama upp 123-loopen
	11.	Tillåt först därefter verifierad flytt från C till A/B/D
	12.	Samla svåra fall i H och börja senare djupanalys där

⸻

13. Appendix — routingConfidence vs routingReason

routingConfidence

routingConfidence beskriver hur säker klassningen är.

Föreslagna nivåer:
	•	low
	•	medium
	•	high
	•	verified

För faktisk flytt från C till A/B/D ska nivån vara:
	•	verified

routingReason

routingReason beskriver varför källan placerades i en viss kö.

Exempel:
	•	“XHR till /api/events innehöll användbar eventdata”
	•	“JSON-LD innehöll eventobjekt med titel och datum”
	•	“relevant eventinnehåll saknas i rå HTML men finns efter JS-render”
	•	“ingen verifierad A/B/D-väg hittad, därför kvar i C”

Kort skillnad
	•	routingConfidence = hur säker klassningen är
	•	routingReason = den konkreta orsaken till klassningen

⸻

Vad som INTE ska göras nu
	•	inte direkt döpa om nuvarande sources/ innan kompatibilitet är verifierad
	•	inte låta köerna bli egna masterregister
	•	inte flytta källor från C till A/B/D på AI-känsla
	•	inte bygga site-specifika HTML-regler i 123
	•	inte utveckla A-, B-, D- och H-spåren parallellt just nu
	•	inte fortsätta batchlogik utan att först få ordning på source- och queue-arkitekturen

Filer som senare behöver uppdateras efter godkänd plan
	•	source-relaterade .md-filer under 00-Sources/
	•	dokumentation för 00A importverktyget
	•	dokumentation för A/B/C/D/H-köerna
	•	dokumentation för C-Batchmaker
	•	dokumentation för 123-loopen
	•	eventuella runtime- eller routingfiler först efter att planen godkänts

