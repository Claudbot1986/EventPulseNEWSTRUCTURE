# Autentisering (email-OTP)

## Sub-features

- Ingång: **Profil → "Lägg till e-post"** (gästgrenen) eller påminnelse-modalens knapp (visas efter ~3 min) eller Notiser-fliken.
- `AppShell` byter då ut fliken för en **hel-skärms** `LoginScreen` (inte en dialog): "Logga in med email", fält "din@email.com", knapp "Skicka magic link", "Avbryt".
- Steg 2: `CodeEntryScreen` — "Knappa in koden", "Skicka ny kod", "Ändra e-postadress".
- **Apple-inloggning är native-only** (`Platform.OS === 'ios'`) → på web syns ingen Apple-knapp.
- **Demologin (2026-11-04, `ecf8ff49`):** `signInWithPassword` i `supabaseAuthClient.js` + en demoruta i `LoginScreen.js`, gated på `EXPO_PUBLIC_ENABLE_DEMO_LOGIN === 'true'` **och** `EXPO_PUBLIC_DEMO_EMAIL`. Test-ID:n: `demo-login-email`, `demo-login-password`, `demo-login-submit`. Finns i `eas.json` production-env ⇒ syns i granskningsbygget. Lösenordet lever bara i `06-UI/.env` (gitignored) + App Store Connect "Notes for Review".
- Session lagras i `eventpulse.auth_session`. Logga ut raderar nyckeln lokalt men **ingen revocation sker server-side**; nästa kallstart får en ny anonym id.

## How to get to it (user POV)

Profil → "Lägg till e-post".

## Driving it with Playwright

Spec: `06-UI/e2e/demo-login.test.mjs` (2 tester + 1 skip). **Specen läser `06-UI/.env` själv** — Metro laddar samma fil, så specens syn på flaggan måste matcha appens.

Recept:

1. Öppna appen → klicka "Profil" (synlig `[role="tab"]`).
2. Klicka knappen **"Lägg till e-post"** (`getByRole('button', { name: 'Lägg till e-post' })`).
3. Assera att texten **"Logga in med email"** syns (det är en hel-skärm, inte en dialog).
4. Assera att **"Fortsätt med Apple" har count 0** på web.
5. Assera att demorutan syns **iff** `EXPO_PUBLIC_ENABLE_DEMO_LOGIN === 'true'` och `EXPO_PUBLIC_DEMO_EMAIL` är satt — annars ska `[data-testid="demo-login-submit"]` ha count 0.
6. Med flaggan på: fyll email/lösenord → tryck `demo-login-submit` → vänta ≤6 s → sidan ska visa "Inloggad".
7. Deterministiskt felfall som inte kräver e-post: fyll `getByPlaceholder('din@email.com')` med `asdf` → "Skicka magic link" → assera "Ogiltig email — kontrollera stavningen.".

## Gotchas

- **Copy-bug:** texten lovar "Vi skickar en magisk länk …" men flödet skickar en **6-siffrig kod**. Användaren förväntar sig fel sorts sak.
- "sent"-fallbacken i `LoginScreen.js:91-95` är död kod (`AppShell.js:544` går direkt vidare).
- Webb-OTP är en känd blockerare (`docs/MASTERPLAN.md:36`).
- Apple-inloggning: **verified-unreachable** på web — förutsättning är iOS-enhet/simulator.
- Utan session använder appen `signInAnonymously()`. **Rättat 2026-11-04:** det krävs INTE ett permanent konto för att analytics ska ha en user-id — den anonyma bootstrapen sätter identiteten (`supabaseAuthClient.js:253` → `storage.js:88`). Bara flush-loopen kräver permanent konto.
- **ProfileScreen läser sessionen bara vid mount** (`ProfileScreen.js:377-391`) — efter en demologin måste appen laddas om innan inloggad gren syns.
- Lösenordet får aldrig loggas eller committas. Läs det från `06-UI/.env` vid variabelnamn, skriv aldrig ut värdet.
