/**
 * Web-shim för `@supabase/realtime-js`.
 */

const realtimeJs = require('@supabase/realtime-js/dist/module/index.js');

module.exports = realtimeJs;
module.exports.default = realtimeJs.default || realtimeJs;