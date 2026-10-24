---
name: verify-eventpulse-ui
description: |
  Drive the EventPulse Expo web build end to end via Playwright. Use for
  /verify-eventpulse-ui, when a UI feature in 06-UI/FEATURE_MAP.md needs
  evidence, or when a UI regression must be reproduced in the browser.
  Covers the user-facing surfaces reachable from web build (Hem, Utforska,
  Search, Profile, Notifications, Onboarding, Login). Native-modul-funktioner
  (push device-token, native maps clustering, Apple-ID) annoteras som
  `verified-unreachable` — se Gotchas.
disable-model-invocation: false
---

# verify-eventpulse-ui

## Launch

Web build via Metro. Expo servear `06-UI` på port 9090 (den port `06-UI/e2e/*.test.mjs` förväntar sig, inte 8081).

```bash
# Kör från projekt-roten
cd 06-UI
EXPO_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
EXPO_PUBLIC_SUPABASE_ANON_KEY="$SB_PUBLISHABLE_KEY" \
EXPO_PUBLIC_AGENT_URL="http://localhost:8787" \
npx expo start --host lan --port 9090
```

Ready-signal: Metro-loggen visar `Metro waiting on ...` eller första `GET /` 200 inom 30 s. Roterande spinner i web bundle är OK — Metro bundlar fortfarande. Vänta tills `[Web] Bundled` syns i loggen innan du öppnar webbläsaren. Bekräfta sedan med `curl -sI http://localhost:9090/ | head -1` → `200`.

Isolering: en Metro-process äger 9090. Kör inte en andra `expo start` parallellt. Om du behöver samköra, byt port (`--port 9091`) och sätt `BASE_URL=http://localhost:9091` för Playwright.

Env vars vid körning:

| Var | Källa | Obligatorisk |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` från `.env` | ja |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `SB_PUBLISHABLE_KEY` från `.env` (nya formatet, ersätter `SUPABASE_ANON_KEY`) | ja |
| `EXPO_PUBLIC_AGENT_URL` | pekar mot lokalt 08-Agent (`http://localhost:8787`) om agent-API:t ska nås under drive | rekommenderad |
| `EXPO_PUBLIC_PUSH_ENABLED` | sätt till `1` om push-flödet ska öppnas (för device-token-test — se Gotchas) | bara för push-feature |

## Doctor

Kör innan första drive, och efter varje misslyckad drive.

```bash
# Metro svarar?
curl -sI http://localhost:9090/ | head -1
# → förväntat: HTTP/1.1 200 OK

# Sidan innehåller Expo-mount-point?
curl -s http://localhost:9090/ | grep -E 'expo|eventpulse' | head -1
# → förväntat: minst en träff

# Agent-API nåbart (om UI ska prata med det)?
curl -s http://localhost:8787/agent/health
# → förväntat: {"ok":true,"phase":0}
```

Doctor-failure innebär att instansen inte är värd att driva. Stoppa. Relaunch via Launch-sektionen istället för att köra tester på en trasig Metro.

## Drive

Harness redan på plats: Playwright med `06-UI/playwright.config.js`. Återanvänd befintliga spec:er och lägg till nya under `06-UI/e2e/<feature>.test.mjs`. **Touch-via-PointerEvent** är obligatoriskt — React Native Web:s `Pressable`/`TouchableOpacity` svarar inte på `.click()` direkt, bara på `pointerdown`+`pointerup`. `06-UI/e2e/search.test.mjs` har fungerande `tap()`-helper som du kan klippa in.

Stabila handtag att föredra:
- `[data-testid="..."]` (befintliga: `home-search-button`, `explore-search-input`)
- `[role="tab"][aria-selected="true"]`
- `[role="button"]` filtrerad på text via `getByRole('button', { name: '...' })`
- Textinnehåll i `UtforskaEventActionSheet` (svenska: "Spara", "Inte intresserad")

Fönsterstorlek: Desktop Chrome default (1280×720) — projektets `playwright.config.js` har inga `viewport`-överridningar.

Kör:

```bash
cd 06-UI
# Alla
BASE_URL=http://localhost:9090 npx playwright test
# Bara en feature
BASE_URL=http://localhost:9090 npx playwright test e2e/<feature>.test.mjs
# Bara en feature inom UI:en (befintligt mönster)
BASE_URL=http://localhost:9090 npx playwright test e2e-dashboard/<spec>.test.mjs
```

