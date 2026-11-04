---
name: verify-eventpulse-ui
description: |
  Drive the EventPulse Expo web build end to end via Playwright. Use for
  /verify-eventpulse-ui, when a UI feature in 06-UI/FEATURE_MAP.md needs
  evidence, or when a UI regression must be reproduced in the browser.
  Covers the user-facing surfaces reachable from the web build (Hem, Utforska,
  event-detalj, Karta, Profil, Notiser, Onboarding, Login, i18n, analytics).
  Native-modul-funktioner (push device-token, native maps clustering,
  Apple-ID) annoteras som `verified-unreachable` — se Gotchas.
disable-model-invocation: false
---

# verify-eventpulse-ui

## Launch

Web build via Metro. `06-UI` serveras på port **9090** (den port `06-UI/e2e/*.test.mjs`
förväntar sig, inte 8081).

```bash
cd 06-UI
# Lokal agent-API på 8787 + Metro mot den (se "Varför lokal agent" nedan)
npm --prefix .. run start:agent &          # 08-Agent/server.ts → :8787
EXPO_PUBLIC_AGENT_URL=http://localhost:8787 ./scripts/launch-metro.sh
./scripts/doctor-metro.sh                 # exit 0 = körbar
```

`scripts/launch-metro.sh` laddar `06-UI/.env`, låter ett externt satt
`EXPO_PUBLIC_AGENT_URL` vinna, skriver PID till `06-UI/.runtime-metro.pid` och
loggar till `/tmp/eventpulse-metro-<port>.log`.

Ready-signal: loggen visar `Waiting on http://localhost:9090` och första `GET /`
svarar 200. Vänta på `[Web] Bundled` innan du driver — första bundlen tar
30–60 s.

Isolering: en Metro-process äger 9090. Kör inte en andra `expo start` parallellt.
Om du behöver samköra, byt port (`PORT=9091`) och sätt `BASE_URL=http://localhost:9091`.

### Varför lokal agent (inte prod)

Prod-API:t på `eventpulse-agent.fly.dev` har en **origin-allowlist**
(`AGENT_ALLOWED_ORIGINS`). Webbbygget skickar `Origin` → utan tillåten ursprung
svarar servern **403 `{"error":"origin not allowed"}`** → appen loggar
"Failed to load events: TypeError: Failed to fetch". Detta drabber även
Expo Go via tunnel (`https://<random>.exp.direct`), eftersom tunnelvärdet är ett
origin som inte kan allowlistas statiskt.

Lösningen i dev: kör agenten lokalt på 8787 (då är `allowedOrigins` tom och
CORS öppet) och peka Metro mot den. **Detta är harnessens jobb, inte appens.**

Env vars vid körning:

| Var | Källa | Obligatorisk |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` från `.env` | ja |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `SB_PUBLISHABLE_KEY` från `.env` | ja |
| `EXPO_PUBLIC_AGENT_URL` | `http://localhost:8787` (lokal agent) | ja för feed/Utforska/Karta |
| `EXPO_PUBLIC_AGENT_URL_LAN` | `http://<dev-maskinens LAN-IP>:8787` | **ja för telefonen (Expo Go)** |
| `EXPO_PUBLIC_PUSH_ENABLED` | **används ingenstans i koden** — pushytan styrs av `isPushRuntimeAvailable()` + `eventpulse.din_helg_push_prompt_shown` | ignorera |

`EXPO_PUBLIC_*` läses vid **bundle-time** — ändra `.env` och starta om Metro.

### Telefonen (Expo Go) når agenten via LAN, inte via localhost

`localhost` betyder olika saker i de två klienterna:

| Klient | `localhost:8787` pekar på | Agenten nås via |
|---|---|---|
| Webbbygget i Chrome (på dev-maskinen) | dev-maskinen | `EXPO_PUBLIC_AGENT_URL` |
| Appen i Expo Go (iPhone) | **telefonen själv** | `EXPO_PUBLIC_AGENT_URL_LAN` |

Telefonen kan därför INTE använda `localhost`. Saknas LAN-kandidaten svarar
iOS med `fetch failed: Could not connect to the server.`
(NSURLErrorCannotConnectToHost) och appen loggar "Failed to load events"
(`06-UI/App.js` → `loadEvents`).

