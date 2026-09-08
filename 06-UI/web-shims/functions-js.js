/**
 * Web-shim för `@supabase/functions-js`.
 */

const functionsJs = require('@supabase/functions-js/dist/module/index.js');

module.exports = functionsJs;
module.exports.default = functionsJs.default || functionsJs;