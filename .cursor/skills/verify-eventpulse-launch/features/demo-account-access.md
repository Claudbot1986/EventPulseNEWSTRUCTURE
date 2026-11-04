# Granskarens inloggning

## Sub-features

- Demologin i inloggningsskärmen (gated bakom
  `EXPO_PUBLIC_ENABLE_DEMO_LOGIN=true` + `EXPO_PUBLIC_DEMO_EMAIL`).
- Lösenordsinloggning via `supabaseAuthClient.signInWithPassword`.
- Att demodelen är **helt osynlig** när flaggan är av.
- Att inloggningen ger en riktig session (Profil → "Inloggad").

## How to get to it (user POV)

Profil → **Lägg till e-post** → rulla ner till **Demologin för App Review**
→ fyll i e-post och lösenord → **Logga in som demo**. E-postadressen är
ifylld; lösenordet står i App Store Connect → Notes for Review.

## Driving it with Playwright

```bash
cd 06-UI
set -a && . ./.env && set +a
BASE_URL=http://localhost:9090 npx playwright test e2e/demo-login.test.mjs
```

Tre fall: (1) demodelen syns när flaggan är på, (2) inloggningen ger
signerad session och inget felmeddelande, (3) demodelen finns **inte** när
flaggan är av (fallet skippas när flaggan är på).

Kontot ligger i Supabase: `demo@eventpulse.nu`. Lösenordet i
`06-UI/.env` (`EXPO_PUBLIC_DEMO_PASSWORD`) — **aldrig i git**.

## Gotchas

- **Flaggan är bundle-time.** Ändra `.env` → starta om Metro, annars kör
  webbygget med den gamla flaggan.
- **Rätt logga in som användare, inte som reviewer.** Appen bygger en
  *anonym* session först; demoläget loggar in på den. Det är korrekt — det
  är samma konto (samma user.id) som du senare kan koppla din e-post till.
- **Kan inte köras headless utan uppgifter.** Specen skippar sig om
  `EXPO_PUBLIC_DEMO_EMAIL`/`_PASSWORD` saknas i miljön.
- **Stäng av efter godkännande.** Radera användaren i Supabase (inget nytt
  bygg behövs) eller bygg om utan `EXPO_PUBLIC_ENABLE_DEMO_LOGIN`.
- **Lösenordet får inte hamna i git.** `eas.json` får inte innehålla
  `PASSWORD` — `check-app-config.mjs` assertar det.
