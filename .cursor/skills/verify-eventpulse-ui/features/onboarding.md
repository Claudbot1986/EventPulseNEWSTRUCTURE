# Onboarding

## Sub-features

- Första-lopps-skärm med val av intressekategorier — **7 kategori-chips**, var och en `accessibilityRole="checkbox"` + `accessibilityLabel` (`OnboardingScreen.js:44-52, 140-153`). De är förifyllda från `eventpulse.preferences.categories`.
- Appen sparar `eventpulse.onboarding_complete = '1'` i AsyncStorage (= `window.localStorage` på web, **utan prefix**).
- **Det finns en "skip"-knapp** (`OnboardingScreen.js:160-163`, etikett `common.skip` = "Hoppa över" / "Skip"). Footer har **två** knappar: "Hoppa över" och "Fortsätt till EventPulse" (den senare är inaktiverad tills preferenserna laddats, `:164-176`).
- Båda knapparna skriver `eventpulse.preferences.categories` och sedan `eventpulse.onboarding_complete='1'` (`:83-90`).
- `savePreferencesToServer` anropas också (`:116`) men är en **no-op** vid det laget — den avbryter när användaren inte är autentiserad (`agentClient.js:295`), och ingen session finns ännu.
- `AppShell` har en 3-lägesmaskin `onboardingState: 'loading' | 'needs' | 'done'` (`AppShell.js:79`). `loading` → `done` efter 800 ms om storage hänger (`:322-329`).
- **Tre bypassar**, alla utvärderade **före** storage-läsningen:
  1. `EXPO_PUBLIC_SKIP_ONBOARDING === '1'` (`AppShell.js:345`)
  2. `globalThis.__SKIP_ONBOARDING__ === true` (`AppShell.js:346`) — används av `e2e/multi-date-verification.test.mjs:54-62`
  3. `eventpulse.onboarding_complete === '1'` i storage

## How to get to it (user POV)

Appen visar onboarding första gången den startas på en enhet.

## Driving it with Playwright

Ingen spec ännu — feature-filen beskriver läget.

**Förutsättning:** Metro måste startas **utan** `EXPO_PUBLIC_SKIP_ONBOARDING=1`, annars kan steg 2–3 aldrig passera (bypassen körs före storage-läsningen).

Recept:

1. `await page.addInitScript(() => { localStorage.removeItem('eventpulse.onboarding_complete'); localStorage.removeItem('eventpulse.preferences.categories'); localStorage.setItem('eventpulse.language', 'sv'); })` — pinna `sv`, annars vinner enhetslokalen.
2. `await page.goto(BASE_URL)` → texten "Vad är du intresserad av?" ska synas, och `getByRole('checkbox')` ska ha count 7.
3. "Hoppa över" ska vara synlig (`getByRole('button', { name: 'Hoppa över' })`).
4. Tryck "Hoppa över" → `localStorage['eventpulse.onboarding_complete'] === '1'` och `localStorage['eventpulse.preferences.categories'] === '[]'`.
5. Med `eventpulse.onboarding_complete = '1'` före laddning ska onboarding **inte** visas.

## Gotchas

- **Rättat 2026-11-04:** det finns **en "skip"-knapp** ("Hoppa över"). Kartan sa att den saknades.
- **Rättat 2026-11-04:** nollställning av storage-nyckeln är **inte** ett alternativ till flaggan. `AppShell.js:345-351` returnerar före `getItem` på `:353` — med flaggan aktiv syns onboarding aldrig, oavsett localStorage.
- **Rättat 2026-11-04:** `e2e/search.test.mjs` innehåller **ingen** referens till `eventpulse.onboarding_complete` (skrevs om 2026-10-28). Den verkliga tredje bypassen är `globalThis.__SKIP_ONBOARDING__`.
- Nyckelnamnet är `eventpulse.onboarding_complete` (`AppShell.js:53` och `OnboardingScreen.js`). En **andra** nyckel finns: `eventpulse.preferences.categories`.
- `EXPO_PUBLIC_SKIP_ONBOARDING=1` finns i projektets `.env` och gör att onboarding **hoppas över** i dev-miljön. Flaggan läses vid **bundle-time** (babel-plugin inline-env-vars) ⇒ ändring i `.env` kräver **Metro-omstart**.
- AsyncStorage på web = `window.localStorage` **utan prefix** — nyckeln används ordagrant.
- RNW tappar `accessibilityState` ⇒ **ingen `aria-checked`**. Assertera state via localStorage och synlig text ("Fortsätt" vs "Fortsätt utan val").
- Demo-inloggning och juridiktexterna påverkar **inte** onboarding — de ligger efteråt i appen.
