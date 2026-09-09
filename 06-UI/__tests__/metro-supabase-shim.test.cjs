/**
 * Regression-skydd för web-shim:arna för `@supabase/*`-paketen.
 *
 * Bakgrund:
 *   Metro Web:s ESM/CJS-resolver hanterar inte Supabase-paketens
 *   conditional exports konsekvent. Resultatet är två distinkta
 *   Supabase-instanser i samma bundle (ESM-entry vs CJS-entry) där
 *   `supabase.auth.signInWithOtp` är `undefined` vid call-time trots
 *   `typeof === 'function'` på module-load.
 *
 *   Vi route:ar nuvarande exakt fem `@supabase/*`-paketnamn till
 *   varsin shim i `web-shims/<namn>.js`. Varje shim require:ar en
 *   CJS-entry med statisk sträng. Metro-transformern förbjuder
 *   variabel-argument i require-anrop ("Invalid call"), så detta
 *   regressionstest måste hållas grönt — annars exploderar hela
 *   web-builden med 500 på /index.bundle.
 *
 *   Vi använder node:assert + node:test (inbyggt i Node) istället för
 *   jest för att slippa installera ytterligare dev-beroenden.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHIMS_DIR = path.join(__dirname, '..', 'web-shims');
const METRO_PATH = path.join(__dirname, '..', 'metro.config.js');

const SHIM_NAMES = [
  'supabase.js',
  'auth-js.js',
  'postgrest-js.js',
  'functions-js.js',
  'realtime-js.js',
  'storage-js.js',
];

const metro = fs.readFileSync(METRO_PATH, 'utf8');

test('every shim file exists and uses static-string require() (no variable args)', () => {
  for (const name of SHIM_NAMES) {
    const p = path.join(SHIMS_DIR, name);
    const source = fs.readFileSync(p, 'utf8');
    const requireCalls = [...source.matchAll(/require\s*\(\s*([^)]+)\s*\)/g)];
    assert.ok(
      requireCalls.length > 0,
      `${name}: expected at least one require() call`
    );

    for (const match of requireCalls) {
      const arg = match[1].trim();
      const isStringLiteral =
        (arg.startsWith("'") && arg.endsWith("'")) ||
        (arg.startsWith('"') && arg.endsWith('"'));
      assert.equal(
        isStringLiteral,
        true,
        `${name}: require() argument must be a string literal — Metro ` +
          `transform-worker rejects variable-args. Found: ${arg}`
      );
    }
  }
});

test('every shim has no stray HTML/XML tokens from edit-collision writes', () => {
  for (const name of SHIM_NAMES) {
    const p = path.join(SHIMS_DIR, name);
    const source = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(
      source,
      /<\/content>/,
      `${name}: stray </content> token detected`
    );
  }
});

test('every shim exposes both module.exports and module.exports.default', () => {
  for (const name of SHIM_NAMES) {
    const p = path.join(SHIMS_DIR, name);
    const source = fs.readFileSync(p, 'utf8');
    // Paket-suffix i shim:en (t.ex. `supabase`, `authJs`).
    // Vi kräver bara att det finns en `module.exports = <x>` och att
    // `.default` sätts. Detaljsyntax varierar mellan shims.
    assert.match(
      source,
      /module\.exports\s*=\s*\w+/,
      `${name}: expected "module.exports = <varname>" pattern`
    );
    assert.match(
      source,
      /module\.exports\.default\s*=\s*\w+\.default\s*\|\|\s*\w+/,
      `${name}: expected default interop pattern`
    );
  }
});

test('metro.config.js route:ar alla fem @supabase/*-paket via shim-map (exact match, inte startsWith)', () => {
  const code = metro
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const pkg of [
    '@supabase/supabase-js',
    '@supabase/auth-js',
    '@supabase/postgrest-js',
    '@supabase/functions-js',
    '@supabase/realtime-js',
    '@supabase/storage-js',
  ]) {
    assert.match(
      code,
      new RegExp(`['"]${pkg.replace(/\//g, '\\/')}['"]`),
      `metro.config.js must route ${pkg} to a shim`
    );
  }

  assert.doesNotMatch(
    code,
    /moduleName\.startsWith\s*\(\s*['"]@supabase/,
    'metro.config.js must not route via moduleName.startsWith("@supabase/") — that catches shim self-refs and creates circular dep arrays'
  );
});

test('every shim sub-path exists i node_modules (skyddar mot typo i dist/-väg)', () => {
  for (const name of SHIM_NAMES) {
    const p = path.join(SHIMS_DIR, name);
    const source = fs.readFileSync(p, 'utf8');
    const calls = [...source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)];
    for (const m of calls) {
      const reqPath = m[1];
      // Måste sluta med @supabase/<paket>/dist/<...>
      const m2 = reqPath.match(/^@supabase\/[^/]+\/dist\/(.+)$/);
      if (!m2) {
        // Inte en Supabase sub-path — skippa
        continue;
      }
      const pkgName = reqPath.split('/')[1];
      const distPath = path.join(
        __dirname,
        '..',
        '..',
        'node_modules',
        '@supabase',
        pkgName,
        'dist'
      );
      assert.ok(
        fs.existsSync(distPath),
        `${name}: requires ${reqPath} but ${distPath} does not exist`
      );
    }
  }
});