`agentClient.pickReachableAgentBase` provar kandidaterna i ordning och tar den
första som svarar `{"ok":true}` på `/agent/health` — telefonen hoppar då förbi
`localhost` (refused) och landar på LAN-adressen. Samma agent, samma kod,
samma data; bara olika väg dit.

`launch-metro.sh` sätter LAN-kandidaten automatiskt från nätverksgränssnittet
när den saknas i `.env`. Kontrollera med `./scripts/doctor-metro.sh` (raden
"Agent LAN API").

## Doctor

Kör innan första drive, och efter varje misslyckad drive.

```bash
cd 06-UI && ./scripts/doctor-metro.sh
```

Kontrollerar: Metro-root (200), Expo-mount-point i HTML, **web-bundlen byggs**,
och agent-API:t svarar `{"ok":true,"phase":0}`. Exit non-zero = instansen är
inte värd att driva. Stoppa och relauncha.

## Drive

Harness: Playwright med `06-UI/playwright.config.js`. Specar ligger under
`06-UI/e2e/<feature>.test.mjs`. **Delade hjälpare: `06-UI/e2e/helpers/ui.mjs`**
(`tap`, `tapText`, `tapTab`, `tapBack`, `boot`, `collectErrors`, `homeSections`).

**Touch via PointerEvent är obligatoriskt** — RN-web:s `Pressable`/`TouchableOpacity`
svarar inte på `.click()`. `helpers/ui.mjs` gör det rätt.

Befintliga specar:

| Spec | Vad den bevisar |
|---|---|
| `e2e/app-tabs.test.mjs` | Alla fem flikar öppnar utan konsolfel + feeden laddar events |
| `e2e/hem-sections.test.mjs` | Varje Hem-sektion öppnar ett event och "Tillbaka" går tillbaka |
| `e2e/home.test.mjs` | Hem-basvyn: sektioner, kort, tomma tillstånd |
| `e2e/event-detail-buttons.test.mjs` | Varje knapp i eventkortet trycks + inga kapslade `<button>` |
| `e2e/utforska-categories.test.mjs` | Alla 18 kategorier öppnar med events + ⋯-menyn |
| `e2e/search.test.mjs` | Live-sök i Utforska (om-skriven 2026-10-28) |
| `e2e/save-favorite.test.mjs` | Hjärtat flippar + **persisterar inget** (den kända luckan) |
| `e2e/dedup-no-duplicate-cards.test.mjs` | Ingen kategori visar samma evenemang två gånger |
| `e2e/multi-date-verification.test.mjs` | Evenemang med flera datum visas korrekt |
| `e2e/image-frame-aspect.test.mjs` | Bildramen är låst till 3:2 |
| `e2e/legal-policy.test.mjs` | Policyn i appen: inga `[TODO]`, inga råa `legal.*`-nycklar, rätt innehåll |
| `e2e/demo-login.test.mjs` | Demologinen syns bara när flaggan är på (läser `06-UI/.env` själv) |

Förklaring av en drive (live-felsökning, ingen assertion):

```bash
cd 06-UI
node scripts/ui-probe.mjs --plan scripts/plans/<plan>.json
```

Proben (skillens egen) startar appen, samlar konsolfel / page errors /
misslyckade nätverksanrop, dumpar DOM (`inventory`, `structure`, `textmap`) och
tar skärmdumpar. Plan-formatet står i `scripts/ui-probe.mjs`.

Kör:

```bash
cd 06-UI
BASE_URL=http://localhost:9090 npx playwright test                     # alla
BASE_URL=http://localhost:9090 npx playwright test e2e/<feature>.test.mjs
```

Stabila handtag att föredra:

- `[data-testid="..."]` — `home-screen`, `event-card-read-more`, `utforska-section-screen`, `explore-search-input`
- `[role="list"]` med `aria-label="<Rubrik> — karusell"` — Hem-sektionerna
- `getByRole('button', { name: '...' })` — kort och kategoriknappar
- Textinnehåll i `UtforskaEventActionSheet` (svenska: "Spara", "Inte intresserad")

**`aria-selected` finns INTE i DOM** (RNW mappar inte `accessibilityState.selected`).
Välj flik på `[role="tab"]` + **synlighet**.

## Evidence

