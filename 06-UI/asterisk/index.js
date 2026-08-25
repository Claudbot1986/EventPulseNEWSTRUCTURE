/**
 * `*` — AI Event Posters test page
 * Separate Expo entry. Started via:
 *   cd 06-UI && EXPO_PUBLIC_BFL_API_KEY=bfl_... npx expo start --entry-file ./asterisk/index.js
 *
 * No effect on main app flow (06-UI/App.js is untouched).
 */
import { registerRootComponent } from 'expo';
import AsteriskApp from './App';

registerRootComponent(AsteriskApp);