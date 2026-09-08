/**
 * Web-shim för `@supabase/auth-js`.
 *
 * Spegel av `supabase.js`: route:ar exakt `@supabase/auth-js` till
 * CJS-entryn i Metro web runtime. Det garanterar att vi får samma
 * GoTrueClient-instans som Supabase-klienten själv require:ar, så
 * `client.auth.signInWithOtp` är kopplad till rätt prototyp-metod.
 */

const authJs = require('@supabase/auth-js/dist/module/index.js');

module.exports = authJs;
module.exports.default = authJs.default || authJs;