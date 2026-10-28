# Push-notiser (Din helg)

## Sub-features

- `PushPromptModal` visas i **detaljskärmen** (`App.js:1776-1780`) med `onAccept`/`onDecline`.
- `services/pushTokenClient.js` registrerar en push-token och sätter `din_helg_push_enabled` i `user_preferences.preferences`.
- Modulen är **Expo Go-medveten**: `Constants.appOwnership === 'expo'` → `notificationsModule = null` → varje anrop ger `{ ok:false, warning:'unavailable' }` utan krasch.
- Token kräver EAS-projekt-id från `app.json → expo.extra.eas.projectId`; saknas det → `warning:'no-project-id'`.

## How to get to it (user POV)

Öppna ett event → spara det → push-prompten kan visas → "Tillåt" → OS-frågan.

## Driving it with Playwright

**verified-unreachable i både Expo Go och webbbygget.**

- Expo Go (SDK 53+): ingen fjärrpush. Modulen avbryter sig själv → prompten ska aldrig visas.
- Webb: `expo-notifications` har ingen webbimplementation.
- Native-verifiering kräver **dev build / TestFlight** (inte Expo Go) + fysisk enhet.

Det som går att verifiera överallt: att **modalens mount inte kraschar** och att push-opt-in-flödet är inert utan stöd.

## Gotchas

- **I Expo Go kan push aldrig verifieras.** Det är inte ett test-fel — det är plattformens gräns (`pushTokenClient.js:34-38` sätter `notificationsModule = null` när `Constants.appOwnership === 'expo'`).
- **`EXPO_PUBLIC_PUSH_ENABLED` används INGENSTANS i koden** (verifierat repo-wide). FEATURE_MAP § 2 och äldre skill-dokumentation påstår att flaggan styr push — den är stale. De verkliga grindarna är `isPushRuntimeAvailable()` + AsyncStorage-flaggan `eventpulse.din_helg_push_prompt_shown` (en gång per installation).
- På webb kastar `require('expo-notifications')` (Metro plockar `.native.js` även för web) → `loadNotifications()` fångar det → `null`. Därför visas push-prompten aldrig i webbbygget.
- `pushTokenClient.js:130-132` kollapsar varje fel till `warning:'unavailable'` — web, nekad behörighet och nätverksfel går inte att skilja åt i loggen.
- `expo-notifications` har i teorin en webbimplementation (`getDevicePushTokenAsync.web.js`), men `app.json` saknar `notification.vapidPublicKey` och `serviceWorkerPath` → även vägen för webbtoken är stängd.
- Push-prompten triggas av **♡-sparningen** (`NewEventCard` a11y "Spara" → `handleSaveToggle` → `maybePromptDinHelgPush`) — vilket är samma sparning som inte persisterar något (se `save-favorite.md`). Närmare vägen är alltså delvis död.
