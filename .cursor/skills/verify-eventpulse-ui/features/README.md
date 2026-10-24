# verify-eventpulse-ui/features — index

Detta är feature-map för verify-skill, speglad från `06-UI/FEATURE_MAP.md`. Samma numrering och status.

| # | Feature | Fil | Status | Native-unreachable del |
|---|---|---|---|---|
| 1 | save-favorite | `save-favorite.md` | live | – |
| 2 | push-notiser | `push-din-helg.md` (saknas) | behind-flag | ja |
| 3 | agent-chatt (UI) | `agent-chat-ui.md` (saknas) | live | – |
| 4 | utforska | `utforska.md` (saknas) | live | – |
| 5 | hem | `hem.md` (saknas) | live | – |
| 6 | karta | `karta.md` (saknas) | live | ja |
| 7 | sök | `search.md` (saknas) | live | – |
| 8 | onboarding | `onboarding.md` (saknas) | live | – |
| 9 | profil + gdpr | `profil.md` (saknas) | live | – |
| 10 | notifikationer (lista) | `notifications.md` (saknas) | live | – |
| 11 | bildgenerering | utanför — se `08-Agent` | experimental | – |
| 12 | autentisering | `auth.md` (saknas) | live | delvis (Apple-ID) |
| 13 | locale / i18n | `i18n.md` (saknas) | live | – |
| 14 | analytics | `analytics.md` (saknas) | live | – |
| 15 | helg-chips + intent | `helg-chips.md` (saknas) | live | – |

Status-kolumnen speglar `FEATURE_MAP.md`. Om de divergerar → uppdatera båda. Pilotsynk är maintenance-passets ansvar.

Cross-cutting concerns som INTE har egna feature-filer (per FEATURE_MAP):
- `06-UI/services/storage.js` (AsyncStorage wrapper)
- `06-UI/services/supabaseAuthClient.js`
- `06-UI/i18n/` (runtime)
- dark mode tokens

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`. Drift i någon av dessa är `verify-eventpulse-ui`-skillens ansvar — produktkod-drift rapporteras separat.
