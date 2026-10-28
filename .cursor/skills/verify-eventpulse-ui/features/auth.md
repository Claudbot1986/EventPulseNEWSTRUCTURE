# Autentisering (email-OTP)

## Sub-features

- Ingång: **Profil → "Lägg till e-post"** (gästgrenen) eller påminnelse-modalens knapp (visas efter ~3 min) eller Notiser-fliken.
- `AppShell` byter då ut fliken för en **hel-skärms** `LoginScreen` (inte en dialog): "Logga in med email", fält "din@email.com", knapp "Skicka magic link", "Avbryt".
- Steg 2: `CodeEntryScreen` — "Knappa in koden", "Skicka ny kod", "Ändra e-postadress".
- **Apple-inloggning är native-only** (`Platform.OS === 'ios'`) → på web syns ingen Apple-knapp.
- Session lagras i `eventpulse.auth_session`. Logga ut raderar nyckeln lokalt men **s revocation sker inte server-side**; nästa kallstart får en ny anonym id.

## How to get to it (user POV)

Profil → "Lägg till e-post".

## Driving it with Playwright

Ingen spec ännu. Recept:

1. Öppna appen → klicka "Profil" (synlig `[role="tab"]`).
2. Klicka knappen **"Lägg till e-post"** (`getByRole('button', { name: 'Lägg till e-post' })`).
3. Assera att texten **"Logga in med email"** syns (det är en hel-skärm, inte en dialog).
4. Fyll i `getByPlaceholder('din@email.com')` → klicka "Skicka magic link".
5. Assera att "Knappa in koden" syns inom ~20 s (Supabase skickar 6-siffrig kod).
6. Assera att **"Fortsätt med Apple" har count 0** på web.

## Gotchas

- **Copy-bug:** texten lovar "Vi skickar en magisk länk …" men flödet skickar en **6-siffrig kod**. Användaren förväntar sig fel sorts sak.
- "sent"-fallbacken i `LoginScreen.js:91-95` är död kod (`AppShell.js:544` går direkt vidare).
- Webb-OTP är en känd blockerare (`docs/MASTERPLAN.md:36`).
- Apple-inloggning: **verified-unreachable** på web — förutsättning är iOS-enhet/simulator.
- Utan session använder appen `signInAnonymously()` → analytics kräver "permanent konto" för att köra (`AppShell.js:398-400`).
