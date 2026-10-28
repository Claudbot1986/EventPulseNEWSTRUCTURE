# Analytics

## Sub-features

- Skickar till `POST ${EXPO_PUBLIC_ANALYTICS_URL}/api/events` → `10-Analytics/server.ts` (port 7778).
- Opt-out: `POST /api/gdpr/opt-out`.
- Consent-nyckel: `analytics.consent` (`'1'`/`'0'`) — i `services/analyticsClient.js`, inte i `storage.js`.
- `track()` är **no-op** om env-variabeln saknas, consent ≠ `'1'`, eller ingen aktiv user-id finns.
- Flush sker var ~2 s.
- Analytics startas bara för **permanenta konton** (`AppShell.js:398-400`).

## How to get to it (user POV)

Det finns ingen synlig analytics-yta; slåt upp via Profil → Integritet → "Anonym användarstatistik" (login-gated).

## Driving it with Playwright

Ingen spec ännu. Recept (standardbuild):

1. Fånga requests till `/api/events`.
2. Öppna appen, gå till Profil → Integritet.
3. Vänta 3 s.
4. **Asserta 0 requests** i en default-build (env-variabeln satt men inte konfigurerad i CI).

Vill du se en riktig POST: starta `10-Analytics` på 7778 och starta Metro med `EXPO_PUBLIC_ANALYTICS_URL=http://localhost:7778` → då ska en POST komma inom ~2 s med `{events:[…]}`.

## Gotchas

- **FEATURE_MAP § 14 säger "live" men det är det inte i en default-build.** `analyticsClient.js:13-17` säger själv att analytics inte är en funnel, och `EXPO_PUBLIC_ANALYTICS_URL` är "unset" enligt `docs/MASTERPLAN.md:109`.
- Consent ensamt räcker **inte** — det krävs även en aktiv user-id, vilket kräver permanent konto.
- Consent-nyckeln är **icke-namespaced** (`analytics.consent`), vilket bryter mot projektets egen konvention `eventpulse.*`.
- `clearActiveUser()` raderar consent medan `AnalyticsClient.logout()` behåller den → inkonsekvent GDPR-semantik mellan två utvägar.
