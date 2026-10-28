#!/usr/bin/env node
/**
 * verify-env-integrity.mjs — GATE: .env är läsbar och parseras utan fel.
 *
 * Varför (2026-10-28). `.env` rad 58 (FLY_API_TOKEN2) hade ett värde med
 * ett blanksteg och utan citattecken. `. ./.env` i launchd-plisten kastade
 * då `unknown command "TOKEN2"` — bash fortsatte (körande `set -a` utan
 * `set -e`), så felet var osynligt. Under tre nätter var kedjans fel
 * dessutom "nätet dog", vilket gjorde det extra lätt att skylla på något
 * annat.
 *
 * Gaten provar tre saker:
 *   1. Varje rad i .env kan parsas (eller är en kommentar/tom rad).
 *   2. `bash -c 'set -a; source .env; set +a'` går rent igenom.
 *   3. Nycklarna kedjan behöver finns och är inte placeholders.
 *
 * Värden skrivs ALDRIG ut — bara nyckelnamn, längder och felrader.
 *
 * Användning:
 *   node scripts/verify-env-integrity.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseEnvContent } from './lib/env-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

/** Nycklar kedjan behöver. Placeholder = inte användbar. */
const REQUIRED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'EXA_API_KEY',
  'SCRAPINGBEE_API_KEY',
];

const PLACEHOLDER_PATTERN = /_FAKE_|_PLACEHOLDER_|REPLACE_ME|TODO|FIXME|^$/i;

let ok = true;
const fail = (msg) => {
  console.error(`  FAIL: ${msg}`);
  ok = false;
};

// ── 1. Finns filen? ────────────────────────────────────────────────────────
if (!fs.existsSync(ENV_PATH)) {
  fail(`.env finns inte (${ENV_PATH})`);
  process.exit(1);
}
const raw = fs.readFileSync(ENV_PATH, 'utf8');
const lines = raw.split('\n');
console.log(`[verify-env-integrity] .env: ${lines.length} rader`);

// ── 2. Kan varje rad parsas? ───────────────────────────────────────────────
// Samma regel som runtime OCH som preflighten: KEY=value, KEY="value" eller
// KEY='value'. En rad med ett blanksteg i ett ociterat värde är INTE giltig —
// det är precis felet som fanns på rad 58.
//
// 2026-10-28 — regeln bor i scripts/lib/env-parse.mjs. Den var inline här
// och SKILDE sig från preflightens (den trimmade inte värdet).Två verktyg
// som säger olika saker om samma fil är en gate som inte går att lita på.
const { entries: parsed, unparsable } = parseEnvContent(raw);

if (unparsable.length > 0) {
  for (const u of unparsable) fail(`rad ${u.line}: ${u.reason}`);
} else {
  console.log(`  OK: alla ${parsed.size} nycklar parsas (inga olåsta rader)`);
}

// ── 3. Kan bash source:a filen? ────────────────────────────────────────────
const bash = spawnSync(
  '/bin/bash',
  ['-c', `set -a; source "${ENV_PATH}"; set +a; echo SOURCE_OK`],
  { encoding: 'utf8' },
);
if (bash.status !== 0) {
  fail(`bash kunde inte source:a .env (exit ${bash.status}): ${(bash.stderr || '').trim().split('\n')[0] || 'okänt fel'}`);
} else if (!/SOURCE_OK/.test(bash.stdout || '')) {
  fail('bash source:a .env men skrev inte SOURCE_OK');
} else {
  console.log('  OK: `source .env` går rent igenom i bash');
}

// ── 4. Nycklarna som kedjan behöver ────────────────────────────────────────
for (const key of REQUIRED_KEYS) {
  const value = parsed.get(key);
  if (value === undefined) {
    fail(`${key} saknas i .env`);
    continue;
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    fail(`${key} är en placeholder (längd ${value.length})`);
    continue;
  }
  // Längd visas, inte värdet.
  console.log(`  OK: ${key} finns (längd ${value.length})`);
}

console.log(ok ? '\n[verify-env-integrity] GRÖN' : '\n[verify-env-integrity] RÖD');
process.exit(ok ? 0 : 1);
