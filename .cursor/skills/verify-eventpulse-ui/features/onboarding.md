# Onboarding

## Sub-features

- Första-lopps-skärm med val av intressekategorier.
- Kan hoppas över; appen sparar `eventpulse.onboarding_complete = '1'` i AsyncStorage (= `window.localStorage` på web).
- Finns **ingen** "skip"-knapp i UI:t — fullborda eller stäng via env-flaggan.

## How to get to it (user POV)

Appen visar onboarding första gången den startas på en enhet.

## Driving it with Playwright

Ingen spec ännu — feature-filen beskriver läget. Recept:

1. `await page.addInitScript(() => localStorage.removeItem('eventpulse.onboarding_complete'))`.
2. `await page.goto(BASE_URL)` → onboarding ska visas.
3. Välj en kategori → tryck primärknappen → `eventpulse.onboarding_complete` ska vara `'1'` och Hem ska visas.
4. Med `localStorage.setItem('eventpulse.onboarding_complete', '1')` före laddning ska onboarding **inte** visas.

## Gotchas

- `EXPO_PUBLIC_SKIP_ONBOARDING=1` finns i projektets `.env` och gör att onboarding **hoppas över** i dev-miljön. Därför ser en vanlig drive aldrig onboarding — sätt flaggan till 0 eller nollställ storage-nyckeln för att verifiera den.
- Nyckelnamnet är `eventpulse.onboarding_complete` (verifierat i `AppShell.js:53` och `OnboardingScreen.js`).
- AsyncStorage på web = `window.localStorage` **utan prefix** — nyckeln används ordagrant.
- Påverkar även `e2e/search.test.mjs` gamla påstående om nyckeln — det stämmer.
