# App Store Connect-underlag — EventPulse 1.0 (iOS)

> Allt du behöver skriva in i App Store Connect, med svaren och underbyggnaden.
> Byggen som ska lämnas in: **iOS, version 1.0.0, build 6**, SDK 58, IPA:
> `https://expo.dev/artifacts/eas/TD2hhnROFKrV5B_wTgNeWjq4UtkZ40zRL3dUHGp_YcE.ipa`
> (EAS build `e31dc67b-5c15-4479-ab50-ded9f110a541`, byggd från commit
> `aa845431` som innehåller rättningen av de råa i18n-nycklarna, rättningen
> av kartleverantören **och** att Perfectday AB är personuppgiftsansvarig).
> IPA-gate `check-ipa.mjs`: **47/47 kontroller gröna** (inkl. kontroll av
> personuppgiftsansvarig i bunten).
>
> **Lösenordet till demokontot ligger i `06-UI/.env` (gitignored) under
> `EXPO_PUBLIC_DEMO_PASSWORD` — kopiera det till "Notes for Review", inte hit.**
>
> ### ⚠️ Rättat 2026-11-07 — underlaget beskriver nu appen som den faktiskt är
>
> Den tidigare versionen av det här underlaget lovade en **agent-chatt**
> ("fråga agenten"), en **"Rekommenderat"-flik** och en **sparad lista**. **Inget
> av det finns i appen som den lämnas in** (build 6). Det som är sant:
>
> - **Ingen chatt.** Agentchatten är inte monterad — `06-UI/index.js` registrerar
>   `AppShell`, inte `App-agent.js` (`App-agent.js` ligger kvar på disk "för
>   senare"). Hem-sökningen går mot `GET /agent/feed?q=` och matchar text mot
>   evenemangstitlar och beskrivningar — **ingen AI**.
> - **MiniMax används inte av appen.** Enda vägen till MiniMax är
>   `POST /agent/chat` → `llmRouter.composeReply`, och appen anropar den
>   aldrig. Den enda AI-tjänsten i kedjan är alltså MiniMax, och den används
>   bara av serverns agent-API.
> - **Appen är opersonaliserad.** Hem läser `events_public` direkt. Det finns
>   ingen "Rekommenderat"-flik och ingen lista över sparade evenemang
>   (`getSavedEvents` har ingen anropare). Det som *finns* är att du kan spara
>   ett evenemang med hjärtat på kortet → då får du en påminnelse i Notiser
>   2 timmar innan start.
> - **Sökningen kräver minst 3 tecken** och uppdateras medan du skriver.
>
> Beskrivning, promotional text, engelska stödtext, privacy-label, åldersbetyg,
> Review Notes och shot-list är alltså omskrivna efter detta. **Om agentchatten
> aktiveras senare måste privacy-label, policy och beskrivning uppdateras
> samtidigt** — annars står det fel i App Store Connect.

---

## 1. Identitet och beskrivning

| Fält | Värde |
|---|---|
| Namn | `EventPulse` (9 tecken, max 30) |
| Undernamn | `Evenemang för dig i Stockholm` (28 tecken, max 30) |
| Primär kategori | Travel |
| Sekundär kategori | Entertainment |
| Pris | Gratis |
| Bundle ID | `com.tomorgashi.eventpulse` (redan skapat) |
| SKU | `EVENTPULSE-IOS-001` |
| Copyright | `2026 Perfectday AB` |
| Åldersgräns | 18+ |

### Beskrivning (svenska, max 4000 tecken)

```
EventPulse är en personlig evenemangstipsare för Stockholm — en app som
hittar riktiga evenemang åt dig, med skrivna beskrivningar, bilder och
biljettlänkar.

Börja på Hem, där du hittar nio urval: ikväll, imorgon, helgen, gratis,
foodies och mer. Varje evenemang har en egen skriven beskrivning, bild, tid,
plats och biljettlänk — aldrig en rå källtext.

Vill du söka rakt på? Skriv "konsert ikväll" eller "något för barn i helgen"
i sökfältet under Utforska, så får du träffar bland riktiga evenemang. Du kan
också bläddra bland 18 kategorier.

Det som gör EventPulse annorlunda:
• RIKTIGA EVENEMANG — allt kommer från arrangörernas egna publika sidor, med
  källhänvisning på varje evenemang. Vi hittar aldrig på sådant.
• BESKRIVNINGAR SOM LÄSES — varje evenemang har en egen skriven beskrivning.
• BILJETTER INGÅR INTE — vi säljer inga biljetter. Vi visar var du kan köpa
  och låter arrangören ta hand om betalningen.
• FUNGERAR UTAN KONTO — bläddra och söka direkt, ingen inloggning behövs.
  Logga in bara om du vill få "Din helg"-notis om helgens evenemang.

Vi visar Stockholmsregionen — och ibland saknas evenemang, vilket står
varifrån informationen kommer.

Frågor? hej@eventpulse.nu
```

### Promotional text (max 170 tecken)

```
Riktiga evenemang i Stockholm med skrivna beskrivningar, bild och
biljettlänk. Sök "konsert ikväll" eller bläddra bland 18 kategorier. Inget
konto behövs.
```

### Keywords (max 100 tecken)

```
evenemang,stockholm,konsert,teater,festival,utställning,kultur,mat,helg,upplevelse,biljetter
```
(92 tecken. "agent" togs bort 2026-11-07 — appen har ingen agentchatt, så
nyckelordet skulle föra användare till en funktion som inte finns.)

### Stödtext engelska (om du vill)

```
EventPulse is a personal event guide for Stockholm. Real events from the
organisers' own public pages, each with a written description, a photo, a
time, a venue and a ticket link — never raw source text.

Start on Hem, where you find nine collections: tonight, tomorrow, the
weekend, free things, foodies and more. Want to search straight away? Type
"concert tonight" in the search field under Explore and you get real matching
events. You can also browse 18 categories.

What makes EventPulse different:
• REAL EVENTS — everything comes from the organisers' own public pages, with a
  source link on every event. We never make things up.
• DESCRIPTIONS WRITTEN TO READ — every event has its own written description.
• NO TICKETS SOLD — we don't sell tickets. We show you where to buy them and
  let the organiser handle payment.
• NO ACCOUNT NEEDED — browse and search straight away. Sign in only if you
  want a weekly "Din helg" notification about the weekend's events.
```

---

## 2. App Privacy (privacy label)

Svaren följer exakt det som står i appens privacy manifest och i policyn.

| Datatyp | Samlas in? | Länkat till dig? | Spårning? | Syften |
|---|---|---|---|---|
| Email Address | Ja | Ja | Nej | App Functionality |
| User ID | Ja | Ja | Nej | App Functionality, Analytics |
| Device ID | Ja | Ja | Nej | Analytics |
| Product Interaction | Ja | Ja | Nej | App Functionality, Analytics, Product Personalization |
| Search History | Ja | Ja | Nej | App Functionality, Product Personalization |
| Other User Content | Ja | Ja | Nej | App Functionality |

| Övrigt | Svar |
|---|---|
| Tracking | **Nej** — ingen ATT-prompt behövs |
| Third-party analytics | **Nej** — analysen är egen (första parts), inga annons- eller analys-SDK:er |
| Third-Party SDKs | **Supabase** (`@supabase/supabase-js` — User ID), **expo-notifications** (Device ID / push-token), **expo-apple-authentication** (User ID), **AsyncStorage** (User ID). **MiniMax, Fly.io och APNs ska INTE listas här** — de är inte SDK:er i appens binär. Verifierat mot build 6:s IPA: alla SDK-manifest deklarerar `NSPrivacyCollectedDataTypes: []` och `NSPrivacyTracking: false`; de 6 datatyperna deklareras i appens eget manifest |
| Data Shared with third parties | **Nej i den build som lämnas in.** Agentchatten — som är den enda vägen till MiniMax (`POST /agent/chat` → `llmRouter.composeReply`) — är **inte monterad** i appen (`index.js` registrerar `AppShell`, inte `App-agent.js`). Sökningen går mot vår egen server och matchar mot evenemangstitlar och beskrivningar, utan AI. **Om agentchatten aktiveras måste den här raden uppdateras** (då tillkommer MiniMax som tredjepart) — samma ändring måste göras i policyn |
| Purposes | App Functionality, Analytics, Product Personalization |

> Underbyggnad: `06-UI/app.json` → `ios.privacyManifests` (6 datatyper, tracking
> false). Manifestet i det shippade IPAn innehåller dessutom de aggregerade
> SDK-deklarationerna (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime
> 35F9.1).

---

## 3. Åldersbetyg

| Fråga | Svar | Varför |
|---|---|---|
| Alkohol, tobak eller narkotik | **Ja** | Katalogen innehåller 28 wine tasting- och 57 nightlife-events (framtida, mätt 2026-11-02) |
| Obegränsad webbåtkomst | Nej | Appen har ingen inbyggd webbläsare |
| Spel, gambling, tävlingar | Nej | |
| Skräck, våld | Nej | |
| Sexuellt material | Nej | |
| Medicinsk information | Nej | |
| Vuxeninnehåll | Nej | |
| Råa svordomar | Nej | |
| Användargenererat innehåll | Nej | Det finns ingen chatt och ingen publik feed. Söktexten du skriver skickas till vår egen server för matchning mot evenemangstitlar och beskrivningar, men publiceras aldrig och delas aldrig med andra användare. Share-länkar samlar evenemangsval, inte text |
| Spelande | Nej | |
| Made for Kids | Nej | |
| Advertising ID | Nej | |
| Third-party analytics | Nej | |
| Data som används för att spåra | Nej | |
| **Shared Location** (ny fråga, från 16 nov 2026) | **Nej** | Appen begär inte platsåtkomst (`expo-location` är inte installerat) |
| **Dating and Relationships** (ny fråga, från 16 nov 2026) | **Nej** | Ingen parfunktion, ingen romantisk AI-kompanjon |

**Åldersgräns 18+.** Sista frågorna ska besvaras senast **12 januari 2027** för
alla appar, men besvara dem redan nu — de krävs vid varje inlämning från och
med 16 november 2026.

> Underbyggnad: policy och villkor säger "minst 18 år" (verifierat i det
> shippade IPAn).

---

## 4. Review Notes (granskningsnoteringar)

Klistra in detta i App Store Connect → "Notes for Review" (eller "App Review
Information"):

```
EventPulse is a personal event guide for Stockholm. It shows real events
with photos, written descriptions, times, venues and ticket links.

HOW TO REVIEW:
1. The app works fully WITHOUT an account — no sign-up is required to browse
   the feed, search for events, save an event or read the privacy policy. The
   "Lägg till e-post" button on the Profil tab is optional.
2. To test the signed-in experience (Konto / Notifieringar / Din helg), use
   the demo account below. It is a separate, empty account with no personal
   data.
   - Login screen (Profil → "Lägg till e-post" → scroll down to
     "Demologin för App Review")
   - Email: demo@eventpulse.nu
   - Password: <KOPIERA FRÅN 06-UI/.env — EXPO_PUBLIC_DEMO_PASSWORD>
3. There is no chat interface in this build — the app works by browsing and
   by searching. To search: open the Utforska tab, type at least 3 characters
   such as "konsert ikväll" in the search field, and matching real events
   appear with photo, written description, time, venue and ticket link. You
   do not need to press Enter; results update as you type.
4. Privacy policy: Profil → Integritetspolicy, and online at
   https://eventpulse.nu/privacy/
   Terms: https://eventpulse.nu/villkor/

NOTES:
- Push notifications are not part of this build's review flow; they require
  enabling them under Profil.
- The Karta tab uses Apple Maps (MapKit).
- The app is iPhone-only (iPad is not supported).
- Our API backend is live at https://eventpulse-agent.fly.dev and the app
  talks to it in production.
- The data controller is Perfectday AB (company registration number
  556990-9830), Sweden. The App Store seller name is the individual developer
  account of the publisher. The privacy policy states this explicitly.
```

---

## 5. Övriga fält i App Store Connect

| Fält | Värde |
|---|---|
| Privacy Policy URL | `https://eventpulse.nu/privacy/` |
| Support URL | `https://eventpulse.nu/kontakt/` |
| Marketing URL | `https://eventpulse.nu/` |
| Support email | `hej@eventpulse.nu` |
| Contact email (granskare) | `hej@eventpulse.nu` |
| Phone | ditt nummer (krävs av Apple) |
| Encryption export compliance | `ITSAppUsesNonExemptEncryption: false` — appen använder bara standard-HTTPS, inget eget krypto. Inget dokument behövs |
| App Review contact | Tomor Gashi, `hej@eventpulse.nu`, ditt telefonnummer (kontaktperson — behöver inte vara samma som säljaren/operatören) |

### Signerade avtal (kolla först)

App Store Connect kräver att Account Holder har signerade avtal, samt att
skatt- och bankuppgifter är ifyllda. Det går inte att se från repot och det är
det vanligaste "tysta stoppet" för ett nytt konto. Kontrollera det **innan**
du laddar upp builden.

---

## 6. Skärmbilder — krav och shot-list

Apple godkänner en uppsättning per deviceklass. Eftersom appen nu är
**iPhone-only** (`TARGETED_DEVICE_FAMILY = 1`) behöver du **inte** iPad-bilder.

**Format (iPhone 6,9"):** 1320×2868, 1290×2796 eller 1260×2736 px, PNG/JPG,
utan alfakanal. 1–10 bilder.

**Shot-list (9 bilder):**

| # | Skärm | Vad som ska synas | Särskilt |
|---|---|---|---|
| 1 | Hem | Karusellerna "För dig" / "Senaste" / "Ikväll" med evenemang och bilder | Riktiga evenemang, inte tom lista |
| 2 | Utforska | De 18 kategorirutorna | Visa en bildkatt med riktiga evenemang |
| 3 | Utforska + sökning | Sökrutan med "konsert ikväll" och träfflistan under den | Minst 3 tecken, uppdateras medan du skriver |
| 4 | Event-detalj | Ett evenemang med bild, skriven beskrivning, tid, plats och biljettlänk | Välj ett event **med** editorial-beskrivning (372 events saknar text) |
| 5 | Event-detalj | Action-rad: Spara / Visa karta / Lägg till i kalender / Dela / ⋯ | Alla fem knappar ska gå att trycka |
| 6 | Karta | Apple Maps med EventPulse-markörer | Verifiera att kartan faktiskt renderar på enheten |
| 7 | Notiser | Notiser-fliken | Tomt läge är ett giltigt läge: "Inga notiser än. Spara ett evenemang så får du en påminnelse 2 timmar innan det börjar." |
| 8 | Profil (gäst) | Gästvyn med **Integritetspolicy** och **Användarvillkor** synliga | Visar att policyn finns i appen utan konto — Apple §5.1.1(i) |
| 9 | Profil (inloggad) | Konto + Notifieringar + "Din helg-notiser" | Kräver inloggning → logga in med demokontot |

> **Måste göras på en riktig iPhone (eller simulator med Xcode).** Det finns
> ingen Xcode-installation på maskinen här, så skärmbilderna kunde inte tas
> automatiskt. Ta dem från **TestFlight-builden** (build 6), inte från Expo Go.

---

## 7. Checklista före inlämning

- [ ] Avtal signerade + skatt/bank ifyllt i App Store Connect
- [ ] Ny app-post: bundle ID, SKU, kategori, pris 0
- [ ] Privacy Policy URL + Support URL + Marketing URL ifyllda
- [ ] App Privacy ifyllt enligt avsnitt 2
- [ ] Åldersbetyg ifyllt enligt avsnitt 3 (inkl. de två nya deklarationerna)
- [ ] Review Notes ifyllda med demokontot (lösenord från `06-UI/.env`)
- [ ] Review-kontakt: namn, email, telefon
- [ ] Skärmbilder 1–9 i rätt format (1320×2868 eller 1290×2796)
- [ ] iOS-build 6 uppladdad och vald i version 1.0.0
- [ ] **Integritetspolicyn live på eventpulse.nu** (se avsnitt 8)
- [ ] Skicka in

---

## 8. Kvar att lösa av ägaren

| Punkt | Status | Vad som krävs |
|---|---|---|
| Integritetspolicyn live på `eventpulse.nu/privacy/` | **LÖST 2026-11-04/06** — Cloudflare Pages-projektet `eventpulse-nu` deployades via `wrangler pages deploy site --branch main` och deployades om 2026-11-06 (`84c60d5a`) med operatören **Perfectday AB, org.nr 556990-9830**. Live-gate `check-live-site.mjs`: **24/24 kontroller gröna** (sv + en), körd igen 2026-11-07. Live-sidan svarar nu med "Perfectday AB (organisationsnummer 556990-9830)" och **0 träffar** på "Tomor Gashi" | — |
| TestFlight-uppladdning | **Blockerat** — `eas submit` kräver inloggning mot App Store Connect (API-nyckel eller interaktiv OAuth). Bygget finns redo | `cd 06-UI && eas submit --platform ios --latest` (logga in först) eller ladda upp IPA:n i App Store Connect manuellt |
| Skärmbilder | **Blockerat på maskinen** — ingen Xcode/simulator | Ta på riktig iPhone från TestFlight-builden |
| Juridiskt bolagsnamn | **LÖST 2026-11-06** — personuppgiftsansvarig är **Perfectday AB, org.nr 556990-9830** (bekräftat mot Bolagsverket: aktiebolag, bildat 2014-11-20, F-skatt). Policyn uppdaterad i appen (sv/en/it), i villkoren (äganderätt) och på webben (sv/en). Gate-kontroller tillagda: appen 60/60, IPA-gaten kräver `Perfectday AB` + `556990-9830` och förbjuder `Tomor Gashi` som operatör, live-gaten kräver samma | — |
| **App Store Connect-kontotyp** | **Öppet beslut — kan orsaka avslag** | Apple-utvecklarkontot är registrerat som **"TOMOR GASHI (Individual)"**, så säljaren i butiken blir *Tomor Gashi* medan policyn anger *Perfectday AB*. Apple kräver att säljarens entitet är den som äger appen. **Det här är ett antingen-eller-beslut, inte två saker samtidigt** — se avsnitt 9 nedan för konsekvens- och kostnadstabell och för Apples egna verifierade länkar. **(a) Konvertera kontot till Organization med Perfectday AB** (D-U-N-S-numret finns redan hos D&B — kontrollerat 2026-11-07 — + bolagshandlingar, några dagar — gör detta **innan** du skickar in). **(b) Behåll Individual-kontot** och låt policyn ange privatpersonen igen (går att göra i samma dag, men innebär att Perfectday AB inte är personuppgiftsansvarig — och då måste appens juridiska texter rullas **tillbaka**, vilket är ett nytt bygge och en ny build-nummer). **Att byta e-postadress på kontot löser inget** — Apple: *"updating your name in your Apple Account will not change the name used for your membership or seller name on the App Store"* |
| Avstängning av demologin efter godkännande | Val | Radera demokontot i Supabase (stänger av direkt, utan ny build) eller bygg om utan `EXPO_PUBLIC_ENABLE_DEMO_LOGIN` |

---

## 9. Beslut: Apple-kontotyp — det är **antingen eller**

Det här beslutet är **inte** "konvertera kontot **och** byta mail". Det är två
alternativ som utesluter varandra. Välj ett.

| | **(a) Konvertera till bolagskonto** | **(b) Behålla Individual-kontot** |
|---|---|---|
| Vad du gör | Konverterar Apple-kontot till **Organization** med Perfectday AB | Låter kontot vara "TOMOR GASHI (Individual)" |
| Vem säljaren i butiken blir | **Perfectday AB** | **Tomor Gashi** |
| Matchar policyn som den är nu? | **Ja** | **Nej** — policyn måste skrivas om tillbaka till privatpersonen |
| Vad det kostar i tid | **D-U-N-S-numret finns redan hos D&B** (kontrollerat 2026-11-07) ⇒ bara **1–2 minuter** att hämta det (det skickas till din e-post) + upp till **2 arbetsdagar** för att Apple ska få informationen + bolagshandlingar + Apples granskning av konverteringen. Om du ändå måste beställa nytt: +5 arbetsdagar hos D&B ⇒ ~1–2 veckor | **Samma dag** |
| Vad det kostar i pengar | **0 kr** i Apple-avgifter. (Att *ha* ett medlemskap förknippat med en organisation ingår; ett nytt separat medlemskap för en ny enhet kostar 99 USD/år) | 0 kr |
| Vad som händer med build 6 | **Troligen ingenting** — bundle ID `com.tomorgashi.eventpulse` kan användas som det är. **Men:** Apple dokumenterar inte offentligt om Team ID och befintliga appar följer med vid en konvertering. I värsta fallet får bolaget ett nytt Team ID ⇒ nytt bundle ID ⇒ **nytt bygge** (samma commit, nytt build-nummer, ~20 min) + nytt app-record. Koden i appen ändras inte. | Bygget går att lämna in, **men** policyn, villkoren, webbsidan och appens eget privacy-manifest måste rullas tillbaka till privatpersonen ⇒ **nytt bygge (build 7) + ny IPA-gate-körning** |
| Konsekvens för personuppgifter | Perfectday AB är personuppgiftsansvarig, det du redan beställt och verifierat (60/60, 47/47, 24/24) | Tomor Gashi blir personuppgiftsansvarig ⇒ GDPR-krav på privatperson som personuppgiftsansvarig (i praktiken: samma bolagstext går att använda, men bolaget måste inte längre stå som ansvarig) |
| Risk | Apple kan neka konverteringen om dokumenten inte håller ⇒ då hamnar du i (b) med fördröjning | **Avslagsrisk på granskningen**: säljare och personuppgiftsansvarig pekar på olika entiteter. Apple §5.1.1(i) kräver att appens information finns i appen, men säljarens entitet måste vara den som står i appen/policyn |

### Min rekommendation

**Välj (a)**, och gör den **innan** du skickar in appen — av tre skäl:

1. Det är den enda vägen där säljare och personuppgiftsansvarig är samma
   entitet. Det är den vanligaste avslagsorsaken i granskningen.
2. (a) är billigare: 0 kr och en tidsåtgång, jämfört med (b) som kräver ett nytt
   bygge och en tillbaka-rullning av all juridisk text.
3. (a) kräver högst **ett nytt bygge** (20 min, samma kod) om Apple ger bolaget
   ett nytt Team ID. (b) kräver att **all juridisk text rullas tillbaka** i fyra
   ställen och att gate-skripten skrivs om, plus ett nytt bygge. Koden i appen
   ändras inte i något av alternativen.

**Vad du behöver göra för (a) — steg för steg, med Apples egna länkar:**

Steg 1 — **Hämta D-U-N-S-nummer**

> ✅ **KONTROLLERAT 2026-11-07: Perfectday AB finns REDAN hos D&B.** Sökningen på
> organisationsnumret gav **1 träff**: `Perfectday AB` · Single Location ·
> Larmtorget 4, Lgh 1202 · 392 32 Kalmar · org.nr 556990-9830 · status
> **Active** (D&B:s eget API-svar: `{"companyName":"Perfectday AB",
> "registrationNumber":"5569909830","operatingStatus":"Active",
> "locationType":"Single Location"}`).
> ⇒ **Du behöver INTE beställa numret och slipper väntetiden.** Du hämtar bara
> det befintliga numret (stegen nedan). Bevis (skärmbilder):
> `06-UI/runtime/verification-reports/duns-lookup-2026-11-07/`.

Så här gör du (1–2 minuter, gratis, inget inloggningskrav):

1. Öppna **<https://dunsnumberlookup.dnb.com/sv-se>**
2. Cookie-rutan: tryck **"Endast nödvändiga"** (eller "Godkänn och fortsätt").
3. Vika bort ansvarsfriskrivningen: tryck **"Bekräfta"**.
4. Välj fliken **"Sök på Organisationsnummer"** → fyll i **556990-9830** →
   Land = **Sverige** → tryck **"Sök"**.
5. Du får en rad: "Perfectday AB … 556990-9830 … Kalmar" → tryck **"Välj"**.
6. Formuläret **"Skicka D-U-N-S® nummer till mig!"** visas: fyll i förnamn,
   efternamn och din e-post → tryck **"Skicka"**. **Numret kommer till din
   e-post** (visas inte på skärmen).

- Apples egen väg (kräver inloggning med Apple ID):
  <https://developer.apple.com/enroll/duns-lookup/>
- Apples information om D-U-N-S, inklusive tider:
  <https://developer.apple.com/support/D-U-N-S/>

> ⚠️ **Adressen i D&B:s register är "Larmtorget 4, Lgh 1202, 392 32 Kalmar"**,
> medan den adress vi tidigare hämtat från Bolagsverket (via hitta.se) var en
> besöksadress i **Borgholm**. Det är **adressen i D&B som Apple matchar mot**,
> så kontrollera att bolagets **registrerade säte** verkligen är Kalmar. Är
> D&B:s adress fel eller inaktuell → uppdatera den hos D&B först
> (<https://support.dnb.com/?CUST=APPLEDEV>, Apples eget D&B-kontakt), annars kan
> Apple inte matcha D-U-N-S-numret mot den juridiska entiteten.

Apples egna ord: *"D&B may have already assigned your organization a **free**
D‑U‑N‑S Number… If your company is not listed, you'll have the option to submit
your information to Dun & Bradstreet for a free D‑U‑N‑S Number."* D&B frågar
efter: juridiskt namn, huvudkontoradress, postadress och din arbetsadress.
**Om du ändå måste beställa ett nytt:** bearbetningstid upp till **5
arbetsdagar** hos D&B ("Expediting your D‑U‑N‑S Number creation process will
not shorten this waiting period") **+ upp till 2 arbetsdagar för att Apple ska
få informationen.** ⇒ **~1–2 veckor.**
Om D&B behöver kontakta dig: ha bolagshandlingarna redo.

> ✅ **HÄMTAT 2026-11-14: D-U-N-S-numret är `352708209`** (format `35-270-8209`).
> Det kom från D&B:s eget utskick till ägarens e-post ⇒ **provenance: D&B**.
> Formatkontroll: 9 siffror ⇒ uppfyller D-U-N-S-strukturen (ISO 6523-schemat
> DUNS/0060, valideringsregel `RegEx: [0-9]{9}`).
> **Observera:** den gamla mod-11-kontrollsiffran är **inte längre i bruk** —
> Peppols officiella kodlista anger uttryckligen *"Check digits were removed to
> get a bigger number area"*, och valideringsregeln är bara längd + siffror.
> En misslyckad mod-11-prove är därför **inte** ett tecken på ett felaktigt
> nummer. (Ingen oberoende bekräftelse från oss att numret pekar ut
> Perfectday AB gick att få: D&B:s EU-API har ingen D-U-N-S-lookup, och
> dnb.com ligger bakom Cloudflare-bot-skydd. Apple verifierar numret när
> förfrågan skickas.)

### Vad du fyller i i Apples konverteringsformulär

Formulär: <https://developer.apple.com/contact/request/migrate-individual-account>
(inloggning med ditt Apple ID krävs).

| Fält | Vad du skriver |
|---|---|
| Legal entity name | **Perfectday AB** |
| D-U-N-S Number | **352708209** |
| Address | Bolagets **registrerade säte** — se varningen nedan (D&B har Kalmar) |
| Website | **https://eventpulse.nu** |
| Work email | **hej@eventpulse.nu** |
| Din roll | Förgrundare/medgrundare — Apple kräver det. Om du inte är det, säg till innan du skickar in. |
| Bifogat | Registerprotokoll/utdrag ur bolagsregistret + ID med foto |

> ⚠️ **Adressen är den sista öppna frågan.** D&B:s register anger
> **Larmtorget 4, Lgh 1202, 392 32 Kalmar**; Bolagsverket/hitta.se angav en
> besöksadress i **Borgholm**. Det är D&B-adressen Apple matchar mot. Fyll i
> bolagets **registrerade säte** (samma som i registret), inte en besöksadress.

Steg 2 — **Samla underlag** (Apple: "You also may be asked to submit business
documents to verify your organization's identity"): registerprotokoll eller
utdrag ur bolagsregistret för Perfectday AB, plus ID med foto för den som är
founder/cofounder (Apple kräver att du är det).

Steg 3 — **Skicka konverteringsförfrågan** (Apple: *"If you'd like to update
your membership from an individual to an organization, please submit a
request"*):

- Apples hjälpsida (läs först):
  <https://developer.apple.com/help/account/membership/updating-your-account-information/>
- Direkt förfrågan:
  <https://developer.apple.com/contact/request/migrate-individual-account>
- Eller via kontosidan: <https://developer.apple.com/account> →
  **Membership details** → "submit a request".

Behöver rollen **Account Holder** (det har du). Fyll i bolagets rättsliga namn
("Perfectday AB"), D-U-N-S-numret och adress.

Steg 4 — **Ladda upp samma IPA och skicka in.** (Om Apple ger bolaget ett nytt
Team ID behövs ett nytt bundle ID och därmed ett nytt bygge — se tabellen
ovan.)

**Två saker Apples hjälpsida bekräftar uttryckligen:**

- Att byta namn eller mail på ditt Apple-konto **ändrar inte** säljarens namn
  för ett Individual-medlemskap: *"if you're enrolled in the Apple Developer
  Program as an individual, updating your name in your Apple Account will not
  change the name used for your membership or seller name on the App Store."*
  ⇒ **Att byta mailadress löser ingenting.** Bara konverteringen löser det.
- Namnbytet påverkar alla appar: *"Changing your organization name will update
  your vendor name across all your apps"* (och nollställer IDFV för befintliga
  användare vid nästa uppdatering — relevant om du mäter installationer).

### Om du väljer (b) i stället

Då måste den juridiska texten rullas tillbaka i **fyra** ställen (appens i18n sv/en/it
för policy + villkor, `site/privacy/index.html`, `site/en/privacy/index.html`)
och gate-skripten (`check-app-config.mjs`, `check-ipa.mjs`,
`check-live-site.mjs`) måste skrivas om, eftersom de i dag **kräver**
`Perfectday AB` + `556990-9830` och **förbjuder** "Tomor Gashi" som operatör.
Det är ett par timmars arbete plus ett nytt bygge.

> **Obs:** köp och sälj är två skilda lager hos Apple. Att kontot är ett
> bolagskonto påverkar **inte** ditt eget köp av appar i App Store — det är
> Media & Purchases-kontot som gäller där, och det kan vara ett helt annat
> konto.
