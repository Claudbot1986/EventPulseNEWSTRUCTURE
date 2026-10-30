# Hem — startsidan

## Sub-features

- **Nio karuseller**, i ordning: För dig, Senaste, Ikväll, Imorgon, Helgen, Foodies, Gratis, Nytt på Eventpulse, Upptäck.
- Varje karusell är en horisontell lista av eventkort (tumbild + titel + undertext).
- Alla nio sektioner läser direkt från Supabase-vyn `events_public` — **ingen agent-API**. Därför når agentens `?locale=`-översättning inte hit: Hem hämtar i stället översättningen själv för de få titlar som har ett främmande skript (`06-UI/utils/displayTitles.js` → `attachDisplayTitles`), och `pickDisplayTitle` skyddar resten.
- En gäst ser samma nio sektioner som en inloggad användare.
- Kortet "Rekommenderad" är ett *underetikett* på kortet, inte en sektion.
- Tappas ett kort → händelsen skrivs till `eventpulse.pending_event`, skalet byter till Utforska-fliken och App.js öppnar gemensamma DetailsScreen.

## How to get to it (user POV)

Appen startar på Hem. Hem är första-fliken i den synliga bottenstapeln. Det finns **en** synlig tabbar i DOM — AppShell passerar `hideInternalTabBar`, så App.js:s egen tabbar renderas inte alls.

## Driving it with Playwright

Spec: `06-UI/e2e/hem-sections.test.mjs` (kör `BASE_URL=http://localhost:9090 npx playwright test e2e/hem-sections.test.mjs`).

Nycklar:

- Hem-roten bär `testID="home-screen"` → `data-testid="home-screen"`.
- Varje karusell bär `accessibilityRole="list"` + `aria-label="<Rubrik> — karusell"`. **Använd det som sektions-handle**, inte rubriktexten.
- Eventkort är `<button>` med `aria-label`. I de åtta `EventPulseCarousel`-sektionerna är formatet **`<underetikett> — <titel>`**, i **Senaste** är det **`<titel> — <underetikett>`** (ordningen är omvänd mellan komponenterna). De saknar `data-testid` (propen `testID` droppas i `EventPulseCarousel`).
- Tillbaka-knappen på detaljskärmen är en `TouchableOpacity` **utan** `accessibilityRole`/`testID` → den är INTE ett `<button>`. Hitta den på texten `"< Tillbaka"`.

Recept i korthet:

1. `await page.getByTestId('home-screen').waitFor()`.
2. `await page.getByRole('list', { name: 'För dig — karusell' }).waitFor()`.
3. Klicka första knappen i karusellen → `await page.getByTestId('event-card-read-more').waitFor()`.
4. Klicka texten `"< Tillbaka"` → `home-screen` ska synas igen.

## Gotchas

- **FEATURE_MAP-drift:** kartan sa 5 sektioner ("Senaste", "Rekommenderat", "Förslag", "Sparade", "Din helg"). Verkligheten är **9** sektioner ovan. "Rekommenderat"/"Förslag"/"Sparade"/"Din helg" finns bara i `06-UI/HEM-QUARANTINE/` som aldrig monteras. FEATURE_MAP pekar också på `06-UI/screens/home/` som inte finns.
- `testID="home-personalized-gated"` droppas i `EventPulseCarousel` (propen finns inte i signaturen) — kan inte väljas på.
- `<ul>` (role=list) innehåller `<div>`-barn: ogiltig HTML men React varnar inte.
- "Senaste"-korten tappar `extraDatesCount` → "+N andra datum" visas inte i Senaste.
- **"TEST EVENT" ligger i produktionsfeeden** (första kortet i För dig). Testdata har läckt till den publika vyn.
- `useAiImageUrl` anropas inuti `.map()` i `HomeScreen.js` — ren funktion idag, men bryter hook-reglerna om den blir stateful.
