# EventPulse mot App Store-godkännande

Apple bestämmer slutet, så "100 % garanterat" finns inte. Men varje avvisningsorsak som går att förutse går att stänga i förväg, och nästan alla av dem går att hitta i repot. Jag har gått igenom Apples faktiska regler och mappat dem mot appens kod, konfiguration, bygghistorik och produktionsdata.

Slutsatsen: åtta saker blockerar en inlämning i dag. Tre av dem är i princip omedelbara att åtgärda, resten tar timmar till en dag. Med allt gjort ligger det runt tre arbetsdagar till inlämning, sedan Apples granskning.

## Godkännande i fyra lager

En inlämning passerar fyra olika kontroller, och de flesta avvisningar inträffar långt innan en människa öppnar appen.

Det översta lagret är binären: SDK-version, privacy manifest, entitlements och Info.plist. Där avvisas allt maskinellt. Under det ligger metadata: namn, beskrivning, skärmbilder, åldersbetyg och privacy label. Under det ligger App Store Connect-state: signerade avtal, skatt och bank, bolagsuppgifter, app-post. Och underst ligger granskarens bedömning av guideline 1 till 5.

De tre övre lagren är helt kontrollerbara. Det fjärde är en bedömning, och det är där den enda verkliga risken ligger. Arbetet måste därför delas i två: maskinella fel rättas direkt, medan guideline-frågorna kräver positionering, alltså vad appen säger att den är, i metadata och i granskningsnoteringen.

För EventPulse är läget bättre än vid en vanlig första inlämning. Appen har en fungerande backend, riktig data (10 124 framtida evenemang, 99,96 procent med bild, mätt 2 november), en etablerad webbplats med integritets- och villkorssidor, konto-radering inom appen enligt §5.1.1(v), Sign in with Apple-konfiguration och inga annonser eller spårningspixels. Det som saknas är release-lagret.

## Åtta blockerare inför inlämning

Tabellen går igenom de åtta punkterna i prioritetsordning. De två första avgör om inlämningen ens är möjlig att göra, de övriga avgör om den godkänns vid första försök.

| # | Blockerare | Varför det stoppar | Åtgärd | Verifiering |
|---|---|---|---|---|
| 1 | Privacy manifest saknas i appens mål | Apple kräver att varje app deklarerar vilka "required reason API:er" den använder; utan korrekt manifest passerar inte inlämningen (ITMS-91053) [5] | Lägg `PrivacyInfo.xcprivacy` med `NSPrivacyAccessedAPICategoryUserDefaults` (skäl CA92.1) för AsyncStorage | Bekräfta att filen finns i det arkiverade bygget, inte bara i repot |
| 2 | Integritetstexterna i appen innehåller "[TODO: ...]" och en synlig AI-utkastsbanner | §2.1 kräver att all platshållartext är borttagen; §5.1.1(i) kräver att policy visar vilka data som samlas, hur de gallras och hur samtycke återkallas [1] | Ersätt texterna. Regionen är redan utredd, bolagsuppgifterna är inte | Sök "TODO" i `06-UI/i18n/strings/` och läs igenom `components/LegalModal.js` |
| 3 | Webbsidans integritetspolicy är 859 tecken och saknar tredje parter, gallring och AI | Samma §5.1.1(i), och app och webb ska säga samma sak [1] | Skriv om `site/privacy/index.html` och den engelska varianten | Jämför punktvis mot apptexten |
| 4 | Noll App Store-skärmbilder finns | Skärmbilder är obligatoriska och formatet kontrolleras maskinellt [4] | 1 till 10 bilder i 1320x2868, alternativt 1290x2796 eller 1260x2736 | Ladda upp i App Store Connect och låt valideringen gå igenom |
| 5 | Granskare kan inte logga in | §2.1 kräver demo-konto eller, med Apples förhandsgodkännande, inbyggt demoläge [1] | Lägg till lösenordsinloggning för ett demo-konto | Logga in som demo-konto i den riktiga TestFlight-byggen |
| 6 | Kartan använder Google Maps utan API-nyckel | Kartan kan renderas tom eller med utvecklingsvattenskrämpe på iOS, samtidigt som Google blir tredjepart [11] | Byt till `PROVIDER_APPLE` | Öppna Karta på en riktig iPhone |
| 7 | `supportsTablet: true` men appen har ingen iPad-layout | iPad kräver 13-tumsskärmbilder [4], och iOS 27 gör iPhone-appar resizable [9] | Sätt `supportsTablet: false` inför launch | Verifiera i simulatorn att appen inte visas som iPad |
| 8 | Senaste store-bygget är SDK 57 från 2026-10-11 | Sedan 2026-04-28 måste appar byggas med Xcode 26 eller iOS 26 SDK [2], och SDK 58 uppfyller kravet [9] | Ny EAS production-bygg på SDK 58, pinna `image: sdk-58` | TestFlight-build installeras och startar på en riktig iPhone |

