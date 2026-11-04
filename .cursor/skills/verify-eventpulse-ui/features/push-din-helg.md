# Push-notiser (Din helg)

## Sub-features

- `PushPromptModal` visas i **detaljskärmen** (`App.js:1806-1810`) med `onAccept`/`onDecline`. Test-ID:n: `push-prompt-modal`, `push-prompt-accept`, `push-prompt-decline`.
- Utlösare: ♡-sparningen (`handleSaveToggle` → `maybePromptDinHelgPush`, `App.js:1587-1596`) ⇒ engångsflaggan `eventpulse.din_helg_push_prompt_shown` + `isPushRuntimeAvailable()` (`pushTokenClient.js:65-67`). Acceptera ⇒ flagga + `enableDinHelgPush()`; neka ⇒ bara flaggan.
- `services/pushTokenClient.js` registrerar en push-token och sätter `din_helg_push_enabled` i `user_preferences.preferences`.
- Modulen är **Expo Go-medveten**: `Constants.appOwnership === 'expo'` → `notificationsModule = null` → varje anrop ger `{ ok:false, warning:'unavailable' }` utan krasch (`pushTokenClient.js:34-38`).
- Token kräver EAS-projekt-id från `app.json → expo.extra.eas.projectId`; saknas det → `warning:'no-project-id'`.
- Profilens två push-växlar: `follow-push-switch` (bara serverflagga) och `din-helg-push-switch` (riktig behörighet + token, med rollback `ProfileScreen.js:549-566`). **Båda ligger i den INLOGGADE grenen** — `ProfileScreen.js:671-673` returnerar gästgrenen först.

## How to get to it (user POV)

Öppna ett event → spara det → push-prompten visas → "Tillåt" → OS-frågan.

## Driving it with Playwright

**Native-verifiering kräver dev build / TestFlight (inte Expo Go) + fysisk enhet.**

**På webb syns prompten — det är INTE verified-unreachable.** Verifierat live 2026-11-04: efter att ha tryckt ♡ på ett eventkort renderades `[data-testid="push-prompt-modal"]` med texten "Vill du få Din helg varje vecka?" (se beviset nedan).

Recept (webb):

1. `boot(page, BASE_URL)`; rensa `localStorage['eventpulse.din_helg_push_prompt_shown']` (AsyncStorage på web = rå localStorage-nyckel).
2. Öppna första Hem-kortet → tryck `[aria-label="Spara"]` med pointer-events.
3. **Avgörande assertion:** `[data-testid="push-prompt-modal"]` ska **vara synlig**. Acceptera → `push-prompt-accept` → inga `POST /agent/push-token` (ingen token på web) och flaggan satt.
4. Spara ett annat event → prompten ska **inte** komma tillbaka (engångsflaggan).
5. Efter demologin + `page.reload()`: `din-helg-push-switch` och `follow-push-switch` ska synas i Profil. Slå "Din helg" till ⇒ den **går tillbaka till AV** utan synlig feiltruta (RNW:s `Alert` är en no-op) och utan push-token-POST.

## Gotchas

- **I Expo Go kan push aldrig verifieras.** Det är inte ett test-fel — det är plattformens gräns (`pushTokenClient.js:34-38` sätter `notificationsModule = null` när `Constants.appOwnership === 'expo'`).
- **`EXPO_PUBLIC_PUSH_ENABLED` används INGENSTANS i koden** (verifierat repo-wide). FEATURE_MAP § 2 och äldre skill-dokumentation påstår att flaggan styr push — den är stale. De verkliga grindarna är `isPushRuntimeAvailable()` + AsyncStorage-flaggan `eventpulse.din_helg_push_prompt_shown` (en gång per installation).
- **Rättat 2026-11-04:** `expo-notifications` v58.1.7 **har** webbimplementationer (`getDevicePushTokenAsync.web.js`, `NotificationPermissionsModule.js` med browser Notification API). `require('expo-notifications')` kastar **inte** på web. Den gamla förklaringen ("Metro plockar `.native.js` även för web") är FEL.
- **Rättat 2026-11-04:** `isPushRuntimeAvailable()` returnerar **true på webb** (`Constants.appOwnership` är `null` där, inte `'expo'`). Därför **visas** push-prompten i webbbygget — den är bara **inert** (ingen token). Bevis: live-probe 2026-11-04, `[data-testid="push-prompt-modal"]` renderades efter ♡-spara.
- Konsekvens av det: webbbygget förbrukar engångsflaggan på prompten utan att någonsin registrera en token.
- `pushTokenClient.js:130-132` kollapsar varje fel till `warning:'unavailable'` — web, nekad behörighet och nätverksfel går inte att skilja åt i loggen.
- `app.json` saknar `notification.vapidPublicKey` och `serviceWorkerPath` ⇒ vägen för webbtoken är stängd, men **prompten syns ändå**.
- Push-prompten triggas av **♡-sparningen** — vilket är samma sparning som inte återhydreras (se `save-favorite.md`). Profilens push-växlar kräver **inloggning** (demologin + reload).
- `Alert.alert` är en **no-op på web** ⇒ rollbacken är tyst. Ett felande värde syns alltså inte.
