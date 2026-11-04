# App Store Connect-underlag — EventPulse 1.0 (iOS)

> Allt du behöver skriva in i App Store Connect, med svaren och underbyggnaden.
> Byggen som ska lämnas in: **iOS, version 1.0.0, build 4**, SDK 58, IPA:
> `https://expo.dev/artifacts/eas/dujp2FL-iGkeunOq4u1m2Ul9YBAChRLsBjvBt81PlQg.ipa`
> (EAS build `cfa059fe-8686-473b-b613-effce8fe7577`, byggd från commit
> `fb4d45a0` som innehåller rättningen av de råa i18n-nycklarna i policyn).
> IPA-gate `check-ipa.mjs`: **42/42 kontroller gröna**.
>
> **Lösenordet till demokontot ligger i `06-UI/.env` (gitignored) under
> `EXPO_PUBLIC_DEMO_PASSWORD` — kopiera det till "Notes for Review", inte hit.**

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
| Copyright | `2026 Tomor Gashi` |
| Åldersgräns | 18+ |

### Beskrivning (svenska, max 4000 tecken)

```
EventPulse är en personlig event-agent som hittar evenemang i Stockholm
utifrån din egen smak — inte en länklista.

Skriv vad du vill göra ("konsert ikväll", "något för barn i helgen", "mat och
vin") så föreslår agenten evenemang som faktiskt finns, med bild, tid, plats och
biljettlänk.

Det som gör EventPulse annorlunda:

• EN AGENT, INTE ETT FLÖDE — du ställer en fråga i stället för att scrolla
  bland kategorier. Agenten väljer bland riktiga evenemang i databasen och
  hittar aldrig på sådant.
• SMÅK UT DIN SMAK — de evenemang du sparar, gillar på och markerar som
  ointressanta förändrar nästa förslag. Allt du gör i appen är valfritt.
• BESKRIVNINGAR SOM LÄSES — varje evenemang har en egen skriven beskrivning,
  inte en rå källtext.
• BILJETTER INGÅR INTE — vi säljer inga biljetter. Vi visar var du kan köpa
  och låter arrangören ta hand om betalningen.
• FUNGERAR UTAN KONTO — browse, spara och prata med agenten direkt. Logga in
  bara om du vill ha samma smak på flera enheter.

Evenemangen kommer från arrangörernas egna publika sidor, med källhänvisning
på varje evenemang. Vi visar Stockholmsregionen — och ibland saknas evenemang,
vilket står varifrån informationen kommer.

Frågor? hej@eventpulse.nu
```

### Promotional text (max 170 tecken)

```
Skriv "konsert ikväll" — så hittar agenten evenemanget. Utan konto, utan att
scrolla, med bild och beskrivning på varje förslag.
```

### Keywords (max 100 tecken)

```
evenemang,stockholm,konsert,teater,festival,utställning,kultur,mat,helg,agent,biljetter
```
(87 tecken)

### Stödtext engelska (om du vill)

```
EventPulse is a personal event agent for Stockholm — ask it what to do
instead of scrolling through lists. It only suggests real events, with
photos, written descriptions, times, venues and ticket links. Works without
an account.
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
| Data Shared with third parties | **Ja** — MiniMax (agentchatten: text du skriver + evenemangssammanfattning). Beskriv under "Third-Party SDKs": MiniMax, och de övriga leverantörerna (Supabase, Fly.io, Expo/APNs) om Apple frågar efter "data used to track" vs "data collected" |
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
| Användargenererat innehåll | Nej | Chattar pratas med en AI-agent, inte användare. Share-länkar samlar evenemangsval, inte text, och är inte en publik feed |
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
EventPulse is a personal event agent for Stockholm. It shows real events
with photos, written descriptions, times, venues and ticket links.

HOW TO REVIEW:
1. The app works fully WITHOUT an account — no sign-up is required to browse
   the feed, ask the agent for suggestions, save events or read the privacy
   policy. The "Lägg till e-post" button on the Profil tab is optional.
2. To test the signed-in experience (Sparade / Rekommenderat / Din helg), use
   the demo account below. It is a separate, empty account with no personal
   data.
   - Login screen (Profil → "Lägg till e-post" → scroll down to
     "Demologin för App Review")
   - Email: demo@eventpulse.nu
   - Password: <KOPIERA FRÅN 06-UI/.env — EXPO_PUBLIC_DEMO_PASSWORD>
3. The agent chat is on the Hem tab: type a request such as "konsert ikväll"
   and it proposes real events from our database. It never invents events.
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
| App Review contact | Tomor Gashi, `hej@eventpulse.nu`, ditt telefonnummer |

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
| 1 | Hem | Feed med "Förslag från din agent" + evenemang med bild | Agentens förslag, inte tom lista |
| 2 | Agent-chatt | Frågan "konsert ikväll" + svaret med konkreta evenemang | Bevisar att agenten svarar |
| 3 | Förslag-kort | Ett evenemang med bild, skriven beskrivning, tid, plats, pris | Välj ett event **med** editorial-beskrivning (372 events saknar text) |
| 4 | Utforska | Kategorirutor med bilder | Visa en bildkatt med riktiga evenemang |
| 5 | Sökm resultat | Sökning som ger träffar | |
| 6 | Karta | Karta med EventPulse-markörer (Apple Maps) | Verifiera att kartan faktiskt renderar på enheten |
| 7 | Din helg | Agentens veckoförslag (topp 3–5) | Kräver inloggning → logga in med demokontot |
| 8 | Sparade | Sparade evenemang | Kräver inloggning → demokontot |
| 9 | Profil | Profilen med Integritetspolicy + Användarvillkor synliga | Visar att policy finns i appen |

> **Måste göras på en riktig iPhone (eller simulator med Xcode).** Det finns
> ingen Xcode-installation på maskinen här, så skärmbilderna kunde inte tas
> automatiskt. Ta dem från **TestFlight-builden** (build 4), inte från Expo Go.

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
- [ ] iOS-build 4 uppladdad och vald i version 1.0.0
- [ ] **Integritetspolicyn live på eventpulse.nu** (se avsnitt 8)
- [ ] Skicka in

---

## 8. Kvar att lösa av ägaren

| Punkt | Status | Vad som krävs |
|---|---|---|
| Integritetspolicyn live på `eventpulse.nu/privacy/` | **LÖST 2026-11-04** — Cloudflare Pages-projektet `eventpulse-nu` deployades via `wrangler pages deploy site --branch main`. Live-gate `check-live-site.mjs`: **18/18 kontroller gröna** (sv + en). Live-sidan svarar nu med den fulla policyn (9 413 B sv / 9 255 B en) | — |
| TestFlight-uppladdning | **Blockerat** — `eas submit` kräver inloggning mot App Store Connect (API-nyckel eller interaktiv OAuth). Bygget finns redo | `cd 06-UI && eas submit --platform ios --latest` (logga in först) eller ladda upp IPA:n i App Store Connect manuellt |
| Skärmbilder | **Blockerat på maskinen** — ingen Xcode/simulator | Ta på riktig iPhone från TestFlight-builden |
| Juridiskt bolagsnamn | Antagande | Policyn anger "Tomor Gashi" (från git/EAS-kontot). Bekräfta att det är ditt juridiska namn, eller ändra i `06-UI/i18n/strings/{sv,en,it}.js` + `site/privacy/index.html` + `site/en/privacy/index.html` |
| Avstängning av demologin efter godkännande | Val | Radera demokontot i Supabase (stänger av direkt, utan ny build) eller bygg om utan `EXPO_PUBLIC_ENABLE_DEMO_LOGIN` |