Mönstret i tabellen är att inget av punkterna är ett funktionellt fel i produkten. De är release-artefakter: en saknad fil, två ouppdaterade texter, en saknad bilduppsättning, en saknad inloggningsväg, en kartkonfiguration och en byggversion.

En sak behöver däremot inte fixas: push. Den introspekterade configen innehåller redan `aps-environment`, och Xcode byter den till `production` i release-arkivet. Att lägga `expo-notifications` i plugin-listan är rekommenderat men ingen blockerare [10].

## Integritetstexter som visar platshållare

Det här är den punkt som är lätt att missa eftersom den ligger i en strängfil och inte i något test. `06-UI/i18n/strings/sv.js` innehåller "[TODO: fullständigt företagsnamn och organisationsnummer]", "[TODO: bekräfta]" vid kontaktadressen och "[TODO: bekräfta EU, helst eu-north-1]" vid beskrivningen av Supabase-regionen. `components/LegalModal.js` visar dessutom en banner där appen meddelar att texten är ett AI-utkast som ännu inte granskats och att EventPulse inte ansvarar för textens rättsliga korrekthet. En granskare som öppnar appens integritetspolicy ser alltså en ofärdig text som appen själv betecknar som osäker, och §2.1 säger uttryckligen att all platshållartext ska rensas bort före inlämning [1].

Två av platshållarna är redan lösta i sak. Supabase-projektet ligger i eu-north-1 (Stockholm), verifierat av `scripts/verify-supabase-region.ts` och dokumenterat i `runtime/supabase-region.json`. Den tredje platshållaren, bolagsnamn och organisationsnummer, är inte ett textproblem utan ett bolagsuppgiftsproblem, och den informationen måste finnas i App Store Connect innan granskningen.

Den fjärde saken i samma text är ett faktiskt uppgiftsfel. Appen skriver att agentchatten använder "OpenAI / Anthropic / valfri LLM-leverantör", medan agenten i praktiken anropar MiniMax via `api.minimax.io`. Det är inte en formulering utan en beskrivning av vilken mottagare som får användarens chattext, och den måste vara rätt både i policyn och i privacy label.

## Demo-åtkomst för granskare

Inloggningen i EventPulse består av tre vägar: anonym session, Sign in with Apple och e-post med engångskod. Det finns ingen `signInWithPassword` någonstans i `06-UI/services/supabaseAuthClient.js`, och det är där problemet uppstår. En granskare kan inte ta emot e-post i en inkorg den äger, så varken magic link eller OTP-kod är en fungerande demoåtkomst. Sign in with Apple fungerar tekniskt, eftersom entitlementen `com.apple.developer.applesignin` finns i den introspekterade configen, men bygger på att granskaren kan logga in med ett eget Apple-ID, vilket inte är en garanti.

§2.1 ger två godkända vägar: antingen ett fungerande demo-konto, eller ett inbyggt demoläge som godkänns av Apple i förväg [1]. Den deterministiska lösningen är att lägga till lösenordsinloggning för ett enda demo-konto, eftersom Supabase stöder det direkt och klienten bara saknar anropet. Den andra vägen är rimligare om du hellre inte vill ha lösenordsinloggning i appen: skriv ett kort brev till App Review-kontakten [12] med förfrågan om demoläge, och beskriv att hela produkten går att använda som gäst.

Kontotillståndet i övrigt finns på plats. Konto-radering finns både i appen och som `DELETE /agent/account`, vilket §5.1.1(v) kräver [1], och det finns ingen tredjepartslogin som skulle kräva mer av inloggningen enligt §4.8.

## Kartprovider och iPad-layouter

De två punkterna hänger ihop i samma beslut. `06-UI/screens/MapScreen.js` använder `PROVIDER_DEFAULT` och `KartaScreen.js` använder `react-native-map-clustering`, men det finns ingen `ios.config.googleMapsApiKey` i `app.json`. På iOS är standardleverantören Google Maps, som kräver en API-nyckel med aktiverat Maps SDK for iOS; utan nyckel blir kartvyn sannolikt tom eller vattenmärkt. `react-native-maps` levererar dessutom en egen Google Maps-privacyfil, vilket gör Google till tredjepart i privacy-frågan. Att byta till `PROVIDER_APPLE` löser båda delar: ingen nyckel behövs, ingen Google-data, och Apple Maps fungerar i den befintliga koden. En sak att kolla i samma svep är att `react-native-map-clustering` faktiskt vidarebefordrar providern till det underliggande kartvyn.

