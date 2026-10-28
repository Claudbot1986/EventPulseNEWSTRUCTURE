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
| `EXPO_PUBLIC_PUSH_ENABLED` | **används ingenstans i koden** — pushytan styrs av `isPushRuntimeAvailable()` + `eventpulse.din_helg_push_prompt_shown` | ignorera |

`EXPO_PUBLIC_*` läses vid **bundle-time** — ändra `.env` och starta om Metro.

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
| `e2e/event-detail-buttons.test.mjs` | Varje knapp i eventkortet trycks + inga kapslade `<button>` |
| `e2e/utforska-categories.test.mjs` | Alla 18 kategorier öppnar med events + ⋯-menyn |
| `e2e/search.test.mjs` | Live-sök i Utforska (om-skriven 2026-10-28) |

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

1. **Appen har två tabbares i DOM.** App.js:s egen (Hem/Map/Profil) är dold
   (`display:none`), AppShells `BottomTabBar` är synlig. Tryck bara på **synliga**
   element — annars träffar du den dolda och "ingen händer".
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

**Rate limit:** agent-API:t har en token bucket (5 rps, burst 20 per IP).
Utforska gör **två** anrop per kategori → snabb kategoribrowsing ger **429**.
Appen visar då "Kunde inte hämta evenemang. Försök igen." — det är verifierat
felbeteende, inte en krasch. Pacing i specen (1–2 s mellan kategorier).

**Bilder:** alla Supabase-storage-URLer ger **404** i den nuvarande databasen
(`NoSuchKey`) → webbläsaren blockerar dem med ORB → tomma bildrutor. Detta är
ett känt bildproblem och **ska inte** räknas som UI-fel. Verifiera **innehåll**
(text, data, navigation), inte bilder.

**Sökfel sväljs tyst** (`agentClient.js` → `search.error`, ingen synlig feedback).

## Maintenance

Kör `/maintain-verification-skill` när `06-UI/FEATURE_MAP.md` ändras (ny feature,
status-shift, ny route) eller när en e2e-spec börjar flaga utan motsvarande
produktfel. Source-wave gör parallell granskning av en feature-fil per subagent;
live-pass driver en långlivad Metro-instans genom alla features.

**2026-10-28 — genomförd maintenance-pass.** Se `features/README.md` för den
korrigerade feature-kartan och vilka claims som var fel.
