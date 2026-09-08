/**
 * Web-shim för `@supabase/storage-js`.
 */

const storageJs = require('@supabase/storage-js/dist/index.cjs');

module.exports = storageJs;
module.exports.default = storageJs.default || storageJs;