iPad-delen är enklare. `app.json` anger `supportsTablet: true`, men av alla filer i `06-UI` använder bara en `Dimensions`, så det finns ingen responsiv layout. En iPad-skärmbild skulle visa en utsträckt telefonlayout, och App Store Connect kräver 13-tumsskärmbilder för en app som kör på iPad [4]. Expo SDK 58 noterar dessutom att iOS 27 gör iPhone-appar resizable och att `requireFullScreen` inte längre fungerar som opt-out [9]. Att sätta `supportsTablet: false` tar bort hela frågan inför launch: bara iPhone-skärmbilder behövs och ingen iPad-layout behöver byggas nu.

## Produktuppfattning, innehållsrätt och åldersbetyg

Det här är de tre frågorna där en granskare kan resonera sig fram till ett nej trots att allt fungerar.

Det första är risken att appen bedöms som en länksamling. §4.2.2 säger att appar inte främst ska vara "web clippings, content aggregators, or a collection of links", med undantag för kataloger [1]. EventPulse samlar 157 källor, vilket gör frågan legitim. Motverknaden är positioneringen: agenten, chatten, de personliga rekommendationerna och de egenproducerade beskrivningarna gör appen till något annat än en lista. Det måste synas i skärmbilderna och i granskningsnoteringen, inte bara i koden.

Det andra är innehållsrätten. Appen visar evenemangsdata från tredje part, inklusive 278 framtida evenemang från en Facebook-eventskrapning. §5.2.1 kräver rätt att använda tredjepartsmaterial [1], och App Store Connect har en separat deklaration om innehållsrätt som ska besvaras [7]. Det som redan finns hjälper: källnamn, källlänk och attribuering per evenemang, egna redaktionella beskrivningar och inga logotyper från arrangörerna.

Det tredje är åldersbetygen. Nya frågeformulär är obligatoriska för nya appar och uppdateringar, och från 16 november 2026 tillkommer två nya deklarationer, Shared Location och Dating and Relationships, som måste besvaras vid varje inlämning; alla appar i butiken ska ha dem senast 12 januari 2027 [3][8]. För EventPulse är svaren nej på båda, eftersom appen varken delar användarens plats med någon eller har parfunktioner. Det som ändå väger är katalogen: 28 framtida wine tasting-evenemang och 57 nightlife-evenemang ligger i databasen. §1.4.3 begränsar appar som underlättar om köp av alkohol till rätt åldrade användare [1]. Biljettköpet sker hos arrangören utanför appen, vilket talar för en lägre grad, men 18+ är den grad som undanröjer diskussionen utan extra arbete.

## Metadata, privacy label och underlag i App Store Connect

Privacy labeln är det vanligaste stället där en korrekt app faller. App Privacy-formuläret i App Store Connect är inte samma sak som privacy policyn, och inte samma sak som manifestet från punkt 1 [6]. Underlaget för EventPulse är e-postadress för konto, användar-id från Supabase, hashat enhets-id för analys, produktinteraktion i form av vilka evenemang som visas, sparas och söks, sökhistorik som skickas till agenten samt användarens egna chattmeddelanden. Som delad data: MiniMax, som tar emot chattexten och smakprofilen, samt Supabase, Expo och APNs. Spårning: nej, vilket innebär att ingen ATT-prompt behövs.

Åldersbetygen sätts i samma formulär, och de nya deklarationerna från 16 november ska besvaras i samband med inlämningen [3]. Kategorin bör väljas efter hur listan presenteras. Apple saknar evenemangskategori, så Travel eller Entertainment ligger närmare en evenemangssökare än Social Networking. Granskningsnoteringen enligt §2.3.1 ska beskriva agenten, gästläget, share-länkar och demoåtkomst.

Utanför repot finns ett lager av administrativt underlag som avgör om inlämningen ens kan göras: signerade avtal för Account Holder, skatt- och bankuppgifter, bolagsnamn och organisationsnummer, en ny app-post med bundle-ID `com.tomorgashi.eventpulse`, SKU, primär kategori och gratispris, samt en review-kontakt. Inget av det går att verifiera härifrån, och avtalen är det vanligaste tysta stoppet för ett nytt konto. Kontrollera det först, innan något byggs.

## Val inför inlämning

Sex frågor måste avgöras innan arbetet kan börja, eftersom de påverkar både kod och material.

