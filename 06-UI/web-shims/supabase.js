/**
 * Web-shim för `@supabase/supabase-js` (top-level).
 *
 * Why this exists:
 *   Metro Web:s ESM/CJS-resolver hanterar inte `@supabase/supabase-js`:s
 *   conditional exports (`{ import: { default }, require: { ... } }`)
 *   konsekvent. Resultatet blir två distinkta Supabase-instanser i samma
 *   bundle — en bundlad via ESM-entryn, en annan via CJS-entryn — där
 *   `supabase.auth.signInWithOtp` är `undefined` vid call-time trots
 *   `typeof === 'function'` på module-load. Det klassiska Metro Web
 *   dual-bundle-symptomet.
 *
 *   Denna shim tvingar EN ENDA ingång: vi require:ar CJS-entryn direkt
 *   med en statisk sträng (Metro-transformern tillåter bara statiska
 *   `require()`-argument; variabel-argument kastas med "Invalid call").
 *   `metro.config.js` route:ar exakt `@supabase/supabase-js` till denna
 *   shim på web — så hela trädet går genom samma `GoTrueClient`-instans.
 *
 * iOS/Android: resolvern returnerar default-modulen, shim:en läses
 * aldrig in. Native-byggen är orörda.
 */

const supabase = require('@supabase/supabase-js/dist/index.cjs');

module.exports = supabase;
// Default-export för ESM-import: `import supabase from '@supabase/supabase-js'`
module.exports.default = supabase.default || supabase;