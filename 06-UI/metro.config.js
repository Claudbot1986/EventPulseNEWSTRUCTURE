/**
 * Metro config for EventPulse Expo app.
 *
 * `resolver.resolveRequest` pekar om följande moduler till web-shims
 * när plattformen är `web`:
 *
 *   - `react-native-maps` → web-shims/react-native-maps.js
 *     react-native-maps importerar react-native-intern
 *     `codegenNativeCommands` på modul-top-level, vilket Metro vägrar
 *     buntla för web. Utan alias kraschar hela web-builden — även för
 *     användare som aldrig öppnar Karta-tabben — eftersom Metro
 *     för-bundlar alla villkorliga requires.
 *
 *   - `@supabase/supabase-js` och alla sub-moduler → egna shims i
 *     web-shims/<namn>.js. Bakgrunden är Metro Web:s hantering av
 *     Supabase-paketens conditional exports, som skapar två olika
 *     bundlade kopior (ESM vs CJS) av samma GoTrueClient-klass. Det
 *     gör `supabase.auth.signInWithOtp` till `undefined` vid call-time
 *     trots `typeof === 'function'` på module-load. Genom att route:a
 *     varje `@supabase/*`-paketnamn till en egen shim som require:ar
 *     motsvarande CJS-entry med statisk sträng (Metro-transformern
 *     förbjuder variabel-argument), pekar Metro:s `modules.get()` för
 *     `@supabase/auth-js` på samma fysiska modul som Supabase-klienten
 *     själv require:ar. Då finns EN enda GoTrueClient-instans.
 *
 * På iOS/Android pekar resolvern på riktiga moduler i node_modules, så
 * native-byggen är orörda.
 *
 * `extraNodeModules` används inte här — den mappar paths, inte
 * modulnamn. `resolveRequest` är rätt API för per-modul aliasing.
 *
 * `watchFolders` + `nodeModulesPaths` låter Metro resolva paket som
 * ligger i monorepo-roten (t.ex. `@supabase/supabase-js`, delad med
 * 08-Agent) utan att vi behöver installera en andra kopia i
 * 06-UI/node_modules. Web-build:et failade utan detta eftersom Metro
 * Web:s default-resolver stannar i workspace-roten.
 */

import { getDefaultConfig } from 'expo/metro-config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Per-paket-shim-path. EN skiftnyckel per top-level Supabase-paket —
// vi route:ar ALLA `@supabase/*`-paket som Metro Web annars skulle
// ladda via conditional exports. Vi fångar EXAKT modulnamn (inte
// `startsWith('@supabase/')`) för att inte trigga shim:ens egna
// `require()`-anrop och skapa cirkulära beroenden.
const shimMap = {
  'react-native-maps': path.join(projectRoot, 'web-shims', 'react-native-maps.js'),
  '@supabase/supabase-js': path.join(projectRoot, 'web-shims', 'supabase.js'),
  '@supabase/auth-js': path.join(projectRoot, 'web-shims', 'auth-js.js'),
  '@supabase/postgrest-js': path.join(projectRoot, 'web-shims', 'postgrest-js.js'),
  '@supabase/functions-js': path.join(projectRoot, 'web-shims', 'functions-js.js'),
  '@supabase/realtime-js': path.join(projectRoot, 'web-shims', 'realtime-js.js'),
  '@supabase/storage-js': path.join(projectRoot, 'web-shims', 'storage-js.js'),
};

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && Object.prototype.hasOwnProperty.call(shimMap, moduleName)) {
    return { type: 'sourceFile', filePath: shimMap[moduleName] };
  }
  if (typeof defaultResolveRequest === 'function') {
    return defaultResolveRequest(context, moduleName, platform);
  }
  // Fallback: re-enter the resolver. `context.resolveRequest` is always
  // available on the context object (it points at the original resolver).
  return context.resolveRequest(context, moduleName, platform);
};

export default config;