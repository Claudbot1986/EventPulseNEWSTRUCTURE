# Analytics

## Sub-features

- Skickar till `POST ${EXPO_PUBLIC_ANALYTICS_URL}/api/events` → `10-Analytics/server.ts` (port 7778).
- Opt-out: `POST /api/gdpr/opt-out`.
- Consent-nyckel: `analytics.consent` (`'1'`/`'0'`) — i `services/analyticsClient.js`, inte i `storage.js`.
- `track()` är **no-op** om env-variabeln saknas, consent ≠ `'1'`, eller ingen aktiv user-id finns.
- Flush sker var ~2 s (och direkt vid ≥10 köade events).
- **Identiteten sätts av anonym bootstrap också** (`bootstrapSession()` → `signInAnonymously()` → `setActiveUser`) — det är bara **flush-loopen** som kräver permanent konto (`AppShell.js:240-242, 269-271, 398-401`).
- **`EXPO_PUBLIC_ANALYTICS_URL` ÄR satt** i `06-UI/.env` ⇒ i en lokal Metro-build är env-gaten ÖPPEN. 0 requests gäller bara en gäst utan consent.
- Identitet = `analytics.active_user` → deterministisk 64-hex `device_id_hash` (`analyticsClient.js:76-116`).

## How to get to it (user POV)

Det finns ingen synlig analytics-yta; slåt upp via Profil → Integritet → "Anonym användarstatistik" (login-gated).

## Driving it with Playwright

Ingen spec ännu. Recept (standardbuild):

1. Fånga requests till `/api/events` med `page.route('**/api/events', …)`.
2. Öppna appen som **gäst** → gå till Profil → Integritet. Växeln ska **inte** syns för gäst (`analytics-consent-switch` count 0).
3. Vänta 3 s → **assera 0** intercepted `/api/events` POSTs (gästen har ingen consent ⇒ gaten stängd).
4. Vill du se en riktig POST: logga in med demologin (`EXPO_PUBLIC_ENABLE_DEMO_LOGIN=true` + `EXPO_PUBLIC_DEMO_EMAIL`), gå till Profil → Integritet, toggla **"Anonym användarstatistik"** PÅ, vänta ≤3 s → förvänta ≥1 POST med `{events:[…]}` som innehåller `session_start`. Toggla AV → förvänta ett POST till `/api/gdpr/opt-out` med `device_id_hash`.

## Gotchas

- **FEATURE_MAP § 14 säger "live" men det är det inte i en default-build.** `analyticsClient.js:13-17` säger själv att analytics inte är en funnel. **Rättat 2026-11-04:** env-variabeln är inte "unset" — `EXPO_PUBLIC_ANALYTICS_URL` **är satt** i `06-UI/.env` (port 7778). I en lokal build är porten alltså öppen; 0 requests gäller bara en gäst utan consent.
- Consent ensamt räcker **inte** — det krävs även en aktiv user-id. Men identiteten sätts av den **anonyma** bootstrapen, så "permanent konto" är **inte** kravet (bara flush-loopen kräver det). Rättat 2026-11-04.
- Consent-nyckeln är **icke-namespaced** (`analytics.consent`), vilket bryter mot projektets egen konvention `eventpulse.*`.
- `clearActiveUser()` raderar consent medan `AnalyticsClient.logout()` behåller den → inkonsekvent GDPR-semantik mellan två utvägar.
- RNW renderar `Switch` som `input[type=checkbox][role=switch]` ⇒ välj via `getByRole('switch', …)`, inte via `[type=checkbox]` generellt.
- **Ny (2026-11-04):** demologin ger en permanent session ⇒ identity öppnar och flush-loopen startar (`LoginScreen.js` → `supabaseAuthClient.js` → `storage.js` → `AppShell.js:269-271`). Det är inte dokumenterat någonstans i kartmaterialet.
