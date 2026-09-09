/**
 * Web-shim för `@supabase/postgrest-js`.
 */

const postgrestJs = require('@supabase/postgrest-js/dist/index.cjs');

module.exports = postgrestJs;
module.exports.default = postgrestJs.default || postgrestJs;