# FEATURE_MAP.md — UI Feature Inventory

> Stream B.0 (Agent Trust Plan 2026-10-09) / Pstack-stil: katalog över UI-features med status, ägare, scope.

**Senast uppdaterad:** 2026-10-09

## Syfte

FEATURE_MAP är **kartan** som Stream B (UI without micromanagement) använder för att avgöra:
- Vilka features som hör ihop och bör bli `feature-as-directory` (Stream B.1).
- Vilka features som är "cross-cutting" och hör hemma på andra ställen.
- Vilka features som redan är feature-as-directory och inte ska röras.

Det viktigaste: **inte varje komponent är en feature**. En feature är ett *sammanhängande user-facing beteende* med egen state + API-koppling + tester. `EventPulseCard.js` ensamt är INTE en feature — det är en presentationskomponent.

## Konventioner

| Status | Betydelse |
|--------|-----------|
| `draft` | Idéfas, inte implementerad |
| `live` | I produktion, använd av riktiga användare |
| `behind-flag` | Kodad men inaktiverad via feature-flag / miljövariabel |
| `experimental` | Kodad, använd av delmängd av användare |
| `deprecated` | Markerad för borttagning |
| `archived` | Borttagen, flyttad till archive/ |

## Feature-inventory

### 1. Sparade events (save_favorite)
- **Status:** live
- **Ägare:** 06-UI (huvudarkitekt)
- **Scope:** användare markerar ett event som sparat → persistent lokalt + moln (vid inloggad)
- **Filer idag:** `06-UI/services/notificationsClient.js` (spara-toggle), `06-UI/components/UtforskaEventActionSheet.js` (UI-trigger), 06-UI storage layer
- **Tester:** delvis via `agentClient.test.ts` (mockad)
- **Streams som berör:** B.1 (feature-as-directory-kandidat), C.0 (M3-signal för ground truth)
- **Risk vid migration:** medium — använd-state skickas som del av agentClient-svaret (cross-cutting)

### 2. Push-notiser (push_din_helg / push_token)
- **Status:** behind-flag (`EXPO_PUBLIC_PUSH_ENABLED`)
- **Ägare:** 08-Agent (server-side cron) + 06-UI (registrering)
- **Scope:** server skickar push-notis på torsdagar 17:00 med helgens rekommendationer
- **Filer idag:** `08-Agent/cron/push_din_helg.ts`, `06-UI/services/pushTokenClient.js`, `06-UI/components/PushPromptModal.js`
- **Streams som berör:** C.4 (lesson-encoded: locale-handling, device-not-registered)
- **Risk vid migration:** hög — multiple entry points + iOS/Android-skillnad

### 3. Agent-chatt (parse_intent → search_events → rank_events)
- **Status:** live
- **Ägare:** 08-Agent (server) + 06-UI (skärm)
- **Scope:** fritext → top-5 rekommendationer
- **Filer idag:** `06-UI/app/AgentScreen.js`, `06-UI/services/agentClient.js`, `08-Agent/server.ts` + 6 tools
- **Streams som berör:** C.0+C.1, C.2, C.4 (alla tre M3-streams)
- **Risk vid migration:** mycket hög — huvudsaklig produkt-yta

### 4. Utforska (UtforskaScreen)
- **Status:** live (med dev-flag `EXPO_PUBLIC_EXPLORE_TILES`)
- **Ägare:** 06-UI
- **Scope:** tiles + filter + sökning
- **Filer idag:** `06-UI/components/UtforskaSection.js`, `06-UI/utils/browseFilters.js`, `06-UI/utils/promptIntent.js`, `06-UI/utils/weekendIntent.js`
- **Streams som berör:** B.2 (visual regression)
- **Risk vid migration:** medium — väl separerad från andra features

### 5. Hem ("Senaste", "Rekommenderat", "Förslag", "Sparade", "Din helg")
- **Status:** live (med TILE-aktivering)
- **Ägare:** 06-UI
- **Scope:** 5 hemtiles med olika datakällor
- **Filer idag:** `06-UI/screens/HomeScreen.js`, `06-UI/screens/home/`, `06-UI/components/EventPulseCard.js`, `06-UI/components/EventPulseCarousel.js`
- **Streams som berör:** B.2 (visual regression)

### 6. Karta (KartaScreen)
- **Status:** live
- **Ägare:** 06-UI
- **Scope:** Stockholm-karta med markers
- **Filer idag:** `06-UI/screens/KartaScreen.js`, `06-UI/components/MapEventCard.js`, `06-UI/utils/mapProjection.js`
- **Streams som berör:** B.2 (visual regression)

