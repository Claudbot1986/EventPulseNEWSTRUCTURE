/**
 * env-parse.mjs — EN parser för .env, som bash och launchd-plisten ser det.
 *
 * Varför (2026-10-28). Två verktyg läste .env med två olika regler:
 *
 *   - scripts/lib/preflight.mjs — trimmade INTE värdet, så `KEY=value `
 *     (slutblanksteg) flaggades som trasig, trots att bash parserar den.
 *   - scripts/verify-env-integrity.mjs — trimmade värdet, men hade ingen
 *     egen export — regeln var inline i ett CLI-skript.
 *
 * Resultatet: preflight och verifieringsskriptet kunde ge olika svar på
 * samma fil. En gate som säger "miljön är ren" medan kedjan startar med
 * en trasig .env är värre än ingen gate — det är den gröna ljugen i ny
 * dräkt.
 *
 * Regeln är bashs egen: `KEY=värde`, `KEY="värde med blanksteg"` eller
 * `KEY='värde med blanksteg'`. Ett ociterat värde med blanksteg splittas av
 * skalet i två ord — det är felet på .env rad 58 (`FLY_API_TOKEN2=FlyV1
 * fm2_abc`), där bash körde "fm2_abc" som ett kommando.
 *
 * Värden skrivs aldrig ut. Bara radnummer och skäl.
 */

import fs from 'fs';

/**
 * @typedef {{
 *   line: number,
 *   reason: string,
 * }} UnparsableLine
 */

/**
 * Nyckelnamn som bash tillåter.
 */
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Är värdet citationstecknat? Ett ensamt citattecken är inte citation.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isQuoted(value) {
  return (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  );
}

/**
 * Tolka .env-innehåll.
 *
 * @param {string} content
 * @returns {{ entries: Map<string, string>, unparsable: UnparsableLine[] }}
 */
export function parseEnvContent(content) {
  const entries = new Map();
  const unparsable = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      unparsable.push({ line: index + 1, reason: 'ingen "=" i raden' });
      return;
    }

    const key = trimmed.slice(0, eq).trim();
    if (!VALID_KEY.test(key)) {
      unparsable.push({ line: index + 1, reason: `ogiltigt nyckelnamn "${key}"` });
      return;
    }

    let value = trimmed.slice(eq + 1).trim();
    if (isQuoted(value)) {
      value = value.slice(1, -1);
    } else if (/\s/.test(value)) {
      // Ociterat värde med blanksteg → skalet splittar det i två ord.
      unparsable.push({ line: index + 1, reason: `ociterat värde med blanksteg (nyckel ${key})` });
      return;
    }
    entries.set(key, value);
  });

  return { entries, unparsable };
}

/**
 * Hitta rader i en .env-fil som INTE kan parses som KEY=VÄRDE av en shell.
 *
 * @param {string} envPath
 * @returns {UnparsableLine[]}
 */
export function findUnparsableEnvLines(envPath) {
  if (!fs.existsSync(envPath)) return [];
  const { unparsable } = parseEnvContent(fs.readFileSync(envPath, 'utf8'));
  return unparsable;
}

/**
 * Radnummer (1-baserade) med trasiga rader — kortformatet som preflighten
 * rapporterar.
 *
 * @param {string} envPath
 * @returns {number[]}
 */
export function findUnparsableEnvLineNumbers(envPath) {
  return findUnparsableEnvLines(envPath).map((u) => u.line);
}