## Evidence

Bevisplatser, peggade så att både spec + baseline committas tillsammans:

- **Skärmdumpar (visual regression):** `06-UI/e2e/visual-regression/baseline/<name>-darwin.png`. Sökvägen är redan konfigurerad av `snapshotPathTemplate` i `playwright.config.js`.
- **Test-loggar:** `06-UI/playwright-report/` (genereras av Playwright). Committa inte — gitignored.
- **Transcripts:** stdout från `expo start` skriv till `/tmp/eventpulse-metro-<ts>.log` om du behöver rekonstruera ett fel.
- **Side-effects i Supabase:** antal rader i `agent_interactions`, `agent_sessions` (skrivna av save-favorite / chat). Driver-side: gör en rad-räknings-SELECT före + efter drive, diff = bevis.

Bevisstandard: kör den riktiga user path (knapptryck → DOM-event → nätverksanrop → DB-rad), inte interna setters eller mockade API-svar. Side-effects ska verifieras vid sidan av UI:t, inte bara "skärmen ser ut som förut".

## Cleanup

```bash
# Metro-processen dog du startade. Aldrig 'killall node'.
PID=$(cat .runtime-metro.pid 2>/dev/null)
[ -n "$PID" ] && kill "$PID"
rm -f .runtime-metro.pid
```

Lämna baseline-screenshots och Playwright-report intakta — bevis överlever teardown. Playwright-report är redan gitignored; baseline är commit-skyddad och ska committas med specen.

## Helpers

Lanseras som `scripts/` i `06-UI/` efter steg 5 (live-drive). Innan dess är de inline-bash-block ovan. Den färdiga formen:

- `scripts/launch-metro.sh` — startar Metro, skriver PID till `06-UI/.runtime-metro.pid`, loggar till `/tmp/eventpulse-metro.log`.
- `scripts/doctor-metro.sh` — kör Doctor-block, exit non-zero om något saknas.
- `scripts/cleanup-metro.sh` — dödar PID från `.runtime-metro.pid`, lämnar baseline.

## Gotchas

**Native-moduler — `verified-unreachable` i web build:**
- **#2 Push-notiser (save/registrering):** `expo-notifications.getExpoPushTokenAsync()` returnerar `null`/undefined i web. Token-registrering via `pushTokenClient.js` kan öppnas i DOM (knapptryck), men device-token-flödet kan inte bevisas automatiskt. Annotera som prerequisite: iOS/Android device, alternativt verifiera endast `push_din_helg`-cron-flödet i `08-Agent/cron/` som separat test i `verify-eventpulse-agent`.
- **#6 Karta:** `react-native-maps` + `react-native-map-clustering` har ingen native clustering-prestanda på web. Markers kan renderas, men cluster-beteende, klick→detalj-sheet, "använd min plats"-GPS kan inte verifieras. Annotera med prerequisite: fysisk device med GPS.
- **#12 Autentisering — Apple-ID:** `expo-apple-authentication` är iOS-only. Email-OTP-flödet (Supabase magic link) funkar i web build.

**CORS-quirk i test-env:** Console.error-events från `agent/health` och CORS-fel filtreras bort i `06-UI/e2e/search.test.mjs:53`. Om du skriver nya spec:ar, koppla samma filtrering så du inte fejk-felar på test-miljö-bråk.

**`EXPO_PUBLIC_*` env vars läses vid bundle-time.** Om du ändrar `.env` efter Metro startat, starta om. Dokumentera detta i `scripts/launch-metro.sh` när steg 5 körs.

**Metro första bundle är långsamt (~30-60 s).** Ha med `--reporter=list` så du ser förloppet, och ge första `goto()` `waitUntil: 'networkidle'` + explicit `waitForTimeout(4_000)` som befintliga spec:er gör.

**Två instanser kan inte dela samma 9090.** Se Isolering ovan.

## Maintenance

Kör `/maintain-verification-skill` när `06-UI/FEATURE_MAP.md` ändras (ny feature, status-shift, ny route) eller när en e2e-spec börjar flaga utan motsvarande produktfel. Source-wave gör parallell granskning av en feature-fil per subagent; live-pass driver en långlivad Metro-instans genom alla features.
