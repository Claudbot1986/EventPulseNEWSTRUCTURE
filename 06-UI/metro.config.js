/**
 * Metro config for EventPulse Expo app.
 *
 * `resolver.resolveRequest` pekar om `react-native-maps` till en
 * web-stub (se ./web-shims/react-native-maps.js) när plattformen är
 * `web`. react-native-maps importerar react-native-internal
 * `codegenNativeCommands` på modul-top-level, vilket Metro vägrar
 * buntla för web. Utan alias kraschar hela web-builden — även för
 * användare som aldrig öppnar Karta-tabben — eftersom Metro
 * för-bundlar alla villkorliga requires.
 *
 * På iOS/Android pekar resolvern på riktiga react-native-maps i
 * node_modules, så native-byggen är orörda.
 *
 * `extraNodeModules` används inte här — den mappar paths, inte
 * modulnamn. `resolveRequest` är rätt API för per-modul aliasing.
 */

import { getDefaultConfig } from 'expo/metro-config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const shimPath = path.join(projectRoot, 'web-shims', 'react-native-maps.js');

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return { type: 'sourceFile', filePath: shimPath };
  }
  if (typeof defaultResolveRequest === 'function') {
    return defaultResolveRequest(context, moduleName, platform);
  }
  // Fallback: re-enter the resolver. `context.resolveRequest` is always
  // available on the context object (it points at the original resolver).
  return context.resolveRequest(context, moduleName, platform);
};

export default config;