- **Live-bevis (screenshots + JSON-rapporter):** `06-UI/runtime/verification-reports/ui-verify-<ts>/` och `.../ui-probe-<ts>/`. Gitignored — kopiera det som ska levereras.
- **Visual-regression-baselines:** `06-UI/e2e/visual-regression/baseline/<name>-darwin.png`.
- **Test-loggar:** `06-UI/playwright-report/` — gitignored, committa inte.
- **Metro-transcript:** `/tmp/eventpulse-metro-<port>.log`.

Bevisstandard: kör den riktiga user path (knapptryck → DOM-event → nätverksanrop →
DB-rad), inte interna setters eller mockade API-svar.

## Cleanup

```bash
cd 06-UI && ./scripts/cleanup-metro.sh
```

Dödar bara PID:en i `.runtime-metro.pid` och en eventuell kvarvarande lyssnare
på **PORT** (default 9090). Rör aldrig 8081 — det kan vara en användares egen
session. Lämna baseline-screenshots och rapporter intakta.

## Helpers

- `06-UI/scripts/launch-metro.sh` — startar Metro, PID-fil, logg.
- `06-UI/scripts/doctor-metro.sh` — Doctor-block, exit non-zero vid fel.
- `06-UI/scripts/cleanup-metro.sh` — dödar PID + lyssnare på PORT.
- `06-UI/scripts/ui-probe.mjs` — live-probe (felinsamling + DOM-dump + screenshots).
- `06-UI/scripts/plans/*.json` — planer för prober.
- `06-UI/e2e/helpers/ui.mjs` — delade Playwright-hjälpare.

## Gotchas

**Tre landminer som förstör körningar:**

1. ~~**Appen har två tabbares i DOM.**~~ **Rättad 2026-11-04 — numera FÖREDEBAND.** App.js:s egen tabbar (Hem/Map/Profil) är dold via `hideInternalTabBar` (`AppShell.js:592` → `App.js:2370`), så det finns **bara en** tablist i DOM med 5 synliga flikar. Verifierat live 2026-11-04: `[role="tab"]` → 5 träffar, alla synliga, `role="tablist"` → 0. Välj flik på `[role="tab"]` med `aria-label`.
2. **`aria-selected` finns inte i DOM.** Välj flik via `[role="tab"]` + synlighet.
3. **Tryck måste ske via pointer-events.** `page.click()` triggar inte RNW:s Pressable.

**Native-moduler — `verified-unreachable` i web build:**

- **#2 Push-notiser:** `expo-notifications` har ingen webbimplementation, och
  Expo Go (SDK 53+) har ingen fjärrpush → `pushTokenClient.js` avbryter sig
  själv med `warning:'unavailable'`. Kräver dev build/TestFlight + enhet.
- **#6 Karta:** `react-native-maps` renders via shim på web ("Kartan är inte
  tillgänglig på webb"). Clustering, GPS och riktiga pins kräver fysisk enhet.
- **#12 Autentisering — Apple-ID:** `expo-apple-authentication` är iOS-only.
  Email-OTP-flödet funkar i webbbuilden.

**CORS/origin:** prod-agenten svarar 403 på origins som inte står i
`AGENT_ALLOWED_ORIGINS`. Filtera INTE bort detta i specar — kör mot den lokala
agenten (Launch) så är det inte miljöbrus.

**Telefonen når inte `localhost`:** i Expo Go är `localhost` = telefonen själv.
Appen måste peka på LAN-kandidaten `EXPO_PUBLIC_AGENT_URL_LAN` — annars loggar
iOS "fetch failed: Could not connect to the server." Se "Telefonen (Expo Go)".

**Rate limit:** agent-API:t har en token bucket (5 rps, burst 20 per IP).
Utforska gör **två** anrop per kategori → snabb kategoribrowsing ger **429**.
Appen visar då "Kunde inte hämta evenemang. Försök igen." — det är verifierat
felbeteende, inte en krasch. Pacing i specen (1–2 s mellan kategorier).

**Bilder:** ~~alla Supabase-storage-URLer ger **404**~~ — **INAKTUELLT, rättat
2026-11-04.** Storage-restore (`d8dbff5e`) plus rättad uppladdningssökväg gör att
bilderna fungerar. Verifierat live 2026-11-04 på Hem: **126 av 126 bilder laddade,
0 trasiga, 0 misslyckade nätverksanrop** på bildresurser. Bildramen är låst till
**3:2** (`hooks/imageAspectCore.js`); trasig URL ger en **bildtext-placeholder** i
stället för en tom ruta. Verifiera alltså gärna bilder igen — men en tom ruta är
fortfarande ett verkligt fel.