### 7. Sök (SearchScreen + chip intent)
- **Status:** live
- **Ägare:** 06-UI
- **Scope:** sökfritext + intent-chips
- **Filer idag:** `06-UI/screens/SearchScreen.js`, `06-UI/utils/chipCatalog.testkit.ts`, `06-UI/utils/chipSimulation.test.ts`

### 8. Onboarding (OnboardingScreen)
- **Status:** live
- **Ägare:** 06-UI
- **Scope:** kategori-val vid första start
- **Filer idag:** `06-UI/screens/OnboardingScreen.js`

### 9. Profil + GDPR (ProfileScreen + Integritet)
- **Status:** live
- **Ägare:** 06-UI + 10-Analytics
- **Scope:** inställningar, GDPR-samtycke, utloggning
- **Filer idag:** `06-UI/screens/ProfileScreen.js`, `06-UI/components/LegalModal.js`, `06-UI/services/analyticsClient.js`
- **Streams som berör:** C.4 (lesson: GDPR-data-flöde)

### 10. Notifikationer (NotificationsScreen)
- **Status:** live
- **Ägare:** 06-UI + 10-Analytics
- **Scope:** lista över mottagna push-notiser
- **Filer idag:** `06-UI/screens/NotificationsScreen.js`, `06-UI/services/notificationsClient.js`

### 11. Bildgenerering (ai-image, BFL)
- **Status:** experimental (1/30-kvot, round5-pipeline)
- **Ägare:** 08-Agent (services/imageGen.ts, workers/aiImageWorker.ts)
- **Scope:** AI-genererade bilder för events utan bild
- **Filer idag:** `08-Agent/services/imageGen.ts`, `08-Agent/utils/imageLibrary.ts`, `08-Agent/workers/aiImageWorker.ts`, `08-Agent/tools/ai_compliance.ts`
- **Streams som berör:** utanför Stream B (separat beslut 2026-09-23 pausades)

### 12. Autentisering + profilbyte (Sign-in, MagicLink, Anon)
- **Status:** live
- **Ägare:** 06-UI + Supabase
- **Scope:** e-post-OTP primär inloggning, anonym för gäster, device-verifierad linking
- **Filer idag:** `06-UI/screens/LoginScreen.js`, `06-UI/screens/CodeEntryScreen.js`, `06-UI/services/api-server.cjs`

### 13. Locale / i18n (10 språk)
- **Status:** live (vissa språk deploy-pending)
- **Ägare:** 06-UI + 08-Agent (locale-läsning)
- **Scope:** ar/fa/so/pl/tr/de/it/zh-Hans/en/sv
- **Filer idag:** `06-UI/i18n/`, `11-Translation/translate-batch.mjs`

### 14. Analytics (10-Analytics + 06-UI integration)
- **Status:** live (Phase 1.5 acceptance 2026-09-23)
- **Ägare:** 10-Analytics + 06-UI
- **Scope:** insamling + lagring + GDPR-erase
- **Filer idag:** `10-Analytics/`, `06-UI/services/analyticsClient.js`

### 15. Helg-chips + intent-pipeline (HELG_*, IMORGEN, GRATIS…)
- **Status:** live
- **Ägare:** 06-UI
- **Scope:** browseFilters + chipCatalog → applicera intent på Utforska
- **Filer idag:** `06-UI/utils/browseFilters.js`, `06-UI/utils/promptIntent.js`, `06-UI/utils/weekendIntent.js`

## Cross-cutting concerns (INTE features)

| Concern | Plats | Anledning |
|---------|-------|-----------|
| Storage (AsyncStorage wrapper) | `06-UI/services/` | Återanvänds av flera features — INTE egen feature |
| Auth client (Supabase) | `06-UI/services/` | Samma |
| I18n runtime | `06-UI/i18n/` | Samma |
| Dark mode / theme | global | Samma |
| Toast / modal primitives | `06-UI/components/Toast.js`, `06-UI/components/PushPromptModal.js` | Samma |

## Feature-as-directory-kandidater (Stream B.1)

Två features som passar för `features/<name>/`-katalogen:

1. **save-favorite** — `06-UI/features/save-favorite/{feature.api.js, feature.ui.js, feature.test.ts, feature.routes.js}`. Klar avgränsning, persisterad state, ett UI-trigger-ställe.
2. **share-session** — *ny feature* — låter användaren dela en agent-session (URL med query-state). Lämplig pilot EFTERSOM den är ny och vi kan välja strukturen från start.

## Vad som INTE är feature-as-directory-material

- `EventPulseCard.js`, `EventPulseSenasteCard.js`, `NewEventCard.js` — presentationskomponenter, återanvänds av flera features.
- `tabBar.js`, `BottomTabBar.js` — navigation primitives.
- `pushTokenClient.js` — backend-IO som inte har egen UI-state.