| Fråga | Alternativ | Rekommendation | Följd |
|---|---|---|---|
| iPad | `supportsTablet: true` eller `false` | `false` inför launch | Tar bort 13-tumsskärmbilder och iPad-layoutarbete |
| Demoåtkomst | Lösenordsdemo-konto, inbyggt demoläge, Sign in with Apple | Lösenordsdemo-konto | Granskare kan alltid komma in |
| Kartor | `PROVIDER_APPLE` eller Google-nyckel | `PROVIDER_APPLE` | Ingen nyckel, ingen tredjepart, fungerar i befintlig kod |
| Åldersbetyg | 18+ eller lägre med motivering | 18+ | Täcker alkoholutbudet utan diskussion |
| Share-länkar | Behålla eller stänga av | Behålla, dokumentera i granskningsnoteringen | `/s/:hash` exponerar frågetext med förfall; ingen publik feed och inget modereringsbehov |
| 372 evenemang utan beskrivning | Backfill eller inte | Backfill före skärmbilderna | Synlig fallback-text kan uppfattas som platshållare |

Med de valen ovan är resten ren genomförandearbete, utan förgranskningar som kräver nya beslut.

## Arbetsordning och tidsplan

Dag ett går till texter och konfiguration, eftersom det är deterministiskt arbete utan byggtid: integritetspolicyn i appen och på webben, privacy manifestet, iPad-beslutet, kartbytet och bolagsuppgifterna. Bygget bör startas så tidigt som möjligt på dag två, eftersom EAS-bygget är den enda delen som väntar i kö. Medan det byggs går du igenom gäst-till-konto-flödet på riktig iPhone, den del som varit overifierad sedan 20 september, och tar skärmbilderna från samma bygg.

Dag tre är metadata: description, keywords, privacy label, åldersbetyg med de nya deklarationerna, granskningsnoteringar och demo-kontot. Därefter kontrollerar du underlaget i App Store Connect, laddar upp versionen och skickar in. Granskningen tar normalt en till sju dagar, och den längsta väntetiden är Apples, inte din.

Total arbetstid landar runt tre dagar om besluten ovan tas snabbt. Det som avgör om det blir en vecka eller två är inte kod, utan om granskaren delar din syn på guideline 4.2 och om du hinner rätta tillbaka om en första avvisning kommer.

## Gränser för garantier

Tre saker går inte att kontrollera härifrån, och de ska inte presenteras som kontrollerade. App Store Connect-tillståndet är osynligt från repot. Det finns ingen iPhone-test som visar att push, karta och gäst-till-konto-flödet fungerar i ett riktigt bygg, och det är den första punkten i repetitionsfasen. Och om granskaren hittar något utanför guideline 1 till 5, till exempel att antalet källor uppfattas som masskopiering, finns ingen plan som garanterar bort.

## Referenser

[1] App Store Review Guidelines — https://developer.apple.com/app-store/review/guidelines/
[2] Upcoming requirements — https://developer.apple.com/news/upcoming-requirements/
[3] New age rating content descriptors in App Store Connect — https://developer.apple.com/news/?id=yxkh08us
[4] Screenshot specifications — https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
[5] Describing use of required reason API — https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api
[6] App privacy details — https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy-details
[7] Content rights declaration — https://developer.apple.com/help/app-store-connect/reference/app-information/content-rights-declaration
[8] Age rating — https://developer.apple.com/help/app-store-connect/reference/app-information/age-rating
[9] How to upgrade to SDK 58 — https://expo.dev/blog/how-to-upgrade-to-sdk-58
[10] expo-notifications documentation — https://docs.expo.dev/versions/latest/sdk/notifications/
[11] react-native-maps and Expo maps documentation — https://docs.expo.dev/versions/latest/sdk/maps/
[12] App Review — https://developer.apple.com/app-store/review/

## På människospråk

Apple bestämmer om appen godkänns, så ingen kan lova "100 %". Men allt som går att förutse går att stänga i förväg, och här är listan över vad som är kvar.

- Åtta saker saknas: en fil Apple kräver i appen, två integritetstexter som fortfarande innehåller "[TODO]" och en banner som säger att texten är ett AI-utkast, noll skärmbilder, ingen inloggning för granskare, kartor utan nyckel, iPad-stöd utan layout, och en byggversion som är tre veckor gammal.
- Inget av det är ett fel i själva appen. Appen fungerar, databasen är fylld och 99,96 procent av de framtida evenemangen har bild. Det som saknas är release-lagret runt appen.
- Sex beslut behöver du ta, och de är små: iPad eller inte, hur granskaren loggar in, vilka kartor, vilken åldersbetyg, share-länkar, och om de 372 evenemang utan beskrivning ska fyllas på.
- Räkna med cirka tre arbetsdagar till inlämning, sedan en till sju dagars väntan på Apples granskning.