**Sökfel sväljs tyst** (`agentClient.js` → `search.error`, ingen synlig feedback).

**Scrollar på webb:** de flesta vyer scrollar i en inre container (`overflow-y:
auto`). Detaljskärmen scrollar numera också (fix 2026-10-28 — den saknade
ScrollView helt, vilket klippte innehållet på native). När du scrollar i en
drive: sök den inre containern (`scrollHeight > clientHeight`), inte fönstret.

## Maintenance

Kör `/maintain-verification-skill` när `06-UI/FEATURE_MAP.md` ändras (ny feature,
status-shift, ny route) eller när en e2e-spec börjar flaga utan motsvarande
produktfel. Source-wave gör parallell granskning av en feature-fil per subagent;
live-pass driver en långlivad Metro-instans genom alla features.

**2026-10-28 — genomförd maintenance-pass.** Se `features/README.md` för den
korrigerade feature-kartan och vilka claims som var fel.

**2026-11-04 — genomförd maintenance-pass. Outcome: `changed`.**
15 read-only `explore`-subagenter (en per feature-fil) + live-pass över hela
e2e-sviten (40 tester, 10,5 min). Rättat i **11 feature-filer**:
- **Landminen "två tabbares i DOM" är inaktuell** — `hideInternalTabBar` gör att det finns
  **en** tabbar. Verifierat live: 5 `[role="tab"]`, 0 `[role="tablist"]`.
- **Landminen "alla storage-URLer ger 404" är inaktuell** — bilderna fungerar sedan
  storage-restore. Verifierat live: 126/126 bilder laddade, 0 trasiga.
- Juridiska texter: råa i18n-nycklar och `[TODO]` är **fixade** (profil.md, i18n.md).
- `PROVIDER_APPLE` finns **inte** i `react-native-maps` — kartans leverantör är
  `PROVIDER_DEFAULT` (= MapKit på iOS). Se `karta.md`.
- Push-prompten **syns på webb** (verifierat live) — den är bara inert.
- Onboarding **har** en "Hoppa över"-knapp.
- Sök har **ingen submit** och **3-teckens-tröskel**; fel tystas bort i `App.js`.
- Agent-chatten monteras av `App-agent.js` (ingen importerar den) — inte "ingenstans".
- Ny: `analytics.md` — env-gaten är **öppen** i lokal build; identiteten sätts av den
  anonyma bootstrapen.

**Harness-fixar som följde med (ej produktkod):**
- `e2e/helpers/ui.mjs` — `tapTab` söker bland `[role="tab"]` **först** (exakt matchning
  före delmatchning). Tidigare matchade den bland alla knappar: "Hem" träffade ett
  evenemang med "hemsidan" i titeln.
- `e2e/visual-regression/visual-regression.spec.mjs` — navigerade via **webbroutes**
  (`/karta`, `/agent`) som inte finns (appen har ingen router) ⇒ alla fyra "kritiska
  vyer" var skärmbilder av Hem. Nu flik-klick + skärmspecifik markör; `AGENT — Chatt`
  ersatt av `PROFIL — Gästvy + juridik` (chatten är dormant).
- `e2e/home.test.mjs` — assertionen "Konserter syns inte" träffade ett evenemang med
  titeln "Konserter". Nu krävs **exakt** accessible name.
- `e2e/demo-login.test.mjs` — läser `06-UI/.env` själv (Metro gör det, Playwright-processen
  gjorde inte det) ⇒ det negativa fallet föll annars.
- **Baselines tillagda:** `baseline/screen-{home,utforska,karta,profile}-darwin.png`.

**Produktluckor rapporterade (inte fixade i dokumentationen):**
- "⋯"-menyn i Utforska är **no-ops** — den visar val som inte gör något.
- Notiser: `attendance_prompt` och `follow_drop` filtreras bort av klientens `sanitize()`
  ⇒ kan aldrig visas. Servertypen `match`/`response` finns bara i testfixtures.
- Webbbygget förbrukar push-promptens engångsflagga utan att registrera någon token.
- Sökfel tystas bort ⇒ ser ut som "inga träffar".
- "TEST EVENT" ligger i produktionsfeeden (första kortet i För dig) — synligt för
  användare och granskare.
- Sparat hjärta återställs (ingen återhydrering) trots att `/agent/feedback` skrivs en rad.
